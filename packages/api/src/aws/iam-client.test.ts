import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { GetRoleCommandOutput } from "@aws-sdk/client-iam";
import { IAMClient } from "@aws-sdk/client-iam";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import type { TrustPolicyDocument } from "@rolust/core";
import { localized, plainMessage, renderMessage } from "@rolust/core";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConfigurationError } from "../errors.js";
import * as iamClientModule from "./iam-client.js";
import {
  IamOperationError,
  createIamRoleTagClient,
  createIamTrustPolicyClient,
  createIamTrustPolicyReader,
  resetIamClient,
  toIamOperationError,
} from "./iam-client.js";

// 引き受けの一時資格情報は、実 STS を呼ばずに、テストが与える提供元へ差し替える。
vi.mock("@aws-sdk/credential-providers", () => ({ fromTemporaryCredentials: vi.fn() }));

const iamMock = mockClient(IAMClient);

/** Rolust のデプロイ先アカウント。ROLE_ARN はここのロール、CROSS_ARN は別アカウントのロール（同名）。 */
const DEPLOY_ACCOUNT = "555566667777";
const ROLE_ARN = "arn:aws:iam::555566667777:role/DeployProd";
const CROSS_ARN = "arn:aws:iam::999900001111:role/DeployProd";
const POLICY: TrustPolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { AWS: "arn:aws:iam::111122223333:user/ayaka.mori" },
      Action: "sts:AssumeRole",
    },
  ],
};

/** GetRole の応答を組み立てる。SDK の Role 型は必須項目が多いため、必要な項目だけ与える。 */
function getRoleResponse(assumeRolePolicyDocument?: string): GetRoleCommandOutput {
  return {
    Role: assumeRolePolicyDocument === undefined
      ? {}
      : { AssumeRolePolicyDocument: assumeRolePolicyDocument },
  } as unknown as GetRoleCommandOutput;
}

/** テストが触る環境変数。実行前の値を退避し、実行後に戻す（ほかのテストへ漏らさない）。 */
const ENV_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_PROFILE",
  "AWS_REGION",
  "AWS_LAMBDA_FUNCTION_NAME",
  "ROLUST_TARGET_READER_ROLE_NAME",
  "ROLUST_TARGET_MANAGER_ROLE_NAME",
] as const;
const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of ENV_KEYS) savedEnv.set(key, process.env[key]);
  // 実行ロール自身の資格情報（デプロイ先のロール用のクライアントが使う）。引き受けた資格情報と区別できる値にする。
  process.env.AWS_ACCESS_KEY_ID = "OWN-KEY";
  process.env.AWS_SECRET_ACCESS_KEY = "own-secret";
  delete process.env.AWS_SESSION_TOKEN;
  // SDK は AWS_PROFILE を環境変数の資格情報より優先する。利用者のシェルに AWS_PROFILE があっても
  // （`.local/rolust.env` を source した場合など。Issue #176）、上の OWN-KEY が使われるようにする。
  delete process.env.AWS_PROFILE;
  process.env.AWS_REGION = "ap-northeast-1";
  process.env.AWS_LAMBDA_FUNCTION_NAME = "rolust-crud";
  process.env.ROLUST_TARGET_READER_ROLE_NAME = "RolustTrustPolicyReader";
  process.env.ROLUST_TARGET_MANAGER_ROLE_NAME = "RolustTrustPolicyManager";

  iamMock.reset();
  vi.mocked(fromTemporaryCredentials).mockReset();
  resetIamClient();
});

afterEach(() => {
  resetIamClient();
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("FR-5.7 / C-4: IAM への問い合わせは読み取りと更新の 2 時点に限定される", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./iam-client.ts", import.meta.url)),
    "utf8",
  );

  it("モジュールは一覧取得・実在検証の API を export しない", () => {
    const exported = Object.keys(iamClientModule);

    for (const forbidden of [
      "listRoles",
      "listUsers",
      "getUser",
      "simulatePrincipalPolicy",
    ]) {
      expect(exported).not.toContain(forbidden);
    }
  });

  it("モジュールは一覧取得・実在検証のコマンドを import すらしていない", () => {
    for (const forbidden of [
      "ListRolesCommand",
      "ListUsersCommand",
      "GetUserCommand",
      "ListRolePoliciesCommand",
      "SimulatePrincipalPolicyCommand",
      "PutRolePolicyCommand",
      "AttachRolePolicyCommand",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("使用する IAM コマンドは GetRole / UpdateAssumeRolePolicy / ListRoleTags の 3 つだけである", () => {
    // `ListRoleTags` は 3.4 のタグ方式移行（RQ-4 = A）で加わった。登録時検証を
    // 成立させるための読み取りであり、FR-5.7 の 2 時点制限を人間の決定で緩めた結果である。
    // **緩めるたびに人間の決定が要る**という性質を保つため、集合ごと固定する。
    const commands = [...source.matchAll(/\b(\w+Command)\b/g)].map((match) => match[1]);

    expect([...new Set(commands)].sort()).toEqual([
      "GetRoleCommand",
      "ListRoleTagsCommand",
      "UpdateAssumeRolePolicyCommand",
    ]);
  });
});

describe("IAM クライアントの動作とエラー分類", () => {
  it("GetRole が返す URL エンコード済み文書をパースして返す（FR-4.1 / FR-5.1）", async () => {
    iamMock.resolves(getRoleResponse(encodeURIComponent(JSON.stringify(POLICY))));

    const document = await createIamTrustPolicyClient(DEPLOY_ACCOUNT).getTrustPolicy(ROLE_ARN);

    expect(document).toEqual(POLICY);
  });

  it("UpdateAssumeRolePolicy に JSON 文字列とロール名（ARN ではない）を渡す（FR-5.3）", async () => {
    iamMock.resolves({});

    await createIamTrustPolicyClient(DEPLOY_ACCOUNT).updateTrustPolicy(ROLE_ARN, POLICY);

    const call = iamMock.calls().at(-1);
    expect(call?.args[0].input).toEqual({
      RoleName: "DeployProd",
      PolicyDocument: JSON.stringify(POLICY),
    });
  });

  it("エッジケース: AccessDenied を access-denied に分類し、コードを隠さず保持する（GI-6）", async () => {
    const denied = Object.assign(new Error("User is not authorized"), {
      name: "AccessDeniedException",
    });
    iamMock.rejects(denied);

    await expect(
      createIamTrustPolicyClient(DEPLOY_ACCOUNT).updateTrustPolicy(ROLE_ARN, POLICY),
    ).rejects.toMatchObject({
      name: "IamOperationError",
      kind: "access-denied",
      errorCode: "AccessDeniedException",
      retryable: false,
      roleArn: ROLE_ARN,
    });
  });

  it("エッジケース: スロットリングは retryable として返す", async () => {
    iamMock.rejects(Object.assign(new Error("Rate exceeded"), { name: "Throttling" }));

    await expect(
      createIamTrustPolicyClient(DEPLOY_ACCOUNT).getTrustPolicy(ROLE_ARN),
    ).rejects.toMatchObject({ kind: "throttling", retryable: true });
  });

  it("エッジケース: 信頼ポリシー文書が空でも握り潰さず IamOperationError にする", async () => {
    iamMock.resolves(getRoleResponse());

    await expect(
      createIamTrustPolicyClient(DEPLOY_ACCOUNT).getTrustPolicy(ROLE_ARN),
    ).rejects.toBeInstanceOf(IamOperationError);
  });
});

describe("createIamTrustPolicyReader（Issue #80。CRUD 系統には読み取りだけを渡す）", () => {
  it("信頼ポリシーを読めるが、更新の関数を持たない（iam:UpdateAssumeRolePolicy を持たない系統に、呼べる形を渡さない）", async () => {
    iamMock.resolves(getRoleResponse(encodeURIComponent(JSON.stringify(POLICY))));

    const reader = createIamTrustPolicyReader(DEPLOY_ACCOUNT);

    expect(Object.keys(reader)).toEqual(["getTrustPolicy"]);
    await expect(reader.getTrustPolicy(ROLE_ARN)).resolves.toEqual(POLICY);
  });

  it("読み取りの失敗は、AWS のコードを隠さず IamOperationError で返す（GI-6）", async () => {
    iamMock.rejects(Object.assign(new Error("not authorized"), { name: "AccessDenied" }));

    await expect(createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(ROLE_ARN)).rejects.toMatchObject({
      kind: "access-denied",
      errorCode: "AccessDenied",
      roleArn: ROLE_ARN,
    });
  });
});

/**
 * 別アカウントのロール（Issue #85）。
 *
 * IAM の API は `RoleName` しか受け取らず、**呼び出しに使った資格情報のアカウントに対して解決される**。
 * したがって、どの資格情報のクライアントで呼んだかを確かめるのが、これらのテストの要点である。
 * `iamMock.calls()` の `thisValue`（呼んだクライアント）の資格情報を解決して、その `accessKeyId` で判別する
 * （実行ロール自身は `OWN-KEY`、引き受けた資格情報は `ASSUMED:<引き受けたロールの ARN>`）。
 */
describe("別アカウントのロール（Issue #85）", () => {
  const READER_ARN = "arn:aws:iam::999900001111:role/RolustTrustPolicyReader";
  const MANAGER_ARN = "arn:aws:iam::999900001111:role/RolustTrustPolicyManager";
  const ENCODED = encodeURIComponent(JSON.stringify(POLICY));

  /** 引き受けの提供元を、`ASSUMED:<RoleArn>` の資格情報を返すものに差し替える。呼ばれた回数を返す。 */
  function grantAssume(): { stsCalls: () => number } {
    let calls = 0;
    vi.mocked(fromTemporaryCredentials).mockImplementation(((options: { params: { RoleArn: string } }) =>
      async () => {
        calls += 1;
        return {
          accessKeyId: `ASSUMED:${options.params.RoleArn}`,
          secretAccessKey: "assumed-secret",
          sessionToken: "assumed-token",
          expiration: new Date(Date.now() + 3600_000),
        };
      }) as never);
    return { stsCalls: () => calls };
  }

  /** 引き受けの提供元を、常に失敗するものに差し替える。 */
  function denyAssume(name = "AccessDenied"): void {
    vi.mocked(fromTemporaryCredentials).mockImplementation((() => async () => {
      throw Object.assign(new Error("User is not authorized to perform: sts:AssumeRole"), { name });
    }) as never);
  }

  /** 最後の IAM 呼び出しに使われた資格情報の accessKeyId。 */
  async function callerOfLastCall(): Promise<string> {
    const client = iamMock.calls().at(-1)?.thisValue as IAMClient;
    return (await client.config.credentials()).accessKeyId;
  }

  it("デプロイ先と同じアカウントのロールは、実行ロール自身の資格情報で呼び、引き受けない", async () => {
    grantAssume();
    iamMock.resolves(getRoleResponse(ENCODED));

    await createIamTrustPolicyClient(DEPLOY_ACCOUNT).getTrustPolicy(ROLE_ARN);

    expect(await callerOfLastCall()).toBe("OWN-KEY");
    expect(fromTemporaryCredentials).not.toHaveBeenCalled();
  });

  it("別アカウントのロールの読み取り（CRUD・Diff）は、Reader を引き受けた資格情報で呼ぶ。セッション名は系統を示す", async () => {
    grantAssume();
    iamMock.resolves(getRoleResponse(ENCODED));

    const document = await createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(CROSS_ARN);

    expect(document).toEqual(POLICY);
    expect(await callerOfLastCall()).toBe(`ASSUMED:${READER_ARN}`);
    expect(vi.mocked(fromTemporaryCredentials).mock.calls[0]?.[0]).toMatchObject({
      params: { RoleArn: READER_ARN, RoleSessionName: "rolust-crud" },
    });
    // 引き受けたロールにも、IAM には RoleName（ARN ではない）で渡す。
    expect(iamMock.calls().at(-1)?.args[0].input).toEqual({ RoleName: "DeployProd" });
  });

  it("別アカウントのロールの更新と、更新の前の読み取り（Apply）は、Manager を引き受けた資格情報で呼ぶ", async () => {
    grantAssume();
    iamMock.resolves(getRoleResponse(ENCODED));
    const client = createIamTrustPolicyClient(DEPLOY_ACCOUNT);

    await client.getTrustPolicy(CROSS_ARN);
    expect(await callerOfLastCall()).toBe(`ASSUMED:${MANAGER_ARN}`);

    iamMock.resolves({});
    await client.updateTrustPolicy(CROSS_ARN, POLICY);
    expect(await callerOfLastCall()).toBe(`ASSUMED:${MANAGER_ARN}`);
    expect(iamMock.calls().at(-1)?.args[0].input).toEqual({
      RoleName: "DeployProd",
      PolicyDocument: JSON.stringify(POLICY),
    });
    // Apply は Reader を引き受けない（Apply の実行ロールが引き受けられるのは Manager だけ）。
    const assumed = vi.mocked(fromTemporaryCredentials).mock.calls.map((call) => call[0]?.params?.RoleArn);
    expect(assumed).toEqual([MANAGER_ARN]);
  });

  it("別アカウントのロールのタグ読み取り（ロール登録）は、Reader を引き受けた資格情報で呼ぶ", async () => {
    grantAssume();
    iamMock.resolves({ Tags: [{ Key: "rolust:managed", Value: "true" }], IsTruncated: false });

    const tags = await createIamRoleTagClient(DEPLOY_ACCOUNT).listRoleTags(CROSS_ARN);

    expect(tags).toEqual({ "rolust:managed": "true" });
    expect(await callerOfLastCall()).toBe(`ASSUMED:${READER_ARN}`);
  });

  it("引き受けに失敗したら assume-role で返し、IAM を 1 回も呼ばない（デプロイ先の資格情報で呼び直さない。Issue #27 の再発防止）", async () => {
    denyAssume();
    iamMock.resolves(getRoleResponse(ENCODED));

    const attempt = createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(CROSS_ARN);

    await expect(attempt).rejects.toMatchObject({
      name: "IamOperationError",
      kind: "assume-role",
      errorCode: "AccessDenied",
      retryable: false,
      roleArn: CROSS_ARN,
    });
    // どのクライアントからも IAM を呼んでいない。実行ロール自身のクライアントへの切り替えも起きない。
    expect(iamMock.calls()).toHaveLength(0);
  });

  it("引き受けの失敗の文言は、何が・なぜ・どう直すかを示し、STS のコードとメッセージを隠さない（GI-6）", async () => {
    denyAssume();

    const error: unknown = await createIamTrustPolicyClient(DEPLOY_ACCOUNT)
      .updateTrustPolicy(CROSS_ARN, POLICY)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IamOperationError);
    const { message } = error as IamOperationError;
    expect(message).toContain("999900001111");
    expect(message).toContain("RolustTrustPolicyManager");
    expect(message).toContain("AccessDenied");
    expect(message).toContain("docs/guide/cross-account.md");
    expect(message).toContain("User is not authorized to perform: sts:AssumeRole");
    expect(iamMock.calls()).toHaveLength(0);
  });

  it("引き受けの失敗の文言は、ロールや信頼ポリシーを直した直後は数分待つと通ることがある旨を含む（実測: 復元から約 7 分。失敗は覚えないので再起動は要らない）", async () => {
    denyAssume();

    const error: unknown = await createIamTrustPolicyReader(DEPLOY_ACCOUNT)
      .getTrustPolicy(CROSS_ARN)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IamOperationError);
    const { message } = error as IamOperationError;
    expect(message).toContain("直した直後");
    expect(message).toContain("数分");
    // 既存の要素（何が・なぜ・どう直すか）は、そのまま残る。
    expect(message).toContain("docs/guide/cross-account.md");
  });

  it("引き受けの失敗の英語の文言も、手順書 docs/guide/cross-account.md を案内する", async () => {
    denyAssume();

    const error: unknown = await createIamTrustPolicyReader(DEPLOY_ACCOUNT)
      .getTrustPolicy(CROSS_ARN)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IamOperationError);
    const { localized: cause } = error as IamOperationError;
    expect(renderMessage("en", cause)).toContain("Create it by following docs/guide/cross-account.md.");
  });

  it("引き受けが STS のスロットリングで失敗したときは、再試行可能として返す", async () => {
    denyAssume("Throttling");

    await expect(
      createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(CROSS_ARN),
    ).rejects.toMatchObject({ kind: "throttling", retryable: true, errorCode: "Throttling" });
  });

  it("引き受けた後の IAM の AccessDenied は、引き受けの失敗と区別して access-denied で返す（タグの不足など）", async () => {
    grantAssume();
    iamMock.rejects(Object.assign(new Error("not authorized to perform: iam:GetRole"), { name: "AccessDenied" }));

    await expect(
      createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(CROSS_ARN),
    ).rejects.toMatchObject({ kind: "access-denied", errorCode: "AccessDenied", roleArn: CROSS_ARN });
    expect(iamMock.calls()).toHaveLength(1);
  });

  it("ターゲット側を用意した後は、再起動なしで通る（引き受けの失敗はキャッシュしない）", async () => {
    let prepared = false;
    vi.mocked(fromTemporaryCredentials).mockImplementation((() => async () => {
      if (!prepared) throw Object.assign(new Error("not authorized"), { name: "AccessDenied" });
      return {
        accessKeyId: "ASSUMED",
        secretAccessKey: "s",
        sessionToken: "t",
        expiration: new Date(Date.now() + 3600_000),
      };
    }) as never);
    iamMock.resolves(getRoleResponse(ENCODED));
    const reader = createIamTrustPolicyReader(DEPLOY_ACCOUNT);

    await expect(reader.getTrustPolicy(CROSS_ARN)).rejects.toMatchObject({ kind: "assume-role" });
    expect(iamMock.calls()).toHaveLength(0);

    prepared = true;
    await expect(reader.getTrustPolicy(CROSS_ARN)).resolves.toEqual(POLICY);
    expect(iamMock.calls()).toHaveLength(1);
  });

  it("有効期間内は、同じアカウント・役割の呼び出しで STS を呼び直さない。同時に呼んでも 1 回で済む", async () => {
    const granted = grantAssume();
    iamMock.resolves(getRoleResponse(ENCODED));
    const reader = createIamTrustPolicyReader(DEPLOY_ACCOUNT);

    await Promise.all([
      reader.getTrustPolicy("arn:aws:iam::999900001111:role/A"),
      reader.getTrustPolicy("arn:aws:iam::999900001111:role/B"),
      reader.getTrustPolicy("arn:aws:iam::999900001111:role/C"),
    ]);
    await reader.getTrustPolicy("arn:aws:iam::999900001111:role/D");

    expect(fromTemporaryCredentials).toHaveBeenCalledTimes(1);
    expect(granted.stsCalls()).toBe(1);
    expect(iamMock.calls()).toHaveLength(4);
  });

  it("同じアカウントでも、役割（Reader と Manager）ごとに別々に引き受ける。Reader の資格情報を Manager と共有しない", async () => {
    grantAssume();
    iamMock.resolves(getRoleResponse(ENCODED));

    // Reader（CRUD・Diff）を先に使ったあとで、Manager（Apply）を使う。同じアカウントの同じキャッシュを引かない。
    await createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(CROSS_ARN);
    expect(await callerOfLastCall()).toBe(`ASSUMED:${READER_ARN}`);
    await createIamTrustPolicyClient(DEPLOY_ACCOUNT).getTrustPolicy(CROSS_ARN);
    expect(await callerOfLastCall()).toBe(`ASSUMED:${MANAGER_ARN}`);
  });

  it("別のアカウントは、別々に引き受ける", async () => {
    grantAssume();
    iamMock.resolves(getRoleResponse(ENCODED));
    const reader = createIamTrustPolicyReader(DEPLOY_ACCOUNT);

    await reader.getTrustPolicy("arn:aws:iam::999900001111:role/A");
    await reader.getTrustPolicy("arn:aws:iam::777700002222:role/A");

    const assumed = vi.mocked(fromTemporaryCredentials).mock.calls.map((call) => call[0]?.params?.RoleArn);
    expect(assumed).toEqual([
      "arn:aws:iam::999900001111:role/RolustTrustPolicyReader",
      "arn:aws:iam::777700002222:role/RolustTrustPolicyReader",
    ]);
  });

  it("期限が切れた資格情報は更新する", async () => {
    let issued = 0;
    vi.mocked(fromTemporaryCredentials).mockImplementation((() => async () => {
      issued += 1;
      // 1 回目の資格情報は、発行の時点で期限切れ。
      const lifetime = issued === 1 ? -1000 : 3600_000;
      return {
        accessKeyId: `K${issued}`,
        secretAccessKey: "s",
        sessionToken: "t",
        expiration: new Date(Date.now() + lifetime),
      };
    }) as never);
    iamMock.resolves(getRoleResponse(ENCODED));
    const reader = createIamTrustPolicyReader(DEPLOY_ACCOUNT);

    await reader.getTrustPolicy(CROSS_ARN);
    await reader.getTrustPolicy(CROSS_ARN);

    expect(issued).toBe(2);
  });

  it("デプロイ先を判定できない（null）ときは、どの資格情報でも IAM を呼ばずに止める", async () => {
    grantAssume();
    iamMock.resolves(getRoleResponse(ENCODED));

    for (const roleArn of [ROLE_ARN, CROSS_ARN]) {
      await expect(createIamTrustPolicyReader(null).getTrustPolicy(roleArn)).rejects.toMatchObject({
        kind: "deploy-account-unknown",
        errorCode: "DeployAccountUnknown",
      });
    }
    await expect(createIamTrustPolicyClient(null).updateTrustPolicy(ROLE_ARN, POLICY)).rejects.toMatchObject({
      kind: "deploy-account-unknown",
    });
    await expect(createIamRoleTagClient(null).listRoleTags(ROLE_ARN)).rejects.toMatchObject({
      kind: "deploy-account-unknown",
    });
    expect(iamMock.calls()).toHaveLength(0);
    expect(fromTemporaryCredentials).not.toHaveBeenCalled();
  });

  it("引き受けるロールの名前の設定が不正なら、ConfigurationError で止め、IAM を呼ばない", async () => {
    grantAssume();
    process.env.ROLUST_TARGET_READER_ROLE_NAME = "Rolust*";

    await expect(
      createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(CROSS_ARN),
    ).rejects.toBeInstanceOf(ConfigurationError);
    expect(iamMock.calls()).toHaveLength(0);
  });

  it("同じアカウントのロールは、引き受けるロールの名前の設定が無くても扱える（別アカウントを使わない運用を止めない）", async () => {
    delete process.env.ROLUST_TARGET_READER_ROLE_NAME;
    delete process.env.ROLUST_TARGET_MANAGER_ROLE_NAME;
    iamMock.resolves(getRoleResponse(ENCODED));

    await expect(createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(ROLE_ARN)).resolves.toEqual(POLICY);
  });

  it("セッション名は、Lambda の関数名から作る。使えない文字は置き換え、64 文字に収める", async () => {
    grantAssume();
    iamMock.resolves(getRoleResponse(ENCODED));
    process.env.AWS_LAMBDA_FUNCTION_NAME = `my project/apply${"x".repeat(80)}`;

    await createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(CROSS_ARN);

    const sessionName = vi.mocked(fromTemporaryCredentials).mock.calls[0]?.[0]?.params?.RoleSessionName as string;
    expect(sessionName).toMatch(/^[\w+=,.@-]{2,64}$/);
    expect(sessionName.startsWith("my-project-apply")).toBe(true);
    expect(sessionName).toHaveLength(64);
  });

  it("Lambda の外（関数名が無い）では、セッション名は rolust-local", async () => {
    grantAssume();
    iamMock.resolves(getRoleResponse(ENCODED));
    delete process.env.AWS_LAMBDA_FUNCTION_NAME;

    await createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(CROSS_ARN);

    expect(vi.mocked(fromTemporaryCredentials).mock.calls[0]?.[0]?.params?.RoleSessionName).toBe("rolust-local");
  });

  it("引き受けた後の NoSuchEntity は not-found のまま返し、文言にアカウント ID とロール名を入れる。AWS のメッセージは隠さない（spec D-10）", async () => {
    grantAssume();
    iamMock.rejects(
      Object.assign(new Error("The role with name DeployProd cannot be found."), { name: "NoSuchEntity" }),
    );

    const error: unknown = await createIamTrustPolicyReader(DEPLOY_ACCOUNT)
      .getTrustPolicy(CROSS_ARN)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IamOperationError);
    const { kind, message } = error as IamOperationError;
    expect(kind).toBe("not-found");
    // デプロイ先にも同名のロールがある形（#27）。どのアカウントのロールが無かったのかを、文言で区別できる。
    expect(message).toContain("999900001111");
    expect(message).toContain("DeployProd");
    expect(message).toContain("The role with name DeployProd cannot be found.");
  });

  it("引き受けた後の AccessDenied は access-denied のまま返し、文言にアカウント ID とロール名を入れる。AWS のメッセージは隠さない（spec D-10）", async () => {
    grantAssume();
    iamMock.rejects(
      Object.assign(new Error("not authorized to perform: iam:UpdateAssumeRolePolicy"), { name: "AccessDenied" }),
    );

    const error: unknown = await createIamTrustPolicyClient(DEPLOY_ACCOUNT)
      .updateTrustPolicy(CROSS_ARN, POLICY)
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(IamOperationError);
    const { kind, message } = error as IamOperationError;
    expect(kind).toBe("access-denied");
    expect(message).toContain("999900001111");
    expect(message).toContain("DeployProd");
    expect(message).toContain("not authorized to perform: iam:UpdateAssumeRolePolicy");
  });

  it("デプロイ先と同じアカウントのロールの NoSuchEntity も、文言にアカウント ID を入れる（同アカウントと別アカウントで文言の形を分けない）", async () => {
    iamMock.rejects(
      Object.assign(new Error("The role with name DeployProd cannot be found."), { name: "NoSuchEntity" }),
    );

    await expect(createIamTrustPolicyReader(DEPLOY_ACCOUNT).getTrustPolicy(ROLE_ARN)).rejects.toMatchObject({
      kind: "not-found",
      message: expect.stringContaining(DEPLOY_ACCOUNT),
    });
  });
});

describe("IamOperationError の localized（Issue #94）", () => {
  const SAME_ROLE_ARN = "arn:aws:iam::111122223333:role/r";

  it("AWS のメッセージが空のとき、iam.awsMessage の detail は null で、ja・en とも定型文を出す", () => {
    const error = toIamOperationError(new Error(""), SAME_ROLE_ARN, "iam:GetRole");

    expect(error.localized).toEqual(localized("iam.awsMessage", { operation: "iam:GetRole", detail: null }));
    expect(error.message).toBe("iam:GetRole に失敗しました");
    expect(renderMessage("en", error.localized)).toBe("iam:GetRole failed");
  });

  it("not-found / access-denied は、アカウント ID とロール名を添える（iam.awsMessageForRole）", () => {
    const named = Object.assign(new Error("not here"), { name: "NoSuchEntity" });
    const error = toIamOperationError(named, SAME_ROLE_ARN, "iam:GetRole");

    expect(error.localized).toEqual(
      localized("iam.awsMessageForRole", {
        accountId: "111122223333",
        roleName: "r",
        operation: "iam:GetRole",
        detail: "not here",
      }),
    );
    expect(error.message).toBe("アカウント 111122223333 のロール「r」: not here");
    expect(renderMessage("en", error.localized)).toBe('Role "r" in account 111122223333: not here');
  });

  it("access-denied で AWS のメッセージが空のときは、detail が null の iam.awsMessageForRole になる", () => {
    const named = Object.assign(new Error(""), { name: "AccessDenied" });
    const error = toIamOperationError(named, SAME_ROLE_ARN, "iam:ListRoleTags");

    expect(error.localized).toEqual(
      localized("iam.awsMessageForRole", {
        accountId: "111122223333",
        roleName: "r",
        operation: "iam:ListRoleTags",
        detail: null,
      }),
    );
    expect(error.message).toBe("アカウント 111122223333 のロール「r」: iam:ListRoleTags に失敗しました");
    expect(renderMessage("en", error.localized)).toBe(
      'Role "r" in account 111122223333: iam:ListRoleTags failed',
    );
  });

  it("それ以外の失敗は、iam.awsMessage に AWS の文をそのまま入れる", () => {
    const throttled = Object.assign(new Error("Rate exceeded"), { name: "Throttling" });
    const error = toIamOperationError(throttled, SAME_ROLE_ARN, "iam:GetRole");

    expect(error.localized).toEqual(localized("iam.awsMessage", { operation: "iam:GetRole", detail: "Rate exceeded" }));
    expect(error.message).toBe("Rate exceeded");
  });

  describe("実在しない IAM ユーザ（Issue #208）", () => {
    // フィクスチャは、実 IAM が返した例外名と原文（2026-11-02 の実測。アカウント ID だけ置き換えた）。
    const awsError = (principal: string, name = "MalformedPolicyDocumentException"): Error =>
      Object.assign(new Error(`Invalid principal in policy: "AWS":"${principal}"`), { name });
    const USER_ARN = "arn:aws:iam::111122223333:user/rolust-ghost-does-not-exist";

    it("ユーザの ARN を取り出し、「IAM に存在しない」ことと直し方を示す。AWS の原文は残す", () => {
      const error = toIamOperationError(awsError(USER_ARN), SAME_ROLE_ARN, "iam:UpdateAssumeRolePolicy");

      expect(error.kind).toBe("invalid-policy");
      expect(error.errorCode).toBe("MalformedPolicyDocumentException");
      expect(error.localized).toEqual(
        localized("iam.invalidPrincipalUser", {
          userArn: USER_ARN,
          detail: `Invalid principal in policy: "AWS":"${USER_ARN}"`,
        }),
      );
      expect(error.message).toContain(USER_ARN);
      expect(error.message).toContain("IAM に存在しない");
      expect(error.message).toContain(`Invalid principal in policy: "AWS":"${USER_ARN}"`);
      expect(renderMessage("en", error.localized)).toContain("does not exist in IAM");
    });

    it("パス付きのユーザ・別アカウントのユーザも同じ扱い（IAM の原文の形は同じ）", () => {
      for (const arn of [
        "arn:aws:iam::111122223333:user/team/rolust-ghost-pathed",
        "arn:aws:iam::444455556666:user/rolust-ghost-other-account",
      ]) {
        const error = toIamOperationError(awsError(arn), SAME_ROLE_ARN, "iam:UpdateAssumeRolePolicy");
        expect(error.localized).toMatchObject({ id: "iam.invalidPrincipalUser", params: { userArn: arn } });
      }
    });

    it("例外名が MalformedPolicyDocument（Exception の付かない名前）でも同じ扱い", () => {
      const error = toIamOperationError(awsError(USER_ARN, "MalformedPolicyDocument"), SAME_ROLE_ARN, "iam:UpdateAssumeRolePolicy");

      expect(error.localized).toMatchObject({ id: "iam.invalidPrincipalUser" });
    });

    it("ロールが存在しないときは、ユーザとは言わず、AWS の文言のまま出す（判定を広げない）", () => {
      const roleArn = "arn:aws:iam::111122223333:role/rolust-ghost-role";
      const error = toIamOperationError(awsError(roleArn), SAME_ROLE_ARN, "iam:UpdateAssumeRolePolicy");

      expect(error.kind).toBe("invalid-policy");
      expect(error.localized).toEqual(
        localized("iam.awsMessage", {
          operation: "iam:UpdateAssumeRolePolicy",
          detail: `Invalid principal in policy: "AWS":"${roleArn}"`,
        }),
      );
    });

    it("ほかの MalformedPolicyDocument（構文の誤りなど）は、AWS の文言のまま出す", () => {
      const syntax = Object.assign(new Error("Syntax errors in policy."), { name: "MalformedPolicyDocumentException" });
      const error = toIamOperationError(syntax, SAME_ROLE_ARN, "iam:UpdateAssumeRolePolicy");

      expect(error.kind).toBe("invalid-policy");
      expect(error.localized).toEqual(
        localized("iam.awsMessage", { operation: "iam:UpdateAssumeRolePolicy", detail: "Syntax errors in policy." }),
      );
    });

    it("同じ文言でも、例外名が MalformedPolicyDocument 系でなければ、AWS の文言のまま出す", () => {
      const error = toIamOperationError(awsError(USER_ARN, "PolicyNotAttachable"), SAME_ROLE_ARN, "iam:UpdateAssumeRolePolicy");

      expect(error.localized).toMatchObject({ id: "iam.awsMessage" });
    });

    it("原文がユーザの ARN で終わらない形（Principal の値が別の形）は、AWS の文言のまま出す", () => {
      for (const principal of ["*", "arn:aws:iam::111122223333:root", "arn:aws:iam::111122223333:user/"]) {
        const error = toIamOperationError(awsError(principal), SAME_ROLE_ARN, "iam:UpdateAssumeRolePolicy");
        expect(error.localized).toMatchObject({ id: "iam.awsMessage" });
      }
    });
  });

  it("plainMessage で作った IamOperationError は、localized が operator.plain", () => {
    const error = new IamOperationError("unknown", "X", SAME_ROLE_ARN, plainMessage("手で作った文"));

    expect(error.localized).toEqual(plainMessage("手で作った文"));
    expect(error.message).toBe("手で作った文");
  });

  it("LocalizedMessage で作ると、message はその ja の描画になる", () => {
    const message = localized("iam.emptyPolicy", {});
    const error = new IamOperationError("unknown", "X", SAME_ROLE_ARN, message);

    expect(error.localized).toBe(message);
    expect(error.message).toBe("IAM が信頼ポリシー文書を返しませんでした");
  });

  it("信頼ポリシー文書が空のとき、iam.emptyPolicy を返す", async () => {
    iamMock.resolves(getRoleResponse());

    const error: unknown = await createIamTrustPolicyClient(DEPLOY_ACCOUNT)
      .getTrustPolicy(ROLE_ARN)
      .catch((caught: unknown) => caught);

    expect((error as IamOperationError).localized).toEqual(localized("iam.emptyPolicy", {}));
    expect((error as IamOperationError).message).toBe("IAM が信頼ポリシー文書を返しませんでした");
    expect(renderMessage("en", (error as IamOperationError).localized)).toBe(
      "IAM did not return a trust policy document",
    );
  });

  it("デプロイ先を判定できないとき、iam.deployAccountUnknown に roleArn を持たせる", async () => {
    const error: unknown = await createIamTrustPolicyReader(null)
      .getTrustPolicy(CROSS_ARN)
      .catch((caught: unknown) => caught);

    expect((error as IamOperationError).localized).toEqual(localized("iam.deployAccountUnknown", { roleArn: CROSS_ARN }));
    expect((error as IamOperationError).message).toContain(
      "デプロイ先の AWS アカウント ID を判定できないため、IAM を呼ばずに止めました。",
    );
    expect((error as IamOperationError).message).toContain(`ロール ${CROSS_ARN} が Rolust と同じアカウントのものか`);
  });

  it("引き受けに失敗したとき、iam.assumeRoleFailed にアカウント ID・ロール名・コード・AWS の文を持たせる", async () => {
    vi.mocked(fromTemporaryCredentials).mockImplementation((() => async () => {
      throw Object.assign(new Error("User is not authorized"), { name: "AccessDenied" });
    }) as never);

    const error: unknown = await createIamTrustPolicyReader(DEPLOY_ACCOUNT)
      .getTrustPolicy(CROSS_ARN)
      .catch((caught: unknown) => caught);

    expect((error as IamOperationError).localized).toEqual(
      localized("iam.assumeRoleFailed", {
        accountId: "999900001111",
        assumeRoleName: "RolustTrustPolicyReader",
        code: "AccessDenied",
        detail: "User is not authorized",
      }),
    );
    expect((error as IamOperationError).message).toContain("（AWS のメッセージ: User is not authorized）");
  });

  it("引き受けの失敗で AWS の文が空のとき、ja は「詳細なし」、en は no details", async () => {
    vi.mocked(fromTemporaryCredentials).mockImplementation((() => async () => {
      throw Object.assign(new Error(""), { name: "AccessDenied" });
    }) as never);

    const error: unknown = await createIamTrustPolicyReader(DEPLOY_ACCOUNT)
      .getTrustPolicy(CROSS_ARN)
      .catch((caught: unknown) => caught);

    const { localized: message } = error as IamOperationError;
    expect(renderMessage("ja", message)).toContain("（AWS のメッセージ: 詳細なし）");
    expect(renderMessage("en", message)).toContain("(AWS message: no details)");
  });
});
