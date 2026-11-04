import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ValidationError } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../errors.js";
import { conditionalCheckFailed, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { saveRoleDescription } from "./role-description-service.js";

const ACCOUNT_ID = "123456789012";
const ROLE_NAME = "ReadOnlyAudit";
const ROLE_ARN = `arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}`;
const NOW = "2026-09-27T00:00:00.000Z";
const ROLE_KEY = { pk: "ROLE", sk: `ROLE#${ROLE_ARN}` };

function stubRole(description?: string): void {
  ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolves({
    Item: {
      ...ROLE_KEY,
      itemType: "IamRole",
      accountId: ACCOUNT_ID,
      roleName: ROLE_NAME,
      arn: ROLE_ARN,
      createdAt: NOW,
      ...(description ? { description } : {}),
    },
  });
}

function writeCount(): number {
  return ddbMock.commandCalls(UpdateCommand).length + ddbMock.commandCalls(PutCommand).length;
}

beforeEach(() => {
  setupDdbMock();
  stubRole("旧説明");
  ddbMock.on(UpdateCommand).resolves({});
});

describe("PATCH /roles?arn=（Issue #21）", () => {
  it("前後の空白を除いた説明で更新し、更新後のロールを返す", async () => {
    const result = await saveRoleDescription(ROLE_ARN, "  新しい説明  ");

    expect(result).toEqual({
      role: {
        accountId: ACCOUNT_ID,
        roleName: ROLE_NAME,
        arn: ROLE_ARN,
        description: "新しい説明",
        displayName: null,
        color: null,
        createdAt: NOW,
      },
    });
    const updates = ddbMock.commandCalls(UpdateCommand);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.args[0].input.ExpressionAttributeValues).toEqual({
      ":description": "新しい説明",
    });
  });

  it("空白だけなら未設定（null）にし、属性を消す", async () => {
    const result = await saveRoleDescription(ROLE_ARN, "   ");

    expect(result.role.description).toBeNull();
    expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.UpdateExpression).toBe(
      "REMOVE #description",
    );
  });

  it("null でも未設定にする", async () => {
    const result = await saveRoleDescription(ROLE_ARN, null);

    expect(result.role.description).toBeNull();
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(1);
  });

  it("説明が変わらなければ書かない", async () => {
    const result = await saveRoleDescription(ROLE_ARN, "旧説明");

    expect(result.role.description).toBe("旧説明");
    expect(writeCount()).toBe(0);
  });

  it("規則違反は 400（field は description）で、書かない", async () => {
    const error: unknown = await saveRoleDescription(ROLE_ARN, "a".repeat(257)).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(ValidationError);
    expect(error).toMatchObject({ field: "description" });
    expect(writeCount()).toBe(0);
  });

  it("ロールが無ければ NotFoundError（404）で、書かない", async () => {
    ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolves({});

    await expect(saveRoleDescription(ROLE_ARN, "新しい説明")).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(writeCount()).toBe(0);
  });

  it("読んだ後にロールが削除されていたら NotFoundError（404）を返す", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());

    const error: unknown = await saveRoleDescription(ROLE_ARN, "新しい説明").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(NotFoundError);
    expect(error).toMatchObject({ statusCode: 404 });
  });

  it("書き込みの失敗は 502 で知らせる", async () => {
    ddbMock
      .on(UpdateCommand)
      .rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    await expect(saveRoleDescription(ROLE_ARN, "新しい説明")).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
