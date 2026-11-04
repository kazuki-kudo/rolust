import { GetCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ValidationError } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { ConflictError, NotFoundError } from "../errors.js";
import { ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { assertRoleDisplayNameUnused, saveRoleDisplayName } from "./role-display-name-service.js";

const ACCOUNT_ID = "123456789012";
const ROLE_A = `arn:aws:iam::${ACCOUNT_ID}:role/RoleA`;
const ROLE_B = `arn:aws:iam::${ACCOUNT_ID}:role/RoleB`;
const NOW = "2026-10-08T00:00:00.000Z";

function roleItem(arn: string, displayName?: string) {
  const roleName = arn.split("/").pop() ?? arn;
  return {
    pk: "ROLE",
    sk: `ROLE#${arn}`,
    itemType: "IamRole",
    accountId: ACCOUNT_ID,
    roleName,
    arn,
    createdAt: NOW,
    ...(displayName ? { displayName } : {}),
  };
}

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${ROLE_A}` } }).resolves({ Item: roleItem(ROLE_A) });
  ddbMock.on(QueryCommand).resolves({ Items: [roleItem(ROLE_A), roleItem(ROLE_B, "本番デプロイ")] });
  ddbMock.on(UpdateCommand).resolves({});
});

describe("saveRoleDisplayName（Issue #150）", () => {
  it("前後の空白を除いた表示名で更新し、更新後のロールを返す", async () => {
    const result = await saveRoleDisplayName(ROLE_A, "  新しい名前  ");
    expect(result.role.displayName).toBe("新しい名前");
    expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.ExpressionAttributeValues).toEqual({
      ":displayName": "新しい名前",
    });
  });

  it("ほかのロールと同じ表示名は ConflictError で拒否し、何も書かない", async () => {
    await expect(saveRoleDisplayName(ROLE_A, "本番デプロイ")).rejects.toBeInstanceOf(ConflictError);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("前後の空白の違いだけなら、ほかのロールと同じ表示名とみなす（重複）", async () => {
    await expect(saveRoleDisplayName(ROLE_A, "  本番デプロイ ")).rejects.toBeInstanceOf(ConflictError);
  });

  it("重複の 409 は role.displayNameTaken と、正規化した表示名を持つ（Issue #94）", async () => {
    await expect(saveRoleDisplayName(ROLE_A, "  本番デプロイ ")).rejects.toMatchObject({
      code: "Conflict",
      localized: { id: "role.displayNameTaken", params: { displayName: "本番デプロイ" } },
      message: "表示名「本番デプロイ」は、ほかのロールで使われています",
    });
  });

  it("大文字小文字の違いは重複ではない", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [roleItem(ROLE_B, "Deploy")] });
    await expect(saveRoleDisplayName(ROLE_A, "deploy")).resolves.toMatchObject({ role: { displayName: "deploy" } });
  });

  it("自分自身が今持つ表示名をそのまま保存しても、重複にせず、書き込みもしない", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${ROLE_B}` } }).resolves({ Item: roleItem(ROLE_B, "本番デプロイ") });
    await saveRoleDisplayName(ROLE_B, "本番デプロイ");
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("null と空白だけは未設定に戻す（重複の検査はしない）", async () => {
    ddbMock.on(GetCommand, { Key: { pk: "ROLE", sk: `ROLE#${ROLE_B}` } }).resolves({ Item: roleItem(ROLE_B, "本番デプロイ") });
    const result = await saveRoleDisplayName(ROLE_B, "   ");
    expect(result.role.displayName).toBeNull();
  });

  it("規則違反は ValidationError で、何も書かない", async () => {
    await expect(saveRoleDisplayName(ROLE_A, "a\tb")).rejects.toBeInstanceOf(ValidationError);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("存在しないロールは NotFoundError", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(saveRoleDisplayName(ROLE_A, "x")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("assertRoleDisplayNameUnused", () => {
  it("使われていない名前は通す", async () => {
    await expect(assertRoleDisplayNameUnused("新しい名前")).resolves.toBeUndefined();
  });

  it("除外したロールが使っている名前は通す", async () => {
    await expect(assertRoleDisplayNameUnused("本番デプロイ", ROLE_B)).resolves.toBeUndefined();
  });
});
