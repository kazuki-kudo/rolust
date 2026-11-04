import type { IamRole, RoleColorId } from "@rolust/core";

import { requireRole, updateRoleColor } from "../repository/role.js";

/**
 * IamRole の背景色の保存（Issue #100）。`role-description-service.ts` と同じ形。
 *
 * ロールが無ければ `requireRole` が、読んだ後に削除されていれば `updateRoleColor` の
 * 条件付き更新が `NotFoundError`（404）を投げる。変わらないときは書かない。
 */
export async function saveRoleColor(
  roleArn: string,
  color: RoleColorId | null,
): Promise<{ role: IamRole }> {
  const role = await requireRole(roleArn);
  if (color !== role.color) {
    await updateRoleColor(roleArn, color);
  }
  return { role: { ...role, color } };
}
