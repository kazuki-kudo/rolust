import type { IamRole } from "@rolust/core";
import { normalizeRoleDescription } from "@rolust/core";

import { requireRole, updateRoleDescription } from "../repository/role.js";

/**
 * IamRole の説明の保存（Issue #21）。`repository/pool.ts` の `renamePool` と同じ形。
 *
 * ロールが無ければ `requireRole` が、読んだ後に削除されていれば `updateRoleDescription` の
 * 条件付き更新が `NotFoundError`（404）を投げる。
 */
export async function saveRoleDescription(
  roleArn: string,
  rawDescription: string | null,
): Promise<{ role: IamRole }> {
  const role = await requireRole(roleArn);
  const description = normalizeRoleDescription(rawDescription);
  if (description !== role.description) {
    await updateRoleDescription(roleArn, description);
  }
  return { role: { ...role, description } };
}
