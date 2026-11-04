import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import type { ChangeRequest } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { changeRequestKey } from "../ddb/keys.js";
import { ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { getChangeRequest, putChangeRequest } from "./change-request.js";

const base: ChangeRequest = {
  changeRequestId: "cr-1",
  poolId: "platform-team",
  roleArn: "arn:aws:iam::555566667777:role/R",
  addUserArns: [],
  removeUserArns: [],
  status: "draft",
  createdAt: "2026-10-16T00:00:00.000Z",
  createdBy: null,
  appliedAt: null,
  appliedBy: null,
  result: null,
};

beforeEach(() => setupDdbMock());

describe("ChangeRequest.kind（Issue #172）", () => {
  it("kind を保存する", async () => {
    ddbMock.on(PutCommand).resolves({});
    await putChangeRequest({ ...base, kind: "restore" });
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).toMatchObject({ kind: "restore" });
  });

  it("kind が無い申請は、属性を書かない（通常）", async () => {
    ddbMock.on(PutCommand).resolves({});
    await putChangeRequest(base);
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).not.toHaveProperty("kind");
  });

  it("kind を持つアイテムは kind つきで、持たない既存アイテムは kind なしで読める", async () => {
    const item = { ...changeRequestKey("cr-1"), itemType: "ChangeRequest", ...base };
    ddbMock.on(GetCommand).resolvesOnce({ Item: { ...item, kind: "adopt" } }).resolvesOnce({ Item: item });
    expect((await getChangeRequest("cr-1"))?.kind).toBe("adopt");
    const plain = await getChangeRequest("cr-1");
    expect(plain?.kind).toBeUndefined();
    expect(plain).not.toHaveProperty("kind");
  });
});
