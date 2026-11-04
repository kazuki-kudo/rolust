import { InvalidStateTransitionError } from "./errors.js";
import { localized } from "./messages/types.js";
import type { ApplyOutcome, Actor, ChangeRequest, ChangeRequestStatus } from "./types.js";

/**
 * ChangeRequest の状態と遷移規則（FR-4.8 / FR-5.5 / FR-5.6）。
 *
 * ```
 *  draft ──反映成功──▶ applied
 *    │  ╲
 *    │   ╲反映失敗──▶ failed ──再反映成功──▶ applied
 *    │                  │  ╲
 *    │                  │   ╲再反映失敗──▶ failed（自己遷移）
 *    ▼                  ▼
 * discarded         discarded
 * ```
 *
 * applied と discarded は終端。破棄しても削除はせず、状態「破棄」で履歴に残る（FR-4.8）。
 */

/** 「未反映」＝ 下書きまたは失敗（FR-4.6 / Q26）。 */
export const UNREFLECTED_STATUSES: readonly ChangeRequestStatus[] = ["draft", "failed"];

const ALLOWED_TRANSITIONS: Record<ChangeRequestStatus, readonly ChangeRequestStatus[]> = {
  draft: ["applied", "failed", "discarded"],
  failed: ["applied", "failed", "discarded"],
  applied: [],
  discarded: [],
};

/** 未反映（＝ FR-4.6 のロック対象）か。 */
export function isUnreflected(status: ChangeRequestStatus): boolean {
  return UNREFLECTED_STATUSES.includes(status);
}

/** 反映を指示できる状態か（FR-5.6 により失敗からの再反映を含む）。 */
export function isApplicable(status: ChangeRequestStatus): boolean {
  return isUnreflected(status);
}

/** 破棄できる状態か（FR-4.8 は下書きまたは失敗のみを対象とする）。 */
export function isDiscardable(status: ChangeRequestStatus): boolean {
  return isUnreflected(status);
}

export function canTransition(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** 遷移できないなら InvalidStateTransitionError を投げる（サイレントに無視しない）。 */
export function assertTransition(
  from: ChangeRequestStatus,
  to: ChangeRequestStatus,
): void {
  if (!canTransition(from, to)) {
    throw new InvalidStateTransitionError(localized("changeRequest.invalidTransition", { from, to }));
  }
}

/**
 * 反映結果を ChangeRequest に記録する（FR-5.5）。
 *
 * 成功なら「反映済み」、失敗なら「失敗」へ遷移させ、いずれも結果と時刻を保持する。
 * **凍結入力（addUserArns / removeUserArns）は変更しない** — FR-5.6 の再反映が
 * 同じ入力で行えることの担保である。
 * 反映者（`appliedBy`）は、`appliedAt` と同じく反映を試みた者で、失敗でも記録する（Issue #120）。
 */
export function recordApplyOutcome(
  changeRequest: ChangeRequest,
  outcome: ApplyOutcome,
  appliedAt: string,
  appliedBy: Actor | null,
): ChangeRequest {
  const next: ChangeRequestStatus = outcome.ok ? "applied" : "failed";
  assertTransition(changeRequest.status, next);
  return { ...changeRequest, status: next, appliedAt, appliedBy, result: outcome };
}

/** 破棄する（FR-4.8）。削除はしない。 */
export function discard(changeRequest: ChangeRequest): ChangeRequest {
  assertTransition(changeRequest.status, "discarded");
  return { ...changeRequest, status: "discarded" };
}
