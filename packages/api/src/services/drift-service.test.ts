import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { TrustPolicyDocument } from "@rolust/core";
import { plainMessage } from "@rolust/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IamOperationError } from "../aws/iam-client.js";
import { TEST_POOL_ID, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { computeDriftViews } from "./drift-service.js";

/**
 * 乖離の確認（FR-4.9）。AWS の IAM は呼び出しの形（読み取りだけ）を確かめる。実 IAM の応答の形は統合テストで確かめる。
 */

const NOW = "2026-10-15T00:00:00.000Z";
const POOL_PK = `POOL#${TEST_POOL_ID}`;
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
const CROSS = "arn:aws:iam::999900001111:role/CrossRole";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const OUTSIDER = "arn:aws:iam::777788889999:user/outsider";

function roleItem(arn: string) {
  const accountId = arn.split(":")[4] as string;
  return {
    pk: "ROLE", sk: `ROLE#${arn}`, itemType: "IamRole", accountId,
    roleName: arn.split("/")[1], arn, createdAt: NOW,
  };
}
function userItem(arn: string) {
  return {
    pk: POOL_PK, sk: `USER#${arn}`, itemType: "IamUser", poolId: TEST_POOL_ID,
    accountId: arn.split(":")[4], userName: arn.split("/")[1], arn, createdAt: NOW,
  };
}
function assignItem(userArn: string, roleArn: string, checked: boolean, reflected: boolean) {
  return {
    pk: POOL_PK, sk: `ASSIGN#${userArn}#${roleArn}`, itemType: "Assignment", poolId: TEST_POOL_ID,
    userArn, roleArn, checked, reflected, updatedAt: NOW,
  };
}
function linkItem(roleArn: string, position: number) {
  return { pk: POOL_PK, sk: `ROLE#${roleArn}`, itemType: "PoolRoleLink", poolId: TEST_POOL_ID, roleArn, createdAt: NOW, position };
}

function stubStore(opts: {
  roles: string[];
  links?: [string, number][];
  users: string[];
  assignments?: ReturnType<typeof assignItem>[];
}) {
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "ROLE" } }).resolves({ Items: opts.roles.map(roleItem) });
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":pk": POOL_PK, ":prefix": "ROLE#" } })
    .resolves({ Items: (opts.links ?? []).map(([arn, position]) => linkItem(arn, position)) });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": POOL_PK, ":prefix": "USER#" } }).resolves({ Items: opts.users.map(userItem) });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": POOL_PK, ":prefix": "ASSIGN#" } }).resolves({ Items: opts.assignments ?? [] });
}

function trustedBy(...principals: string[]): TrustPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [{ Sid: "S1", Effect: "Allow", Principal: { AWS: principals }, Action: "sts:AssumeRole" }],
  };
}

function iamReturning(policies: Record<string, TrustPolicyDocument | Error>) {
  return {
    getTrustPolicy: vi.fn(async (roleArn: string): Promise<TrustPolicyDocument> => {
      const value = policies[roleArn];
      if (value === undefined) throw new Error(`想定外のロール: ${roleArn}`);
      if (value instanceof Error) throw value;
      return value;
    }),
  };
}

const fixedNow = () => new Date(NOW);

beforeEach(() => {
  setupDdbMock();
});

describe("乖離の確認（FR-4.9）", () => {
  it("reflected と信頼ポリシーが一致するロールは match", async () => {
    stubStore({ roles: [DEPLOY], users: [AYAKA, KENJI], assignments: [assignItem(AYAKA, DEPLOY, true, true)] });
    const iam = iamReturning({ [DEPLOY]: trustedBy(AYAKA, OUTSIDER) });

    const response = await computeDriftViews("555566667777", { iam, now: fixedNow });

    expect(response.checkedAt).toBe(NOW);
    expect(response.roles).toEqual([
      expect.objectContaining({ roleArn: DEPLOY, status: "match", missing: [], extra: [], readError: null }),
    ]);
  });

  it("足りない・余分があるロールは drift で、管理外は unmanaged に出る", async () => {
    stubStore({ roles: [DEPLOY], users: [AYAKA, KENJI], assignments: [assignItem(AYAKA, DEPLOY, true, true)] });
    const iam = iamReturning({ [DEPLOY]: trustedBy(KENJI, OUTSIDER) });

    const [view] = (await computeDriftViews("555566667777", { iam, now: fixedNow })).roles;

    expect(view?.status).toBe("drift");
    expect(view?.missing).toEqual([AYAKA]);
    expect(view?.extra).toEqual([KENJI]);
    expect(view?.unmanaged.map((entry) => entry.value)).toEqual([OUTSIDER]);
  });

  it("checked だけが違う（未反映の編集）は乖離にならない（D-5）", async () => {
    stubStore({
      roles: [DEPLOY],
      users: [AYAKA],
      assignments: [assignItem(AYAKA, DEPLOY, true, false)], // チェックしたが、まだ反映していない
    });
    const iam = iamReturning({ [DEPLOY]: trustedBy(OUTSIDER) });

    const [view] = (await computeDriftViews("555566667777", { iam, now: fixedNow })).roles;

    expect(view?.status).toBe("match");
  });

  it("Assignment が 1 件も無いロールは、信頼ポリシーに管理下のユーザがいれば余分になる（例外を投げない）", async () => {
    stubStore({ roles: [DEPLOY], users: [AYAKA] });
    const iam = iamReturning({ [DEPLOY]: trustedBy(AYAKA) });

    const [view] = (await computeDriftViews("555566667777", { iam, now: fixedNow })).roles;

    expect(view?.status).toBe("drift");
    expect(view?.extra).toEqual([AYAKA]);
  });

  it("ロールの順は列順（FR-2.6）。紐づけの無いロールは末尾", async () => {
    stubStore({
      roles: [AUDIT, DEPLOY, CROSS],
      users: [],
      links: [[DEPLOY, 0], [AUDIT, 1]],
    });
    const iam = iamReturning({ [DEPLOY]: trustedBy(), [AUDIT]: trustedBy(), [CROSS]: trustedBy() });

    const response = await computeDriftViews("555566667777", { iam, now: fixedNow });

    expect(response.roles.map((view) => view.roleArn)).toEqual([DEPLOY, AUDIT, CROSS]);
  });

  it("ロールが 0 件なら roles は空で、IAM を呼ばない", async () => {
    stubStore({ roles: [], users: [] });
    const iam = iamReturning({});

    const response = await computeDriftViews("555566667777", { iam, now: fixedNow });

    expect(response.roles).toEqual([]);
    expect(iam.getTrustPolicy).not.toHaveBeenCalled();
  });

  it("1 ロールの読み取り失敗は、そのロールだけ readError で、他を止めない（D-9）", async () => {
    stubStore({ roles: [DEPLOY, AUDIT], users: [AYAKA], assignments: [assignItem(AYAKA, DEPLOY, true, true)] });
    const denied = new IamOperationError("access-denied", "AccessDenied", AUDIT, plainMessage("拒否されました"));
    const iam = iamReturning({ [DEPLOY]: trustedBy(AYAKA), [AUDIT]: denied });

    const response = await computeDriftViews("555566667777", { iam, now: fixedNow });
    const byArn = new Map(response.roles.map((view) => [view.roleArn, view] as const));

    expect(byArn.get(DEPLOY)?.status).toBe("match");
    expect(byArn.get(AUDIT)?.status).toBe("readError");
    expect(byArn.get(AUDIT)?.readError?.errorCode).toBe("AccessDenied");
    expect(byArn.get(AUDIT)?.readError?.message).toBe("拒否されました");
    expect(byArn.get(AUDIT)?.missing).toEqual([]);
  });

  it("IAM を更新する関数を呼ばない（読み取りだけの型しか渡さない）", async () => {
    stubStore({ roles: [DEPLOY], users: [] });
    const iam = iamReturning({ [DEPLOY]: trustedBy() });

    await computeDriftViews("555566667777", { iam, now: fixedNow });

    expect(Object.keys(iam)).toEqual(["getTrustPolicy"]);
  });

  it("DynamoDB の読み取りに失敗したら、全体を失敗させる（握りつぶさない）", async () => {
    ddbMock.on(QueryCommand).rejects(new Error("boom"));
    const iam = iamReturning({});

    await expect(computeDriftViews("555566667777", { iam, now: fixedNow })).rejects.toThrow();
  });
});
