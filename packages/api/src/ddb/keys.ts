/**
 * DynamoDB のキー生成。設計の根拠は `packages/api/TABLE-DESIGN.md`。
 *
 * テーブルは状態（UserPool・IamUser・Assignment・PoolRoleLink・IamRole・RoleLinkOwner）と
 * 申請（ChangeRequest・RoleLock）の 2 本（Issue #36）。キーの形はどちらも `pk` / `sk`。
 * GSI1 は状態テーブルにだけあり、UserPool 一覧に使う。
 *
 * キー文字列の組み立てを 1 箇所に閉じることで、リポジトリ間でキー表現がずれるのを防ぐ。
 */

export const GSI1_NAME = "gsi1";

/** アイテムの種別。デバッグとリポジトリ側の型ガードに使う。 */
export type ItemType =
  | "UserPool"
  | "IamUser"
  | "Assignment"
  | "IamRole"
  | "ChangeRequest"
  | "RoleLock"
  | "PoolRoleLink"
  | "RoleLinkOwner";

export interface TableKey {
  pk: string;
  sk: string;
}

/** すべてのアイテムが持つ共通属性。 */
export interface BaseItem extends TableKey {
  itemType: ItemType;
  gsi1pk?: string;
  gsi1sk?: string;
}

export const POOLS_INDEX_PK = "POOLS";
export const ROLES_PK = "ROLE";
export const CHANGE_REQUESTS_PK = "CR";
export const ROLE_LOCK_SK = "UNREFLECTED";
export const ROLE_LINK_OWNER_SK = "OWNER";

export const USER_SK_PREFIX = "USER#";
export const ASSIGNMENT_SK_PREFIX = "ASSIGN#";
export const ROLE_SK_PREFIX = "ROLE#";
export const CHANGE_REQUEST_SK_PREFIX = "CR#";

export function poolPk(poolId: string): string {
  return `POOL#${poolId}`;
}

export function poolKey(poolId: string): TableKey {
  return { pk: poolPk(poolId), sk: "META" };
}

export function userKey(poolId: string, userArn: string): TableKey {
  return { pk: poolPk(poolId), sk: `${USER_SK_PREFIX}${userArn}` };
}

export function assignmentKey(
  poolId: string,
  userArn: string,
  roleArn: string,
): TableKey {
  return {
    pk: poolPk(poolId),
    sk: `${ASSIGNMENT_SK_PREFIX}${userArn}#${roleArn}`,
  };
}

/** Assignment の SK 前方一致（あるユーザの全 Assignment。Q4=B の連鎖削除に使う）。 */
export function assignmentSkPrefixForUser(userArn: string): string {
  return `${ASSIGNMENT_SK_PREFIX}${userArn}#`;
}

export function roleKey(roleArn: string): TableKey {
  return { pk: ROLES_PK, sk: `${ROLE_SK_PREFIX}${roleArn}` };
}

/**
 * プールとロールの紐づけ（FR-1.7）。プールのパーティションに置き、SK は IamRole と同じ `ROLE#` 接頭辞。
 * プールの紐づけは `begins_with(sk, "ROLE#")` の Query 1 本で引ける（TABLE-DESIGN.md アクセスパターン 12）。
 */
export function poolRoleLinkKey(poolId: string, roleArn: string): TableKey {
  return { pk: poolPk(poolId), sk: `${ROLE_SK_PREFIX}${roleArn}` };
}

/**
 * ロールの持ち主のプール（Issue #35）。1 ロール 1 アイテムの逆引きで、ロールを紐づけられるプールを 1 つに限る。
 * 取得・返却は `poolId` の条件付き PutItem / DeleteItem（TABLE-DESIGN.md アクセスパターン 15・16）。
 */
export function roleLinkOwnerKey(roleArn: string): TableKey {
  return { pk: `ROLELINK#${roleArn}`, sk: ROLE_LINK_OWNER_SK };
}

export function changeRequestKey(changeRequestId: string): TableKey {
  return {
    pk: CHANGE_REQUESTS_PK,
    sk: `${CHANGE_REQUEST_SK_PREFIX}${changeRequestId}`,
  };
}

export function roleLockKey(roleArn: string): TableKey {
  return { pk: `ROLELOCK#${roleArn}`, sk: ROLE_LOCK_SK };
}
