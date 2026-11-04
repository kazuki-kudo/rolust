import { DeleteCommand, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ValidationError } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../errors.js";
import { conditionalCheckFailed, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { saveUserAttributes } from "./user-attributes-service.js";

const POOL_ID = "platform-team";
const NOW = "2026-10-03T00:00:00.000Z";
const META_KEY = { pk: `POOL#${POOL_ID}`, sk: "META" };
const ARN = "arn:aws:iam::111122223333:user/ayaka.mori";
const USER_KEY = { pk: `POOL#${POOL_ID}`, sk: `USER#${ARN}` };
const COLUMNS = [
  { columnId: "c-name", name: "名前" },
  { columnId: "c-role", name: "役割" },
];

function stub(options: { user?: boolean } = {}): void {
  ddbMock.on(GetCommand, { Key: META_KEY }).resolves({
    Item: { ...META_KEY, itemType: "UserPool", poolId: POOL_ID, createdAt: NOW, attributeColumns: COLUMNS },
  });
  ddbMock.on(GetCommand, { Key: USER_KEY }).resolves(
    options.user === false
      ? {}
      : {
          Item: { ...USER_KEY, itemType: "IamUser", poolId: POOL_ID, accountId: "111122223333", userName: "ayaka.mori", arn: ARN, createdAt: NOW, attributes: { ghost: "古い値", "c-name": "森" } },
        },
  );
}

function writeCount(): number {
  return (
    ddbMock.commandCalls(PutCommand).length +
    ddbMock.commandCalls(UpdateCommand).length +
    ddbMock.commandCalls(DeleteCommand).length
  );
}

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(UpdateCommand).resolves({});
});

describe("PUT /pool/users/attributes（Issue #61）", () => {
  it("正規化した値で attributes を丸ごと置き換え、保存後のユーザを返す", async () => {
    stub();

    const result = await saveUserAttributes(POOL_ID, ARN, { "c-name": " 森 彩花 ", "c-role": "管理者" });

    expect(result.user.attributes).toEqual({ "c-name": "森 彩花", "c-role": "管理者" });
    expect(result.user.arn).toBe(ARN);
    const updates = ddbMock.commandCalls(UpdateCommand);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.args[0].input.Key).toEqual(USER_KEY);
    expect(updates[0]?.args[0].input.ExpressionAttributeValues).toEqual({
      ":attributes": { "c-name": "森 彩花", "c-role": "管理者" },
    });
  });

  it("定義に無い古い値（削除した列）は、保存するとき書かれない（Review Focus 3）", async () => {
    stub();

    await saveUserAttributes(POOL_ID, ARN, { "c-name": "森" });

    expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.ExpressionAttributeValues).toEqual({
      ":attributes": { "c-name": "森" },
    });
  });

  it("すべて空なら属性を消す", async () => {
    stub();

    const result = await saveUserAttributes(POOL_ID, ARN, { "c-name": "  " });

    expect(result.user.attributes).toEqual({});
    expect(ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input.UpdateExpression).toBe("REMOVE #attributes");
  });

  it("定義に無い列・文字列でない値・制御文字は 400 で、書かない", async () => {
    stub();

    for (const bad of [{ ghost: "x" }, { "c-name": 1 }, { "c-name": "a\nb" }, null, []]) {
      await expect(saveUserAttributes(POOL_ID, ARN, bad)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(writeCount()).toBe(0);
  });

  it("プールが無ければ 404、ユーザが無ければ 404 で、書かない", async () => {
    ddbMock.on(GetCommand, { Key: META_KEY }).resolves({});
    await expect(saveUserAttributes(POOL_ID, ARN, {})).rejects.toBeInstanceOf(NotFoundError);

    stub({ user: false });
    await expect(saveUserAttributes(POOL_ID, ARN, {})).rejects.toBeInstanceOf(NotFoundError);
    expect(writeCount()).toBe(0);
  });

  it("ユーザが無い 404 は pool.userNotFound と userArn を持つ（Issue #94）", async () => {
    stub({ user: false });
    await expect(saveUserAttributes(POOL_ID, ARN, {})).rejects.toMatchObject({
      code: "NotFound",
      localized: { id: "pool.userNotFound", params: { userArn: ARN } },
      message: `IAM ユーザが見つかりません: ${ARN}`,
    });
  });

  it("読んだ後にユーザが削除されていたら 404", async () => {
    stub();
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());

    await expect(saveUserAttributes(POOL_ID, ARN, { "c-name": "森" })).rejects.toBeInstanceOf(NotFoundError);
  });
});
