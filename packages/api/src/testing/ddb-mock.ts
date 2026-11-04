import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { mockClient } from "aws-sdk-client-mock";

import { resetDocumentClient } from "../ddb/client.js";

/**
 * テスト用の DynamoDB スタブ。**実 AWS への呼び出しは一切行わない。**
 *
 * この module はテストからのみ import される。Lambda のバンドル（esbuild の
 * エントリポイントは `src/lambda/*.ts`）には含まれない。
 */

/** 状態テーブルの名前（テスト用。Issue #36）。 */
export const TEST_STATE_TABLE_NAME = "rolust-state-test";
/** 申請テーブルの名前（テスト用。Issue #36）。 */
export const TEST_CHANGE_REQUEST_TABLE_NAME = "rolust-change-requests-test";
/** 管理対象タグの既定値（テスト用）。`infra/variables.tf` の既定と揃える必要はない。 */
export const TEST_MANAGED_TAG_KEY = "rolust:managed";
export const TEST_MANAGED_TAG_VALUE = "true";
/** 固定プールの識別子（テスト用。Issue #108）。 */
export const TEST_POOL_ID = "platform-team";
/**
 * Rolust 自身の実行ロール（テスト用。Issue #194）。`infra/main.tf` の `local.self_role_arns` に相当する。
 * アカウント ID は、ハンドラのテストがデプロイ先として使う `123456789012` に揃える。
 */
export const TEST_SELF_ROLE_ARNS = [
  "arn:aws:iam::123456789012:role/rolust-crud-exec",
  "arn:aws:iam::123456789012:role/rolust-diff-exec",
  "arn:aws:iam::123456789012:role/rolust-apply-exec",
  "arn:aws:iam::123456789012:role/rolust-edge-auth-exec",
  "arn:aws:iam::123456789012:role/rolust-apigw-logs",
].join(",");

export const ddbMock = mockClient(DynamoDBDocumentClient);

/** 各テストの前に呼ぶ。環境変数とクライアントキャッシュを既知の状態へ戻す。 */
export function setupDdbMock(): void {
  process.env.ROLUST_STATE_TABLE_NAME = TEST_STATE_TABLE_NAME;
  process.env.ROLUST_CHANGE_REQUEST_TABLE_NAME = TEST_CHANGE_REQUEST_TABLE_NAME;
  // 廃止した変数（Issue #36）。残っていると loadConfig() が落ちる。
  delete process.env.ROLUST_TABLE_NAME;
  process.env.AWS_REGION = "ap-northeast-1";
  // 管理対象タグは loadConfig() が必須にしている（Step 18-A）。未設定だと
  // ConfigurationError で落ちるため、既知の値を入れておく。
  process.env.ROLUST_MANAGED_TAG_KEY = TEST_MANAGED_TAG_KEY;
  process.env.ROLUST_MANAGED_TAG_VALUE = TEST_MANAGED_TAG_VALUE;
  process.env.ROLUST_POOL_ID = TEST_POOL_ID;
  // ロールの登録が読む（Issue #194）。未設定だと ConfigurationError で落ちる（素通りさせない）。
  process.env.ROLUST_SELF_ROLE_ARNS = TEST_SELF_ROLE_ARNS;
  // 資格情報は一切設定しない（NFR-3）。スタブが送信を横取りするため不要である。
  ddbMock.reset();
  resetDocumentClient();
}

/** DynamoDB の条件付き書き込み失敗を模した例外。 */
export function conditionalCheckFailed(): Error {
  return Object.assign(new Error("The conditional request failed"), {
    name: "ConditionalCheckFailedException",
  });
}
