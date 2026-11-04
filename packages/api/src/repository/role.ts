import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import type { IamRole, RoleColorId } from "@rolust/core";
import { assertAccountId, assertIamName, buildRoleArn, isRoleColorId, localized } from "@rolust/core";

import { loadConfig } from "../config.js";
import { ConflictError, NotFoundError } from "../errors.js";
import { getDocumentClient, isConditionalCheckFailed, withStorageErrors } from "../ddb/client.js";
import type { BaseItem } from "../ddb/keys.js";
import { ROLES_PK, ROLE_SK_PREFIX, roleKey } from "../ddb/keys.js";

/**
 * IamRole のリポジトリ（FR-2.1 / FR-2.2）。
 *
 * IamRole は UserPool に従属しない（requirements.md Data Model 補足）ため、
 * 単一パーティション `pk = ROLE` に置き、一覧は Query 1 本で取る。
 *
 * **AWS への実在検証は行わない**（FR-5.7 / C-4）。登録入力は管理者の手入力のみが情報源であり、
 * デプロイ先と異なるアカウント ID のロールも登録できる（FR-2.2。差分確認と反映は、ターゲット側のロールを引き受けて行う。Issue #85）。
 */

interface RoleItem extends BaseItem {
  itemType: "IamRole";
  accountId: string;
  roleName: string;
  arn: string;
  /** 任意の説明（Issue #21）。未設定なら属性を持たない。 */
  description?: string;
  /** 任意の表示名（Issue #150）。未設定なら属性を持たない。 */
  displayName?: string;
  /** 任意の背景色（Issue #100）。未設定なら属性を持たない。 */
  color?: RoleColorId;
  createdAt: string;
}

export async function listRoles(): Promise<IamRole[]> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("Query(IamRole)", () =>
    client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "pk = :pk AND begins_with(sk, :prefix)",
        ExpressionAttributeValues: { ":pk": ROLES_PK, ":prefix": ROLE_SK_PREFIX },
      }),
    ),
  );

  // mockups.md 画面 2「ソートはアカウント ID → ロール名の昇順固定」
  return ((result.Items ?? []) as RoleItem[])
    .map(toIamRole)
    .sort(
      (left, right) =>
        left.accountId.localeCompare(right.accountId) ||
        left.roleName.localeCompare(right.roleName),
    );
}

export async function getRole(roleArn: string): Promise<IamRole | null> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  const result = await withStorageErrors("GetItem(IamRole)", () =>
    client.send(new GetCommand({ TableName: tableName, Key: roleKey(roleArn) })),
  );

  const item = result.Item as RoleItem | undefined;
  return item ? toIamRole(item) : null;
}

export async function requireRole(roleArn: string): Promise<IamRole> {
  const role = await getRole(roleArn);
  if (!role) {
    throw new NotFoundError(localized("role.notRegistered", { roleArn }));
  }
  return role;
}

/** IamRole を作成する（FR-2.1）。同じ ARN が既にあれば ConflictError。 */
export async function createRole(
  accountId: string,
  roleName: string,
  now: string,
  description: string | null = null,
  displayName: string | null = null,
): Promise<IamRole> {
  assertAccountId(accountId);
  assertIamName(roleName, "roleName");

  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();
  const arn = buildRoleArn(accountId, roleName);

  const item: RoleItem = {
    ...roleKey(arn),
    itemType: "IamRole",
    accountId,
    roleName,
    arn,
    ...(description !== null ? { description } : {}),
    ...(displayName !== null ? { displayName } : {}),
    createdAt: now,
  };

  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: item,
        ConditionExpression: "attribute_not_exists(sk)",
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new ConflictError(localized("role.alreadyRegistered", { roleArn: arn }));
    }
    return await withStorageErrors("PutItem(IamRole)", () => Promise.reject(error));
  }

  return { accountId, roleName, arn, description, displayName, color: null, createdAt: now };
}

/**
 * IamRole の説明を更新する（Issue #21）。`null` で属性を消し未設定に戻す
 * （`repository/pool.ts` の `updateDisplayName` と同じ形）。
 *
 * @throws NotFoundError ロールが登録されていない
 */
export async function updateRoleDescription(
  roleArn: string,
  description: string | null,
): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: roleKey(roleArn),
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: { "#description": "description" },
        ...(description === null
          ? { UpdateExpression: "REMOVE #description" }
          : {
              UpdateExpression: "SET #description = :description",
              ExpressionAttributeValues: { ":description": description },
            }),
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new NotFoundError(localized("role.notRegistered", { roleArn }));
    }
    await withStorageErrors("UpdateItem(IamRole.description)", () => Promise.reject(error));
  }
}

/**
 * IamRole の表示名を更新する（Issue #150）。`null` で属性を消し未設定に戻す（`updateRoleDescription` と同じ形）。
 *
 * @throws NotFoundError ロールが登録されていない
 */
export async function updateRoleDisplayName(roleArn: string, displayName: string | null): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: roleKey(roleArn),
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: { "#displayName": "displayName" },
        ...(displayName === null
          ? { UpdateExpression: "REMOVE #displayName" }
          : {
              UpdateExpression: "SET #displayName = :displayName",
              ExpressionAttributeValues: { ":displayName": displayName },
            }),
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new NotFoundError(localized("role.notRegistered", { roleArn }));
    }
    await withStorageErrors("UpdateItem(IamRole.displayName)", () => Promise.reject(error));
  }
}

/**
 * IamRole の背景色を更新する（Issue #100。TABLE-DESIGN.md アクセスパターン 26）。`null` で属性を消し未設定に戻す
 * （`updateRoleDescription` と同じ形）。
 *
 * @throws NotFoundError ロールが登録されていない
 */
export async function updateRoleColor(roleArn: string, color: RoleColorId | null): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  try {
    await client.send(
      new UpdateCommand({
        TableName: tableName,
        Key: roleKey(roleArn),
        ConditionExpression: "attribute_exists(pk)",
        ExpressionAttributeNames: { "#color": "color" },
        ...(color === null
          ? { UpdateExpression: "REMOVE #color" }
          : {
              UpdateExpression: "SET #color = :color",
              ExpressionAttributeValues: { ":color": color },
            }),
      }),
    );
  } catch (error) {
    if (isConditionalCheckFailed(error)) {
      throw new NotFoundError(localized("role.notRegistered", { roleArn }));
    }
    await withStorageErrors("UpdateItem(IamRole.color)", () => Promise.reject(error));
  }
}

/**
 * IamRole を削除する（FR-2.4 / Issue #22）。削除できるかの判定と後片付けは `services/role-delete-service.ts` が行う。
 *
 * 条件は付けない。判定の後にほかの人が先に消していても、同じ結果（登録が無い）になるため。
 */
export async function deleteRoleItem(roleArn: string): Promise<void> {
  const { stateTableName: tableName } = loadConfig();
  const client = getDocumentClient();

  await withStorageErrors("DeleteItem(IamRole)", () =>
    client.send(new DeleteCommand({ TableName: tableName, Key: roleKey(roleArn) })),
  );
}

function toIamRole(item: RoleItem): IamRole {
  return {
    accountId: item.accountId,
    roleName: item.roleName,
    arn: item.arn,
    description: item.description ?? null,
    displayName: item.displayName ?? null,
    color: isRoleColorId(item.color) ? item.color : null,
    createdAt: item.createdAt,
  };
}
