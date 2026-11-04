import type { Actor, ChangeRequest, RepairFailure, RepairResponse, TrustDrift } from "@rolust/core";
import { adoptChangesOf, computeTrustDrift, hasDrift, localized, renderMessage, restoreInputOf } from "@rolust/core";

import { IamOperationError, createIamTrustPolicyReader } from "../aws/iam-client.js";
import type { IamTrustPolicyReader } from "../aws/iam-client.js";
import { loadConfig } from "../config.js";
import { ApiError, awsErrorDetail, localizedOfError } from "../errors.js";
import { listAssignments, setAssignmentState } from "../repository/assignment.js";
import { acquireRoleLock, compensateRoleLock, getRoleLock, putChangeRequest } from "../repository/change-request.js";
import { listAllUsers } from "../repository/pool.js";
import { requireRole } from "../repository/role.js";
import { newChangeRequestId } from "./change-request-service.js";

/**
 * 乖離を直す操作（FR-4.10・FR-4.11。Issue #172）。
 *
 * - `restoreDrift`: IAM を記録（`reflected`）に合わせる下書きの申請（種別 `restore`）を作る。反映は既存の差分確認・反映が行う。
 * - `adoptDrift`: 記録を IAM の現状に合わせる。AWS へは書かない。
 *
 * どちらも、操作の時点で IAM を読み直して乖離を再計算する（画面の確認結果は使わない。D-5）。
 * **IAM の書き込みは呼ばない**（`IamTrustPolicyReader` だけを受け取る）。管理外の principal には触れない。
 */

export interface RepairDeps {
  /** 信頼ポリシーを読む。更新の関数を持たない型にしてある。 */
  iam: IamTrustPolicyReader;
}

const NO_DRIFT: RepairResponse = { outcome: "no-drift", changeRequest: null, exclusion: null, failures: [] };

/** ロールの登録を確かめ、いまの信頼ポリシーと記録から乖離を求める。IAM を読めなければ、コードつきの失敗にして何も書かない。 */
export async function loadDrift(
  roleArn: string,
  iam: IamTrustPolicyReader,
): Promise<{ drift: TrustDrift; poolId: string }> {
  await requireRole(roleArn);
  const { poolId } = loadConfig();
  const [users, assignments] = await Promise.all([listAllUsers(), listAssignments(poolId)]);

  let current;
  try {
    current = await iam.getTrustPolicy(roleArn);
  } catch (error) {
    // 読み取り失敗は、確認（GET /drift）と同じ文言・コードで返す（GI-6）。何も書かない。
    console.error(`[rolust] 乖離の修復で信頼ポリシーの読み取りに失敗しました: roleArn=${roleArn}`, error);
    throw new ApiError(
      502,
      error instanceof IamOperationError ? error.errorCode : "UnknownError",
      localizedOfError(error, localized("diff.readFailed", {})),
      { retryable: error instanceof IamOperationError ? error.retryable : false, cause: error },
    );
  }

  const reflected = assignments
    .filter((assignment) => assignment.roleArn === roleArn && assignment.reflected)
    .map((assignment) => assignment.userArn);
  const drift = computeTrustDrift(current, roleArn, users.map((user) => user.arn), reflected);
  return { drift, poolId };
}

/** 乖離を入力にした下書きの申請を作る（種別 `restore`）。未反映の申請があるロールでは作らず、理由を返す（FR-4.6）。 */
export async function restoreDrift(
  roleArn: string,
  now: string,
  actor: Actor | null,
  deployAccountId: string | null,
  deps: RepairDeps = { iam: createIamTrustPolicyReader(deployAccountId) },
): Promise<RepairResponse> {
  const { drift, poolId } = await loadDrift(roleArn, deps.iam);
  if (!hasDrift(drift)) return NO_DRIFT;

  const input = restoreInputOf(drift);
  const changeRequestId = newChangeRequestId();
  const lock = await acquireRoleLock(roleArn, changeRequestId, "draft", now);
  if (!lock.acquired) {
    return {
      outcome: "excluded",
      changeRequest: null,
      // ロックが読めなかった場合も除外は維持する（安全側。`createChangeRequests` と同じ）。
      exclusion: {
        reason: lock.existing?.status === "failed" ? "failed" : "draft",
        changeRequestId: lock.existing?.changeRequestId ?? null,
      },
      failures: [],
    };
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
    kind: "restore",
  };
  try {
    await putChangeRequest(changeRequest);
  } catch (error) {
    // 本体の書き込みに失敗したらロックを補償削除する（既存の作成と同じ）。
    await compensateRoleLock(roleArn, changeRequestId);
    console.error(`[rolust] 乖離の修復の申請を保存できませんでした: roleArn=${roleArn}`, error);
    throw error;
  }
  return { outcome: "created", changeRequest, exclusion: null, failures: [] };
}

/**
 * 記録を IAM の現状に合わせる（種別 `adopt`）。**AWS へは書かない**（FR-3.2）。
 *
 * 未反映の申請（下書き・失敗）があるロールでは拒否する（D-12。下書きの `restore` が残ったまま記録を変えると、
 * あとで反映したときに `reflected` が食い違う）。書く順序は D-13: 監査（反映済みの ChangeRequest）→ 交点。
 * 交点は絶対値の書き込みで、ユーザごとに独立して書き、失敗は集めて返す。再実行は乖離を再計算して残りを直す。
 */
export async function adoptDrift(
  roleArn: string,
  now: string,
  actor: Actor | null,
  deployAccountId: string | null,
  deps: RepairDeps = { iam: createIamTrustPolicyReader(deployAccountId) },
): Promise<RepairResponse> {
  await requireRole(roleArn);
  // IAM を読む前に判定する（拒否するのに読まない）。
  const lock = await getRoleLock(roleArn);
  if (lock !== null) {
    return {
      outcome: "excluded",
      changeRequest: null,
      exclusion: { reason: lock.status === "failed" ? "failed" : "draft", changeRequestId: lock.changeRequestId },
      failures: [],
    };
  }

  const { drift, poolId } = await loadDrift(roleArn, deps.iam);
  if (!hasDrift(drift)) return NO_DRIFT;

  const { checkedTrue, checkedFalse } = adoptChangesOf(drift);
  const message = localized("driftRepair.adopted", { added: checkedTrue.length, removed: checkedFalse.length });
  const audit: ChangeRequest = {
    changeRequestId: newChangeRequestId(),
    poolId,
    roleArn,
    addUserArns: checkedTrue,
    removeUserArns: checkedFalse,
    status: "applied",
    createdAt: now,
    createdBy: actor,
    appliedAt: now,
    appliedBy: actor,
    result: { ok: true, message: renderMessage("ja", message), errorCode: null, localized: message },
    kind: "adopt",
  };
  // 監査を先に書く（D-13）。失敗したら交点は書かない。
  await putChangeRequest(audit);

  const targets = [
    ...checkedTrue.map((userArn) => ({ userArn, state: true })),
    ...checkedFalse.map((userArn) => ({ userArn, state: false })),
  ];
  const settled = await Promise.allSettled(
    targets.map((target) => setAssignmentState(poolId, target.userArn, roleArn, target.state, now)),
  );
  const failures: RepairFailure[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") return;
    const userArn = (targets[index] as { userArn: string }).userArn;
    console.error(`[rolust] 記録の更新に失敗しました: roleArn=${roleArn}, userArn=${userArn}`, outcome.reason);
    const cause = localized("driftRepair.cellFailed", { userArn, detail: awsErrorDetail(outcome.reason) });
    failures.push({ userArn, message: renderMessage("ja", cause), localized: cause });
  });

  return { outcome: "adopted", changeRequest: audit, exclusion: null, failures };
}
