import { randomUUID } from "node:crypto";

import type {
  Actor,
  ChangeRequest,
  CreateChangeRequestsResult,
  CreationFailure,
  DiscardResponse,
  ExcludedRole,
} from "@rolust/core";
import {
  ValidationError,
  buildFrozenInput,
  discard,
  isDiscardable,
  isEmptyInput,
  localized,
  renderMessage,
} from "@rolust/core";

import { ConflictError, awsErrorDetail, carriedLocalized } from "../errors.js";
import { listAssignments } from "../repository/assignment.js";
import {
  acquireRoleLock,
  compensateRoleLock,
  getChangeRequest,
  listChangeRequests,
  putChangeRequest,
  requireChangeRequest,
  tryReleaseRoleLock,
  updateChangeRequestStatus,
} from "../repository/change-request.js";
import { getRole } from "../repository/role.js";
import { requirePool } from "../repository/pool.js";

/**
 * 申請の作成・一覧・破棄（FR-4.4〜FR-4.8）。
 *
 * **AWS へは一切問い合わせない。** 申請の作成は Rolust 内部の状態遷移だけで完結する
 * （FR-4.3: 明示的な反映指示があるまで信頼ポリシーを更新しない）。
 */

export type { CreateChangeRequestsResult, CreationFailure, ExcludedRole };

export function newChangeRequestId(): string {
  return `cr-${randomUUID()}`;
}

/**
 * 選択された IamRole ごとに下書き ChangeRequest を 1 件ずつ作成する（FR-4.4）。
 *
 * - 入力はその時点の Assignment から算出し、**凍結**する（FR-4.5）。
 * - 未反映（下書きまたは失敗）の申請を持つロールは**除外して警告**する（FR-4.6）。
 *   既存の ChangeRequest を自動的に破棄することはしない。
 * - 作成者（`createdBy`）に、申請を作った実行者を保存する（Issue #120。分からなければ null）。
 */
export async function createChangeRequests(
  poolId: string,
  roleArns: string[],
  now: string,
  actor: Actor | null,
): Promise<CreateChangeRequestsResult> {
  await requirePool(poolId);

  if (roleArns.length === 0) {
    throw new ValidationError(localized("changeRequest.noRoles", {}), "roleArns");
  }

  const assignments = await listAssignments(poolId);

  const created: ChangeRequest[] = [];
  const excluded: ExcludedRole[] = [];
  const failures: CreationFailure[] = [];

  for (const roleArn of unique(roleArns)) {
    const role = await getRole(roleArn);
    if (!role) {
      excluded.push({ roleArn, reason: "not-registered", changeRequestId: null });
      continue;
    }
    const input = buildFrozenInput(roleArn, assignments);
    if (isEmptyInput(input)) {
      excluded.push({ roleArn, reason: "no-changes", changeRequestId: null });
      continue;
    }

    const changeRequestId = newChangeRequestId();
    const lock = await acquireRoleLock(roleArn, changeRequestId, "draft", now);
    if (!lock.acquired) {
      excluded.push({
        roleArn,
        // ロックが読めなかった場合も除外は維持する（安全側）。理由は draft として提示する。
        reason: lock.existing?.status === "failed" ? "failed" : "draft",
        changeRequestId: lock.existing?.changeRequestId ?? null,
      });
      continue;
    }

    const changeRequest: ChangeRequest = {
      changeRequestId,
      poolId,
      roleArn,
      addUserArns: input.addUserArns,
      removeUserArns: input.removeUserArns,
      status: "draft",
      createdAt: now,
      createdBy: actor,
      appliedAt: null,
      appliedBy: null,
      result: null,
    };

    try {
      await putChangeRequest(changeRequest);
      created.push(changeRequest);
    } catch (error) {
      // 本体の書き込みに失敗したらロックを補償削除する。補償の失敗も記録される。
      await compensateRoleLock(roleArn, changeRequestId);
      console.error(`[rolust] 申請の作成に失敗しました: roleArn=${roleArn}`, error);
      // `StorageError` など `localized` を運ぶ例外はそれを、運ばなければ AWS の文を、`message` と同じ文言として返す。
      const cause = carriedLocalized(error) ?? localized("changeRequest.saveFailed", { detail: awsErrorDetail(error) });
      failures.push({
        roleArn,
        message: renderMessage("ja", cause),
        localized: cause,
      });
    }
  }

  return { created, excluded, failures };
}

/** 申請履歴の一覧のオプション（Issue #116）。 */
export interface ListChangeRequestsOptions {
  /** この時刻以降（含む）に作成した申請だけを返す。UTC の ISO 文字列（`toISOString()` の形）。 */
  createdFrom?: string;
}

/**
 * 申請履歴（FR-7.5）。
 *
 * `createdFrom` があれば、applied・discarded は `createdAt >= createdFrom` のものだけにする。
 * **draft・failed は期間によらず返す**。未反映の申請は FR-4.6 のロックを握るので、期間外で
 * 見えなくなると、新しい申請を作れない理由が画面から消える。
 */
export async function listAllChangeRequests(
  options: ListChangeRequestsOptions = {},
): Promise<ChangeRequest[]> {
  const all = await listChangeRequests();
  const { createdFrom } = options;
  if (createdFrom === undefined) return all;
  return all.filter(
    (request) =>
      request.status === "draft" ||
      request.status === "failed" ||
      request.createdAt >= createdFrom,
  );
}

/**
 * 申請を破棄する（FR-4.8）。
 *
 * 状態「破棄」として履歴に残し、削除はしない。
 * 副作用として FR-4.6 のロールロックが解け、当該ロールの新規申請が作れるようになる。
 *
 * **順序の保証（B-1）**: `updateChangeRequestStatus` が返った時点で「破棄」は
 * 確定する。それより後のロック解放が失敗しても、**この関数は例外を投げない**。
 * 投げると呼び出し側（HTTP 層）が 502 を返し、記録は「破棄」なのに利用者には
 * 「破棄できませんでした」と伝わる — 記録と表示が食い違う。
 * 漏れたロックは運用で解放できるので、握り潰さず `lockWarning` として返す。
 */
export async function discardChangeRequest(
  changeRequestId: string,
  now: string,
): Promise<DiscardResponse> {
  const current = await requireChangeRequest(changeRequestId);

  if (!isDiscardable(current.status)) {
    throw discardRefusedByStatus(current.status);
  }

  const discarded = discard(current);
  // ここがコミット点。この書き込みが返ったら「破棄」は確定する。
  // 反映中（claim 中）の申請は書けない。読んだ後に別の管理者が先に確定した場合も、条件に外れる（Issue #121）。
  try {
    await updateChangeRequestStatus(discarded, { kind: "unclaimed", now });
  } catch (error) {
    if (!(error instanceof ConflictError)) throw error;
    // 条件に外れた理由を、申請を読み直して区別する。
    const latest = await getChangeRequest(changeRequestId, { consistent: true });
    if (latest && !isDiscardable(latest.status)) throw discardRefusedByStatus(latest.status);
    throw new ConflictError(localized("changeRequest.applyingByOther", {}));
  }

  // ---- コミット点より後。ここから先の失敗で破棄を取り消してはならない ----
  const release = await tryReleaseRoleLock(discarded.roleArn, discarded.changeRequestId);

  const lockWarning =
    !release.released && release.reason === "release-failed"
      ? localized("changeRequest.lockReleaseFailed", { cause: release.cause })
      : null;

  return {
    changeRequest: discarded,
    lockReleased: release.released,
    lockWarning: lockWarning === null ? null : renderMessage("ja", lockWarning),
    localizedLockWarning: lockWarning,
  };
}

function discardRefusedByStatus(status: string): ValidationError {
  return new ValidationError(localized("changeRequest.discardRefused", { status }), "status");
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
