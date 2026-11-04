import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { BatchGetCommand, DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { QueryCommandInput } from "@aws-sdk/lib-dynamodb";
import { localized } from "@rolust/core";
import type { LocalizedMessage } from "@rolust/core";

import { loadConfig } from "../config.js";
import { StorageError, awsErrorName } from "../errors.js";

/**
 * DynamoDB Document クライアント。
 *
 * NFR-3: 認証情報は SDK の認証情報チェーン（Lambda 実行ロール）から取得する。
 * 資格情報を引数にも環境変数にも持たない。
 *
 * Lambda の実行コンテキスト再利用に載せるためモジュールスコープでキャッシュする。
 */
let cached: DynamoDBDocumentClient | null = null;

export function getDocumentClient(): DynamoDBDocumentClient {
  if (cached) return cached;

  const { region } = loadConfig();
  const base = new DynamoDBClient(region ? { region } : {});
  cached = DynamoDBDocumentClient.from(base, {
    marshallOptions: {
      // 未定義の属性を書き込まない。空文字列は許す（ARN 由来の値は空にならない）。
      removeUndefinedValues: true,
      convertClassInstanceToMap: false,
    },
  });
  return cached;
}

/** テスト用。キャッシュを捨てて次回の生成をやり直させる。 */
export function resetDocumentClient(): void {
  cached = null;
}

/** DynamoDB の楽観的条件が失敗したときの SDK 例外名。 */
export const CONDITIONAL_CHECK_FAILED = "ConditionalCheckFailedException";

/** 再試行して意味のある DynamoDB エラー。 */
const RETRYABLE_ERRORS = new Set([
  "ProvisionedThroughputExceededException",
  "ThrottlingException",
  "RequestLimitExceeded",
  "InternalServerError",
  "TransactionInProgressException",
]);

/**
 * DynamoDB 呼び出しを包み、例外を StorageError へ変換する。
 *
 * 握り潰さない。原因の例外は `cause` に載せ、回復可能かを `retryable` で伝える。
 */
export async function withStorageErrors<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const name = awsErrorName(error);
    if (name === CONDITIONAL_CHECK_FAILED) {
      // 条件付き書き込みの失敗は呼び出し側が意味を持って扱う（FR-4.6 の除外など）。
      throw error;
    }
    throw new StorageError(
      localized("storage.operationFailed", {
        operation,
        detail: error instanceof Error && error.message ? error.message : null,
      }),
      { retryable: name !== null && RETRYABLE_ERRORS.has(name), cause: error },
    );
  }
}

/** 条件付き書き込みが条件不一致で失敗したか。 */
export function isConditionalCheckFailed(error: unknown): boolean {
  return awsErrorName(error) === CONDITIONAL_CHECK_FAILED;
}

/** BatchGetItem の 1 回あたりのキー数の上限。 */
const BATCH_GET_LIMIT = 100;
/** 未処理のキーを含めた BatchGetItem の試行回数の上限（1 チャンクあたり）。 */
const MAX_BATCH_GET_ATTEMPTS = 3;

/**
 * `tableName` のテーブルから `keys` のアイテムを BatchGetItem で読み切る。見つからないキーは結果に含まない。
 *
 * 100 件ごとに刻み、`UnprocessedKeys` はそれだけを再要求する。読み切れないまま結果を返すと
 * 「アイテムが無い」と誤って判定させる（持ち主やロックの取りこぼし）ため、
 * 1 チャンクあたり {@link MAX_BATCH_GET_ATTEMPTS} 回で読み切れなければ
 * `failureMessage` の再試行可能な `StorageError` を投げる。
 */
export async function batchGetAll(
  tableName: string,
  operation: string,
  keys: Record<string, unknown>[],
  failureMessage: LocalizedMessage,
): Promise<Record<string, unknown>[]> {
  if (keys.length === 0) return [];
  return await batchGetAllWith(getDocumentClient(), tableName, operation, keys, failureMessage);
}

/**
 * {@link batchGetAll} のクライアントとテーブル名を引数で受ける版。
 * Lambda の設定（`loadConfig`）を使わない移行スクリプトのストアから使う（Issue #35）。
 */
export async function batchGetAllWith(
  client: DynamoDBDocumentClient,
  tableName: string,
  operation: string,
  keys: Record<string, unknown>[],
  failureMessage: LocalizedMessage,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  for (let offset = 0; offset < keys.length; offset += BATCH_GET_LIMIT) {
    let pending = keys.slice(offset, offset + BATCH_GET_LIMIT);
    for (let attempt = 0; pending.length > 0; attempt += 1) {
      if (attempt === MAX_BATCH_GET_ATTEMPTS) {
        throw new StorageError(failureMessage, { retryable: true });
      }
      const requestKeys = pending;
      const result = await withStorageErrors(operation, () =>
        client.send(new BatchGetCommand({ RequestItems: { [tableName]: { Keys: requestKeys } } })),
      );
      items.push(...(result.Responses?.[tableName] ?? []));
      pending = result.UnprocessedKeys?.[tableName]?.Keys ?? [];
    }
  }
  return items;
}

/**
 * Query を `LastEvaluatedKey` の最後まで辿る。取りこぼすと結果が黙って欠けるため、
 * 全件が対象の読み取り（移行スクリプト、申請履歴の一覧）で使う。
 */
export async function queryAllWith(
  client: DynamoDBDocumentClient,
  input: Omit<QueryCommandInput, "ExclusiveStartKey">,
): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let start: QueryCommandInput["ExclusiveStartKey"];
  do {
    const result = await client.send(new QueryCommand({ ...input, ExclusiveStartKey: start }));
    items.push(...((result.Items ?? []) as Record<string, unknown>[]));
    start = result.LastEvaluatedKey;
  } while (start);
  return items;
}
