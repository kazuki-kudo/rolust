import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError, StorageError } from "../errors.js";
import { TEST_STATE_TABLE_NAME, conditionalCheckFailed, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { createRole, deleteRoleItem, getRole, requireRole, updateRoleColor, updateRoleDescription, updateRoleDisplayName } from "./role.js";

const ACCOUNT_ID = "123456789012";
const ROLE_NAME = "ReadOnlyAudit";
const ROLE_ARN = `arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}`;
const NOW = "2026-09-27T00:00:00.000Z";
const ROLE_KEY = { pk: "ROLE", sk: `ROLE#${ROLE_ARN}` };

beforeEach(() => {
  setupDdbMock();
});

describe("IamRole（FR-2.1 / Issue #21 の説明）", () => {
  it("createRole は説明を省略すると null で作る", async () => {
    ddbMock.on(PutCommand).resolves({});

    const role = await createRole(ACCOUNT_ID, ROLE_NAME, NOW);

    expect(role.description).toBeNull();
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item?.description).toBeUndefined();
  });

  it("createRole は渡された説明を保存する", async () => {
    ddbMock.on(PutCommand).resolves({});

    const role = await createRole(ACCOUNT_ID, ROLE_NAME, NOW, "本番デプロイ用");

    expect(role.description).toBe("本番デプロイ用");
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item?.description).toBe(
      "本番デプロイ用",
    );
  });

  it("getRole は説明が無いアイテムを null として返す（未設定は属性を持たない）", async () => {
    ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolves({
      Item: { ...ROLE_KEY, itemType: "IamRole", accountId: ACCOUNT_ID, roleName: ROLE_NAME, arn: ROLE_ARN, createdAt: NOW },
    });

    const role = await getRole(ROLE_ARN);

    expect(role?.description).toBeNull();
  });

  it("updateRoleDescription は存在するロールの説明を SET する", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await updateRoleDescription(ROLE_ARN, "本番デプロイ用");

    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.Key).toEqual(ROLE_KEY);
    expect(input?.ConditionExpression).toBe("attribute_exists(pk)");
    expect(input?.UpdateExpression).toBe("SET #description = :description");
    expect(input?.ExpressionAttributeValues).toEqual({ ":description": "本番デプロイ用" });
  });

  it("updateRoleDescription(null) は属性を消して未設定に戻す", async () => {
    ddbMock.on(UpdateCommand).resolves({});

    await updateRoleDescription(ROLE_ARN, null);

    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.UpdateExpression).toBe("REMOVE #description");
    expect(input?.ExpressionAttributeValues).toBeUndefined();
  });

  it("updateRoleDescription は存在しないロールを NotFoundError にする", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());

    await expect(updateRoleDescription(ROLE_ARN, "x")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("文言の ID（Issue #94）", () => {
  const notRegistered = {
    code: "NotFound",
    localized: { id: "role.notRegistered", params: { roleArn: ROLE_ARN } },
    message: `IAM ロールが登録されていません: ${ROLE_ARN}`,
  };

  it("requireRole は未登録のロールを role.notRegistered と roleArn を持つ NotFoundError にする", async () => {
    ddbMock.on(GetCommand).resolves({});
    await expect(requireRole(ROLE_ARN)).rejects.toMatchObject(notRegistered);
  });

  it("更新（説明・表示名・色）は、ロールが無ければ role.notRegistered の NotFoundError にする", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    await expect(updateRoleDescription(ROLE_ARN, "x")).rejects.toMatchObject(notRegistered);
    await expect(updateRoleDisplayName(ROLE_ARN, "x")).rejects.toMatchObject(notRegistered);
    await expect(updateRoleColor(ROLE_ARN, "red")).rejects.toMatchObject(notRegistered);
  });

  it("createRole は登録済みのロールを role.alreadyRegistered と roleArn を持つ ConflictError にする", async () => {
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());
    await expect(createRole(ACCOUNT_ID, ROLE_NAME, NOW)).rejects.toMatchObject({
      code: "Conflict",
      localized: { id: "role.alreadyRegistered", params: { roleArn: ROLE_ARN } },
      message: `この IAM ロールは既に登録されています: ${ROLE_ARN}`,
    });
  });

  it("DynamoDB の失敗は storage.operationFailed と operation・detail を持つ StorageError にする", async () => {
    ddbMock.on(DeleteCommand).rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));
    await expect(deleteRoleItem(ROLE_ARN)).rejects.toMatchObject({
      code: "StorageError",
      localized: { id: "storage.operationFailed", params: { operation: "DeleteItem(IamRole)", detail: "Rate exceeded" } },
      message: "DynamoDB の DeleteItem(IamRole) に失敗しました: Rate exceeded",
    });
  });
});

describe("IamRole の表示名（Issue #150）", () => {
  it("createRole は表示名を渡されたら保存し、省略したら属性を持たない", async () => {
    ddbMock.on(PutCommand).resolves({});
    const role = await createRole(ACCOUNT_ID, ROLE_NAME, NOW, null, "本番デプロイ");
    const put = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(put).toMatchObject({ displayName: "本番デプロイ" });
    expect(role.displayName).toBe("本番デプロイ");

    ddbMock.resetHistory();
    const roleWithout = await createRole(ACCOUNT_ID, ROLE_NAME, NOW);
    const putWithout = ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item;
    expect(putWithout).not.toHaveProperty("displayName");
    expect(roleWithout.displayName).toBeNull();
  });

  it("getRole は表示名が無いアイテムを null として返し、あれば返す", async () => {
    const base = { ...ROLE_KEY, itemType: "IamRole", accountId: ACCOUNT_ID, roleName: ROLE_NAME, arn: ROLE_ARN, createdAt: NOW };
    ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolvesOnce({ Item: base }).resolvesOnce({ Item: { ...base, displayName: "本番デプロイ" } });

    expect((await getRole(ROLE_ARN))?.displayName).toBeNull();
    expect((await getRole(ROLE_ARN))?.displayName).toBe("本番デプロイ");
  });

  it("updateRoleDisplayName は存在するロールの displayName を SET する", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateRoleDisplayName(ROLE_ARN, "本番デプロイ");
    const update = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(update?.Key).toEqual(ROLE_KEY);
    expect(update?.ConditionExpression).toBe("attribute_exists(pk)");
    expect(update?.UpdateExpression).toBe("SET #displayName = :displayName");
    expect(update?.ExpressionAttributeNames).toEqual({ "#displayName": "displayName" });
    expect(update?.ExpressionAttributeValues).toEqual({ ":displayName": "本番デプロイ" });
  });

  it("updateRoleDisplayName(null) は属性を消す", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateRoleDisplayName(ROLE_ARN, null);
    const update = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(update?.UpdateExpression).toBe("REMOVE #displayName");
    expect(update?.ExpressionAttributeValues).toBeUndefined();
  });

  it("updateRoleDisplayName は存在しないロールを NotFoundError にする", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    await expect(updateRoleDisplayName(ROLE_ARN, "x")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("deleteRoleItem（FR-2.4 / Issue #22）", () => {
  it("状態テーブルの IamRole を、条件を付けずに DeleteItem で消す", async () => {
    ddbMock.on(DeleteCommand).resolves({});

    await deleteRoleItem(ROLE_ARN);

    const input = ddbMock.commandCalls(DeleteCommand)[0]?.args[0].input;
    expect(input?.TableName).toBe(TEST_STATE_TABLE_NAME);
    expect(input?.Key).toEqual(ROLE_KEY);
    // 先に消されていても同じ結果になるので、条件は付けない（spec 3.1 手順 5）。
    expect(input?.ConditionExpression).toBeUndefined();
  });

  it("DynamoDB の失敗は StorageError にする", async () => {
    ddbMock.on(DeleteCommand).rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    await expect(deleteRoleItem(ROLE_ARN)).rejects.toBeInstanceOf(StorageError);
  });
});

describe("IamRole の背景色（Issue #100。アクセスパターン 26）", () => {
  it("getRole は color を返し、無ければ null（未設定は属性を持たない）", async () => {
    ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolves({
      Item: { ...ROLE_KEY, itemType: "IamRole", accountId: ACCOUNT_ID, roleName: ROLE_NAME, arn: ROLE_ARN, createdAt: NOW, color: "blue" },
    });
    expect((await getRole(ROLE_ARN))?.color).toBe("blue");

    ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolves({
      Item: { ...ROLE_KEY, itemType: "IamRole", accountId: ACCOUNT_ID, roleName: ROLE_NAME, arn: ROLE_ARN, createdAt: NOW },
    });
    expect((await getRole(ROLE_ARN))?.color).toBeNull();
  });

  it("DynamoDB に不正な色が残っていても、読み取りは null にする（画面を壊さない）", async () => {
    ddbMock.on(GetCommand, { Key: ROLE_KEY }).resolves({
      Item: { ...ROLE_KEY, itemType: "IamRole", accountId: ACCOUNT_ID, roleName: ROLE_NAME, arn: ROLE_ARN, createdAt: NOW, color: "fuchsia" },
    });
    expect((await getRole(ROLE_ARN))?.color).toBeNull();
  });

  it("createRole は color: null で作り、color を書かない", async () => {
    ddbMock.on(PutCommand).resolves({});
    const role = await createRole(ACCOUNT_ID, ROLE_NAME, NOW);
    expect(role.color).toBeNull();
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item?.color).toBeUndefined();
  });

  it("updateRoleColor は SET で色を書く（ロールの存在を条件にする）", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateRoleColor(ROLE_ARN, "green");
    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.Key).toEqual(ROLE_KEY);
    expect(input?.ConditionExpression).toBe("attribute_exists(pk)");
    expect(input?.UpdateExpression).toBe("SET #color = :color");
    expect(input?.ExpressionAttributeNames).toEqual({ "#color": "color" });
    expect(input?.ExpressionAttributeValues).toEqual({ ":color": "green" });
  });

  it("updateRoleColor は null で REMOVE する（属性を持たない形に戻す）", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateRoleColor(ROLE_ARN, null);
    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.UpdateExpression).toBe("REMOVE #color");
    expect(input?.ExpressionAttributeValues).toBeUndefined();
  });

  it("updateRoleColor は、ロールが無ければ NotFoundError、DynamoDB の障害は StorageError", async () => {
    ddbMock.on(UpdateCommand).rejectsOnce(conditionalCheckFailed());
    await expect(updateRoleColor(ROLE_ARN, "red")).rejects.toBeInstanceOf(NotFoundError);

    ddbMock.reset(); // 同じ matcher の on() は呼び出し回数を引き継ぐため、rejectsOnce の 2 件目は reset して仕切り直す
    ddbMock.on(UpdateCommand).rejectsOnce(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));
    await expect(updateRoleColor(ROLE_ARN, "red")).rejects.toBeInstanceOf(StorageError);
  });
});
