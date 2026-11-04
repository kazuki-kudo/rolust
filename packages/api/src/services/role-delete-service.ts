import type { DeleteRoleResponse, LocalizedMessage, RoleLock } from "@rolust/core";
import { localized } from "@rolust/core";

import { loadConfig } from "../config.js";
import { ConflictError, StorageError } from "../errors.js";
import { deleteAssignment, listAssignments } from "../repository/assignment.js";
import { getRoleLock } from "../repository/change-request.js";
import { deleteRoleLink } from "../repository/pool-role-link.js";
import { deleteRoleItem, requireRole } from "../repository/role.js";

/**
 * IamRole の削除（FR-2.4 / Issue #22。Issue #135 で、紐づきを拒否の理由にしないよう改めた）。
 *
 * 未反映（下書き・失敗）の申請があるロールだけを 409 で拒否し、何も書かない（ロールロックを直接読む）。
 * ロールは登録時に固定プールへ紐づくので、削除は紐づけと割り当てもあわせて片付ける。
 *
 * 書き込みの順序: 紐づけ → 固定プールに残った交点 → IamRole（最後）。紐づけを先に消すので、以後マトリクスの保存は
 * このロールの交点を作れない（`isRoleLinked`）。IamRole を最後に消すので、途中で失敗しても登録は残り、再実行で
 * 続きから片付く（紐づけが無くても IamRole が残る間は、もう一度削除できる）。
 * ロールの持ち主（`RoleLinkOwner`）は Issue #108 で廃止したので、読まず、消さない。
 *
 * **AWS へは一切問い合わせない**（FR-5.7）。AWS 上の IAM ロールと信頼ポリシーには触れない。
 */
export async function deleteRole(roleArn: string): Promise<DeleteRoleResponse> {
  const role = await requireRole(roleArn);
  const { poolId } = loadConfig();

  const lock = await getRoleLock(roleArn);
  if (lock !== null) {
    throw new ConflictError(blockerMessage(role.roleName, lock));
  }

  try {
    await deleteRoleLink(poolId, roleArn);
    // 固定プールに残った、このロールの交点を消す。`checked`・`reflected` を問わない。
    const leftovers = (await listAssignments(poolId)).filter((assignment) => assignment.roleArn === roleArn);
    for (const assignment of leftovers) {
      await deleteAssignment(poolId, assignment.userArn, roleArn);
    }
    await deleteRoleItem(roleArn);
    return { roleArn, removedAssignments: leftovers.length };
  } catch (cause) {
    console.error(`[rolust] IAM ロールの削除が途中で失敗しました: roleArn=${roleArn}`, cause);
    throw new StorageError(localized("storage.roleDeletePartial", { roleName: role.roleName }), {
      retryable: true,
      cause,
    });
  }
}

/** 409 の文言（GI-6: 何が・なぜ・どう直すか）。 */
export function blockerMessage(roleName: string, lock: RoleLock): LocalizedMessage {
  return localized("role.deleteBlocked", { roleName, status: lock.status === "failed" ? "failed" : "draft" });
}
