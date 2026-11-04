import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

// ddb-mock.ts が DynamoDBDocumentClient を既にモック化している。二重に mockClient すると失敗するので、それを使う。
import { conditionalCheckFailed, ddbMock as mock } from "../testing/ddb-mock.js";
import { createSplitTablesStore } from "./split-tables-store.js";

const LEGACY = "rolust-legacy-test";
const STATE = "rolust-state-split-test";
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";

function store() {
  return createSplitTablesStore(
    { legacyTableName: LEGACY, stateTableName: STATE },
    "ap-northeast-1",
    DynamoDBDocumentClient.from(new DynamoDBClient({ region: "ap-northeast-1" })),
  );
}

beforeEach(() => {
  mock.reset();
});

describe("コピーの DynamoDB ストア（Issue #36）", () => {
  it("listPoolIds は旧テーブルの GSI1 POOLS を最後のページまで辿る", async () => {
    mock
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ poolId: "a" }], LastEvaluatedKey: { pk: "x" } })
      .resolvesOnce({ Items: [{ poolId: "b" }] });

    expect(await store().listPoolIds()).toEqual(["a", "b"]);
    expect(mock.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      TableName: LEGACY,
      IndexName: "gsi1",
      KeyConditionExpression: "gsi1pk = :pk",
      ExpressionAttributeValues: { ":pk": "POOLS" },
    });
  });

  it("listPoolPartition はプールのパーティションを sk で絞らずに全件引く", async () => {
    mock.on(QueryCommand).resolves({ Items: [{ pk: "POOL#a", sk: "META" }] });
    expect(await store().listPoolPartition("a")).toEqual([{ pk: "POOL#a", sk: "META" }]);
    expect(mock.commandCalls(QueryCommand)[0]?.args[0].input).toEqual({
      TableName: LEGACY,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "POOL#a" },
      ExclusiveStartKey: undefined,
    });
  });

  it("listRoles は旧テーブルの pk = ROLE を引く", async () => {
    mock.on(QueryCommand).resolves({ Items: [] });
    await store().listRoles();
    expect(mock.commandCalls(QueryCommand)[0]?.args[0].input).toMatchObject({
      TableName: LEGACY,
      KeyConditionExpression: "pk = :pk",
      ExpressionAttributeValues: { ":pk": "ROLE" },
    });
  });

  it("getRoleLinkOwners は旧テーブル、findExistingKeys は状態テーブルを BatchGet する", async () => {
    mock
      .on(BatchGetCommand)
      .resolvesOnce({ Responses: { [LEGACY]: [{ pk: `ROLELINK#${DEPLOY}`, sk: "OWNER" }] } })
      .resolvesOnce({ Responses: { [STATE]: [{ pk: "POOL#a", sk: "META" }] } });

    expect(await store().getRoleLinkOwners([DEPLOY])).toEqual([{ pk: `ROLELINK#${DEPLOY}`, sk: "OWNER" }]);
    expect(await store().findExistingKeys([{ pk: "POOL#a", sk: "META" }, { pk: "ROLE", sk: `ROLE#${DEPLOY}` }])).toEqual(
      new Set(["POOL#a|META"]),
    );
    const calls = mock.commandCalls(BatchGetCommand);
    expect(calls[0]?.args[0].input.RequestItems?.[LEGACY]?.Keys).toEqual([{ pk: `ROLELINK#${DEPLOY}`, sk: "OWNER" }]);
    expect(Object.keys(calls[1]?.args[0].input.RequestItems ?? {})).toEqual([STATE]);
  });

  it("putIfAbsent は状態テーブルへ既存を上書きしない条件で書き、既存なら false、ほかの失敗は投げる", async () => {
    const item = { pk: "POOL#a", sk: "META", itemType: "UserPool" };
    mock.on(PutCommand).resolvesOnce({}).rejectsOnce(conditionalCheckFailed()).rejectsOnce(new Error("denied"));

    expect(await store().putIfAbsent(item)).toBe(true);
    expect(mock.commandCalls(PutCommand)[0]?.args[0].input).toEqual({
      TableName: STATE,
      Item: item,
      ConditionExpression: "attribute_not_exists(pk)",
    });
    expect(await store().putIfAbsent(item)).toBe(false);
    await expect(store().putIfAbsent(item)).rejects.toThrow("denied");
  });
});
