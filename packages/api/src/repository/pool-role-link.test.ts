import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { StorageError } from "../errors.js";
import { conditionalCheckFailed, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { appendRoleLink, deleteRoleLink, isRoleLinked, listRoleLinks, putRoleLink, listRoleLinkEntries, setRoleLinkPosition } from "./pool-role-link.js";

const POOL_ID = "platform-team";
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
const NOW = "2026-09-25T00:00:00.000Z";

function linkItem(roleArn: string, position?: number) {
  return {
    pk: `POOL#${POOL_ID}`, sk: `ROLE#${roleArn}`, itemType: "PoolRoleLink", poolId: POOL_ID, roleArn, createdAt: NOW,
    ...(position !== undefined ? { position } : {}),
  };
}

function throttled(): Error {
  return Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" });
}

beforeEach(() => {
  setupDdbMock();
});

describe("プールとロールの紐づけ（FR-1.7 / TABLE-DESIGN.md アクセスパターン 12・13）", () => {
  it("listRoleLinks はプールのパーティションを ROLE# で絞って Query し、ARN を返す", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [linkItem(DEPLOY), linkItem(AUDIT)] });

    expect(await listRoleLinks(POOL_ID)).toEqual([DEPLOY, AUDIT].sort());
    const input = ddbMock.commandCalls(QueryCommand)[0]?.args[0].input;
    expect(input?.KeyConditionExpression).toBe("pk = :pk AND begins_with(sk, :prefix)");
    expect(input?.ExpressionAttributeValues).toEqual({ ":pk": `POOL#${POOL_ID}`, ":prefix": "ROLE#" });
  });

  it("putRoleLink は既存を上書きしない条件付きで 1 件書き、作れたら true", async () => {
    ddbMock.on(PutCommand).resolves({});

    expect(await putRoleLink(POOL_ID, DEPLOY, NOW)).toBe(true);
    const input = ddbMock.commandCalls(PutCommand)[0]?.args[0].input;
    expect(input?.Item).toEqual(linkItem(DEPLOY));
    expect(input?.ConditionExpression).toBe("attribute_not_exists(pk)");
  });

  it("putRoleLink は既にある紐づけなら false（作成日時を上書きしない）", async () => {
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());
    expect(await putRoleLink(POOL_ID, DEPLOY, NOW)).toBe(false);
  });

  it("putRoleLink は DynamoDB の障害を StorageError にする", async () => {
    ddbMock.on(PutCommand).rejects(throttled());
    await expect(putRoleLink(POOL_ID, DEPLOY, NOW)).rejects.toBeInstanceOf(StorageError);
  });

  it("deleteRoleLink は紐づけのキーだけを消す", async () => {
    ddbMock.on(DeleteCommand).resolves({});
    await deleteRoleLink(POOL_ID, DEPLOY);
    expect(ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input.Key).toEqual({ pk: `POOL#${POOL_ID}`, sk: `ROLE#${DEPLOY}` });
  });

  it("isRoleLinked は項目の有無を返す", async () => {
    ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: `ROLE#${DEPLOY}` } }).resolves({ Item: linkItem(DEPLOY) });
    ddbMock.on(GetCommand, { Key: { pk: `POOL#${POOL_ID}`, sk: `ROLE#${AUDIT}` } }).resolves({});
    expect(await isRoleLinked(POOL_ID, DEPLOY)).toBe(true);
    expect(await isRoleLinked(POOL_ID, AUDIT)).toBe(false);
  });
});

describe("紐づけの並び順（Issue #100。アクセスパターン 12・25）", () => {
  const BILLING = "arn:aws:iam::555566667777:role/BillingViewer";

  it("position 昇順で返す", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [linkItem(DEPLOY, 2), linkItem(AUDIT, 0), linkItem(BILLING, 1)] });
    expect(await listRoleLinks(POOL_ID)).toEqual([AUDIT, BILLING, DEPLOY]);
  });

  it("position を持たないものは、持つものの後ろに ARN 昇順で並べる（混在）", async () => {
    // Review Focus 1: 一部だけ position を持つ（移行前のデータや、途中で失敗した保存の後）。
    ddbMock.on(QueryCommand).resolves({ Items: [linkItem(DEPLOY), linkItem(BILLING, 5), linkItem(AUDIT)] });
    expect(await listRoleLinks(POOL_ID)).toEqual([BILLING, DEPLOY, AUDIT]);
  });

  it("position が同じ値（保存の競合）は ARN 昇順で決める", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [linkItem(DEPLOY, 1), linkItem(AUDIT, 1)] });
    expect(await listRoleLinks(POOL_ID)).toEqual([DEPLOY, AUDIT]);
  });

  it("position を持たないものだけなら、従来どおり ARN 昇順", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [linkItem(DEPLOY), linkItem(AUDIT)] });
    expect(await listRoleLinks(POOL_ID)).toEqual([DEPLOY, AUDIT]);
  });

  it("listRoleLinkEntries は position（無ければ null）つきで返す", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [linkItem(DEPLOY), linkItem(AUDIT, 0)] });
    expect(await listRoleLinkEntries(POOL_ID)).toEqual([
      { roleArn: AUDIT, position: 0 },
      { roleArn: DEPLOY, position: null },
    ]);
  });

  it("putRoleLink は position を渡したときだけ、その値を属性に含める", async () => {
    ddbMock.on(PutCommand).resolves({});
    await putRoleLink(POOL_ID, DEPLOY, NOW, 3);
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toEqual(linkItem(DEPLOY, 3));
  });

  it("setRoleLinkPosition は紐づけの存在を条件に position だけを SET する", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    expect(await setRoleLinkPosition(POOL_ID, DEPLOY, 2)).toBe(true);
    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.Key).toEqual({ pk: `POOL#${POOL_ID}`, sk: `ROLE#${DEPLOY}` });
    expect(input?.ConditionExpression).toBe("attribute_exists(pk)");
    expect(input?.UpdateExpression).toBe("SET #position = :position");
    expect(input?.ExpressionAttributeNames).toEqual({ "#position": "position" });
    expect(input?.ExpressionAttributeValues).toEqual({ ":position": 2 });
  });

  it("setRoleLinkPosition は、紐づけが外されていたら false（失敗にしない）", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    expect(await setRoleLinkPosition(POOL_ID, DEPLOY, 2)).toBe(false);
  });

  it("setRoleLinkPosition は DynamoDB の障害を StorageError にする", async () => {
    ddbMock.on(UpdateCommand).rejects(throttled());
    await expect(setRoleLinkPosition(POOL_ID, DEPLOY, 2)).rejects.toBeInstanceOf(StorageError);
  });
});

describe("appendRoleLink（Issue #135。登録時に列の末尾へ紐づける）", () => {
  const C = "arn:aws:iam::555566667777:role/Third";

  function stubLinks(entries: { roleArn: string; position?: number }[]): void {
    ddbMock.on(QueryCommand).resolves({ Items: entries.map(({ roleArn, position }) => linkItem(roleArn, position)) });
  }

  it("全件が position を持つとき、最大 + 1 で紐づける（欠番があっても割り込まない）", async () => {
    stubLinks([{ roleArn: DEPLOY, position: 0 }, { roleArn: AUDIT, position: 4 }]);
    ddbMock.on(PutCommand).resolves({});

    expect(await appendRoleLink(POOL_ID, C, NOW)).toBe(true);

    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({ roleArn: C, position: 5 });
  });

  it("紐づけが 0 件なら position 0", async () => {
    stubLinks([]);
    ddbMock.on(PutCommand).resolves({});

    await appendRoleLink(POOL_ID, C, NOW);

    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({ roleArn: C, position: 0 });
  });

  it("position を持たない紐づけがあれば、現在の順（ARN 昇順）で position を埋めてから、その後ろに紐づける（列の途中に割り込まない）", async () => {
    // A は position 0、B・C は持たない（#100 より前の保存）。D（ARN は A〜C より前）を登録しても、末尾に付く。
    const D = "arn:aws:iam::555566667777:role/AAAFirstAlphabetically";
    stubLinks([{ roleArn: DEPLOY, position: 0 }, { roleArn: AUDIT }, { roleArn: C }]);
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    expect(await appendRoleLink(POOL_ID, D, NOW)).toBe(true);

    const filled = ddbMock.commandCalls(UpdateCommand).map((call) => [
      (call.args[0].input.Key as { sk: string }).sk,
      call.args[0].input.ExpressionAttributeValues?.[":position"],
    ]);
    // 持たないもの同士は ARN 昇順（AUDIT < C）。
    expect(filled).toEqual([[`ROLE#${AUDIT}`, 1], [`ROLE#${C}`, 2]]);
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({ roleArn: D, position: 3 });
  });

  it("全件が position を持たないときも、順に埋めてから末尾に紐づける", async () => {
    stubLinks([{ roleArn: DEPLOY }, { roleArn: AUDIT }]);
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(UpdateCommand).resolves({});

    await appendRoleLink(POOL_ID, C, NOW);

    const positions = ddbMock.commandCalls(UpdateCommand).map((call) => call.args[0].input.ExpressionAttributeValues?.[":position"]);
    expect(positions).toEqual([0, 1]);
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({ roleArn: C, position: 2 });
  });

  it("position を埋める更新に失敗したら、紐づけを書かずに StorageError（やり直せる）", async () => {
    stubLinks([{ roleArn: DEPLOY }]);
    ddbMock.on(UpdateCommand).rejects(throttled());

    await expect(appendRoleLink(POOL_ID, C, NOW)).rejects.toBeInstanceOf(StorageError);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("既に紐づいていれば false（登録のやり直しで作成日時と position を保つ）", async () => {
    stubLinks([{ roleArn: DEPLOY, position: 0 }]);
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());

    expect(await appendRoleLink(POOL_ID, DEPLOY, NOW)).toBe(false);
  });
});
