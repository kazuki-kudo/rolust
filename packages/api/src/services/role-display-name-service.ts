import type { IamRole } from "@rolust/core";
import { localized, normalizeRoleDisplayName } from "@rolust/core";

import { ConflictError } from "../errors.js";
import { listRoles, requireRole, updateRoleDisplayName } from "../repository/role.js";

/**
 * IamRole の表示名の保存と重複の検査（Issue #150）。`role-description-service.ts` と同じ形。
 *
 * 重複は、登録済みロールの間で、正規化した後の完全一致で判定する（大文字小文字は区別する）。
 * 同時に同じ表示名を保存したときの競合は排他しない（spec D-6）。
 */

/**
 * 表示名が、`exceptRoleArn` 以外の登録済みロールで使われていなければ通す。使われていれば 409。
 * 登録（POST）は、AWS を呼ぶ前にこれを呼ぶ。
 */
export async function assertRoleDisplayNameUnused(displayName: string, exceptRoleArn?: string): Promise<void> {
  const used = (await listRoles()).some(
    (role) => role.arn !== exceptRoleArn && role.displayName === displayName,
  );
  if (used) {
    throw new ConflictError(localized("role.displayNameTaken", { displayName }));
  }
}

/**
 * 表示名を保存する。`null` または空白だけで未設定に戻す。
 *
 * @throws ValidationError 規則違反（書き込み前）
 * @throws ConflictError ほかのロールと同じ表示名（書き込み前）
 * @throws NotFoundError ロールが登録されていない
 */
export async function saveRoleDisplayName(
  roleArn: string,
  rawDisplayName: string | null,
): Promise<{ role: IamRole }> {
  const role = await requireRole(roleArn);
  const displayName = normalizeRoleDisplayName(rawDisplayName);
  if (displayName === role.displayName) return { role };
  if (displayName !== null) await assertRoleDisplayNameUnused(displayName, roleArn);
  await updateRoleDisplayName(roleArn, displayName);
  return { role: { ...role, displayName } };
}
