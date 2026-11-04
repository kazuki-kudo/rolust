/**
 * `@rolust/core` — ドメインモデルと純粋なビジネスロジック。
 *
 * この層は AWS SDK にもデータストアにも依存しない。差分算出（FR-4.1）と
 * 保全方式マージ（FR-5.1）は Rolust の中核であり、副作用を持たない関数として
 * 切り出すことでユニットテストだけで検証できる。
 */

export * from "./errors.js";
export * from "./types.js";
export * from "./actor.js";
export * from "./permission.js";
export * from "./arn.js";
export * from "./trust-policy.js";
export * from "./principals.js";
export * from "./unmanaged.js";
export * from "./trust-import.js";
export * from "./diff.js";
export * from "./drift.js";
export * from "./placeholder.js";
export * from "./merge.js";
export * from "./change-request.js";
export * from "./matrix.js";
export * from "./api-contract.js";
export * from "./role.js";
export * from "./attribute.js";
export * from "./role-color.js";
export * from "./user-csv.js";
export * from "./messages/index.js";
