import { createHandler } from "../http.js";
import { changeRequestRoutes } from "../handlers/change-requests.js";
import { configRoutes } from "../handlers/config.js";
import { matrixRoutes } from "../handlers/matrix.js";
import { meRoutes } from "../handlers/me.js";
import { poolRoutes } from "../handlers/pool.js";
import { roleRoutes } from "../handlers/roles.js";

/**
 * CRUD 系統の Lambda（`iam-policy-design-note.md` 2 節）。
 *
 * 担当: FR-1.1〜1.4, FR-2.1〜2.2, FR-3.1〜3.2, FR-4.4〜4.8, FR-7.1〜7.3, FR-7.5、
 *       および `GET /config`（実行時設定の読み出し。質問 9 = A）、`GET /me`（呼び出した人の権限。Issue #141）
 * 権限: **DynamoDB と、ロール登録時のタグ読み取り（`iam:ListRoleTags`）、ロールの紐づけ時の信頼ポリシーの読み取り
 *       （`iam:GetRole`。管理対象タグの付いたロールだけ。Issue #80）のみ。IAM への書き込み権限は持たない。**
 *
 * この分割により、FR-3.2（チェック操作時に AWS へ一切書き込まない）は
 * 実行ロールが書き込み権限を持たないことで構造的に保証される。
 */
export const handler = createHandler([
  ...configRoutes,
  ...meRoutes,
  ...poolRoutes,
  ...roleRoutes,
  ...matrixRoutes,
  ...changeRequestRoutes,
]);
