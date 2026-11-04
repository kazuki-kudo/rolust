import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ValidationError } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StorageError } from "../errors.js";
import { TEST_POOL_ID, conditionalCheckFailed, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { reorderRoles } from "./role-order-service.js";

const A = "arn:aws:iam::111122223333:role/A";
const B = "arn:aws:iam::111122223333:role/B";
const C = "arn:aws:iam::111122223333:role/C";
const NOW = "2026-10-07T00:00:00.000Z";

function stubRoles(arns: string[]): void {
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "ROLE", ":prefix": "ROLE#" } }).resolves({
    Items: arns.map((arn) => ({
      pk: "ROLE", sk: `ROLE#${arn}`, itemType: "IamRole",
      accountId: arn.split(":")[4], roleName: arn.split("/")[1], arn, createdAt: NOW,
    })),
  });
}

function stubLinks(entries: { roleArn: string; position?: number }[]): void {
  ddbMock
    .on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${TEST_POOL_ID}`, ":prefix": "ROLE#" } })
    .resolves({
      Items: entries.map(({ roleArn, position }) => ({
        pk: `POOL#${TEST_POOL_ID}`, sk: `ROLE#${roleArn}`, itemType: "PoolRoleLink",
        poolId: TEST_POOL_ID, roleArn, createdAt: NOW, ...(position !== undefined ? { position } : {}),
      })),
    });
}

function updates(): { sk: string; position: unknown }[] {
  return ddbMock.commandCalls(UpdateCommand).map((call) => ({
    sk: (call.args[0].input.Key as { sk: string }).sk,
    position: call.args[0].input.ExpressionAttributeValues?.[":position"],
  }));
}

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(QueryCommand).resolves({ Items: [] });
  ddbMock.on(UpdateCommand).resolves({});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("reorderRoles（Issue #135 spec 3.3）", () => {
  it("順位が変わるロールだけ position を更新し、保存後の列順を返す", async () => {
    stubRoles([A, B, C]);
    stubLinks([{ roleArn: A, position: 0 }, { roleArn: B, position: 1 }, { roleArn: C, position: 2 }]);

    const result = await reorderRoles([C, A, B]);

    expect(result).toEqual({ roleArns: [C, A, B] });
    expect(updates()).toEqual([
      { sk: `ROLE#${C}`, position: 0 },
      { sk: `ROLE#${A}`, position: 1 },
      { sk: `ROLE#${B}`, position: 2 },
    ]);
  });

  it("順位が変わらないロールには書かない", async () => {
    stubRoles([A, B]);
    stubLinks([{ roleArn: A, position: 0 }, { roleArn: B, position: 1 }]);

    await reorderRoles([A, B]);

    expect(updates()).toEqual([]);
  });

  it("登録されていない ARN は 400 で、何も書かない", async () => {
    stubRoles([A]);
    stubLinks([{ roleArn: A, position: 0 }]);

    await expect(reorderRoles([A, B])).rejects.toBeInstanceOf(ValidationError);
    expect(updates()).toEqual([]);
  });

  it("登録されていない ARN の 400 は role.orderUnregistered と roleArns を持つ（Issue #94）", async () => {
    stubRoles([A]);
    stubLinks([{ roleArn: A, position: 0 }]);

    await expect(reorderRoles([A, B, C])).rejects.toMatchObject({
      code: "ValidationError",
      field: "roleArns",
      localized: { id: "role.orderUnregistered", params: { roleArns: [B, C] } },
      message: `登録されていない IAM ロールは並べられません: ${B}, ${C}`,
    });
  });

  it("ロールの ARN でない値は 400 で、何も書かない", async () => {
    await expect(reorderRoles(["arn:aws:iam::111122223333:user/ayaka.mori"])).rejects.toBeInstanceOf(ValidationError);
    expect(updates()).toEqual([]);
  });

  it("ロールの ARN でない値の 400 は arn.notRoleArn と arn を持つ（Issue #94）", async () => {
    const arn = "arn:aws:iam::111122223333:user/ayaka.mori";
    await expect(reorderRoles([arn])).rejects.toMatchObject({
      field: "roleArns",
      localized: { id: "arn.notRoleArn", params: { arn } },
      message: `IAM ロールの ARN ではありません: ${arn}`,
    });
  });

  it("配列に無い登録済みロール（読んだ後に登録されたもの）は、現在の順で後ろに付く", async () => {
    stubRoles([A, B, C]);
    stubLinks([{ roleArn: A, position: 0 }, { roleArn: B, position: 1 }, { roleArn: C, position: 2 }]);

    const result = await reorderRoles([B, A]);

    expect(result.roleArns).toEqual([B, A, C]);
  });

  it("重複した ARN は先頭を残す", async () => {
    stubRoles([A, B]);
    stubLinks([{ roleArn: A, position: 0 }, { roleArn: B, position: 1 }]);

    expect((await reorderRoles([B, A, B])).roleArns).toEqual([B, A]);
  });

  it("position を持たない紐づけも、保存で position が付く", async () => {
    stubRoles([A, B]);
    stubLinks([{ roleArn: A }, { roleArn: B }]);

    await reorderRoles([A, B]);

    expect(updates()).toEqual([
      { sk: `ROLE#${A}`, position: 0 },
      { sk: `ROLE#${B}`, position: 1 },
    ]);
  });

  it("読んだ後に削除されたロール（条件に外れた更新）は飛ばして、失敗にしない", async () => {
    stubRoles([A, B]);
    stubLinks([{ roleArn: A, position: 0 }, { roleArn: B, position: 1 }]);
    ddbMock.on(UpdateCommand, { Key: { pk: `POOL#${TEST_POOL_ID}`, sk: `ROLE#${A}` } }).rejects(conditionalCheckFailed());

    await expect(reorderRoles([B, A])).resolves.toEqual({ roleArns: [B, A] });
  });

  it("書き込みが失敗したら、再試行可の StorageError を返す", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    stubRoles([A, B]);
    stubLinks([{ roleArn: A, position: 0 }, { roleArn: B, position: 1 }]);
    ddbMock.on(UpdateCommand).rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    const error = await reorderRoles([B, A]).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(StorageError);
    expect((error as StorageError).retryable).toBe(true);
    expect(error).toMatchObject({
      localized: { id: "storage.roleOrderPartial", params: {} },
      message:
        "ロールの並び順を一部しか保存できていない可能性があります。最新の状態を読み込み直し、必要ならもう一度保存してください。",
    });
  });
});
