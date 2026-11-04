import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../errors.js";
import { ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { saveRoleColor } from "./role-color-service.js";

const ROLE_ARN = "arn:aws:iam::123456789012:role/ReadOnlyAudit";
const KEY = { pk: "ROLE", sk: `ROLE#${ROLE_ARN}` };

function stubRole(color?: string): void {
  ddbMock.on(GetCommand, { Key: KEY }).resolves({
    Item: { ...KEY, itemType: "IamRole", accountId: "123456789012", roleName: "ReadOnlyAudit", arn: ROLE_ARN, createdAt: "2026-09-27T00:00:00.000Z", ...(color ? { color } : {}) },
  });
}

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(UpdateCommand).resolves({});
});

describe("saveRoleColor（Issue #100）", () => {
  it("色を保存し、更新後のロールを返す", async () => {
    stubRole();
    const result = await saveRoleColor(ROLE_ARN, "teal");
    expect(result.role.color).toBe("teal");
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });

  it("null で解除する", async () => {
    stubRole("teal");
    const result = await saveRoleColor(ROLE_ARN, null);
    expect(result.role.color).toBeNull();
    expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.UpdateExpression).toBe("REMOVE #color");
  });

  it("変わらないときは書かない", async () => {
    stubRole("teal");
    await saveRoleColor(ROLE_ARN, "teal");
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("登録されていないロールは NotFoundError", async () => {
    ddbMock.on(GetCommand, { Key: KEY }).resolves({});
    await expect(saveRoleColor(ROLE_ARN, "red")).rejects.toBeInstanceOf(NotFoundError);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });
});
