import type { ReorderRolesResponse } from "@rolust/core";
import { ValidationError, isRoleArn, localized } from "@rolust/core";

import { loadConfig } from "../config.js";
import { StorageError } from "../errors.js";
import { listRoleLinkEntries, setRoleLinkPosition } from "../repository/pool-role-link.js";
import { listRoles } from "../repository/role.js";

/**
 * ロールの並び順（マトリクスの列順）の保存（FR-2.6。Issue #135 spec 3.3）。AWS にも ChangeRequest にも触れない。
 *
 * 本文は全登録ロールの ARN の配列。登録されていない ARN は 400。重複は先頭を残す。配列に無い登録済みロール
 * （読んだ後に登録されたもの）は、現在の順で後ろに付ける（同時の登録を失敗にしない）。順位が変わるロールだけ
 * `position` を書く。読んだ後に削除されたロールは飛ばす（`setRoleLinkPosition` が false）。冪等で、
 * 途中で失敗しても、再保存で最終の順に直る。
 */
export async function reorderRoles(roleArns: string[]): Promise<ReorderRolesResponse> {
  const { poolId } = loadConfig();

  const requested = [...new Set(roleArns)];
  for (const roleArn of requested) {
    if (!isRoleArn(roleArn)) {
      throw new ValidationError(localized("arn.notRoleArn", { arn: roleArn }), "roleArns");
    }
  }
  const registered = new Set((await listRoles()).map((role) => role.arn));
  const unregistered = requested.filter((roleArn) => !registered.has(roleArn));
  if (unregistered.length > 0) {
    throw new ValidationError(localized("role.orderUnregistered", { roleArns: unregistered }), "roleArns");
  }

  const entries = await listRoleLinkEntries(poolId);
  const asked = new Set(requested);
  const rest = entries
    .map((entry) => entry.roleArn)
    .filter((roleArn) => registered.has(roleArn) && !asked.has(roleArn));
  const order = [...requested, ...rest];
  const currentPosition = new Map(entries.map((entry) => [entry.roleArn, entry.position] as const));

  try {
    for (const [index, roleArn] of order.entries()) {
      if (currentPosition.get(roleArn) !== index) {
        await setRoleLinkPosition(poolId, roleArn, index);
      }
    }
  } catch (cause) {
    console.error(`[rolust] ロールの並び順の保存が途中で失敗しました: poolId=${poolId}`, cause);
    throw new StorageError(localized("storage.roleOrderPartial", {}), { retryable: true, cause });
  }
  return { roleArns: order };
}
