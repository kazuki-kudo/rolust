import type { LocalizedMessage } from "@rolust/core";
import { localized, parseRoleArn } from "@rolust/core";

import { ConflictError } from "../errors.js";
import { listAssignments } from "../repository/assignment.js";
import { getChangeRequest, getRoleLocks } from "../repository/change-request.js";
import { deleteUser } from "../repository/pool.js";
import { listRoleLinks } from "../repository/pool-role-link.js";
import type { PendingRequest, UserDeleteBlockers } from "./user-delete-blockers.js";
import { computeUserDeleteBlockers } from "./user-delete-blockers.js";

/**
 * IamUser の削除（FR-1.5）。削除できない理由があれば 409 で拒否し、何も消さない（Issue #44）。
 *
 * **AWS へは一切問い合わせない**（FR-5.7）。判定は Rolust が記録した反映済み状態と
 * 未反映の申請の凍結入力だけで行う。
 *
 * @returns 連鎖削除した Assignment の件数
 */
export async function deletePoolUser(poolId: string, userArn: string): Promise<number> {
  const [assignments, pendingRequests] = await Promise.all([
    listAssignments(poolId),
    findPendingRequests(poolId),
  ]);

  const blockers = computeUserDeleteBlockers({ poolId, userArn, assignments, pendingRequests });
  if (blockers.reflectedRoleArns.length > 0 || blockers.changeRequestIds.length > 0) {
    throw new ConflictError(blockersMessage(userArn, blockers));
  }

  return deleteUser(poolId, userArn);
}

/**
 * このプールに紐づくロールの未反映の申請（FR-4.6 によりロールごとに高々 1 件）。
 *
 * このプールから作った未反映の申請があるロールは紐づけを外せない（FR-1.7）ので、
 * 紐づくロールのロックを引けば漏れない。申請が見つからないロックは含めない。
 */
async function findPendingRequests(poolId: string): Promise<PendingRequest[]> {
  const roleArns = await listRoleLinks(poolId);
  if (roleArns.length === 0) return [];

  const locks = await getRoleLocks(roleArns);
  const requests = await Promise.all(
    [...locks.values()].map((lock) => getChangeRequest(lock.changeRequestId)),
  );
  return requests.filter((request) => request !== null);
}

/** 409 の文言（GI-6: 何が・なぜ・どう直すか）。描画は ja・en のカタログ（`user.deleteBlocked`）が行う。 */
export function blockersMessage(userArn: string, blockers: UserDeleteBlockers): LocalizedMessage {
  const userName = userArn.split("/").pop() ?? userArn;
  const roleNames = blockers.reflectedRoleArns.map((roleArn) => parseRoleArn(roleArn).roleName);
  return localized("user.deleteBlocked", { userName, roleNames, changeRequestIds: blockers.changeRequestIds });
}
