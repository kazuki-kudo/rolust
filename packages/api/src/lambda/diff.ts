import { createHandler } from "../http.js";
import { diffRoutes } from "../handlers/apply.js";

/**
 * Diff 系統の Lambda（`iam-policy-design-note.md` 2 節）。
 *
 * 担当: FR-4.1〜4.2, FR-7.4 の差分表示
 * 権限: DynamoDB + `iam:GetRole`（**読み取りのみ**。更新権限は持たない）
 */
export const handler = createHandler(diffRoutes);
