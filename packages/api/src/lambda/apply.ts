import { createHandler } from "../http.js";
import { applyRoutes } from "../handlers/apply.js";

/**
 * Apply 系統の Lambda（`iam-policy-design-note.md` 2 節）。
 *
 * 担当: FR-5.1〜5.6
 * 権限: DynamoDB + `iam:GetRole` + `iam:UpdateAssumeRolePolicy`
 *       （`DenySelfEscalation` により Rolust 自身の実行ロールは対象外）
 *
 * `iam:UpdateAssumeRolePolicy` を持つのはこの 1 系統だけである。
 */
export const handler = createHandler(applyRoutes);
