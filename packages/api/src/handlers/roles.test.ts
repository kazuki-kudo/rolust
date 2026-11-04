import {
  BatchGetCommand,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { RegisterRoleResponse, RolesResponse, TrustPolicyDocument } from "@rolust/core";
import { ValidationError, localized, plainMessage } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, ConflictError, NotFoundError } from "../errors.js";
import type * as AllowedAccounts from "../aws/allowed-accounts.js";
import { IamOperationError } from "../aws/iam-client.js";
import type { IamRoleTagClient, IamTrustPolicyReader } from "../aws/iam-client.js";
import type { RequestContext, Route } from "../http.js";
import {
  TEST_MANAGED_TAG_KEY,
  TEST_MANAGED_TAG_VALUE,
  TEST_POOL_ID,
  ddbMock,
  setupDdbMock,
} from "../testing/ddb-mock.js";
import { createRoleRoutes } from "./roles.js";

/**
 * FR-2.1 / FR-7.2 — ロール登録時のタグ検証（Step 18-B）。
 *
 * IAM ポリシー側（`infra/main.tf`）が `aws:ResourceTag/<key> = <value>` で絞り込まれて
 * いるため、タグが合わないロールは反映時に `AccessDenied` になる。**登録の時点で弾く**
 * ことと、弾いた場合に DynamoDB へ一切書かないことを固定する。
 *
 * 3 つの失敗（タグ不在 / 値不一致 / ロール不在）は原因も対処も違うため、
 * **文面が分かれていること**もここで固定する。同じ文面にすると、運用者は
 * タグを付けに行って存在しないロールを探すことになる。
 */

// 許可リストの SSM 読み取りは、実 AWS を呼ばず差し替える（Issue #139）。
vi.mock("../aws/allowed-accounts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof AllowedAccounts>()),
  getAllowedAccountIds: vi.fn(async () => new Set(["111122223333"])),
}));

const ROLE_ARN = "arn:aws:iam::123456789012:role/ReadOnlyAudit";

function stubTags(tags: Record<string, string>): IamRoleTagClient {
  return { listRoleTags: vi.fn().mockResolvedValue(tags) };
}

function failingTags(error: unknown): IamRoleTagClient {
  return { listRoleTags: vi.fn().mockRejectedValue(error) };
}

function postRole(
  iamTags: IamRoleTagClient,
  accountId: string,
  roleName: string,
  /** API Gateway が渡すデプロイ先アカウント。`null` は判定不能（検証は行う）。 */
  deployAccountId: string | null = null,
  trust: IamTrustPolicyReader = trustOf(),
): Promise<{ statusCode: number; body: unknown }> {
  const route = createRoleRoutes({ iamTags, iamTrust: trust }).find(
    (entry: Route) => entry.method === "POST",
  );
  if (!route) throw new Error("POST /roles のルートが見つかりません");

  const context: RequestContext = {
    method: "POST",
    path: "/roles",
    params: {},
    query: {},
    body: { accountId, roleName },
    deployAccountId,
    actor: null, permission: "apply",
  };
  return route.handler(context);
}

async function capture(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error;
  }
}

/** 信頼ポリシーを読むクライアント（登録は信頼ポリシーも読む。Issue #135）。既定は取り込むユーザのいない文書。 */
function trustOf(result: TrustPolicyDocument | Error = { Version: "2012-10-17", Statement: [] }): IamTrustPolicyReader {
  return {
    getTrustPolicy: vi.fn().mockImplementation(async () => {
      if (result instanceof Error) throw result;
      return result;
    }),
  };
}

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(GetCommand).resolves({});
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(PutCommand).resolves({});
  // 登録が確かめる固定プールの META
  ddbMock.on(GetCommand, { Key: { pk: `POOL#${TEST_POOL_ID}`, sk: "META" } }).resolves({
    Item: { pk: `POOL#${TEST_POOL_ID}`, sk: "META", itemType: "UserPool", poolId: TEST_POOL_ID, createdAt: "2026-10-07T00:00:00.000Z" },
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /roles のタグ検証", () => {
  it("管理対象のタグが付いたロールは登録できる", async () => {
    const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE });

    const result = await postRole(iamTags, "123456789012", "ReadOnlyAudit");

    expect(result.statusCode).toBe(201);
    expect(iamTags.listRoleTags).toHaveBeenCalledWith(ROLE_ARN);
    // 登録は、固定プールへの紐づけ（PoolRoleLink）と IamRole の 2 件を書く。IamRole が最後（Issue #135）。
    const items = ddbMock.commandCalls(PutCommand).map((call) => call.args[0].input.Item);
    expect(items.map((item) => item?.itemType)).toEqual(["PoolRoleLink", "IamRole"]);
    expect(items[1]?.arn).toBe(ROLE_ARN);
  });

  it("登録の応答は、登録したロールと信頼ポリシーからの取り込みの結果を返す（Issue #135）", async () => {
    const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE });
    const trust = trustOf({
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", Principal: { AWS: "arn:aws:iam::111122223333:user/ayaka.mori" }, Action: "sts:AssumeRole" },
      ],
    });

    const result = await postRole(iamTags, "123456789012", "ReadOnlyAudit", null, trust);

    expect((result.body as RegisterRoleResponse).imported).toEqual({
      roleArn: ROLE_ARN,
      userCount: 1,
      registeredCount: 1,
      skippedCount: 0,
    });
  });

  it("信頼ポリシーを読めなければ 502 で、何も書かない（Issue #135）", async () => {
    const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE });
    const trust = trustOf(new IamOperationError("access-denied", "AccessDenied", ROLE_ARN, plainMessage("denied")));

    const error = await capture(postRole(iamTags, "123456789012", "ReadOnlyAudit", null, trust));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(502);
    expect((error as ApiError).message).toContain("AccessDenied");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("登録済みのロールは 409 で、何も書かない（Issue #135）", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${ROLE_ARN}` } }).resolves({
      Item: { pk: "ROLE", sk: `ROLE#${ROLE_ARN}`, itemType: "IamRole", accountId: "123456789012", roleName: "ReadOnlyAudit", arn: ROLE_ARN, createdAt: "2026-10-07T00:00:00.000Z" },
    });
    const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE });

    const error = await capture(postRole(iamTags, "123456789012", "ReadOnlyAudit"));

    expect(error).toBeInstanceOf(ConflictError);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  /**
   * Rolust 自身の実行ロールの登録（Issue #194 H-1）。
   *
   * IAM 側の `DenySelfEscalation` は、タグが付いていても反映を拒否する。しかし拒否は操作の連鎖の
   * 末尾（反映）で初めて現れるため、**登録の時点でも**返す（CLAUDE.md「制約は、それを作り込んだ
   * 操作の場でも検証して返す」）。判定は AWS を呼ばずに済むので、タグ検証より前に置く。
   */
  describe("Rolust 自身の実行ロール（Issue #194）", () => {
    it("自分の実行ロールは 400 で弾き、AWS も DynamoDB も呼ばない", async () => {
      const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE });

      const error = await capture(postRole(iamTags, "123456789012", "rolust-apply-exec", "123456789012"));

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).field).toBe("roleName");
      // 何が・なぜ・どう直すか（GI-6）。タグを外す対処まで含める。
      expect((error as ValidationError).message).toContain("rolust-apply-exec");
      expect((error as ValidationError).message).toContain("aws iam untag-role");
      // タグ検証より前に弾く（AWS への問い合わせを無駄にしない）。
      expect(iamTags.listRoleTags).not.toHaveBeenCalled();
      expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    });

    it("大文字小文字が違うだけのロール名も弾く（IAM の名前は大小だけ違う 2 つを作れない）", async () => {
      const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE });

      const error = await capture(postRole(iamTags, "123456789012", "ROLUST-Apply-Exec", "123456789012"));

      expect(error).toBeInstanceOf(ValidationError);
      expect(iamTags.listRoleTags).not.toHaveBeenCalled();
    });

    it("別アカウントの同名ロールは弾かない（自己ロールはアカウント ID とロール名の対で決まる）", async () => {
      const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE });

      const result = await postRole(iamTags, "999988887777", "rolust-apply-exec", "123456789012");

      expect(result.statusCode).toBe(201);
    });
  });

  it("ロール名は管理対象かどうかを決めない（接頭辞方式との違い）", async () => {
    // 接頭辞方式では `RolustManaged-` で始まらない名前は弾かれていた。
    // タグ方式では名前は判定に関与せず、タグだけが判定材料である。
    const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE });

    const result = await postRole(iamTags, "123456789012", "any-legacy-name");

    expect(result.statusCode).toBe(201);
  });

  it("タグが無いロールは 400 で弾き、DynamoDB へ書かない", async () => {
    const iamTags = stubTags({ Environment: "prod" });

    const error = await capture(postRole(iamTags, "123456789012", "ReadOnlyAudit"));

    expect(error).toBeInstanceOf(ValidationError);
    // 対処（tag-role コマンド）まで含めて返す（GI-6）。
    expect((error as ValidationError).message).toContain("aws iam tag-role");
    expect((error as ValidationError).message).toContain(TEST_MANAGED_TAG_KEY);
    // 反映まで進んでから AccessDenied で気づくのを防ぐのが目的なので、
    // 「登録はされたが使えない」状態を作らないことまで固定する。
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("タグの値が一致しないロールも弾く（IAM は StringEquals で完全一致を要求する）", async () => {
    const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: "false" });

    const error = await capture(postRole(iamTags, "123456789012", "ReadOnlyAudit"));

    expect(error).toBeInstanceOf(ValidationError);
    // 実際の値を隠さずに出す。何が入っているか分からないと直しようがない。
    expect((error as ValidationError).message).toContain("false");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("タグ不在と値不一致は別の文面で返す", async () => {
    const absent = (await capture(
      postRole(stubTags({}), "123456789012", "ReadOnlyAudit"),
    )) as ValidationError;
    const mismatch = (await capture(
      postRole(stubTags({ [TEST_MANAGED_TAG_KEY]: "false" }), "123456789012", "ReadOnlyAudit"),
    )) as ValidationError;

    expect(absent.message).not.toBe(mismatch.message);
    expect(absent.message).toContain("付いていません");
    expect(mismatch.message).toContain("一致しません");
  });

  it("ロールが存在しない場合は 400 で弾き、タグの話ではなく実在の話として返す", async () => {
    const iamTags = failingTags(
      new IamOperationError("not-found", "NoSuchEntity", ROLE_ARN, plainMessage("Role not found")),
    );

    const error = await capture(postRole(iamTags, "123456789012", "ReadOnlyAudit"));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain("存在しません");
    // タグを付けに行かせない。存在しないロールにタグは付けられない。
    expect((error as ValidationError).message).not.toContain("aws iam tag-role");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("実行ロールの権限不足は 400 ではなく 502 で返す（入力を直しても解決しない）", async () => {
    const iamTags = failingTags(
      new IamOperationError("access-denied", "AccessDenied", ROLE_ARN, plainMessage("not authorized")),
    );

    const error = await capture(postRole(iamTags, "123456789012", "ReadOnlyAudit"));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(502);
    // 直すべき場所（デプロイ側）を名指しする。
    expect((error as ApiError).message).toContain("iam:ListRoleTags");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("別アカウントのロールも、同じ検証をする。管理対象のタグが付いていれば登録できる（FR-2.2 / Must。Issue #85）", async () => {
    // タグを読むクライアントが、ロールのアカウントに応じて資格情報を選ぶ（ターゲット側の Reader を引き受ける）。
    const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE });

    const result = await postRole(iamTags, "999988887777", "ReadOnlyAudit", "123456789012");

    expect(result.statusCode).toBe(201);
    expect(iamTags.listRoleTags).toHaveBeenCalledWith("arn:aws:iam::999988887777:role/ReadOnlyAudit");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(2); // PoolRoleLink と IamRole（Issue #135）
  });

  it("別アカウントのロールにタグが無ければ、同アカウントと同じく 400 で弾き、何も書かない（Issue #85）", async () => {
    const iamTags = stubTags({});

    const error = await capture(postRole(iamTags, "999988887777", "ReadOnlyAudit", "123456789012"));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain("付いていません");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("別アカウントのロールのタグの直し方は、ターゲットアカウントの資格情報で実行するよう示す（デプロイ先に同名のロールがあると、別のロールにタグが付くため。Issue #85）", async () => {
    const cases: Record<string, string>[] = [{}, { [TEST_MANAGED_TAG_KEY]: "false" }];
    for (const tags of cases) {
      const error = await capture(postRole(stubTags(tags), "999988887777", "ReadOnlyAudit", "123456789012"));

      expect(error).toBeInstanceOf(ValidationError);
      const { message } = error as ValidationError;
      expect(message).toContain("aws iam tag-role --role-name ReadOnlyAudit");
      expect(message).toContain("ターゲットアカウント 999988887777 の資格情報で実行");
    }
  });

  it("同アカウントのロールのタグの直し方は、これまでどおり（ターゲットアカウントの注記を付けない）", async () => {
    const error = await capture(postRole(stubTags({}), "123456789012", "ReadOnlyAudit", "123456789012"));

    expect((error as ValidationError).message).toContain("aws iam tag-role --role-name ReadOnlyAudit");
    expect((error as ValidationError).message).not.toContain("ターゲットアカウント");
  });

  it("別アカウントのロールが存在しなければ、同アカウントと同じく 400 で、実在の話として返す（Issue #85）", async () => {
    const iamTags = failingTags(
      new IamOperationError("not-found", "NoSuchEntity", "arn:aws:iam::999988887777:role/ReadOnlyAudit", plainMessage("not found")),
    );

    const error = await capture(postRole(iamTags, "999988887777", "ReadOnlyAudit", "123456789012"));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain("存在しません");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("別アカウントの権限不足は 502 で、直す場所（ターゲットアカウントの Reader）と手順書（docs/guide/cross-account.md）を示す。デプロイ側の直し方は示さない（Issue #85）", async () => {
    vi.stubEnv("ROLUST_TARGET_READER_ROLE_NAME", "RolustTrustPolicyReader");
    vi.stubEnv("ROLUST_TARGET_MANAGER_ROLE_NAME", "RolustTrustPolicyManager");
    const iamTags = failingTags(
      new IamOperationError("access-denied", "AccessDenied", "arn:aws:iam::999988887777:role/ReadOnlyAudit", plainMessage("not authorized")),
    );

    const error = await capture(postRole(iamTags, "999988887777", "ReadOnlyAudit", "123456789012"));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(502);
    const { message } = error as ApiError;
    expect(message).toContain("999988887777");
    expect(message).toContain("RolustTrustPolicyReader");
    expect(message).toContain("iam:ListRoleTags");
    expect(message).toContain("docs/guide/cross-account.md");
    // 同アカウントの文言（CRUD Lambda の実行ロールの権限）は出さない。直す場所が違う。
    expect(message).not.toContain("crud_iam_read_tags");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("ターゲット側のロールを引き受けられなければ 502 で、引き受けの失敗の文言をそのまま返し、何も書かない（Issue #85）", async () => {
    const assumeFailure = new IamOperationError(
      "assume-role",
      "AccessDenied",
      "arn:aws:iam::999988887777:role/ReadOnlyAudit",
      plainMessage("アカウント 999988887777 のロール RolustTrustPolicyReader を引き受けられませんでした（AccessDenied）。"),
    );

    const error = await capture(
      postRole(failingTags(assumeFailure), "999988887777", "ReadOnlyAudit", "123456789012"),
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(502);
    expect((error as ApiError).code).toBe("TagLookupUnavailable");
    expect((error as ApiError).message).toBe(assumeFailure.message);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("デプロイ先を判定できなければ 502 で、何も書かない（同じアカウントか別アカウントか決められないため）", async () => {
    const unknown = new IamOperationError(
      "deploy-account-unknown",
      "DeployAccountUnknown",
      ROLE_ARN,
      plainMessage("デプロイ先の AWS アカウント ID を判定できないため、IAM を呼ばずに止めました。"),
    );

    const error = await capture(postRole(failingTags(unknown), "123456789012", "ReadOnlyAudit", null));

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).statusCode).toBe(502);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("同一アカウントのロールは検証する", async () => {
    const iamTags = stubTags({});

    const error = await capture(
      postRole(iamTags, "123456789012", "ReadOnlyAudit", "123456789012"),
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(iamTags.listRoleTags).toHaveBeenCalledOnce();
  });

  it("書式そのものが不正な名前はタグを読む前に書式エラーとして返す", async () => {
    const iamTags = stubTags({ [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE });

    // `/` は IAM ロール名に使えない文字。タグの話に先んじて書式で弾く。
    const error = await capture(postRole(iamTags, "123456789012", "Read/Only"));

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).message).toContain("+=,.@_-");
    // 書式が不正なら ARN も組み立てられないため、AWS を呼ばないことまで固定する。
    expect(iamTags.listRoleTags).not.toHaveBeenCalled();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});

/** `POST /roles` の説明欄と `PATCH /roles?arn=` の編集（Issue #21）。 */
describe("IAM ロールの説明（Issue #21）", () => {
  const managedTags = { [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE };

  function postRoleWithBody(body: unknown): Promise<{ statusCode: number; body: unknown }> {
    const route = createRoleRoutes({ iamTags: stubTags(managedTags), iamTrust: trustOf() }).find(
      (entry: Route) => entry.method === "POST",
    );
    if (!route) throw new Error("POST /roles のルートが見つかりません");
    return route.handler({
      method: "POST",
      path: "/roles",
      params: {},
      query: {},
      body,
      deployAccountId: null,
      actor: null, permission: "apply",
    });
  }

  function patchRole(
    query: Record<string, string>,
    body: unknown,
  ): Promise<{ statusCode: number; body: unknown }> {
    const route = createRoleRoutes({ iamTags: stubTags(managedTags) }).find(
      (entry: Route) => entry.method === "PATCH",
    );
    if (!route) throw new Error("PATCH /roles のルートが見つかりません");
    return route.handler({
      method: "PATCH",
      path: "/roles",
      params: {},
      query,
      body,
      deployAccountId: null,
      actor: null, permission: "apply",
    });
  }

  it("POST /roles は説明を省略すると null で登録する", async () => {
    const result = await postRoleWithBody({
      accountId: "123456789012",
      roleName: "ReadOnlyAudit",
    });

    expect((result.body as { role: { description: string | null } }).role.description).toBeNull();
  });

  it("POST /roles は説明を受け取り、正規化して保存する", async () => {
    const result = await postRoleWithBody({
      accountId: "123456789012",
      roleName: "ReadOnlyAudit",
      description: "  監査用の読み取り専用ロール  ",
    });

    expect((result.body as { role: { description: string | null } }).role.description).toBe(
      "監査用の読み取り専用ロール",
    );
  });

  it("POST /roles は説明の規則違反を 400 で弾く", async () => {
    const error = await capture(
      postRoleWithBody({
        accountId: "123456789012",
        roleName: "ReadOnlyAudit",
        description: "a".repeat(257),
      }),
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).field).toBe("description");
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  describe("PATCH /roles?arn=", () => {
    beforeEach(() => {
      ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${ROLE_ARN}` } }).resolves({
        Item: {
          pk: "ROLE",
          sk: `ROLE#${ROLE_ARN}`,
          itemType: "IamRole",
          accountId: "123456789012",
          roleName: "ReadOnlyAudit",
          arn: ROLE_ARN,
          createdAt: "2026-09-27T00:00:00.000Z",
          color: "teal",
        },
      });
      ddbMock.on(UpdateCommand).resolves({});
    });

    it("arn クエリの説明を更新する", async () => {
      const result = await patchRole({ arn: ROLE_ARN }, { description: "新しい説明" });

      expect(result.statusCode).toBe(200);
      expect((result.body as { role: { description: string | null } }).role.description).toBe(
        "新しい説明",
      );
    });

    it("arn クエリが無ければ 400", async () => {
      const error = await capture(patchRole({}, { description: "x" }));

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).field).toBe("arn");
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it("arn クエリがロール ARN の書式でなければ 400", async () => {
      const error = await capture(patchRole({ arn: "not-an-arn" }, { description: "x" }));

      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).field).toBe("arn");
    });

    it("color だけを更新できる（説明は変えない）", async () => {
      const result = await patchRole({ arn: ROLE_ARN }, { color: "purple" });

      expect(result.statusCode).toBe(200);
      expect((result.body as { role: { color: string | null } }).role.color).toBe("purple");
      const updates = ddbMock.commandCalls(UpdateCommand).map((call) => call.args[0].input.UpdateExpression);
      expect(updates).toEqual(["SET #color = :color"]);
    });

    it("color: null は解除する", async () => {
      const result = await patchRole({ arn: ROLE_ARN }, { color: null });

      expect(result.statusCode).toBe(200);
      expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.UpdateExpression).toBe("REMOVE #color");
    });

    it("description と color を一緒に指定すると、両方を保存して最後のロールを返す", async () => {
      const result = await patchRole({ arn: ROLE_ARN }, { description: "監査用", color: "pink" });

      expect(result.statusCode).toBe(200);
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
    });

    it.each([
      ["本文が空", {}],
      ["パレットにない色", { color: "fuchsia" }],
      ["空文字の色", { color: "" }],
      ["数値の色", { color: 1 }],
    ])("%s は 400 で、何も書かない", async (_label, body) => {
      await expect(patchRole({ arn: ROLE_ARN }, body)).rejects.toMatchObject({ name: "ValidationError" });
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });

    it("不正な color と有効な description の組は、description も書かずに 400", async () => {
      await expect(patchRole({ arn: ROLE_ARN }, { description: "監査用", color: "fuchsia" })).rejects.toMatchObject({
        name: "ValidationError",
      });
      expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    });
  });
});

/** `GET /roles` の `linked`（Issue #22 spec D-8。Issue #108 で固定プールの紐づけの有無に改めた）。 */
describe("GET /roles（Issue #108・#135）", () => {
  const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
  const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
  const BILLING = "arn:aws:iam::555566667777:role/BillingViewer";
  const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
  const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
  const NOW = "2026-10-02T00:00:00.000Z";

  function getRoles(): Promise<{ statusCode: number; body: unknown }> {
    const route = createRoleRoutes({ iamTags: stubTags({}) }).find(
      (entry: Route) => entry.method === "GET" && entry.pattern === "/roles",
    );
    if (!route) throw new Error("GET /roles のルートが見つかりません");
    return route.handler({ method: "GET", path: "/roles", params: {}, query: {}, body: null, deployAccountId: null, actor: null, permission: "apply" });
  }

  function stubRoles(arns: string[]): void {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ":pk": "ROLE", ":prefix": "ROLE#" } })
      .resolves({
        Items: arns.map((arn) => ({
          pk: "ROLE", sk: `ROLE#${arn}`, itemType: "IamRole",
          accountId: "555566667777", roleName: arn.split("/").pop(), arn, createdAt: NOW,
        })),
      });
  }

  function stubLinks(entries: { roleArn: string; position?: number }[]): void {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${TEST_POOL_ID}`, ":prefix": "ROLE#" } })
      .resolves({
        Items: entries.map(({ roleArn, position }) => ({
          pk: `POOL#${TEST_POOL_ID}`, sk: `ROLE#${roleArn}`, itemType: "PoolRoleLink", poolId: TEST_POOL_ID, roleArn, createdAt: NOW,
          ...(position !== undefined ? { position } : {}),
        })),
      });
  }

  function stubAssignments(cells: { userArn: string; roleArn: string; checked: boolean; reflected: boolean }[]): void {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${TEST_POOL_ID}`, ":prefix": "ASSIGN#" } })
      .resolves({
        Items: cells.map(({ userArn, roleArn, checked, reflected }) => ({
          pk: `POOL#${TEST_POOL_ID}`, sk: `ASSIGN#${userArn}#${roleArn}`, itemType: "Assignment",
          poolId: TEST_POOL_ID, userArn, roleArn, checked, reflected, updatedAt: NOW,
        })),
      });
  }

  beforeEach(() => {
    // 既定（0 件）を先に置き、テストごとの stub を後から重ねる（後に定義したものが優先される）。
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(BatchGetCommand).resolves({ Responses: {} });
    stubRoles([DEPLOY, AUDIT, BILLING]);
  });

  it("列順（position 順）で返し、紐づけを持たないロールは末尾にアカウント ID → ロール名の昇順で並べる", async () => {
    // ロール名の昇順（BillingViewer・DeployProd・ReadOnlyAudit）とは違う並びにして、列順で返していることを確かめる。
    stubLinks([{ roleArn: AUDIT, position: 0 }, { roleArn: DEPLOY, position: 1 }]);

    const result = await getRoles();

    expect((result.body as RolesResponse).roles.map((role) => role.arn)).toEqual([AUDIT, DEPLOY, BILLING]);
  });

  it("ロールごとの割り当ての件数（checked または reflected の交点）と、未反映の変更の件数を返す", async () => {
    stubLinks([{ roleArn: DEPLOY, position: 0 }, { roleArn: AUDIT, position: 1 }]);
    stubAssignments([
      { userArn: AYAKA, roleArn: DEPLOY, checked: true, reflected: true },
      { userArn: KENJI, roleArn: DEPLOY, checked: true, reflected: false },
      { userArn: AYAKA, roleArn: AUDIT, checked: false, reflected: false },
    ]);

    const result = await getRoles();

    const roles = (result.body as RolesResponse).roles;
    expect(roles.find((role) => role.arn === DEPLOY)?.assignments).toEqual({ total: 2, pending: 1 });
    expect(roles.find((role) => role.arn === AUDIT)?.assignments).toEqual({ total: 0, pending: 0 });
  });

  it("linked・本番に残る RoleLinkOwner・linkedPool は応答に出さない", async () => {
    stubLinks([{ roleArn: DEPLOY, position: 0 }]);

    const result = await getRoles();

    const deploy = (result.body as RolesResponse).roles.find((role) => role.arn === DEPLOY);
    expect(deploy).not.toHaveProperty("linked");
    expect(deploy).not.toHaveProperty("linkedPool");
  });
});

describe("PUT /roles/order（Issue #135）", () => {
  const A = "arn:aws:iam::555566667777:role/A";
  const B = "arn:aws:iam::555566667777:role/B";
  const NOW = "2026-10-07T00:00:00.000Z";

  function putOrder(body: unknown): Promise<{ statusCode: number; body: unknown }> {
    const route = createRoleRoutes({ iamTags: stubTags({}) }).find(
      (entry: Route) => entry.method === "PUT" && entry.pattern === "/roles/order",
    );
    if (!route) throw new Error("PUT /roles/order のルートが見つかりません");
    return route.handler({ method: "PUT", path: "/roles/order", params: {}, query: {}, body, deployAccountId: null, actor: null, permission: "apply" });
  }

  it("本文の roleArns を並び順として保存し、保存後の列順を返す", async () => {
    ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "ROLE", ":prefix": "ROLE#" } }).resolves({
      Items: [A, B].map((arn) => ({
        pk: "ROLE", sk: `ROLE#${arn}`, itemType: "IamRole", accountId: "555566667777", roleName: arn.split("/")[1], arn, createdAt: NOW,
      })),
    });
    ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${TEST_POOL_ID}`, ":prefix": "ROLE#" } }).resolves({
      Items: [A, B].map((roleArn, position) => ({
        pk: `POOL#${TEST_POOL_ID}`, sk: `ROLE#${roleArn}`, itemType: "PoolRoleLink", poolId: TEST_POOL_ID, roleArn, createdAt: NOW, position,
      })),
    });
    ddbMock.on(UpdateCommand).resolves({});

    const result = await putOrder({ roleArns: [B, A] });

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ roleArns: [B, A] });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(2);
  });

  it("roleArns が配列でなければ 400 で、何も書かない", async () => {
    await expect(putOrder({ roleArns: "A" })).rejects.toBeInstanceOf(ValidationError);
    await expect(putOrder({})).rejects.toBeInstanceOf(ValidationError);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});

describe("DELETE /roles?arn=（Issue #22）", () => {
  const ROLE_KEY = { pk: "ROLE", sk: `ROLE#${ROLE_ARN}` };

  function deleteRoute(): Route {
    const routes = createRoleRoutes({ iamTags: stubTags({}) }).filter(
      (entry: Route) => entry.method === "DELETE" && entry.pattern === "/roles",
    );
    // PATCH /roles（説明の編集）と取り違えないよう、DELETE /roles がちょうど 1 本あることを確かめる。
    expect(routes).toHaveLength(1);
    return routes[0] as Route;
  }

  function deleteRole(query: Record<string, string>): Promise<{ statusCode: number; body: unknown }> {
    return deleteRoute().handler({ method: "DELETE", path: "/roles", params: {}, query, body: null, deployAccountId: null, actor: null, permission: "apply" });
  }

  beforeEach(() => {
    // 既定を先に置き、テストごとの stub を後から重ねる（後に定義したものが優先される）。
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(BatchGetCommand).resolves({ Responses: {} });
    ddbMock.on(DeleteCommand).resolves({});
    ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolves({
      Item: { ...ROLE_KEY, itemType: "IamRole", accountId: "123456789012", roleName: "ReadOnlyAudit", arn: ROLE_ARN, createdAt: "2026-10-02T00:00:00.000Z" },
    });
  });

  it("未反映の申請が無ければ、紐づけと IamRole を削除して 200 で件数を返す（Issue #135）", async () => {
    const result = await deleteRole({ arn: ROLE_ARN });

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ roleArn: ROLE_ARN, removedAssignments: 0 });
    expect(ddbMock.commandCalls(DeleteCommand).map((call) => call.args[0].input.Key)).toEqual([
      { pk: `POOL#${TEST_POOL_ID}`, sk: `ROLE#${ROLE_ARN}` },
      ROLE_KEY,
    ]);
  });

  it("arn クエリが無い、またはロールの ARN でなければ 400", async () => {
    await expect(deleteRole({})).rejects.toBeInstanceOf(ValidationError);
    await expect(deleteRole({ arn: "arn:aws:iam::123456789012:user/ayaka.mori" })).rejects.toBeInstanceOf(ValidationError);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it("登録が無ければ 404", async () => {
    ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolves({});

    await expect(deleteRole({ arn: ROLE_ARN })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("未反映の申請があれば 409", async () => {
    ddbMock.on(GetCommand, { Key: { pk: `ROLELOCK#${ROLE_ARN}`, sk: "UNREFLECTED" } }).resolves({
      Item: {
        pk: `ROLELOCK#${ROLE_ARN}`, sk: "UNREFLECTED", itemType: "RoleLock",
        roleArn: ROLE_ARN, changeRequestId: "cr-0142", status: "draft", createdAt: "2026-10-02T00:00:00.000Z",
      },
    });

    await expect(deleteRole({ arn: ROLE_ARN })).rejects.toBeInstanceOf(ConflictError);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });
});

/** `POST /roles`・`PATCH /roles?arn=`・`GET /roles` の表示名（Issue #150）。 */
describe("IAM ロールの表示名（Issue #150）", () => {
  const ACCOUNT_ID = "123456789012";
  const ROLE_NAME = "ReadOnlyAudit";
  /** POST 用。ROLE_ARN は PATCH 用に登録済みの stub があるため、未登録の別名を使う。 */
  const NEW_ROLE_NAME = "NewRole";
  const OTHER_ARN = "arn:aws:iam::123456789012:role/DeployProd";
  const managedTags = { [TEST_MANAGED_TAG_KEY]: TEST_MANAGED_TAG_VALUE };
  const NOW = "2026-10-08T00:00:00.000Z";

  let iamTagClient: IamRoleTagClient;
  let iamTrustReader: IamTrustPolicyReader;

  function findRoute(method: string): Route {
    iamTagClient = stubTags(managedTags);
    iamTrustReader = trustOf();
    const route = createRoleRoutes({ iamTags: iamTagClient, iamTrust: iamTrustReader }).find(
      (entry: Route) => entry.method === method && entry.pattern === "/roles",
    );
    if (!route) throw new Error(`${method} /roles のルートが見つかりません`);
    return route;
  }

  function patchRole(arn: string, body: unknown): Promise<{ statusCode: number; body: unknown }> {
    return findRoute("PATCH").handler({
      method: "PATCH", path: "/roles", params: {}, query: { arn }, body, deployAccountId: null, actor: null, permission: "apply",
    });
  }

  function postRole(body: unknown): Promise<{ statusCode: number; body: unknown }> {
    return findRoute("POST").handler({
      method: "POST", path: "/roles", params: {}, query: {}, body, deployAccountId: null, actor: null, permission: "apply",
    });
  }

  function getRoles(): Promise<{ statusCode: number; body: unknown }> {
    return findRoute("GET").handler({
      method: "GET", path: "/roles", params: {}, query: {}, body: null, deployAccountId: null, actor: null, permission: "apply",
    });
  }

  /** 登録済みロールの一覧（`listRoles` の Query）を stub する。 */
  function stubRegisteredRoles(roles: { arn: string; displayName?: string }[]): void {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ":pk": "ROLE", ":prefix": "ROLE#" } })
      .resolves({
        Items: roles.map(({ arn, displayName }) => ({
          pk: "ROLE", sk: `ROLE#${arn}`, itemType: "IamRole",
          accountId: ACCOUNT_ID, roleName: arn.split("/").pop(), arn, createdAt: NOW,
          ...(displayName !== undefined ? { displayName } : {}),
        })),
      });
  }

  beforeEach(() => {
    ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${ROLE_ARN}` } }).resolves({
      Item: {
        pk: "ROLE", sk: `ROLE#${ROLE_ARN}`, itemType: "IamRole",
        accountId: ACCOUNT_ID, roleName: ROLE_NAME, arn: ROLE_ARN, createdAt: NOW,
      },
    });
    ddbMock.on(UpdateCommand).resolves({});
    ddbMock.on(BatchGetCommand).resolves({ Responses: {} });
  });

  it("PATCH /roles は表示名を保存し、説明は変えない", async () => {
    const response = await patchRole(ROLE_ARN, { displayName: "  本番デプロイ  " });

    expect(response.statusCode).toBe(200);
    expect((response.body as { role: { displayName: string | null } }).role.displayName).toBe("本番デプロイ");
    const updates = ddbMock.commandCalls(UpdateCommand).map((call) => call.args[0].input.UpdateExpression);
    expect(updates).toEqual(["SET #displayName = :displayName"]);
    // §1: 表示名は DynamoDB の項目だけの値で、IAM（タグ・信頼ポリシー）には触れない。
    expect(iamTagClient.listRoleTags).not.toHaveBeenCalled();
    expect(iamTrustReader.getTrustPolicy).not.toHaveBeenCalled();
  });

  it("PATCH /roles は表示名の規則違反を 400 で弾き、説明も書かない", async () => {
    await expect(patchRole(ROLE_ARN, { displayName: "a\tb", description: "新しい説明" })).rejects.toMatchObject({
      name: "ValidationError",
      field: "displayName",
    });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("PATCH /roles は表示名が文字列でも null でもなければ 400", async () => {
    await expect(patchRole(ROLE_ARN, { displayName: 1 })).rejects.toMatchObject({
      name: "ValidationError",
      field: "displayName",
    });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("PATCH /roles は表示名と説明の両方が不正なら、どちらも書かない（検証は書き込みの前）", async () => {
    await expect(patchRole(ROLE_ARN, { displayName: "本番デプロイ", description: "a\nb" })).rejects.toMatchObject({
      name: "ValidationError",
      field: "description",
    });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("PATCH /roles は表示名と不正な color の組でも、表示名を書かずに 400", async () => {
    await expect(patchRole(ROLE_ARN, { displayName: "本番デプロイ", color: "fuchsia" })).rejects.toMatchObject({
      name: "ValidationError",
      field: "color",
    });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("PATCH /roles は表示名が重複すると 409 で、何も書かない", async () => {
    stubRegisteredRoles([{ arn: OTHER_ARN, displayName: "本番デプロイ" }]);

    await expect(patchRole(ROLE_ARN, { displayName: "本番デプロイ", description: "新しい説明" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("PATCH /roles は displayName: null で表示名を解除する", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${ROLE_ARN}` } }).resolves({
      Item: {
        pk: "ROLE", sk: `ROLE#${ROLE_ARN}`, itemType: "IamRole",
        accountId: ACCOUNT_ID, roleName: ROLE_NAME, arn: ROLE_ARN, createdAt: NOW, displayName: "本番デプロイ",
      },
    });

    const response = await patchRole(ROLE_ARN, { displayName: null });

    expect(response.statusCode).toBe(200);
    expect((response.body as { role: { displayName: string | null } }).role.displayName).toBeNull();
    expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.UpdateExpression).toBe("REMOVE #displayName");
    expect(iamTagClient.listRoleTags).not.toHaveBeenCalled();
    expect(iamTrustReader.getTrustPolicy).not.toHaveBeenCalled();
  });

  it("PATCH /roles は displayName・description・color のどれも無ければ 400（新しい文言）", async () => {
    await expect(patchRole(ROLE_ARN, {})).rejects.toMatchObject({
      name: "ValidationError",
      field: "displayName",
      message: "displayName・description・color のいずれかを指定してください",
    });
  });

  it("POST /roles は重複する表示名を 409 で拒否し、IAM のタグも信頼ポリシーも読まない", async () => {
    stubRegisteredRoles([{ arn: OTHER_ARN, displayName: "本番デプロイ" }]);

    await expect(postRole({ accountId: ACCOUNT_ID, roleName: NEW_ROLE_NAME, displayName: "本番デプロイ" })).rejects.toBeInstanceOf(
      ConflictError,
    );
    expect(iamTagClient.listRoleTags).not.toHaveBeenCalled();
    expect(iamTrustReader.getTrustPolicy).not.toHaveBeenCalled();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("POST /roles は表示名の規則違反を、AWS を呼ぶ前に 400 で弾く", async () => {
    await expect(postRole({ accountId: ACCOUNT_ID, roleName: NEW_ROLE_NAME, displayName: "a\tb" })).rejects.toMatchObject({
      name: "ValidationError",
      field: "displayName",
    });
    expect(iamTagClient.listRoleTags).not.toHaveBeenCalled();
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("POST /roles は表示名を正規化して保存する", async () => {
    const response = await postRole({ accountId: ACCOUNT_ID, roleName: NEW_ROLE_NAME, displayName: "  本番デプロイ  " });

    expect(response.statusCode).toBe(201);
    expect((response.body as RegisterRoleResponse).role.displayName).toBe("本番デプロイ");
    const roleItem = ddbMock.commandCalls(PutCommand).map((call) => call.args[0].input.Item).find((item) => item?.itemType === "IamRole");
    expect(roleItem?.displayName).toBe("本番デプロイ");
  });

  it("POST /roles は表示名を省略すると未設定で登録する", async () => {
    const response = await postRole({ accountId: ACCOUNT_ID, roleName: NEW_ROLE_NAME });

    expect(response.statusCode).toBe(201);
    expect((response.body as RegisterRoleResponse).role.displayName).toBeNull();
  });

  it("GET /roles は表示名を返す（未設定は null）", async () => {
    stubRegisteredRoles([{ arn: OTHER_ARN, displayName: "本番デプロイ" }, { arn: ROLE_ARN }]);

    const response = await getRoles();

    expect((response.body as RolesResponse).roles.map((role) => role.displayName)).toEqual(["本番デプロイ", null]);
  });
});

describe("応答の localized（Issue #94。タグ検索以外のリクエスト検証）", () => {
  function run(method: string, query: Record<string, string>, body: unknown = null): Promise<unknown> {
    const route = createRoleRoutes({ iamTags: stubTags({}) }).find(
      (entry: Route) => entry.method === method && entry.pattern === "/roles",
    );
    if (!route) throw new Error(`${method} /roles のルートが見つかりません`);
    return capture(
      route.handler({ method, path: "/roles", params: {}, query, body, deployAccountId: null, actor: null, permission: "apply" }),
    );
  }

  it.each([
    ["PATCH", {}, null, "role.arnQueryRequiredEdit", "arn", "編集対象の IAM ロール ARN を arn クエリで指定してください"],
    ["PATCH", { arn: ROLE_ARN }, { color: "nope" }, "role.colorInvalid", "color", "color はパレットの ID または null で指定してください"],
    ["PATCH", { arn: ROLE_ARN }, {}, "role.updateFieldsRequired", "displayName", "displayName・description・color のいずれかを指定してください"],
    ["DELETE", {}, null, "role.arnQueryRequiredDelete", "arn", "削除対象の IAM ロール ARN を arn クエリで指定してください"],
    ["PATCH", { arn: ROLE_ARN }, { description: 1 }, "role.descriptionInvalidType", "description", "description は文字列または null で指定してください"],
    ["PATCH", { arn: ROLE_ARN }, { displayName: 1 }, "role.displayNameInvalidType", "displayName", "displayName は文字列または null で指定してください"],
  ] as const)("%s %j %j は %s を返す", async (method, query, body, id, field, message) => {
    const error = await run(method, { ...query }, body);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).field).toBe(field);
    expect((error as ValidationError).localized).toEqual({ id, params: {} });
    expect((error as ValidationError).message).toBe(message);
  });
});

describe("応答の localized（Issue #94。タグ検索と検証）", () => {
  const CROSS = "999988887777";
  const CROSS_ROLE_ARN = "arn:aws:iam::999988887777:role/ReadOnlyAudit";

  it("ロールが存在しないとき、role.notFoundInAws（field は roleName）", async () => {
    const iamTags = failingTags(new IamOperationError("not-found", "NoSuchEntity", ROLE_ARN, plainMessage("Role not found")));

    const error = (await capture(postRole(iamTags, "123456789012", "ReadOnlyAudit"))) as ValidationError;

    expect(error.field).toBe("roleName");
    expect(error.localized).toEqual(
      localized("role.notFoundInAws", { roleName: "ReadOnlyAudit", accountId: "123456789012" }),
    );
    expect(error.message).toBe(
      "IAM ロール「ReadOnlyAudit」はアカウント 123456789012 に存在しません。" +
        "Rolust は登録時にロールのタグを読んで管理対象かどうかを判定するため、" +
        "実在しないロールは登録できません。" +
        "ロール名とアカウント ID を確認するか、対象ロールを先に作成してください。",
    );
  });

  it("タグが無いとき、同一アカウントなら role.tagMissing の targetAccountId は null", async () => {
    const error = (await capture(
      postRole(stubTags({}), "123456789012", "ReadOnlyAudit", "123456789012"),
    )) as ValidationError;

    expect(error.field).toBe("roleName");
    expect(error.localized).toEqual(
      localized("role.tagMissing", {
        roleName: "ReadOnlyAudit",
        managedTagKey: TEST_MANAGED_TAG_KEY,
        managedTagValue: TEST_MANAGED_TAG_VALUE,
        targetAccountId: null,
      }),
    );
    expect(error.message).toBe(
      `IAM ロール「ReadOnlyAudit」に管理対象のタグ「${TEST_MANAGED_TAG_KEY}」が付いていません。` +
        `Rolust の反映用 Lambda は ${TEST_MANAGED_TAG_KEY} が「${TEST_MANAGED_TAG_VALUE}」であるロールに対してのみ ` +
        "iam:GetRole / iam:UpdateAssumeRolePolicy を持つため、このまま登録しても反映時に AccessDenied になります。" +
        "次のコマンドでタグを付けてから登録し直してください: " +
        `aws iam tag-role --role-name ReadOnlyAudit --tags Key=${TEST_MANAGED_TAG_KEY},Value=${TEST_MANAGED_TAG_VALUE}`,
    );
  });

  it("タグが無いとき、別アカウントなら role.tagMissing の targetAccountId はロールのアカウント", async () => {
    const error = (await capture(postRole(stubTags({}), CROSS, "ReadOnlyAudit", "123456789012"))) as ValidationError;

    expect(error.localized).toEqual(
      localized("role.tagMissing", {
        roleName: "ReadOnlyAudit",
        managedTagKey: TEST_MANAGED_TAG_KEY,
        managedTagValue: TEST_MANAGED_TAG_VALUE,
        targetAccountId: CROSS,
      }),
    );
    expect(error.message).toContain(
      "次のコマンドでタグを付けてから登録し直してください" +
        `（ターゲットアカウント ${CROSS} の資格情報で実行してください。別のアカウントの資格情報で実行すると、` +
        "そのアカウントに同名のロールがあれば、そのロールにタグが付きます）: aws iam tag-role",
    );
  });

  it("タグの値が違うとき、同一アカウントなら role.tagValueMismatch の targetAccountId は null", async () => {
    const error = (await capture(
      postRole(stubTags({ [TEST_MANAGED_TAG_KEY]: "false" }), "123456789012", "ReadOnlyAudit", "123456789012"),
    )) as ValidationError;

    expect(error.localized).toEqual(
      localized("role.tagValueMismatch", {
        roleName: "ReadOnlyAudit",
        managedTagKey: TEST_MANAGED_TAG_KEY,
        actual: "false",
        managedTagValue: TEST_MANAGED_TAG_VALUE,
        targetAccountId: null,
      }),
    );
    expect(error.message).toBe(
      `IAM ロール「ReadOnlyAudit」のタグ「${TEST_MANAGED_TAG_KEY}」の値が「false」であり、` +
        `管理対象の値「${TEST_MANAGED_TAG_VALUE}」と一致しません。` +
        "IAM ポリシーは StringEquals で完全一致を要求するため、このまま登録しても反映時に AccessDenied になります。" +
        "次のコマンドで値を書き換えてください: " +
        `aws iam tag-role --role-name ReadOnlyAudit --tags Key=${TEST_MANAGED_TAG_KEY},Value=${TEST_MANAGED_TAG_VALUE}`,
    );
  });

  it("タグの値が違うとき、別アカウントなら role.tagValueMismatch の targetAccountId はロールのアカウント", async () => {
    const error = (await capture(
      postRole(stubTags({ [TEST_MANAGED_TAG_KEY]: "false" }), CROSS, "ReadOnlyAudit", "123456789012"),
    )) as ValidationError;

    expect(error.localized).toMatchObject({ id: "role.tagValueMismatch", params: { targetAccountId: CROSS } });
    expect(error.message).toContain(`次のコマンドで値を書き換えてください（ターゲットアカウント ${CROSS} の資格情報で実行してください。`);
  });

  it("別アカウントの権限不足は role.tagReadDeniedCrossAccount（502）", async () => {
    vi.stubEnv("ROLUST_TARGET_READER_ROLE_NAME", "RolustTrustPolicyReader");
    vi.stubEnv("ROLUST_TARGET_MANAGER_ROLE_NAME", "RolustTrustPolicyManager");
    const iamTags = failingTags(new IamOperationError("access-denied", "AccessDenied", CROSS_ROLE_ARN, plainMessage("no")));

    const error = (await capture(postRole(iamTags, CROSS, "ReadOnlyAudit", "123456789012"))) as ApiError;

    expect(error.statusCode).toBe(502);
    expect(error.localized).toEqual(
      localized("role.tagReadDeniedCrossAccount", {
        roleName: "ReadOnlyAudit",
        accountId: CROSS,
        errorCode: "AccessDenied",
        readerRoleName: "RolustTrustPolicyReader",
      }),
    );
    expect(error.message).toBe(
      `IAM ロール「ReadOnlyAudit」（アカウント ${CROSS}）のタグを読み取れませんでした（AccessDenied）。` +
        "これは入力の誤りではなく、ターゲットアカウント側の権限不足です。" +
        "ターゲットアカウントの RolustTrustPolicyReader に、iam:ListRoleTags の許可があるか確認してください" +
        "（docs/guide/cross-account.md）。",
    );
  });

  it("同一アカウントの権限不足は role.tagReadDeniedLocal（502）", async () => {
    const iamTags = failingTags(new IamOperationError("access-denied", "AccessDenied", ROLE_ARN, plainMessage("no")));

    const error = (await capture(postRole(iamTags, "123456789012", "ReadOnlyAudit", "123456789012"))) as ApiError;

    expect(error.localized).toEqual(
      localized("role.tagReadDeniedLocal", { roleName: "ReadOnlyAudit", errorCode: "AccessDenied", roleArn: ROLE_ARN }),
    );
    expect(error.message).toBe(
      "IAM ロール「ReadOnlyAudit」のタグを読み取れませんでした（AccessDenied）。" +
        "これは入力の誤りではなくデプロイ側の権限不足です。" +
        `CRUD Lambda の実行ロールに ${ROLE_ARN} に対する iam:ListRoleTags が必要です` +
        "（infra/lambda.tf の crud_iam_read_tags）。terraform apply が最新か確認してください。",
    );
  });

  it("assume-role / deploy-account-unknown は、内側の IamOperationError.localized をそのまま運ぶ", async () => {
    const inner = new IamOperationError(
      "assume-role",
      "AccessDenied",
      CROSS_ROLE_ARN,
      localized("iam.assumeRoleFailed", {
        accountId: CROSS,
        assumeRoleName: "RolustTrustPolicyReader",
        code: "AccessDenied",
        detail: "denied",
      }),
    );

    const error = (await capture(postRole(failingTags(inner), CROSS, "ReadOnlyAudit", "123456789012"))) as ApiError;

    expect(error.code).toBe("TagLookupUnavailable");
    expect(error.localized).toBe(inner.localized);
    expect(error.message).toBe(inner.message);

    const unknown = new IamOperationError(
      "deploy-account-unknown",
      "DeployAccountUnknown",
      ROLE_ARN,
      localized("iam.deployAccountUnknown", { roleArn: ROLE_ARN }),
    );
    const second = (await capture(postRole(failingTags(unknown), "123456789012", "ReadOnlyAudit", null))) as ApiError;
    expect(second.localized).toBe(unknown.localized);
  });
});
