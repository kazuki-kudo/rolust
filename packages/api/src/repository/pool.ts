import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import type { AttributeColumn, IamUser, ImportUserRow, UserPool } from "@rolust/core";
import { assertAccountId, assertIamName, buildUserArn, localized } from "@rolust/core";

import { loadConfig } from "../config.js";
import { NotFoundError } from "../errors.js";
import { getDocumentClient, isConditionalCheckFailed, withStorageErrors } from "../ddb/client.js";
import type { BaseItem } from "../ddb/keys.js";
import {
  POOLS_INDEX_PK,
  USER_SK_PREFIX,
  assignmentSkPrefixForUser,
  poolKey,
  poolPk,
  userKey,
} from "../ddb/keys.js";

/**
 * UserPool と IamUser のリポジトリ（FR-1.1 / FR-1.3 / FR-1.4 / Q4=B）。
 *
 * UserPool はデプロイにつき固定の 1 つ（`ROLUST_POOL_ID`。Issue #108）。プールの一覧・作成・削除・表示名の
 * 更新は廃止した。`dynamodb:Scan` は使わない。
 */

interface PoolItem extends BaseItem {
  itemType: "UserPool";
  poolId: string;
  /** 本番に残る古い属性（Issue #108 で廃止。読まず、書かない）。 */
  displayName?: string;
  attributeColumns?: AttributeColumn[];
  roleLinksInitializedAt?: string;
  createdAt: string;
}

interface UserItem extends BaseItem {
  itemType: "IamUser";
  poolId: string;
  accountId: string;
  userName: string;
  arn: string;
  attributes?: Record<string, string>;
  createdAt: string;
}

export async function getPool(poolId: string): Promise<UserPool | null> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("GetItem(UserPool)", () =>
    client.send(new GetCommand({ TableName: tableName, Key: poolKey(poolId) })),
  );

  const item = result.Item as PoolItem | undefined;
  return item
    ? {
        poolId: item.poolId,
        attributeColumns: item.attributeColumns ?? [],
        createdAt: item.createdAt,
      }
    : null;
}

/**
 * 固定プール（`ROLUST_POOL_ID`）を返す。META が無ければ冪等に作る（Issue #108）。
 *
 * 同時に 2 つのリクエストが作ろうとしても、条件付き Put の失敗は「既にある」として扱い、
 * 勝った側の META を読み直して返す。作るときに `roleLinksInitializedAt` の印を付け、
 * 紐づけの移行の対象にならないようにする。
 */
export async function ensurePool(now: string = new Date().toISOString()): Promise<UserPool> {
  const { stateTableName: tableName, poolId } = loadConfig();
  const existing = await getPool(poolId);
  if (existing) return existing;

  const client = getDocumentClient();
  const item: PoolItem = {
    ...poolKey(poolId),
    itemType: "UserPool",
    poolId,
    createdAt: now,
    roleLinksInitializedAt: now,
    gsi1pk: POOLS_INDEX_PK,
    gsi1sk: poolPk(poolId),
  };
  try {
    await client.send(
      new PutCommand({ TableName: tableName, Item: item, ConditionExpression: "attribute_not_exists(pk)" }),
    );
  } catch (error) {
    if (!isConditionalCheckFailed(error)) {
      return await withStorageErrors("PutItem(UserPool)", () => Promise.reject(error));
    }
    const created = await getPool(poolId);
    if (created) return created;
    throw new NotFoundError(localized("pool.notFound", { poolId }));
  }
  return { poolId, attributeColumns: [], createdAt: now };
}

/** プールが存在しなければ NotFoundError を投げる。 */
export async function requirePool(poolId: string): Promise<UserPool> {
  const pool = await getPool(poolId);
  if (!pool) {
    throw new NotFoundError(localized("pool.notFound", { poolId }));
  }
  return pool;
}

/**
 * 属性列の定義を丸ごと置き換える（アクセスパターン 23。Issue #61）。
 *
 * 条件付き更新にするのは、存在しないプールの META を新しく作らないため（`updateDisplayName` と同じ）。
 */
export async function updateAttributeColumns(
  poolId: string,
  columns: AttributeColumn[],
): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: poolKey(poolId),
        ConditionExpression: "attribute_exists(pk)",
        UpdateExpression: "SET #attributeColumns = :attributeColumns",
        ExpressionAttributeNames: { "#attributeColumns": "attributeColumns" },
        ExpressionAttributeValues: { ":attributeColumns": columns },
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new NotFoundError(localized("pool.notFound", { poolId }));
    }
    await withStorageErrors("UpdateItem(UserPool.attributeColumns)", () => Promise.reject(error));
  }
}

/** IamUser を 1 件読む。無ければ null。 */
export async function getUser(poolId: string, userArn: string): Promise<IamUser | null> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("GetItem(IamUser)", () =>
    client.send(new GetCommand({ TableName: tableName, Key: userKey(poolId, userArn) })),
  );
  const item = result.Item as UserItem | undefined;
  return item ? toIamUser(item) : null;
}

/**
 * 1 ユーザの属性を丸ごと置き換える（アクセスパターン 24。Issue #61）。空なら属性を消す。
 *
 * `SET attributes.#id` のような入れ子のパスは使わない。親のマップが無いアイテム（属性を持たない
 * 既存のユーザ）では実 DynamoDB が拒否するため、マップごと置き換える。
 */
export async function updateUserAttributes(
  poolId: string,
  userArn: string,
  attributes: Record<string, string>,
): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();
  const isEmpty = Object.keys(attributes).length === 0;

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: userKey(poolId, userArn),
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: { "#attributes": "attributes" },
        ...(isEmpty
          ? { UpdateExpression: "REMOVE #attributes" }
          : {
              UpdateExpression: "SET #attributes = :attributes",
              ExpressionAttributeValues: { ":attributes": attributes },
            }),
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new NotFoundError(localized("pool.userNotFound", { userArn }));
    }
    await withStorageErrors("UpdateItem(IamUser.attributes)", () => Promise.reject(error));
  }
}

export async function listUsers(poolId: string): Promise<IamUser[]> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("Query(IamUser)", () =>
    client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": poolPk(poolId), ":prefix": USER_SK_PREFIX },
      }),
    ),
  );

  return ((result.Items ?? []) as UserItem[])
    .map(toIamUser)
    .sort(
      (left, right) =>
        left.accountId.localeCompare(right.accountId) ||
        left.userName.localeCompare(right.userName),
    );
}

/**
 * 固定プールの IamUser の一覧（FR-4.2 の「Rolust 管理下の principal」集合）。
 *
 * プールは 1 つなので、プール一覧を引かず、固定プールの Query 1 本で取る（Issue #108）。
 */
export async function listAllUsers(): Promise<IamUser[]> {
  return listUsers(loadConfig().poolId);
}

/** `addUserRows` の 1 行の結果。`created` が false なら、すでに登録済みで何も変えていない。 */
export interface AddUserResult {
  user: IamUser;
  created: boolean;
}

/**
 * 既存プールへ「1 アカウント ID ＋ 複数ユーザ名」を登録する（FR-1.1 / FR-1.4 / C-5）。
 *
 * 同じプールに対して別アカウント ID で繰り返すことで混在させられる。
 * ARN は FR-1.2 の書式で導出する。AWS への実在検証は行わない（FR-5.7 / C-4）。
 *
 * すでに登録されているユーザのアイテムは上書きしない（属性と作成日時を保つ。D-13）。
 * 戻り値は要求したユーザすべて（要求順）。登録済みのものは保存されている実際の値を返す。
 */
export async function addUsers(
  poolId: string,
  accountId: string,
  userNames: string[],
  now: string,
): Promise<IamUser[]> {
  const results = await addUserRows(
    poolId,
    accountId,
    userNames.map((userName) => ({ userName, attributes: {} })),
    now,
  );
  return results.map((result) => result.user);
}

/**
 * 属性つきの行を登録する（Issue #98）。`addUsers` の実体。
 *
 * 新規ユーザは `attributes` を同じ `PutItem` に含める（空なら項目を持たせない）。登録済みのユーザは
 * `attribute_not_exists(pk)` の条件で弾かれ、既存のアイテム（属性・作成日時）をそのまま返す（D-2・D-13）。
 * ユーザ名の書式は、1 件も書く前に全件検証する。
 */
export async function addUserRows(
  poolId: string,
  accountId: string,
  rows: readonly ImportUserRow[],
  now: string,
): Promise<AddUserResult[]> {
  assertAccountId(accountId);
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const users: IamUser[] = rows.map((row) => {
    assertIamName(row.userName, "userName");
    return {
      poolId,
      accountId,
      userName: row.userName,
      arn: buildUserArn(accountId, row.userName),
      attributes: row.attributes,
      createdAt: now,
    };
  });

  // 件数が小さい前提（NFR-1）。1 件ずつ Put する。
  // BatchWriteItem は iam-policy-design-note.md 3.4 の権限一覧に含まれないため使わない。
  // 既存のアイテムは上書きしない（D-13）。条件不一致は「登録済み」であり、エラーではない。
  return await Promise.all(
    users.map(async (user): Promise<AddUserResult> => {
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              ...userKey(poolId, user.arn),
              itemType: "IamUser",
              poolId,
              accountId: user.accountId,
              userName: user.userName,
              arn: user.arn,
              ...(Object.keys(user.attributes).length > 0 ? { attributes: user.attributes } : {}),
              createdAt: user.createdAt,
            } satisfies UserItem,
            ConditionExpression: "attribute_not_exists(pk)",
          }),
        );
        return { user, created: true };
      } catch (error) {
        if (!isConditionalCheckFailed(error)) {
          return await withStorageErrors("PutItem(IamUser)", () => Promise.reject(error));
        }
      }
      // 登録済み: 実際の createdAt・attributes を返す。間に削除されていたら組み立てたユーザを返す。
      return { user: (await getUser(poolId, user.arn)) ?? user, created: false };
    }),
  );
}

/**
 * 信頼ポリシーから取り込んだ IamUser を 1 件登録する（ロールの紐づけ時。Issue #80）。
 *
 * すでに当該プールに登録されていれば何もせず false を返す。`addUsers` と同じく、既存のアイテム
 * （`createdAt`・属性）を上書きしない（`addUsers` は D-13 で同じ条件付きの Put になった）。ARN は FR-1.2 の書式で導出する。AWS への実在検証は行わない。
 *
 * @returns 新しく登録したら true、すでにあれば false
 */
export async function addUserIfAbsent(
  poolId: string,
  accountId: string,
  userName: string,
  now: string,
): Promise<boolean> {
  assertAccountId(accountId);
  assertIamName(userName, "userName");
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();
  const arn = buildUserArn(accountId, userName);

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...userKey(poolId, arn),
          itemType: "IamUser",
          poolId,
          accountId,
          userName,
          arn,
          createdAt: now,
        } satisfies UserItem,
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false;
    return await withStorageErrors("PutItem(IamUser)", () => Promise.reject(error));
  }
}

/**
 * IamUser を削除し、配下の Assignment を連鎖削除する（質問 4 = B）。
 *
 * 未反映 ChangeRequest の凍結入力は影響を受けない（FR-4.5）。
 * 削除済みユーザを凍結入力に含む申請は、質問 5 = A により凍結入力どおりに適用される。
 *
 * 削除できない理由（反映済みの交点・未反映の申請）の判定はしない。API からは
 * `services/user-delete-service.ts` の `deletePoolUser` を通して呼ぶ（Issue #44）。
 *
 * AWS 上の信頼ポリシーへは何も書き込まない。
 */
export async function deleteUser(poolId: string, userArn: string): Promise<number> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const assignments = await withStorageErrors("Query(Assignment by user)", () =>
    client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: {
          ":pk": poolPk(poolId),
          ":prefix": assignmentSkPrefixForUser(userArn),
        },
        ProjectionExpression: "#pk, #sk",
        ExpressionAttributeNames: { "#pk": "pk", "#sk": "sk" },
      }),
    ),
  );

  const keys = (assignments.Items ?? []) as { pk: string; sk: string }[];
  await Promise.all(
    keys.map((key) =>
      withStorageErrors("DeleteItem(Assignment cascade)", () =>
        client.send(new DeleteCommand({ TableName: tableName, Key: key })),
      ),
    ),
  );

  await withStorageErrors("DeleteItem(IamUser)", () =>
    client.send(new DeleteCommand({ TableName: tableName, Key: userKey(poolId, userArn) })),
  );

  return keys.length;
}

function toIamUser(item: UserItem): IamUser {
  return {
    poolId: item.poolId,
    accountId: item.accountId,
    userName: item.userName,
    arn: item.arn,
    attributes: item.attributes ?? {},
    createdAt: item.createdAt,
  };
}
