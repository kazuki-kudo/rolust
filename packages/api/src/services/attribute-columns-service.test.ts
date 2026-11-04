import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ValidationError } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../errors.js";
import { conditionalCheckFailed, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { savePoolAttributeColumns } from "./attribute-columns-service.js";

const POOL_ID = "platform-team";
const NOW = "2026-10-03T00:00:00.000Z";
const META_KEY = { pk: `POOL#${POOL_ID}`, sk: "META" };

function stubPool(attributeColumns?: { columnId: string; name: string }[]): void {
  ddbMock.on(GetCommand, { Key: META_KEY }).resolves({
    Item: { ...META_KEY, itemType: "UserPool", poolId: POOL_ID, createdAt: NOW, ...(attributeColumns ? { attributeColumns } : {}) },
  });
}

function writeCount(): number {
  return (
    ddbMock.commandCalls(PutCommand).length +
    ddbMock.commandCalls(UpdateCommand).length +
    ddbMock.commandCalls(DeleteCommand).length
  );
}

let ids = 0;
const newId = () => `generated-${ids++}`;

beforeEach(() => {
  setupDdbMock();
  ids = 0;
  ddbMock.on(UpdateCommand).resolves({});
});

describe("PUT /pool/attribute-columns（Issue #61）", () => {
  it("新しい列に ID を振り、META の attributeColumns だけを更新して、保存後の列を返す", async () => {
    stubPool();

    const result = await savePoolAttributeColumns(POOL_ID, [{ name: " 名前 " }, { name: "役割" }], newId);

    expect(result).toEqual({
      columns: [
        { columnId: "generated-0", name: "名前" },
        { columnId: "generated-1", name: "役割" },
      ],
    });
    const updates = ddbMock.commandCalls(UpdateCommand);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.args[0].input.Key).toEqual(META_KEY);
    expect(updates[0]?.args[0].input.ExpressionAttributeValues).toEqual({ ":attributeColumns": result.columns });
    // IamUser のアイテムには触れない（列の削除でも値は書き換えない。D-6）。
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(0);
  });

  it("名前の変更は columnId を保つ（Review Focus 1）", async () => {
    stubPool([{ columnId: "c-name", name: "名前" }]);

    const result = await savePoolAttributeColumns(POOL_ID, [{ columnId: "c-name", name: "氏名" }], newId);

    expect(result.columns).toEqual([{ columnId: "c-name", name: "氏名" }]);
  });

  it("削除して同じ名前で作り直した列は、別の columnId になる（Review Focus 2）", async () => {
    stubPool([{ columnId: "c-name", name: "名前" }]);

    const result = await savePoolAttributeColumns(POOL_ID, [{ name: "名前" }], newId);

    expect(result.columns).toEqual([{ columnId: "generated-0", name: "名前" }]);
  });

  it("すべて削除（空の配列）を受け付ける", async () => {
    stubPool([{ columnId: "c-name", name: "名前" }]);

    expect(await savePoolAttributeColumns(POOL_ID, [], newId)).toEqual({ columns: [] });
    expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.ExpressionAttributeValues).toEqual({
      ":attributeColumns": [],
    });
  });

  it("規則違反（11 列・重複・知らない columnId・形の誤り）は 400 で、書かない", async () => {
    stubPool([{ columnId: "c-name", name: "名前" }]);

    const eleven = Array.from({ length: 11 }, (_, index) => ({ name: `列${index}` }));
    for (const bad of [eleven, [{ name: "a" }, { name: "a" }], [{ columnId: "ghost", name: "a" }], "x", [1]]) {
      await expect(savePoolAttributeColumns(POOL_ID, bad, newId)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(writeCount()).toBe(0);
  });

  it("プールが無ければ NotFoundError（404）で、書かない", async () => {
    ddbMock.on(GetCommand, { Key: META_KEY }).resolves({});

    await expect(savePoolAttributeColumns(POOL_ID, [], newId)).rejects.toBeInstanceOf(NotFoundError);
    expect(writeCount()).toBe(0);
  });

  it("読んだ後にプールが削除されていたら NotFoundError（404）", async () => {
    stubPool();
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());

    await expect(savePoolAttributeColumns(POOL_ID, [{ name: "a" }], newId)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("書き込みの失敗は 502 で知らせる", async () => {
    stubPool();
    ddbMock.on(UpdateCommand).rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    await expect(savePoolAttributeColumns(POOL_ID, [{ name: "a" }], newId)).rejects.toMatchObject({ statusCode: 502 });
  });
});
