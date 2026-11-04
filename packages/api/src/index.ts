/**
 * `@rolust/api` — Lambda ハンドラ、DynamoDB リポジトリ、IAM クライアント。
 *
 * Lambda のエントリポイントは `src/lambda/{crud,diff,apply}.ts`。
 * この index は型と関数を web / テストから参照するための集約点である。
 */

export * from "./config.js";
export * from "./errors.js";
export * from "./http.js";
export * from "./aws/iam-client.js";
export * from "./services/apply-service.js";
export * from "./services/change-request-service.js";
export * from "./services/diff-service.js";
export { configRoutes } from "./handlers/config.js";
export type { RoleLock } from "./repository/change-request.js";
export type { PoolView } from "./handlers/pool.js";
export type { RoleView } from "./handlers/roles.js";
export type { MatrixView } from "./handlers/matrix.js";
