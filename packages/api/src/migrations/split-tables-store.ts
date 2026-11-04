import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { plainMessage } from "@rolust/core";

import { batchGetAllWith, isConditionalCheckFailed, queryAllWith } from "../ddb/client.js";
import { GSI1_NAME, POOLS_INDEX_PK, ROLES_PK, poolPk, roleLinkOwnerKey } from "../ddb/keys.js";
import type { SplitTablesStore, StateItem } from "./split-tables.js";
import { keyOf } from "./split-tables.js";

/**
 * 状態のコピー（Issue #36）の DynamoDB ストア。旧テーブルから読み、状態テーブルへ書く。
 *
 * Lambda の `loadConfig` は使わない（移行には管理対象タグの環境変数が要らない。`dynamo-migration-store.ts` と同じ）。
 * Query は最後のページまで、BatchGet は 100 件ずつ未処理のキーを再要求して読み切る（取りこぼすと写し漏れになる）。
 * Scan・BatchWriteItem・TransactWriteItems は使わない。
 */
export function createSplitTablesStore(
  tables: { legacyTableName: string; stateTableName: string },
  region: string | undefined,
  client: DynamoDBDocumentClient = DynamoDBDocumentClient.from(
    new DynamoDBClient(region ? { region } : {}),
    { marshallOptions: { removeUndefinedValues: true } },
  ),
): SplitTablesStore {
  const { legacyTableName, stateTableName } = tables;
  const asStateItems = (items: Record<string, unknown>[]) => items as StateItem[];

  return {
    async listPoolIds() {
      const items = await queryAllWith(client, {
        TableName: legacyTableName,
        IndexName: GSI1_NAME,
        KeyConditionExpression: "gsi1pk = :pk",
        ExpressionAttributeValues: { ":pk": POOLS_INDEX_PK },
      });
      return items.map((item) => String(item.poolId));
    },

    async listPoolPartition(poolId) {
      return asStateItems(
        await queryAllWith(client, {
          TableName: legacyTableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": poolPk(poolId) },
        }),
      );
    },

    async listRoles() {
      return asStateItems(
        await queryAllWith(client, {
          TableName: legacyTableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": ROLES_PK },
        }),
      );
    },

    async getRoleLinkOwners(roleArns) {
      return asStateItems(
        await batchGetAllWith(
          client,
          legacyTableName,
          "BatchGetItem(RoleLinkOwner)",
          roleArns.map((roleArn) => ({ ...roleLinkOwnerKey(roleArn) })),
          plainMessage("旧テーブルの IAM ロールの持ち主を読み切れませんでした。時間をおいて再実行してください。"),
        ),
      );
    },

    async findExistingKeys(keys) {
      const items = await batchGetAllWith(
        client,
        stateTableName,
        "BatchGetItem(状態テーブル)",
        keys.map(({ pk, sk }) => ({ pk, sk })),
        plainMessage("状態テーブルの既存のアイテムを読み切れませんでした。時間をおいて再実行してください。"),
      );
      return new Set(asStateItems(items).map(keyOf));
    },

    async putIfAbsent(item) {
      try {
        await client.send(
          new PutCommand({ TableName: stateTableName, Item: item, ConditionExpression: "attribute_not_exists(pk)" }),
        );
        return true;
      } catch (error) {
        if (isConditionalCheckFailed(error)) return false;
        throw error;
      }
    },
  };
}
