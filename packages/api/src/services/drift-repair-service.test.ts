import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { TrustPolicyDocument } from "@rolust/core";
import { plainMessage } from "@rolust/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { IamOperationError } from "../aws/iam-client.js";
import { TEST_POOL_ID, conditionalCheckFailed, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { adoptDrift, restoreDrift } from "./drift-repair-service.js";
import type { RepairDeps } from "./drift-repair-service.js";

/**
 * 乖離を直す操作（FR-4.10。Issue #172）。IAM は読み取りだけの型を渡し、呼び出しの形を確かめる。
 * 実 IAM の応答の形は統合テストで確かめる。
 */

const NOW = "2026-10-16T00:00:00.000Z";
const POOL_PK = `POOL#${TEST_POOL_ID}`;
const ROLE = "arn:aws:iam::555566667777:role/DeployProd";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const MIKI = "arn:aws:iam::111122223333:user/miki.tanaka";
const TARO = "arn:aws:iam::111122223333:user/taro.yamada";
const SAYURI = "arn:aws:iam::111122223333:user/sayuri.ito";
const OUTSIDER = "arn:aws:iam::777788889999:user/outsider";
const ACTOR = { name: "admin1" };

function roleItem(arn: string) {
  return {
    pk: "ROLE", sk: `ROLE#${arn}`, itemType: "IamRole", accountId: arn.split(":")[4],
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
function roleLockItem(changeRequestId: string, status: string) {
  return {
    pk: `ROLELOCK#${ROLE}`, sk: "UNREFLECTED", itemType: "RoleLock", roleArn: ROLE,
    changeRequestId, status, createdAt: NOW,
  };
}

/** GetItem は pk で振り分ける（ロールは `ROLE`、ロールロックは `ROLELOCK#…`）。 */
function stubStore(opts: {
  users: string[];
  assignments?: ReturnType<typeof assignItem>[];
  existingLock?: ReturnType<typeof roleLockItem>;
}) {
  ddbMock.on(GetCommand).callsFake((input: { Key: { pk: string } }) => {
    if (input.Key.pk === "ROLE") return { Item: roleItem(ROLE) };
    if (input.Key.pk.startsWith("ROLELOCK#") && opts.existingLock) return { Item: opts.existingLock };
    return {};
  });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": POOL_PK, ":prefix": "USER#" } }).resolves({ Items: opts.users.map(userItem) });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": POOL_PK, ":prefix": "ASSIGN#" } }).resolves({ Items: opts.assignments ?? [] });
  ddbMock.on(PutCommand).resolves({});
  ddbMock.on(UpdateCommand).resolves({});
  ddbMock.on(DeleteCommand).resolves({});
}

function trustedBy(...principals: string[]): TrustPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [{ Sid: "S1", Effect: "Allow", Principal: { AWS: principals }, Action: "sts:AssumeRole" }],
  };
}
function iamReturning(policy: TrustPolicyDocument | Error) {
  return {
    getTrustPolicy: vi.fn(async (): Promise<TrustPolicyDocument> => {
      if (policy instanceof Error) throw policy;
      return policy;
    }),
  };
}
const puts = () => ddbMock.commandCalls(PutCommand).map((call) => call.args[0].input);

beforeEach(() => {
  setupDdbMock();
});

describe("restoreDrift（FR-4.10）", () => {
  it("乖離から、種別 restore の下書きを作り、ロールのロックを取る。管理外は入力に入らない", async () => {
    // reflected=true の AYAKA が IAM に無く（足りない）、reflected でない KENJI が IAM にある（余分）。
    stubStore({ users: [AYAKA, KENJI], assignments: [assignItem(AYAKA, ROLE, true, true)] });
    const iam = iamReturning(trustedBy(KENJI, OUTSIDER));

    const response = await restoreDrift(ROLE, NOW, ACTOR, "555566667777", { iam });

    expect(response.outcome).toBe("created");
    expect(response.changeRequest).toMatchObject({
      roleArn: ROLE,
      kind: "restore",
      status: "draft",
      addUserArns: [AYAKA],
      removeUserArns: [KENJI],
      createdBy: ACTOR,
    });
    const items = puts().map((input) => input.Item as Record<string, unknown>);
    expect(items.some((item) => item.itemType === "RoleLock")).toBe(true);
    expect(items.some((item) => item.itemType === "ChangeRequest" && item.kind === "restore")).toBe(true);
    expect(JSON.stringify(items)).not.toContain(OUTSIDER);
  });

  it("乖離が無ければ何も書かない（2 回目の押下でも重複しない）", async () => {
    stubStore({ users: [AYAKA], assignments: [assignItem(AYAKA, ROLE, true, true)] });
    const iam = iamReturning(trustedBy(AYAKA, OUTSIDER));

    const response = await restoreDrift(ROLE, NOW, ACTOR, "555566667777", { iam });

    expect(response).toEqual({ outcome: "no-drift", changeRequest: null, exclusion: null, failures: [] });
    expect(puts()).toEqual([]);
  });

  it("未反映の申請があるロールは作らず、理由と既存の申請 ID を返す", async () => {
    stubStore({
      users: [AYAKA],
      assignments: [assignItem(AYAKA, ROLE, true, true)],
      existingLock: roleLockItem("cr-existing", "failed"),
    });
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());
    const iam = iamReturning(trustedBy(OUTSIDER)); // AYAKA が足りない

    const response = await restoreDrift(ROLE, NOW, ACTOR, "555566667777", { iam });

    expect(response.outcome).toBe("excluded");
    expect(response.exclusion).toEqual({ reason: "failed", changeRequestId: "cr-existing" });
    expect(response.changeRequest).toBeNull();
    // ロックを取れなかったので、申請の本体は書かない。
    const items = puts().map((input) => input.Item as Record<string, unknown>);
    expect(items.every((item) => item.itemType === "RoleLock")).toBe(true);
  });

  it("IAM を読めないときは何も書かず、エラーコードつきの失敗にする", async () => {
    stubStore({ users: [AYAKA] });
    const denied = new IamOperationError("access-denied", "AccessDenied", ROLE, plainMessage("拒否されました"));
    const iam = iamReturning(denied);

    await expect(restoreDrift(ROLE, NOW, ACTOR, "555566667777", { iam })).rejects.toMatchObject({
      statusCode: 502,
      code: "AccessDenied",
      retryable: false,
    });
    expect(puts()).toEqual([]);
  });

  it("ChangeRequest の保存に失敗したら、取ったロックを補償して失敗にする", async () => {
    stubStore({ users: [AYAKA], assignments: [assignItem(AYAKA, ROLE, true, true)] });
    ddbMock.on(PutCommand, { Item: { itemType: "ChangeRequest" } } as never).rejects(new Error("boom"));
    const iam = iamReturning(trustedBy(OUTSIDER));

    await expect(restoreDrift(ROLE, NOW, ACTOR, "555566667777", { iam })).rejects.toThrow();

    const items = puts().map((input) => input.Item as Record<string, unknown>);
    const lock = items.find((item) => item.itemType === "RoleLock");
    expect(lock).toBeDefined();
    const deletes = ddbMock.commandCalls(DeleteCommand).map((call) => call.args[0].input);
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.Key).toEqual({ pk: `ROLELOCK#${ROLE}`, sk: "UNREFLECTED" });
    expect(deletes[0]?.ExpressionAttributeValues).toEqual({ ":id": lock?.changeRequestId });
  });

  it("登録されていないロールは NotFound。IAM を呼ばない", async () => {
    ddbMock.on(GetCommand).resolves({});
    const iam = iamReturning(trustedBy());

    await expect(restoreDrift(ROLE, NOW, ACTOR, "555566667777", { iam })).rejects.toMatchObject({ statusCode: 404 });
    expect(iam.getTrustPolicy).not.toHaveBeenCalled();
  });

  it("IAM を更新する関数を持たない型だけを受け取る（型で保証する）", () => {
    const deps: RepairDeps = { iam: iamReturning(trustedBy()) };
    // @ts-expect-error RepairDeps["iam"] は更新の関数を持たない（読み取りだけの型）。
    void deps.iam.updateTrustPolicy;
    expect(deps.iam.getTrustPolicy).toBeTypeOf("function");
  });
});

describe("adoptDrift（FR-4.11）", () => {
  const updates = () => ddbMock.commandCalls(UpdateCommand).map((call) => call.args[0].input);

  it("余分は真・足りないは偽で交点だけを書き、監査（kind adopt・反映済み）を先に残す。AWS の更新関数は呼ばない", async () => {
    stubStore({ users: [AYAKA, KENJI], assignments: [assignItem(AYAKA, ROLE, true, true)] });
    const iam = iamReturning(trustedBy(KENJI, OUTSIDER)); // AYAKA が足りない・KENJI が余分

    const order: string[] = [];
    ddbMock.on(PutCommand).callsFake(() => {
      order.push("put");
      return {};
    });
    ddbMock.on(UpdateCommand).callsFake(() => {
      order.push("update");
      return {};
    });

    const response = await adoptDrift(ROLE, NOW, ACTOR, "555566667777", { iam });

    expect(response.outcome).toBe("adopted");
    expect(response.failures).toEqual([]);
    expect(response.changeRequest).toMatchObject({
      kind: "adopt",
      status: "applied",
      addUserArns: [KENJI],
      removeUserArns: [AYAKA],
      createdBy: ACTOR,
      appliedBy: ACTOR,
      appliedAt: NOW,
      result: { ok: true, errorCode: null },
    });
    expect(order[0]).toBe("put"); // 監査が先
    expect(order.indexOf("put")).toBeLessThan(order.indexOf("update"));
    const values = updates().map((input) => ({
      user: input.ExpressionAttributeValues?.[":userArn"],
      state: input.ExpressionAttributeValues?.[":state"],
    }));
    expect(values).toEqual(expect.arrayContaining([{ user: KENJI, state: true }, { user: AYAKA, state: false }]));
    expect(values).toHaveLength(2); // 乖離していないユーザ・管理外は触らない
    expect(JSON.stringify(updates())).not.toContain(OUTSIDER);
  });

  it("乖離していないユーザ（反映済み・IAM にもある）は、checked に関わらず書き込まれない", async () => {
    stubStore({
      users: [AYAKA, KENJI, SAYURI],
      assignments: [
        assignItem(AYAKA, ROLE, true, true),
        assignItem(SAYURI, ROLE, true, true), // 一致している
      ],
    });
    const iam = iamReturning(trustedBy(KENJI, SAYURI)); // AYAKA が足りない・KENJI が余分・SAYURI は一致

    await adoptDrift(ROLE, NOW, ACTOR, "555566667777", { iam });

    const targets = updates().map((input) => input.ExpressionAttributeValues?.[":userArn"]);
    expect(targets).toHaveLength(2);
    expect(targets).not.toContain(SAYURI);
  });

  it("checked と reflected が食い違う交点も、記録を IAM の現状で絶対値に上書きする（checked も reflected も）", async () => {
    stubStore({
      users: [AYAKA, KENJI, MIKI, TARO],
      assignments: [
        assignItem(AYAKA, ROLE, false, true), // 足りない。checked は偽で食い違い（reflected は真）
        assignItem(KENJI, ROLE, false, false), // 余分。checked は偽
        assignItem(MIKI, ROLE, true, false), // 余分。checked は真
        assignItem(TARO, ROLE, true, true), // 足りない。checked は真
      ],
    });
    const iam = iamReturning(trustedBy(KENJI, MIKI)); // AYAKA・TARO が足りない・KENJI・MIKI が余分

    await adoptDrift(ROLE, NOW, ACTOR, "555566667777", { iam });

    const values = updates().map((input) => ({
      user: input.ExpressionAttributeValues?.[":userArn"],
      state: input.ExpressionAttributeValues?.[":state"],
    }));
    expect(values).toHaveLength(4);
    expect(values).toEqual(
      expect.arrayContaining([
        { user: KENJI, state: true },
        { user: MIKI, state: true },
        { user: AYAKA, state: false },
        { user: TARO, state: false },
      ]),
    );
    // 同じ値（:state）を checked と reflected の両方に書く。以前の checked に条件を付けない（後勝ちの絶対値）。
    for (const input of updates()) {
      const expression = String(input.UpdateExpression);
      expect(expression).toContain("#checked = :state");
      expect(expression).toContain("#reflected = :state");
      expect(input.ConditionExpression).toBeUndefined();
    }
  });

  it("未反映の申請があるロールでは何も書かず、既存の申請 ID を返す（IAM も読まない）", async () => {
    stubStore({ users: [AYAKA], existingLock: roleLockItem("cr-existing", "draft") });
    const iam = iamReturning(trustedBy());

    const response = await adoptDrift(ROLE, NOW, ACTOR, "555566667777", { iam });

    expect(response.outcome).toBe("excluded");
    expect(response.exclusion).toEqual({ reason: "draft", changeRequestId: "cr-existing" });
    expect(iam.getTrustPolicy).not.toHaveBeenCalled();
    expect(puts()).toEqual([]);
    expect(updates()).toEqual([]);
  });

  it("乖離が無ければ何も書かない（2 回目の押下で監査が重複しない）", async () => {
    stubStore({ users: [AYAKA], assignments: [assignItem(AYAKA, ROLE, true, true)] });
    const iam = iamReturning(trustedBy(AYAKA));

    const response = await adoptDrift(ROLE, NOW, ACTOR, "555566667777", { iam });

    expect(response.outcome).toBe("no-drift");
    expect(puts()).toEqual([]);
    expect(updates()).toEqual([]);
  });

  it("IAM を読めないときは何も書かない", async () => {
    stubStore({ users: [AYAKA] });
    const denied = new IamOperationError("access-denied", "AccessDenied", ROLE, plainMessage("拒否されました"));
    await expect(adoptDrift(ROLE, NOW, ACTOR, "555566667777", { iam: iamReturning(denied) })).rejects.toMatchObject({
      code: "AccessDenied",
    });
    expect(puts()).toEqual([]);
    expect(updates()).toEqual([]);
  });

  it("交点の一部が書けなくても、監査は残り、書けた分は書かれ、失敗した交点を列挙する", async () => {
    stubStore({ users: [AYAKA, KENJI], assignments: [assignItem(AYAKA, ROLE, true, true)] });
    ddbMock.on(UpdateCommand).callsFake((input: { ExpressionAttributeValues: Record<string, unknown> }) => {
      if (input.ExpressionAttributeValues[":userArn"] === AYAKA) throw new Error("throttled");
      return {};
    });
    const iam = iamReturning(trustedBy(KENJI)); // AYAKA が足りない（偽にする書き込みが失敗）・KENJI が余分

    const response = await adoptDrift(ROLE, NOW, ACTOR, "555566667777", { iam });

    expect(response.outcome).toBe("adopted");
    expect(response.failures.map((failure) => failure.userArn)).toEqual([AYAKA]);
    expect(response.failures[0]?.localized?.id).toBe("driftRepair.cellFailed");
    expect(puts().some((input) => (input.Item as { kind?: string }).kind === "adopt")).toBe(true);
    // 書けた分（KENJI）は試みられている。
    expect(updates().some((input) => input.ExpressionAttributeValues?.[":userArn"] === KENJI)).toBe(true);
  });

  it("監査の保存に失敗したら、交点は書かない", async () => {
    stubStore({ users: [AYAKA], assignments: [assignItem(AYAKA, ROLE, true, true)] });
    ddbMock.on(PutCommand).rejects(new Error("boom"));
    await expect(adoptDrift(ROLE, NOW, ACTOR, "555566667777", { iam: iamReturning(trustedBy()) })).rejects.toThrow();
    expect(updates()).toEqual([]);
  });
});
