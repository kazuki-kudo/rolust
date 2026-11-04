import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { TrustPolicyDocument } from "@rolust/core";
import { plainMessage } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AllowedAccountsUnavailableError } from "../aws/allowed-accounts.js";
import { IamOperationError } from "../aws/iam-client.js";
import type { IamTrustPolicyReader } from "../aws/iam-client.js";
import { ConflictError, StorageError } from "../errors.js";
import { TEST_POOL_ID, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { registerRole } from "./role-register-service.js";

const ACCOUNT = "555566667777";
const ROLE = `arn:aws:iam::${ACCOUNT}:role/DeployProd`;
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const NOW = "2026-10-07T00:00:00.000Z";
const STRANGER = "arn:aws:iam::999900001111:user/mallory";
/** 許可するアカウント（Issue #139）。AYAKA・KENJI のアカウント。 */
const allowedAccounts = async () => new Set(["111122223333"]) as ReadonlySet<string>;
const INPUT = { accountId: ACCOUNT, roleName: "DeployProd", description: null, displayName: null };

function policyOf(...principals: string[]): TrustPolicyDocument {
  return { Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { AWS: principals }, Action: "sts:AssumeRole" }] };
}

function readerOf(result: TrustPolicyDocument | Error): IamTrustPolicyReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async getTrustPolicy(roleArn) {
      reads.push(roleArn);
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

/** 書き込みの順序を確かめるため、Put と Delete を 1 本の時系列にする。 */
function writes(): string[] {
  return ddbMock.calls().flatMap((call) => {
    const command = call.args[0];
    if (command instanceof PutCommand) return [`Put:${String((command.input.Item as { itemType: string }).itemType)}`];
    if (command instanceof DeleteCommand) return [`Delete:${String((command.input.Key as { sk: string }).sk)}`];
    return [];
  });
}

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(GetCommand).resolves({});
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
  // ensurePool が読む META
  ddbMock.on(GetCommand, { Key: { pk: `POOL#${TEST_POOL_ID}`, sk: "META" } }).resolves({
    Item: { pk: `POOL#${TEST_POOL_ID}`, sk: "META", itemType: "UserPool", poolId: TEST_POOL_ID, createdAt: NOW },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerRole（Issue #135 spec 3.1）", () => {
  it("既に登録済みなら 409 で、信頼ポリシーも読まず、何も書かない（既存の未反映の変更を上書きしない）", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${ROLE}` } }).resolves({
      Item: { pk: "ROLE", sk: `ROLE#${ROLE}`, itemType: "IamRole", accountId: ACCOUNT, roleName: "DeployProd", arn: ROLE, createdAt: NOW },
    });
    const iam = readerOf(policyOf(AYAKA));

    await expect(registerRole(INPUT, NOW, ACCOUNT, { iam })).rejects.toBeInstanceOf(ConflictError);

    expect(iam.reads).toEqual([]);
    expect(writes()).toEqual([]);
  });

  it("登録済みの 409 は role.alreadyRegistered と roleArn を持つ（Issue #94）", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${ROLE}` } }).resolves({
      Item: { pk: "ROLE", sk: `ROLE#${ROLE}`, itemType: "IamRole", accountId: ACCOUNT, roleName: "DeployProd", arn: ROLE, createdAt: NOW },
    });

    await expect(registerRole(INPUT, NOW, ACCOUNT, { iam: readerOf(policyOf(AYAKA)) })).rejects.toMatchObject({
      code: "Conflict",
      localized: { id: "role.alreadyRegistered", params: { roleArn: ROLE } },
      message: `この IAM ロールは既に登録されています: ${ROLE}`,
    });
  });

  it("信頼ポリシーを読めなければ、何も書かずに、エラーコードを含めて拒否する", async () => {
    const iam = readerOf(new IamOperationError("access-denied", "AccessDenied", ROLE, plainMessage("denied")));

    const error = await registerRole(INPUT, NOW, ACCOUNT, { iam }).catch((caught: unknown) => caught);

    expect((error as Error).message).toContain("AccessDenied");
    expect(writes()).toEqual([]);
  });

  it("成功: IamUser → Assignment → PoolRoleLink → IamRole の順に書き、IamRole が最後", async () => {
    const result = await registerRole(INPUT, NOW, ACCOUNT, { iam: readerOf(policyOf(AYAKA, KENJI)), allowedAccounts });

    expect(writes()).toEqual([
      "Put:IamUser", "Put:Assignment", "Put:IamUser", "Put:Assignment", "Put:PoolRoleLink", "Put:IamRole",
    ]);
    expect(result.role.arn).toBe(ROLE);
    expect(result.imported).toEqual({ roleArn: ROLE, userCount: 2, registeredCount: 2, skippedCount: 0 });
  });

  it("信頼ポリシーに許可リスト外のアカウントのユーザがいたら、そのユーザだけ取り込まずに飛ばし、ロールは登録する（Issue #139）", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const result = await registerRole(INPUT, NOW, ACCOUNT, { iam: readerOf(policyOf(AYAKA, STRANGER)), allowedAccounts });

    expect(writes()).toEqual(["Put:IamUser", "Put:Assignment", "Put:PoolRoleLink", "Put:IamRole"]);
    expect(result.imported).toEqual({ roleArn: ROLE, userCount: 2, registeredCount: 1, skippedCount: 1 });
  });

  it("許可リストを読めなければ、何も書かずに拒否する（fail closed。Issue #139）", async () => {
    const unavailable = async (): Promise<ReadonlySet<string>> => {
      throw new AllowedAccountsUnavailableError(plainMessage("許可するアカウント ID の一覧を読み取れませんでした"));
    };

    await expect(
      registerRole(INPUT, NOW, ACCOUNT, { iam: readerOf(policyOf(AYAKA)), allowedAccounts: unavailable }),
    ).rejects.toBeInstanceOf(AllowedAccountsUnavailableError);

    expect(writes()).toEqual([]);
  });

  it("取り込むユーザがいなければ、許可リストを読まない（読めなくても、ロールの登録を止めない。Issue #139）", async () => {
    const unavailable = vi.fn(async (): Promise<ReadonlySet<string>> => {
      throw new AllowedAccountsUnavailableError(plainMessage("読めない"));
    });

    await registerRole(INPUT, NOW, ACCOUNT, { iam: readerOf(policyOf()), allowedAccounts: unavailable });

    expect(unavailable).not.toHaveBeenCalled();
    expect(writes()).toEqual(["Put:PoolRoleLink", "Put:IamRole"]);
  });

  it("取り込むユーザがいなくても、PoolRoleLink → IamRole の順に書く", async () => {
    await registerRole(INPUT, NOW, ACCOUNT, { iam: readerOf(policyOf()), allowedAccounts });

    expect(writes()).toEqual(["Put:PoolRoleLink", "Put:IamRole"]);
  });

  it("以前の登録の途中失敗で残った、信頼ポリシーにいないユーザの交点は、取り込みの前に消す", async () => {
    ddbMock
      .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${TEST_POOL_ID}`, ":prefix": "ASSIGN#" } })
      .resolves({
        Items: [{
          pk: `POOL#${TEST_POOL_ID}`, sk: `ASSIGN#${KENJI}#${ROLE}`, itemType: "Assignment",
          poolId: TEST_POOL_ID, userArn: KENJI, roleArn: ROLE, checked: true, reflected: true, updatedAt: NOW,
        }],
      });

    await registerRole(INPUT, NOW, ACCOUNT, { iam: readerOf(policyOf(AYAKA)), allowedAccounts });

    expect(writes()[0]).toBe(`Delete:ASSIGN#${KENJI}#${ROLE}`);
  });

  it("書き込みの途中で失敗したら、IamRole を書かずに再試行可の StorageError を返す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    ddbMock
      .on(PutCommand, { Item: { itemType: "PoolRoleLink" } })
      .rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    const error = await registerRole(INPUT, NOW, ACCOUNT, { iam: readerOf(policyOf()), allowedAccounts }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).retryable).toBe(true);
    expect(writes()).not.toContain("Put:IamRole");
    expect(error).toMatchObject({
      localized: { id: "storage.roleRegisterPartial", params: {} },
      message: "IAM ロールの登録が途中で失敗しました。ロールは登録されていません。もう一度登録すると、続きから直ります。",
    });
  });
});
