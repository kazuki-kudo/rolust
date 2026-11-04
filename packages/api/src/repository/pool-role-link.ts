import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { loadConfig } from "../config.js";
import { getDocumentClient, isConditionalCheckFailed, withStorageErrors } from "../ddb/client.js";
import type { BaseItem } from "../ddb/keys.js";
import { ROLE_SK_PREFIX, poolPk, poolRoleLinkKey } from "../ddb/keys.js";

/**
 * プールとロールの紐づけのリポジトリ（FR-1.7 / FR-3.1）。
 *
 * 1 件 = 1 アイテム（`pk = POOL#<poolId>`, `sk = ROLE#<roleArn>`）。Scan は使わない。
 * 書き込みは 1 件ずつ行う。CRUD の実行ロールは BatchWriteItem / TransactWriteItems を
 * 持たず、IAM ポリシーは変えない（spec D-8）。
 */

export interface PoolRoleLinkItem extends BaseItem {
  itemType: "PoolRoleLink";
  poolId: string;
  roleArn: string;
  createdAt: string;
  /** 列の並び順（Issue #100。0 始まり）。未設定なら属性を持たない。 */
  position?: number;
}

/** プールの紐づけ 1 件の ARN と並び順（`position`。未設定は null）。 */
export interface RoleLinkEntry {
  roleArn: string;
  position: number | null;
}

/** `position` 昇順。持たないものは後ろ。同値と持たないものどうしは ARN 昇順（コード単位。従来の `.sort()` と同じ）。 */
export function sortRoleLinkEntries(entries: RoleLinkEntry[]): RoleLinkEntry[] {
  return [...entries].sort((left, right) => {
    if (left.position !== right.position) {
      if (left.position === null) return 1;
      if (right.position === null) return -1;
      return left.position - right.position;
    }
    return left.roleArn < right.roleArn ? -1 : left.roleArn > right.roleArn ? 1 : 0;
  });
}

/** プールに紐づけたロールの ARN と並び順を、列の順で返す（アクセスパターン 12。Issue #100）。 */
export async function listRoleLinkEntries(poolId: string): Promise<RoleLinkEntry[]> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("Query(PoolRoleLink)", () =>
    client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": poolPk(poolId), ":prefix": ROLE_SK_PREFIX },
      }),
    ),
  );

  return sortRoleLinkEntries(
    ((result.Items ?? []) as PoolRoleLinkItem[]).map((item) => ({
      roleArn: item.roleArn,
      position: typeof item.position === "number" ? item.position : null,
    })),
  );
}

/** プールに紐づけたロールの ARN（アクセスパターン 12）。列の順（`position` 順）で返す。 */
export async function listRoleLinks(poolId: string): Promise<string[]> {
  return (await listRoleLinkEntries(poolId)).map((entry) => entry.roleArn);
}

/** 紐づけているか（割り当ての保存時の検証に使う）。 */
export async function isRoleLinked(poolId: string, roleArn: string): Promise<boolean> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("GetItem(PoolRoleLink)", () =>
    client.send(new GetCommand({ TableName: tableName, Key: poolRoleLinkKey(poolId, roleArn) })),
  );
  return result.Item !== undefined;
}

/** 紐づけを足す（アクセスパターン 13）。既にあれば何もせず false を返す。`position` を渡すと並び順つきで作る（Issue #100）。 */
export async function putRoleLink(poolId: string, roleArn: string, now: string, position?: number): Promise<boolean> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: {
          ...poolRoleLinkKey(poolId, roleArn),
          itemType: "PoolRoleLink",
          poolId,
          roleArn,
          createdAt: now,
          ...(position !== undefined ? { position } : {}),
        } satisfies PoolRoleLinkItem,
        ConditionExpression: "attribute_not_exists(pk)",
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false;
    return await withStorageErrors("PutItem(PoolRoleLink)", () => Promise.reject(error));
  }
}

/**
 * ロールを列の末尾に紐づける（Issue #135。登録時）。既にあれば何もせず false を返す（登録のやり直しで `position` を保つ）。
 *
 * `position` は最大 + 1。`position` を持たない紐づけ（#100 より前の保存）があるときは、現在の順（持たないもの同士は
 * ARN 昇順）で、最大 + 1 から順に `position` を埋めてから、その後ろに足す。埋めないと、新しい紐づけが持たない
 * ものの間（ARN 昇順）に割り込み、末尾にならない。埋めの途中で失敗したら、紐づけは書かない（やり直せる。埋めは冪等）。
 */
export async function appendRoleLink(poolId: string, roleArn: string, now: string): Promise<boolean> {
  const entries = await listRoleLinkEntries(poolId);
  let next = Math.max(-1, ...entries.map((entry) => entry.position ?? -1)) + 1;
  for (const entry of entries) {
    if (entry.position === null) {
      await setRoleLinkPosition(poolId, entry.roleArn, next);
      next += 1;
    }
  }
  return await putRoleLink(poolId, roleArn, now, next);
}

/** 紐づけを外す（アクセスパターン 13）。ロールの削除（`role-delete-service`。Issue #135）が、最初に呼ぶ。 */
export async function deleteRoleLink(poolId: string, roleArn: string): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  await withStorageErrors("DeleteItem(PoolRoleLink)", () =>
    client.send(new DeleteCommand({ TableName: tableName, Key: poolRoleLinkKey(poolId, roleArn) })),
  );
}

/**
 * 紐づけの並び順を書く（アクセスパターン 25。Issue #100）。読んだ後に紐づけが外されていたら何もせず false を返す
 * （並べる対象が無いので失敗にしない）。
 */
export async function setRoleLinkPosition(poolId: string, roleArn: string, position: number): Promise<boolean> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: poolRoleLinkKey(poolId, roleArn),
        ConditionExpression: "attribute_exists(pk)",
        UpdateExpression: "SET #position = :position",
        ExpressionAttributeNames: { "#position": "position" },
        ExpressionAttributeValues: { ":position": position },
      }),
    );
    return true;
  } catch (error) {
    if (isConditionalCheckFailed(error)) return false;
    return await withStorageErrors("UpdateItem(PoolRoleLink.position)", () => Promise.reject(error));
  }
}
