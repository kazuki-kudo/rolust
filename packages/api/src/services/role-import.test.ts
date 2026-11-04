import { PutCommand } from "@aws-sdk/lib-dynamodb";
import type { TrustPolicyDocument } from "@rolust/core";
import type { LocalizedMessage } from "@rolust/core";
import { ValidationError, localized, plainMessage, renderMessage } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { IamOperationError, toIamOperationError } from "../aws/iam-client.js";
import type { IamTrustPolicyReader } from "../aws/iam-client.js";
import {
  TEST_MANAGED_TAG_KEY,
  TEST_MANAGED_TAG_VALUE,
  conditionalCheckFailed,
  ddbMock,
  setupDdbMock,
} from "../testing/ddb-mock.js";
import type { ImportPlan } from "./role-import.js";
import { TrustPolicyUnavailableError, readImportPlans, writeImport } from "./role-import.js";

/** en の描画に日本語が残っていないことの検査に使う（ひらがな・カタカナ・漢字）。 */
const JAPANESE = /[぀-ヿ一-鿿]/;

const POOL_ID = "platform-team";
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const BILLING = "arn:aws:iam::555566667777:role/BillingViewer";
/** デプロイ先と別アカウントのロール。読み取りクライアントが、ロールのアカウントに応じて資格情報を選ぶ（Issue #85）。 */
const OTHER_ACCOUNT_ROLE = "arn:aws:iam::888899990000:role/DataPlatformAdmin";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const NOW = "2026-09-30T00:00:00.000Z";
/** 許可するアカウント（Issue #139）。AYAKA・KENJI のアカウント。 */
const ALLOWED = new Set(["111122223333"]);
const STRANGER = "arn:aws:iam::999900001111:user/mallory";

function policyOf(...principals: string[]): TrustPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { AWS: principals }, Action: "sts:AssumeRole" }],
  };
}

/** ロール ARN → 信頼ポリシー（または投げる例外）。読んだロールを `reads` に記録する偽の読み取りクライアント。 */
function readerOf(
  byRole: Record<string, TrustPolicyDocument | Error>,
): IamTrustPolicyReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async getTrustPolicy(roleArn: string): Promise<TrustPolicyDocument> {
      reads.push(roleArn);
      const entry = byRole[roleArn];
      if (entry === undefined) throw new Error(`テストの設定漏れ: ${roleArn}`);
      if (entry instanceof Error) throw entry;
      return entry;
    },
  };
}

beforeEach(() => {
  // loadConfig()（管理対象タグ）を読むエラー文言のために、環境変数を既知の値にそろえる。
  setupDdbMock();
});

describe("readImportPlans（Issue #80 spec 3.4 手順 4）", () => {
  it("信頼ポリシーを読み、取り込む IAM ユーザの ARN（昇順）を返す", async () => {
    const iam = readerOf({ [DEPLOY]: policyOf(KENJI, AYAKA, "arn:aws:iam::111122223333:role/Ops") });

    const plans = await readImportPlans([DEPLOY], iam);

    expect(iam.reads).toEqual([DEPLOY]);
    expect(plans).toEqual([{ roleArn: DEPLOY, userArns: [AYAKA, KENJI] }]);
  });

  it("取り込める IAM ユーザがいなければ userArns は空（紐づけだけを行う）", async () => {
    const iam = readerOf({ [DEPLOY]: policyOf("arn:aws:iam::111122223333:root") });

    expect(await readImportPlans([DEPLOY], iam)).toEqual([{ roleArn: DEPLOY, userArns: [] }]);
  });

  it("デプロイ先と別アカウントのロールも、同じように信頼ポリシーを読み、取り込む IAM ユーザを返す（Issue #85。前の spec の D-10 を覆す）", async () => {
    const iam = readerOf({ [OTHER_ACCOUNT_ROLE]: policyOf(KENJI, AYAKA) });

    const plans = await readImportPlans([OTHER_ACCOUNT_ROLE], iam);

    // ロールの ARN のまま渡す。どの資格情報で読むかは、読み取りクライアントがロールのアカウントで選ぶ。
    expect(iam.reads).toEqual([OTHER_ACCOUNT_ROLE]);
    expect(plans).toEqual([{ roleArn: OTHER_ACCOUNT_ROLE, userArns: [AYAKA, KENJI] }]);
  });

  it("ターゲット側のロールを引き受けられなければ 502 で拒否し、引き受けの失敗の文言（原因と直し方）をそのまま返す", async () => {
    const iam = readerOf({
      [OTHER_ACCOUNT_ROLE]: new IamOperationError(
        "assume-role",
        "AccessDenied",
        OTHER_ACCOUNT_ROLE,
        plainMessage("アカウント 888899990000 のロール RolustTrustPolicyReader を引き受けられませんでした（AccessDenied）。docs/guide/cross-account.md の手順で作成してください。"),
      ),
    });

    const attempt = readImportPlans([OTHER_ACCOUNT_ROLE], iam);

    await expect(attempt).rejects.toBeInstanceOf(TrustPolicyUnavailableError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 502, retryable: false });
    await expect(attempt).rejects.toThrow(/RolustTrustPolicyReader を引き受けられませんでした/);
    await expect(attempt).rejects.toThrow("docs/guide/cross-account.md");
  });

  it("デプロイ先を判定できなければ（読み取りクライアントが IAM を呼ばずに止めた失敗）、502 で拒否する", async () => {
    const iam = readerOf({
      [DEPLOY]: new IamOperationError(
        "deploy-account-unknown",
        "DeployAccountUnknown",
        DEPLOY,
        plainMessage("デプロイ先の AWS アカウント ID を判定できないため、IAM を呼ばずに止めました。"),
      ),
    });

    const attempt = readImportPlans([DEPLOY], iam);

    await expect(attempt).rejects.toBeInstanceOf(TrustPolicyUnavailableError);
    await expect(attempt).rejects.toMatchObject({ statusCode: 502, retryable: false });
    await expect(attempt).rejects.toThrow(/DeployAccountUnknown/);
  });

  it("ロールが AWS に存在しなければ 400（ValidationError）で、コードと直し方を示す", async () => {
    const iam = readerOf({ [DEPLOY]: new IamOperationError("not-found", "NoSuchEntity", DEPLOY, plainMessage("not found")) });

    const attempt = readImportPlans([DEPLOY], iam);

    await expect(attempt).rejects.toBeInstanceOf(ValidationError);
    await expect(attempt).rejects.toThrow(/DeployProd.*AWS に存在しません.*NoSuchEntity/);
  });

  it("権限不足（AccessDenied）は 502 で、AWS のコードと、管理対象タグ・CRUD の実行ロールの権限のどちらかを示す（GI-6）。別アカウントなら Reader の権限も示す", async () => {
    const iam = readerOf({ [DEPLOY]: new IamOperationError("access-denied", "AccessDenied", DEPLOY, plainMessage("not authorized")) });

    const attempt = readImportPlans([DEPLOY], iam);

    await expect(attempt).rejects.toMatchObject({ statusCode: 502, retryable: false });
    await expect(attempt).rejects.toThrow(/AccessDenied/);
    await expect(attempt).rejects.toThrow(new RegExp(`${TEST_MANAGED_TAG_KEY}=${TEST_MANAGED_TAG_VALUE}`));
    await expect(attempt).rejects.toThrow(/crud_iam_read_trust/);
    await expect(attempt).rejects.toThrow(/Reader ロールに iam:GetRole/);
  });

  it("存在しないロール・権限不足の文言に、ロールのアカウント ID を入れる（デプロイ先に同名のロールがあっても、どのアカウントのロールかを取り違えない。spec D-10）", async () => {
    const notFound = readerOf({
      [OTHER_ACCOUNT_ROLE]: new IamOperationError("not-found", "NoSuchEntity", OTHER_ACCOUNT_ROLE, plainMessage("not found")),
    });
    await expect(readImportPlans([OTHER_ACCOUNT_ROLE], notFound)).rejects.toThrow(/888899990000/);

    const denied = readerOf({
      [OTHER_ACCOUNT_ROLE]: new IamOperationError("access-denied", "AccessDenied", OTHER_ACCOUNT_ROLE, plainMessage("not authorized")),
    });
    await expect(readImportPlans([OTHER_ACCOUNT_ROLE], denied)).rejects.toThrow(/888899990000/);
  });

  it("スロットリングは再試行可の 502、それ以外は AWS のコードとメッセージを載せた 502", async () => {
    const throttled = readerOf({ [DEPLOY]: new IamOperationError("throttling", "Throttling", DEPLOY, plainMessage("Rate exceeded")) });
    await expect(readImportPlans([DEPLOY], throttled)).rejects.toMatchObject({
      statusCode: 502,
      retryable: true,
    });

    const unknown = readerOf({ [DEPLOY]: new IamOperationError("unknown", "ServiceFailure", DEPLOY, plainMessage("boom")) });
    const attempt = readImportPlans([DEPLOY], unknown);
    await expect(attempt).rejects.toMatchObject({ statusCode: 502, retryable: false });
    await expect(attempt).rejects.toThrow(/ServiceFailure.*boom/);
  });

  it("1 件でも読めなければ、全体が失敗する（成功したロールの分だけを返さない）", async () => {
    const iam = readerOf({
      [DEPLOY]: policyOf(AYAKA),
      [BILLING]: new IamOperationError("access-denied", "AccessDenied", BILLING, plainMessage("not authorized")),
    });

    await expect(readImportPlans([DEPLOY, BILLING], iam)).rejects.toBeInstanceOf(
      TrustPolicyUnavailableError,
    );
  });

  it("IamOperationError 以外の例外は変換せずに投げる（握りつぶさない）", async () => {
    const iam = readerOf({ [DEPLOY]: new TypeError("想定外") });

    await expect(readImportPlans([DEPLOY], iam)).rejects.toBeInstanceOf(TypeError);
  });

  it("足すロールが無ければ何も読まない", async () => {
    const iam = readerOf({});

    expect(await readImportPlans([], iam)).toEqual([]);
    expect(iam.reads).toEqual([]);
  });
});

describe("writeImport（Issue #80 spec 3.4 手順 5.2）", () => {
  const plan: ImportPlan = { roleArn: DEPLOY, userArns: [AYAKA, KENJI] };

  function puts(): { sk: unknown; condition: unknown; item: Record<string, unknown> | undefined }[] {
    return ddbMock.commandCalls(PutCommand).map((call) => ({
      sk: call.args[0].input.Item?.sk,
      condition: call.args[0].input.ConditionExpression,
      item: call.args[0].input.Item,
    }));
  }

  it("未登録のユーザだけ IamUser を作り、交点は全員 checked = reflected = true で書く（ユーザ → 交点の順）", async () => {
    ddbMock.on(PutCommand).resolves({});
    const registered = new Set([AYAKA]);

    const result = await writeImport(POOL_ID, plan, registered, NOW, ALLOWED);

    expect(result).toEqual({ userCount: 2, registeredCount: 1, skippedCount: 0 });
    expect(puts().map((entry) => entry.sk)).toEqual([
      `ASSIGN#${AYAKA}#${DEPLOY}`,
      `USER#${KENJI}`,
      `ASSIGN#${KENJI}#${DEPLOY}`,
    ]);
    const assignment = puts().find((entry) => entry.sk === `ASSIGN#${KENJI}#${DEPLOY}`);
    expect(assignment?.item).toMatchObject({ checked: true, reflected: true, userArn: KENJI, roleArn: DEPLOY });
    // 登録したユーザは、以後の呼び出しで再登録しない。
    expect(registered).toEqual(new Set([AYAKA, KENJI]));
  });

  it("IamUser の Put が競合したら（すでに登録されていた）、新規登録に数えず、交点は書く", async () => {
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(PutCommand, { Item: { sk: `USER#${KENJI}` } }).rejects(conditionalCheckFailed());

    const result = await writeImport(POOL_ID, plan, new Set([AYAKA]), NOW, ALLOWED);

    expect(result).toEqual({ userCount: 2, registeredCount: 0, skippedCount: 0 });
    expect(puts().map((entry) => entry.sk)).toContain(`ASSIGN#${KENJI}#${DEPLOY}`);
  });

  it("同じ registered を渡した 2 ロール目は、1 ロール目で登録したユーザを再登録しない", async () => {
    ddbMock.on(PutCommand).resolves({});
    const registered = new Set<string>();

    const first = await writeImport(POOL_ID, { roleArn: DEPLOY, userArns: [AYAKA] }, registered, NOW, ALLOWED);
    const second = await writeImport(POOL_ID, { roleArn: BILLING, userArns: [AYAKA, KENJI] }, registered, NOW, ALLOWED);

    expect([first.registeredCount, second.registeredCount]).toEqual([1, 1]);
    expect(puts().filter((entry) => String(entry.sk).startsWith("USER#")).map((entry) => entry.sk)).toEqual([
      `USER#${AYAKA}`,
      `USER#${KENJI}`,
    ]);
  });

  it("許可リストに無いアカウントの未登録ユーザは、登録も交点も書かず、skippedCount に数える（Issue #139）", async () => {
    ddbMock.on(PutCommand).resolves({});

    const result = await writeImport(POOL_ID, { roleArn: DEPLOY, userArns: [AYAKA, STRANGER] }, new Set(), NOW, ALLOWED);

    expect(result).toEqual({ userCount: 2, registeredCount: 1, skippedCount: 1 });
    expect(puts().map((entry) => entry.sk)).toEqual([`USER#${AYAKA}`, `ASSIGN#${AYAKA}#${DEPLOY}`]);
  });

  it("すでに登録済みのユーザは、そのアカウントが許可リストから外れていても、これまでどおり取り込む（Issue #139）", async () => {
    ddbMock.on(PutCommand).resolves({});

    const result = await writeImport(POOL_ID, { roleArn: DEPLOY, userArns: [STRANGER] }, new Set([STRANGER]), NOW, ALLOWED);

    expect(result).toEqual({ userCount: 1, registeredCount: 0, skippedCount: 0 });
    expect(puts().map((entry) => entry.sk)).toEqual([`ASSIGN#${STRANGER}#${DEPLOY}`]);
  });

  it("取り込むユーザがいなければ何も書かない", async () => {
    const result = await writeImport(POOL_ID, { roleArn: DEPLOY, userArns: [] }, new Set(), NOW, ALLOWED);

    expect(result).toEqual({ userCount: 0, registeredCount: 0, skippedCount: 0 });
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

describe("読み取りの失敗の localized（Issue #94）", () => {
  const COMMON = { roleName: "DeployProd", accountId: "555566667777" };

  async function failureOf(roleArn: string, error: IamOperationError): Promise<Error & { localized: unknown }> {
    const caught: unknown = await readImportPlans([roleArn], readerOf({ [roleArn]: error })).catch(
      (thrown: unknown) => thrown,
    );
    return caught as Error & { localized: unknown };
  }

  it("not-found は import.roleNotInAws（ValidationError。field は roleArns）", async () => {
    const error = await failureOf(DEPLOY, new IamOperationError("not-found", "NoSuchEntity", DEPLOY, plainMessage("not found")));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).field).toBe("roleArns");
    expect(error.localized).toEqual(localized("import.roleNotInAws", { ...COMMON, errorCode: "NoSuchEntity" }));
    expect(error.message).toBe(
      "IAM ロール「DeployProd」（アカウント 555566667777）は AWS に存在しません（NoSuchEntity）。" +
        "ロールが削除された可能性があります。IAM ロール管理で登録を確かめてください。",
    );
  });

  it("access-denied は import.readDenied（管理対象タグの key と value を持つ）", async () => {
    const error = await failureOf(DEPLOY, new IamOperationError("access-denied", "AccessDenied", DEPLOY, plainMessage("no")));

    expect(error).toBeInstanceOf(TrustPolicyUnavailableError);
    expect(error.localized).toEqual(
      localized("import.readDenied", {
        ...COMMON,
        errorCode: "AccessDenied",
        managedTagKey: TEST_MANAGED_TAG_KEY,
        managedTagValue: TEST_MANAGED_TAG_VALUE,
      }),
    );
    expect(error.message).toBe(
      `IAM ロール「DeployProd」（アカウント 555566667777）の信頼ポリシーを読み取れませんでした（AccessDenied）。` +
        `ロールに管理対象タグ（${TEST_MANAGED_TAG_KEY}=${TEST_MANAGED_TAG_VALUE}）が付いていない可能性と、` +
        "CRUD Lambda の実行ロールに iam:GetRole が付いていない可能性があります" +
        "（infra/lambda.tf の crud_iam_read_trust。terraform apply が最新か確認してください）。" +
        "別アカウントのロールなら、ターゲットアカウントの Reader ロールに iam:GetRole が付いていない可能性もあります" +
        "（docs/guide/cross-account.md）。",
    );
  });

  it("throttling は import.readThrottled（再試行可）", async () => {
    const error = await failureOf(DEPLOY, new IamOperationError("throttling", "Throttling", DEPLOY, plainMessage("Rate exceeded")));

    expect(error).toMatchObject({ retryable: true });
    expect(error.localized).toEqual(localized("import.readThrottled", { ...COMMON, errorCode: "Throttling" }));
    expect(error.message).toBe(
      "IAM ロール「DeployProd」（アカウント 555566667777）の信頼ポリシーを読み取れませんでした（Throttling）。" +
        "しばらくしてから、もう一度保存してください。",
    );
  });

  it("それ以外は import.readFailed。cause は内側の IamOperationError.localized（AWS の文）", async () => {
    const aws = Object.assign(new Error("boom"), { name: "ServiceFailure" });
    const inner = toIamOperationError(aws, DEPLOY, "iam:GetRole");
    const error = await failureOf(DEPLOY, inner);

    expect(error.localized).toEqual(
      localized("import.readFailed", { ...COMMON, errorCode: "ServiceFailure", cause: inner.localized }),
    );
    expect(error.message).toBe(
      "IAM ロール「DeployProd」（アカウント 555566667777）の信頼ポリシーを読み取れませんでした（ServiceFailure）: boom",
    );
  });

  it("AWS の文が空のときの import.readFailed は、ja が現行と同じ定型文で、en に日本語が混ざらない", async () => {
    const aws = Object.assign(new Error(""), { name: "ServiceFailure" });
    const error = await failureOf(DEPLOY, toIamOperationError(aws, DEPLOY, "iam:GetRole"));

    expect(error.message).toBe(
      "IAM ロール「DeployProd」（アカウント 555566667777）の信頼ポリシーを読み取れませんでした（ServiceFailure）: iam:GetRole に失敗しました",
    );
    const en = renderMessage("en", error.localized as LocalizedMessage);
    expect(en).toBe(
      'Could not read the trust policy of the IAM role "DeployProd" (account 555566667777) (ServiceFailure): iam:GetRole failed',
    );
    expect(en).not.toMatch(JAPANESE);
  });

  it("AWS の文が無い IamOperationError（iam.emptyPolicy・iam.deployAccountUnknown）が default に落ちても、ja は従来と同じ文で、en に日本語が混ざらない", async () => {
    const empty = await failureOf(
      DEPLOY,
      new IamOperationError("unknown", "EmptyAssumeRolePolicyDocument", DEPLOY, localized("iam.emptyPolicy", {})),
    );
    expect(empty.message).toBe(
      "IAM ロール「DeployProd」（アカウント 555566667777）の信頼ポリシーを読み取れませんでした（EmptyAssumeRolePolicyDocument）: IAM が信頼ポリシー文書を返しませんでした",
    );
    const emptyEn = renderMessage("en", empty.localized as LocalizedMessage);
    expect(emptyEn).toBe(
      'Could not read the trust policy of the IAM role "DeployProd" (account 555566667777) (EmptyAssumeRolePolicyDocument): IAM did not return a trust policy document',
    );
    expect(emptyEn).not.toMatch(JAPANESE);

    const unknownInner = new IamOperationError(
      "deploy-account-unknown",
      "DeployAccountUnknown",
      DEPLOY,
      localized("iam.deployAccountUnknown", { roleArn: DEPLOY }),
    );
    const unknown = await failureOf(DEPLOY, unknownInner);
    // ja は従来の `${head}: ${error.message}` と同じ。
    expect(unknown.message).toBe(
      "IAM ロール「DeployProd」（アカウント 555566667777）の信頼ポリシーを読み取れませんでした（DeployAccountUnknown）: " +
        unknownInner.message,
    );
    const unknownEn = renderMessage("en", unknown.localized as LocalizedMessage);
    expect(unknownEn).toContain("(DeployAccountUnknown): The AWS account ID of the deployment could not be determined");
    expect(unknownEn).not.toMatch(JAPANESE);
  });

  it("assume-role は、内側の IamOperationError.localized をそのまま運ぶ", async () => {
    const inner = new IamOperationError(
      "assume-role",
      "AccessDenied",
      OTHER_ACCOUNT_ROLE,
      localized("iam.assumeRoleFailed", {
        accountId: "888899990000",
        assumeRoleName: "RolustTrustPolicyReader",
        code: "AccessDenied",
        detail: null,
      }),
    );

    const error = await failureOf(OTHER_ACCOUNT_ROLE, inner);

    expect(error).toBeInstanceOf(TrustPolicyUnavailableError);
    expect(error.localized).toBe(inner.localized);
    expect(error.message).toBe(inner.message);
  });
});
