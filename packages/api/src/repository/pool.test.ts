import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ValidationError } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { NotFoundError } from "../errors.js";
import { TEST_POOL_ID, conditionalCheckFailed, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { addUserIfAbsent, addUserRows, addUsers, deleteUser, ensurePool, getPool, getUser, listUsers, requirePool, updateAttributeColumns, updateUserAttributes } from "./pool.js";

const POOL_ID = "platform-team";
const NOW = "2026-07-31T09:00:00.000Z";

beforeEach(() => {
  setupDdbMock();
});

describe("ユーザプール（FR-1.1 / FR-1.3 / FR-1.4 / C-5）", () => {
  it("FR-1.4: 同一プールに異なるアカウント ID のユーザを併存させられる", async () => {
    ddbMock.on(PutCommand).resolves({});

    const first = await addUsers(POOL_ID, "111122223333", ["ayaka.mori", "kenji.sato"], NOW);
    const second = await addUsers(POOL_ID, "444455556666", ["dana.okafor"], NOW);

    expect(first.map((user) => user.arn)).toEqual([
      "arn:aws:iam::111122223333:user/ayaka.mori",
      "arn:aws:iam::111122223333:user/kenji.sato",
    ]);
    expect(second.map((user) => user.arn)).toEqual([
      "arn:aws:iam::444455556666:user/dana.okafor",
    ]);

    // 3 件とも同じプールのパーティションに入る
    const partitions = ddbMock
      .commandCalls(PutCommand)
      .map((call) => call.args[0].input.Item?.pk);
    expect(partitions).toEqual([
      `POOL#${POOL_ID}`,
      `POOL#${POOL_ID}`,
      `POOL#${POOL_ID}`,
    ]);

    // 併存を一覧で確認する（Query の応答を模す）
    ddbMock.on(QueryCommand).resolves({
      Items: [...first, ...second].map((user) => ({
        pk: `POOL#${POOL_ID}`,
        sk: `USER#${user.arn}`,
        itemType: "IamUser",
        ...user,
      })),
    });
    const listed = await listUsers(POOL_ID);
    expect(new Set(listed.map((user) => user.accountId))).toEqual(
      new Set(["111122223333", "444455556666"]),
    );
  });

  it("FR-1.2: 登録時に ARN を導出し、AWS への実在検証は行わない（FR-5.7 / C-4）", async () => {
    ddbMock.on(PutCommand).resolves({});

    const [user] = await addUsers(POOL_ID, "111122223333", ["ayaka.mori"], NOW);

    expect(user?.arn).toBe("arn:aws:iam::111122223333:user/ayaka.mori");
    // DynamoDB 以外の AWS 呼び出しが起きていないこと（IAM クライアントは import すらしていない）
    expect(ddbMock.calls()).toHaveLength(1);
  });

  it("エッジケース: 不正なアカウント ID・ユーザ名を境界で弾く", async () => {
    await expect(addUsers(POOL_ID, "1234", ["ayaka.mori"], NOW)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(
      addUsers(POOL_ID, "111122223333", ["ayaka mori"], NOW),
    ).rejects.toBeInstanceOf(ValidationError);
  });

});

describe("IamUser の削除（質問 4 = B）", () => {
  it("配下の Assignment を連鎖削除する。AWS へは書き込まない", async () => {
    const userArn = "arn:aws:iam::111122223333:user/ayaka.mori";
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { pk: `POOL#${POOL_ID}`, sk: `ASSIGN#${userArn}#arn:aws:iam::555566667777:role/DeployProd` },
        { pk: `POOL#${POOL_ID}`, sk: `ASSIGN#${userArn}#arn:aws:iam::555566667777:role/ReadOnlyAudit` },
      ],
    });
    ddbMock.on(DeleteCommand).resolves({});

    const removed = await deleteUser(POOL_ID, userArn);

    expect(removed).toBe(2);
    // Assignment 2 件 + IamUser 1 件
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(3);
    expect(
      ddbMock.commandCalls(DeleteCommand).at(-1)?.args[0].input.Key,
    ).toEqual({ pk: `POOL#${POOL_ID}`, sk: `USER#${userArn}` });
  });

  it("エッジケース: Assignment が 0 件でもユーザ本体は削除される", async () => {
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    ddbMock.on(DeleteCommand).resolves({});

    const removed = await deleteUser(POOL_ID, "arn:aws:iam::111122223333:user/lin.zhao");

    expect(removed).toBe(0);
    expect(ddbMock.commandCalls(DeleteCommand)).toHaveLength(1);
  });

  it("エッジケース: DynamoDB の障害を握り潰さず StorageError として返す", async () => {
    ddbMock
      .on(QueryCommand)
      .rejects(Object.assign(new Error("service unavailable"), { name: "InternalServerError" }));

    await expect(
      deleteUser(POOL_ID, "arn:aws:iam::111122223333:user/lin.zhao"),
    ).rejects.toMatchObject({ code: "StorageError", retryable: true });

    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
  });
});

describe("表示名の廃止（Issue #108）", () => {
  it("getPool は META の displayName を返さない（本番に属性が残っていても読まない）", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: `POOL#${POOL_ID}`, sk: "META", itemType: "UserPool", poolId: POOL_ID, createdAt: NOW, displayName: "プラットフォームチーム" },
    });

    expect(await getPool(POOL_ID)).toEqual({ poolId: POOL_ID, attributeColumns: [], createdAt: NOW });
  });
});

describe("信頼ポリシーから取り込んだ IamUser の登録（Issue #80）", () => {
  it("未登録なら、FR-1.2 の書式の ARN で条件付きに Put し、true を返す", async () => {
    ddbMock.on(PutCommand).resolves({});

    const created = await addUserIfAbsent(POOL_ID, "111122223333", "ayaka.mori", NOW);

    expect(created).toBe(true);
    const input = ddbMock.commandCalls(PutCommand)[0]?.args[0].input;
    expect(input?.ConditionExpression).toBe("attribute_not_exists(pk)");
    expect(input?.Item).toEqual({
      pk: `POOL#${POOL_ID}`,
      sk: "USER#arn:aws:iam::111122223333:user/ayaka.mori",
      itemType: "IamUser",
      poolId: POOL_ID,
      accountId: "111122223333",
      userName: "ayaka.mori",
      arn: "arn:aws:iam::111122223333:user/ayaka.mori",
      createdAt: NOW,
    });
  });

  it("すでに登録済みなら、何も上書きせず false を返す（createdAt を保つ）", async () => {
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());

    await expect(addUserIfAbsent(POOL_ID, "111122223333", "ayaka.mori", NOW)).resolves.toBe(false);
  });

  it("条件不一致以外の失敗は握りつぶさず、StorageError にする", async () => {
    ddbMock.on(PutCommand).rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));

    await expect(addUserIfAbsent(POOL_ID, "111122223333", "ayaka.mori", NOW)).rejects.toMatchObject({
      statusCode: 502,
      retryable: true,
    });
  });

  it("不正なアカウント ID・ユーザ名は境界で弾く（AWS の実在検証は行わない）", async () => {
    await expect(addUserIfAbsent(POOL_ID, "1234", "ayaka.mori", NOW)).rejects.toBeInstanceOf(ValidationError);
    await expect(addUserIfAbsent(POOL_ID, "111122223333", "team/ayaka", NOW)).rejects.toBeInstanceOf(ValidationError);
    expect(ddbMock.calls()).toHaveLength(0);
  });
});

describe("属性列（Issue #61）", () => {
  const META_KEY = { pk: `POOL#${POOL_ID}`, sk: "META" };
  const ARN = "arn:aws:iam::111122223333:user/ayaka.mori";
  const USER_KEY = { pk: `POOL#${POOL_ID}`, sk: `USER#${ARN}` };

  it("getPool は attributeColumns を返す。持たない既存のプールは空（Review Focus 5）", async () => {
    ddbMock.on(GetCommand, { Key: META_KEY }).resolves({
      Item: { ...META_KEY, itemType: "UserPool", poolId: POOL_ID, createdAt: NOW, attributeColumns: [{ columnId: "c1", name: "名前" }] },
    });
    expect((await getPool(POOL_ID))?.attributeColumns).toEqual([{ columnId: "c1", name: "名前" }]);

    ddbMock.on(GetCommand, { Key: META_KEY }).resolves({
      Item: { ...META_KEY, itemType: "UserPool", poolId: POOL_ID, createdAt: NOW },
    });
    expect((await getPool(POOL_ID))?.attributeColumns).toEqual([]);
  });

  it("listUsers は attributes を返す。持たない既存のアイテムは空（Review Focus 5）", async () => {
    ddbMock.on(QueryCommand).resolves({
      Items: [
        { ...USER_KEY, itemType: "IamUser", poolId: POOL_ID, accountId: "111122223333", userName: "ayaka.mori", arn: ARN, createdAt: NOW, attributes: { c1: "森" } },
        { pk: `POOL#${POOL_ID}`, sk: "USER#x", itemType: "IamUser", poolId: POOL_ID, accountId: "111122223333", userName: "kenji.sato", arn: "arn:aws:iam::111122223333:user/kenji.sato", createdAt: NOW },
      ],
    });
    const users = await listUsers(POOL_ID);
    expect(users.map((user) => user.attributes)).toEqual([{ c1: "森" }, {}]);
  });

  it("addUsers が返すユーザは空の attributes を持つ。Put するアイテムには attributes を足さない", async () => {
    ddbMock.on(PutCommand).resolves({});
    const [user] = await addUsers(POOL_ID, "111122223333", ["ayaka.mori"], NOW);
    expect(user?.attributes).toEqual({});
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).not.toHaveProperty("attributes");
  });

  it("addUsers の Put は attribute_not_exists(pk) 付きで、既存のユーザを上書きしない（D-13）", async () => {
    ddbMock.on(PutCommand).resolves({});
    await addUsers(POOL_ID, "111122223333", ["ayaka.mori"], NOW);
    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.ConditionExpression).toBe("attribute_not_exists(pk)");
  });

  it("登録済みのユーザは条件不一致でもエラーにせず、既存のアイテム（属性・作成日時）を要求順に返す（D-13）", async () => {
    const OLD = "2026-01-01T00:00:00.000Z";
    const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(PutCommand, { Item: { pk: `POOL#${POOL_ID}`, sk: `USER#${ARN}` } }).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand, { Key: USER_KEY }).resolves({
      Item: { ...USER_KEY, itemType: "IamUser", poolId: POOL_ID, accountId: "111122223333", userName: "ayaka.mori", arn: ARN, createdAt: OLD, attributes: { c1: "森" } },
    });

    const users = await addUsers(POOL_ID, "111122223333", ["ayaka.mori", "kenji.sato"], NOW);

    expect(users.map((user) => user.arn)).toEqual([ARN, KENJI]);
    expect(users[0]).toMatchObject({ createdAt: OLD, attributes: { c1: "森" } });
    expect(users[1]).toMatchObject({ createdAt: NOW, attributes: {} });
    // 上書き系の書き込みは、条件付きの Put 以外に起きない
    expect(ddbMock.commandCalls(PutCommand).every((call) => call.args[0].input.ConditionExpression === "attribute_not_exists(pk)")).toBe(true);
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
  });

  it("登録済みと判定した後に消えていたら、組み立てたユーザを返す", async () => {
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({});
    const [user] = await addUsers(POOL_ID, "111122223333", ["ayaka.mori"], NOW);
    expect(user).toMatchObject({ arn: ARN, createdAt: NOW, attributes: {} });
  });

  it("addUsers の条件不一致以外の失敗は握りつぶさず、StorageError（502）にする", async () => {
    ddbMock.on(PutCommand).rejects(Object.assign(new Error("Rate exceeded"), { name: "ThrottlingException" }));
    await expect(addUsers(POOL_ID, "111122223333", ["ayaka.mori"], NOW)).rejects.toMatchObject({
      statusCode: 502,
      retryable: true,
    });
  });

  it("getUser は 1 件を返し、無ければ null", async () => {
    ddbMock.on(GetCommand, { Key: USER_KEY }).resolves({
      Item: { ...USER_KEY, itemType: "IamUser", poolId: POOL_ID, accountId: "111122223333", userName: "ayaka.mori", arn: ARN, createdAt: NOW, attributes: { c1: "森" } },
    });
    expect((await getUser(POOL_ID, ARN))?.attributes).toEqual({ c1: "森" });

    ddbMock.on(GetCommand, { Key: USER_KEY }).resolves({});
    expect(await getUser(POOL_ID, ARN)).toBeNull();
  });

  it("updateAttributeColumns は META の attributeColumns を、存在するプールにだけ丸ごと SET する", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateAttributeColumns(POOL_ID, [{ columnId: "c1", name: "名前" }]);
    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.Key).toEqual(META_KEY);
    expect(input?.ConditionExpression).toBe("attribute_exists(pk)");
    expect(input?.UpdateExpression).toBe("SET #attributeColumns = :attributeColumns");
    expect(input?.ExpressionAttributeValues).toEqual({ ":attributeColumns": [{ columnId: "c1", name: "名前" }] });
  });

  it("updateAttributeColumns は存在しないプールを NotFoundError にする（META を作らない）", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    await expect(updateAttributeColumns("ghost", [])).rejects.toBeInstanceOf(NotFoundError);
  });

  it("updateUserAttributes は attributes を入れ子のパスを使わず丸ごと SET する", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateUserAttributes(POOL_ID, ARN, { c1: "森" });
    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.Key).toEqual(USER_KEY);
    expect(input?.ConditionExpression).toBe("attribute_exists(pk)");
    expect(input?.UpdateExpression).toBe("SET #attributes = :attributes");
    expect(input?.ExpressionAttributeNames).toEqual({ "#attributes": "attributes" });
    expect(input?.ExpressionAttributeValues).toEqual({ ":attributes": { c1: "森" } });
  });

  it("updateUserAttributes は空なら属性を REMOVE する", async () => {
    ddbMock.on(UpdateCommand).resolves({});
    await updateUserAttributes(POOL_ID, ARN, {});
    const input = ddbMock.commandCalls(UpdateCommand)[0]?.args[0].input;
    expect(input?.UpdateExpression).toBe("REMOVE #attributes");
    expect(input?.ExpressionAttributeValues).toBeUndefined();
  });

  it("updateUserAttributes は存在しないユーザを NotFoundError にする", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    await expect(updateUserAttributes(POOL_ID, ARN, { c1: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("文言の ID（Issue #94）", () => {
  const USER_ARN = "arn:aws:iam::111122223333:user/ayaka.mori";

  it("プールが無ければ pool.notFound と poolId を持つ NotFoundError（requirePool・updateAttributeColumns）", async () => {
    const expected = {
      code: "NotFound",
      localized: { id: "pool.notFound", params: { poolId: "ghost" } },
      message: "ユーザプールが見つかりません: ghost",
    };
    ddbMock.on(GetCommand).resolves({});
    await expect(requirePool("ghost")).rejects.toMatchObject(expected);
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    await expect(updateAttributeColumns("ghost", [])).rejects.toMatchObject(expected);
  });

  it("ensurePool は、作成の競合の後にプールを読めなければ pool.notFound の NotFoundError", async () => {
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({});
    await expect(ensurePool()).rejects.toMatchObject({
      code: "NotFound",
      localized: { id: "pool.notFound", params: { poolId: TEST_POOL_ID } },
    });
  });

  it("ユーザが無ければ pool.userNotFound と userArn を持つ NotFoundError", async () => {
    ddbMock.on(UpdateCommand).rejects(conditionalCheckFailed());
    await expect(updateUserAttributes(POOL_ID, USER_ARN, { c1: "x" })).rejects.toMatchObject({
      code: "NotFound",
      localized: { id: "pool.userNotFound", params: { userArn: USER_ARN } },
      message: `IAM ユーザが見つかりません: ${USER_ARN}`,
    });
  });
});

describe("addUserRows（Issue #98）", () => {
  const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
  const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";

  it("新規ユーザは attributes を同じ Put に含める。条件は attribute_not_exists(pk) で、created は true", async () => {
    ddbMock.on(PutCommand).resolves({});

    const results = await addUserRows(
      POOL_ID,
      "111122223333",
      [{ userName: "ayaka.mori", attributes: { c1: "開発" } }],
      NOW,
    );

    expect(results).toEqual([
      {
        created: true,
        user: expect.objectContaining({ arn: AYAKA, createdAt: NOW, attributes: { c1: "開発" } }),
      },
    ]);
    const input = ddbMock.commandCalls(PutCommand)[0]?.args[0].input;
    expect(input?.Item).toMatchObject({ attributes: { c1: "開発" } });
    expect(input?.ConditionExpression).toBe("attribute_not_exists(pk)");
  });

  it("attributes が空の行は、アイテムに attributes を持たせない", async () => {
    ddbMock.on(PutCommand).resolves({});

    await addUserRows(POOL_ID, "111122223333", [{ userName: "ayaka.mori", attributes: {} }], NOW);

    expect(ddbMock.commandCalls(PutCommand)[0]?.args[0].input.Item).not.toHaveProperty("attributes");
  });

  it("登録済みの行は、既存のアイテム（属性・作成日時）を返し、created は false。書き込みは条件つきの Put だけ", async () => {
    const OLD = "2026-01-01T00:00:00.000Z";
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(PutCommand, { Item: { pk: `POOL#${POOL_ID}`, sk: `USER#${AYAKA}` } }).rejects(conditionalCheckFailed());
    ddbMock.on(GetCommand).resolves({
      Item: { pk: `POOL#${POOL_ID}`, sk: `USER#${AYAKA}`, itemType: "IamUser", poolId: POOL_ID, accountId: "111122223333", userName: "ayaka.mori", arn: AYAKA, createdAt: OLD, attributes: { c1: "森" } },
    });

    const results = await addUserRows(
      POOL_ID,
      "111122223333",
      [
        { userName: "ayaka.mori", attributes: { c1: "上書きしない" } },
        { userName: "kenji.sato", attributes: { c1: "運用" } },
      ],
      NOW,
    );

    expect(results.map((r) => [r.user.arn, r.created])).toEqual([[AYAKA, false], [KENJI, true]]);
    expect(results[0]?.user).toMatchObject({ createdAt: OLD, attributes: { c1: "森" } });
    expect(ddbMock.commandCalls(UpdateCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand).every((call) => call.args[0].input.ConditionExpression === "attribute_not_exists(pk)")).toBe(true);
  });

  it("ユーザ名の書式が誤った行があれば、1 件も書かずに ValidationError にする", async () => {
    ddbMock.on(PutCommand).resolves({});

    await expect(
      addUserRows(POOL_ID, "111122223333", [{ userName: "ok.name", attributes: {} }, { userName: "bad name", attributes: {} }], NOW),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });
});

describe("ensurePool（Issue #108）", () => {
  it("META があればそのまま返し、書かない", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: `POOL#${TEST_POOL_ID}`, sk: "META", itemType: "UserPool", poolId: TEST_POOL_ID, createdAt: NOW, attributeColumns: [] },
    });

    const pool = await ensurePool(NOW);

    expect(pool).toMatchObject({ poolId: TEST_POOL_ID, attributeColumns: [], createdAt: NOW });
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("META が無ければ、紐づけの移行の印つきで条件付きに作る", async () => {
    ddbMock.on(GetCommand).resolves({});
    ddbMock.on(PutCommand).resolves({});

    const pool = await ensurePool(NOW);

    expect(pool).toMatchObject({ poolId: TEST_POOL_ID, attributeColumns: [], createdAt: NOW });
    const put = ddbMock.commandCalls(PutCommand)[0]?.args[0].input;
    expect(put?.ConditionExpression).toBe("attribute_not_exists(pk)");
    expect(put?.Item).toMatchObject({
      pk: `POOL#${TEST_POOL_ID}`,
      sk: "META",
      itemType: "UserPool",
      poolId: TEST_POOL_ID,
      roleLinksInitializedAt: NOW,
    });
  });

  it("同時に作られて条件が外れたら、作られた META を読み直して返す", async () => {
    const created = { pk: `POOL#${TEST_POOL_ID}`, sk: "META", itemType: "UserPool", poolId: TEST_POOL_ID, createdAt: "2026-07-31T08:59:59.000Z", attributeColumns: [] };
    ddbMock.on(GetCommand).resolvesOnce({}).resolvesOnce({ Item: created });
    ddbMock.on(PutCommand).rejects(conditionalCheckFailed());

    const pool = await ensurePool(NOW);

    expect(pool.createdAt).toBe("2026-07-31T08:59:59.000Z");
  });
});
