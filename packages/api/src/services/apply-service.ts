import type {
  Actor,
  ApplyOutcome,
  ApplyReport,
  ChangeRequest,
  LocalizedMessage,
  MergeResult,
} from "@rolust/core";
import {
  frozenInputOf,
  isApplicable,
  localized,
  mergeTrustPolicy,
  recordApplyOutcome,
  renderMessage,
} from "@rolust/core";

import { IamOperationError, createIamTrustPolicyClient } from "../aws/iam-client.js";
import type { IamTrustPolicyClient } from "../aws/iam-client.js";
import { localizedOfError } from "../errors.js";
import { markReflected } from "../repository/assignment.js";
import {
  claimChangeRequest,
  getChangeRequest,
  tryReleaseRoleLock,
  updateChangeRequestStatus,
  updateRoleLockStatus,
} from "../repository/change-request.js";
import type { StatusGuard } from "../repository/change-request.js";

/**
 * 信頼ポリシーの反映（FR-5.1〜FR-5.6）。
 *
 * **Q5=A の実装点**: 反映処理における「Rolust 管理下の principal」は、
 * 反映時点の IamUser 集合ではなく**対象 ChangeRequest の凍結入力の ARN 集合**である。
 * `mergeTrustPolicy` が保全の基準集合として凍結入力を使うことで、
 * FR-5.2（適用結果が凍結入力どおり）と FR-5.1（管理外 principal が全件残る）が同時に成立する。
 *
 * **FR-5.4 の実装点**: 一括反映は `Promise.allSettled` でロール単位に分離する。
 * 1 ロールの失敗が他ロールの結果を不明にしてはならない。
 *
 * **順序の保証（B-1）**: 反映処理は「コミット点」で 2 段に分かれる。
 *
 * 1. `commitApply` — AWS の信頼ポリシー更新と、状態「反映済み」の記録。
 *    ここでの失敗だけが「失敗」として記録される。
 * 2. コミット点より後の後片付け — ロック解放・baseline 追随。
 *    **確定した状態を決して巻き戻さない。** 起きたことは `warnings` で伝える。
 *
 * 後片付けをコミット点の try/catch に含めると、DynamoDB の一時障害ひとつで
 * 「AWS には反映済み・記録は失敗」という食い違いが生まれる。これは
 * `requirements.md` § Assignment と ChangeRequest の関係「反映した内容と監査記録は必ず一致する」が
 * 防ぐために存在する、まさにその事故である。
 */

export type { ApplyReport };

export interface ApplyServiceDeps {
  iam: IamTrustPolicyClient;
}

/**
 * 複数の ChangeRequest を反映する。ロール単位で成否を返す（FR-5.4）。
 *
 * この関数は決して reject しない。1 件でも結果を返せなくなると
 * 「他ロールの結果が不明」になり FR-5.4 の判定が壊れるためである。
 *
 * @param deployAccountId デプロイ先の AWS アカウント ID（API Gateway の `requestContext.accountId`）。既定の IAM クライアントが、
 *   ロールのアカウントに応じて資格情報を選ぶために使う（別アカウントのロールは、ターゲット側の Manager を引き受けて
 *   読み書きする。Issue #85）。判定できない（`null`）と、IAM を呼ばずに「失敗」にする。
 * @param actor 反映を指示した実行者。反映者（appliedBy）として、成功にも失敗にも記録する（Issue #120）。分からなければ null。
 */
export async function applyChangeRequests(
  changeRequestIds: string[],
  now: string,
  deployAccountId: string | null,
  actor: Actor | null,
  deps: ApplyServiceDeps = { iam: createIamTrustPolicyClient(deployAccountId) },
): Promise<ApplyReport[]> {
  const settled = await Promise.allSettled(
    changeRequestIds.map((id) => applyOne(id, now, actor, deps)),
  );

  return settled.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;

    // applyOne は内部で例外を捕捉するため通常ここには来ない。
    // 来た場合も「結果が不明なロール」を作らず、失敗として同じ粒度で報告する。
    const changeRequestId = changeRequestIds[index] as string;
    console.error(`[rolust] 反映処理が異常終了しました: ${changeRequestId}`, outcome.reason);
    return failureReport(
      changeRequestId,
      "",
      now,
      "InternalError",
      localizedOfError(outcome.reason, localized("apply.crashed", {})),
    );
  });
}

async function applyOne(
  changeRequestId: string,
  now: string,
  actor: Actor | null,
  deps: ApplyServiceDeps,
): Promise<ApplyReport> {
  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    return failureReport(changeRequestId, "", now, "NotFound", localized("apply.notFound", {}));
  }

  if (!isApplicable(changeRequest.status)) {
    // 反映済み・破棄済みの申請を再度反映しない。状態は変えない。
    return invalidStateReport(changeRequest, now);
  }

  // 反映の権利（claim）を、IAM を呼ぶ前に取る（Issue #121）。同じ申請を同時に反映する別の管理者、
  // および反映中の破棄を排除する。取れなければ、IAM も申請の記録も触らない。
  const claim = await claimChangeRequest(changeRequestId, now);
  if (!claim.claimed) return await claimRefusedReport(changeRequestId, now);

  const commit = await commitApply(changeRequest, now, actor, deps, {
    kind: "claim",
    token: claim.token,
  });
  if (commit.kind === "failed") return commit.report;

  // ============================ コミット点より後 ============================
  // ここに到達した時点で「AWS の信頼ポリシーは更新済み」かつ
  // 「監査記録は状態『反映済み』で確定済み」である。
  //
  // **以降の処理を上の try/catch の中へ戻してはならない。**
  // 戻すと後片付けの失敗が反映失敗と同じ catch へ落ち、成功した反映が
  // 「失敗」へ上書きされる（requirements.md § Assignment と ChangeRequest の関係
  // 「反映した内容と監査記録は必ず一致する」が破れる）。
  // したがってここから先は**例外を投げない API だけ**を呼び、
  // 起きたことは warnings として呼び出し側へ必ず伝える。
  // ========================================================================
  const { applied, merged, message, localized: resultMessage } = commit;
  // 警告は ID と引数で作り、`warnings`（日本語）と `localizedWarnings` を同じ並びで返す。
  const warnings: LocalizedMessage[] = [];

  // FR-4.6 のロックを解放する。ここから当該ロールの新規申請が作れるようになる。
  const release = await tryReleaseRoleLock(applied.roleArn, applied.changeRequestId);
  if (!release.released) {
    warnings.push(
      release.reason === "held-by-other"
        ? localized("apply.lockNotHeld", {})
        : localized("apply.lockReleaseFailed", { cause: release.cause }),
    );
  }

  warnings.push(...(await syncBaseline(changeRequest, now)));

  return {
    changeRequestId,
    roleArn: changeRequest.roleArn,
    ok: true,
    status: applied.status,
    appliedAt: now,
    errorCode: null,
    message,
    localized: resultMessage,
    added: merged.added,
    removed: merged.removed,
    warnings: warnings.map((warning) => renderMessage("ja", warning)),
    localizedWarnings: warnings,
  };
}

/** コミットの結果。`committed` は「AWS も監査記録も確定済み」を意味する。 */
type CommitResult =
  | {
      kind: "committed";
      applied: ChangeRequest;
      merged: MergeResult;
      message: string;
      localized: LocalizedMessage;
    }
  | { kind: "failed"; report: ApplyReport };

/**
 * **コミット点** — AWS への反映と「反映済み」の記録までを 1 つの try で囲む。
 *
 * この関数が `committed` を返したら、AWS 上の信頼ポリシーと監査記録は
 * 揃って確定している。ここで囲む処理はその 2 つ**だけ**であり、
 * ロック解放や baseline 追随といった後片付けは意図的に外へ出してある。
 * 後片付けをこの try の中へ入れると、その失敗が下の catch に落ちて
 * 成功済みの反映を「失敗」で上書きしてしまう（B-1）。
 *
 * claim（`guard`）は呼び出し側が、この関数の前に取る。確定の書き込みは claim の持ち主だけが書け、
 * 書くときに claim を外す。期限（2 分）は Lambda の timeout（30 秒）より長いので、持ち主の実行中に
 * 奪われることは実際には起きない。起きても、条件に外れて「失敗」の記録も拒否され、ログに残る（Issue #121）。
 */
async function commitApply(
  changeRequest: ChangeRequest,
  now: string,
  actor: Actor | null,
  deps: ApplyServiceDeps,
  guard: StatusGuard,
): Promise<CommitResult> {
  const { changeRequestId } = changeRequest;

  try {
    // どの資格情報で読み書きするかは、IAM クライアントが、ロールのアカウントに応じて選ぶ（別アカウントのロールは、
    // ターゲット側の Manager を引き受ける。Issue #85）。引き受けに失敗しても、デプロイ先の資格情報では呼ばない
    // （呼ぶと、デプロイ先の同名ロールを書き換え、監査記録の roleArn と食い違う。Issue #27）。
    // ここは try の中なので、失敗は下の catch が「失敗」の記録（FR-5.5）とロックの扱い（FR-4.6）に載せる。

    // FR-5.1: AWS 上の現在の信頼ポリシーを読み、凍結入力を保全方式でマージする
    const current = await deps.iam.getTrustPolicy(changeRequest.roleArn);
    const merged = mergeTrustPolicy(current, frozenInputOf(changeRequest));

    if (merged.changed) {
      await deps.iam.updateTrustPolicy(changeRequest.roleArn, merged.document);
    }

    const resultMessage = merged.changed
      ? localized("apply.updated", { added: merged.added.length, removed: merged.removed.length })
      : localized("apply.alreadyApplied", {});
    // `message` は `localized` の日本語の描画。両方を保存する結果（ChangeRequest.result）に入れる。
    const outcome: ApplyOutcome = {
      ok: true,
      message: renderMessage("ja", resultMessage),
      errorCode: null,
      localized: resultMessage,
    };

    const applied = recordApplyOutcome(changeRequest, outcome, now, actor);
    // この書き込みが返った時点で「反映済み」は確定する。以後は巻き戻さない。
    await updateChangeRequestStatus(applied, guard);

    return { kind: "committed", applied, merged, message: outcome.message, localized: resultMessage };
  } catch (error) {
    const errorCode =
      error instanceof IamOperationError ? error.errorCode : "UnknownError";
    // IamOperationError は自分の文言、ほかの Error は例外の文、それ以外は定型文。`message` は `localized` の日本語の描画。
    const cause = localizedOfError(error, localized("apply.updateFailed", {}));
    const message = renderMessage("ja", cause);

    console.error(
      `[rolust] 反映に失敗しました: changeRequestId=${changeRequestId}, roleArn=${changeRequest.roleArn}`,
      error,
    );

    // FR-5.5: 失敗も結果と時刻を記録して状態「失敗」へ。
    // FR-4.6: 失敗は「未反映」に含まれるためロックは解放しない。
    const failed = recordApplyOutcome(
      changeRequest,
      { ok: false, message, errorCode, localized: cause },
      now,
      actor,
    );
    try {
      await updateChangeRequestStatus(failed, guard);
      await updateRoleLockStatus(failed.roleArn, failed.changeRequestId, "failed");
    } catch (persistError) {
      console.error(
        `[rolust] 失敗状態の記録に失敗しました: changeRequestId=${changeRequestId}`,
        persistError,
      );
    }

    return {
      kind: "failed",
      report: failureReport(changeRequestId, changeRequest.roleArn, now, errorCode, cause),
    };
  }
}

/**
 * 反映に成功した凍結入力の交点だけ baseline（`Assignment.reflected`）を追随させる。
 *
 * 凍結後にチェックされた交点（FR-5.1 シナリオ 3 の C）は触らないため、
 * 次の申請で改めて「追加される」として現れる。
 *
 * ここでの失敗は AWS への反映そのものを取り消さない。マトリクスの差分表示が
 * 古くなるだけなので、例外にはせず警告として返す（サイレント失敗にはしない）。
 */
async function syncBaseline(changeRequest: ChangeRequest, now: string): Promise<LocalizedMessage[]> {
  const updates: Promise<void>[] = [
    ...changeRequest.addUserArns.map((userArn) =>
      markReflected(changeRequest.poolId, userArn, changeRequest.roleArn, true, now),
    ),
    ...changeRequest.removeUserArns.map((userArn) =>
      markReflected(changeRequest.poolId, userArn, changeRequest.roleArn, false, now),
    ),
  ];

  const settled = await Promise.allSettled(updates);
  const failures = settled.filter((outcome) => outcome.status === "rejected");
  if (failures.length === 0) return [];

  for (const failure of failures) {
    console.error("[rolust] baseline の更新に失敗しました", failure.reason);
  }
  return [localized("apply.baselineFailed", { count: failures.length })];
}

/** すでに反映済み・破棄済みの申請の反映。状態は変えない。 */
function invalidStateReport(changeRequest: ChangeRequest, now: string): ApplyReport {
  const cause = localized("apply.invalidState", { status: changeRequest.status });
  return {
    changeRequestId: changeRequest.changeRequestId,
    roleArn: changeRequest.roleArn,
    ok: false,
    status: changeRequest.status,
    appliedAt: changeRequest.appliedAt ?? now,
    errorCode: "InvalidState",
    message: renderMessage("ja", cause),
    localized: cause,
    added: [],
    removed: [],
    warnings: [],
    localizedWarnings: [],
  };
}

/**
 * claim を取れなかった反映の報告。申請を読み直して理由を区別する（Issue #121）。
 * 先に反映・破棄されていれば `InvalidState`、まだ反映できる状態なら別の管理者が反映中（`Conflict`）。
 * どちらも ChangeRequest の記録は書かない。
 */
async function claimRefusedReport(changeRequestId: string, now: string): Promise<ApplyReport> {
  const latest = await getChangeRequest(changeRequestId, { consistent: true });
  if (!latest) {
    return failureReport(changeRequestId, "", now, "NotFound", localized("apply.notFound", {}));
  }
  if (!isApplicable(latest.status)) return invalidStateReport(latest, now);
  const cause = localized("apply.inProgressByOther", {});
  return {
    changeRequestId,
    roleArn: latest.roleArn,
    ok: false,
    status: latest.status,
    appliedAt: latest.appliedAt ?? now,
    errorCode: "Conflict",
    message: renderMessage("ja", cause),
    localized: cause,
    added: [],
    removed: [],
    warnings: [],
    localizedWarnings: [],
  };
}

function failureReport(
  changeRequestId: string,
  roleArn: string,
  now: string,
  errorCode: string,
  cause: LocalizedMessage,
): ApplyReport {
  return {
    changeRequestId,
    roleArn,
    ok: false,
    status: "failed",
    appliedAt: now,
    errorCode,
    message: renderMessage("ja", cause),
    localized: cause,
    added: [],
    removed: [],
    warnings: [],
    localizedWarnings: [],
  };
}
