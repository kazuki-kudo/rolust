import type { DriftResponse, TrustDriftView } from "@rolust/core";
import { computeTrustDrift, hasDrift, localized, renderMessage } from "@rolust/core";

import { IamOperationError, createIamTrustPolicyReader } from "../aws/iam-client.js";
import type { IamTrustPolicyReader } from "../aws/iam-client.js";
import { loadConfig } from "../config.js";
import { localizedOfError } from "../errors.js";
import { listAssignments } from "../repository/assignment.js";
import { listRoleLinkEntries } from "../repository/pool-role-link.js";
import { listAllUsers } from "../repository/pool.js";
import { listRoles } from "../repository/role.js";
import { sortByColumnOrder } from "./role-column-order.js";

/**
 * 登録済みの割り当てと実際の信頼ポリシーの乖離の確認（FR-4.9。Issue #170）。
 *
 * 利用者の指示で、登録済みの全ロールについて、Rolust の記録（`Assignment.reflected`）と実際の信頼ポリシーを比べる。
 * **読み取りだけ**で、保存しない（D-1）。読み取りは Diff 系統の `iam:GetRole`（別アカウントは Reader の引き受け）で、
 * 更新の関数を持たない型（`IamTrustPolicyReader`）だけを受け取る。
 *
 * ロールごとに独立して読み、1 ロールの読み取り失敗が他を止めない（D-9。`diff-service.ts` と同じ規約）。
 * 乖離の定義は `computeTrustDrift`（申請の差分と同じマージから導く）。
 */

export interface DriftServiceDeps {
  /** 信頼ポリシーを読む。更新の関数を持たない型にしてある。 */
  iam: IamTrustPolicyReader;
  /** 確認を始めた時刻の取得（テストで固定する）。 */
  now: () => Date;
}

/**
 * @param deployAccountId デプロイ先の AWS アカウント ID。既定の読み取りクライアントが、ロールのアカウントに応じて
 *   資格情報を選ぶために使う（`diff-service.ts` と同じ。Issue #85）。判定できない（`null`）と、IAM を呼ばずに読み取りエラーにする。
 */
export async function computeDriftViews(
  deployAccountId: string | null,
  deps: DriftServiceDeps = { iam: createIamTrustPolicyReader(deployAccountId), now: () => new Date() },
): Promise<DriftResponse> {
  const checkedAt = deps.now().toISOString();
  const { poolId } = loadConfig();

  const [roles, entries, users, assignments] = await Promise.all([
    listRoles(),
    listRoleLinkEntries(poolId),
    listAllUsers(),
    listAssignments(poolId),
  ]);

  const ordered = sortByColumnOrder(roles, entries);
  const allUserArns = users.map((user) => user.arn);

  const reflectedByRole = new Map<string, string[]>();
  for (const assignment of assignments) {
    if (!assignment.reflected) continue;
    const list = reflectedByRole.get(assignment.roleArn) ?? [];
    list.push(assignment.userArn);
    reflectedByRole.set(assignment.roleArn, list);
  }

  const views = await Promise.all(
    ordered.map((role) => buildView(role.arn, allUserArns, reflectedByRole.get(role.arn) ?? [], deps.iam)),
  );
  return { checkedAt, roles: views };
}

async function buildView(
  roleArn: string,
  allUserArns: string[],
  reflectedUserArns: string[],
  iam: IamTrustPolicyReader,
): Promise<TrustDriftView> {
  try {
    // どの資格情報で読むかは、読み取りクライアントが、ロールのアカウントに応じて選ぶ（Issue #85）。
    // 引き受けに失敗しても、デプロイ先の資格情報では読まない。失敗は、このロールの読み取りエラーになる。
    const current = await iam.getTrustPolicy(roleArn);
    const drift = computeTrustDrift(current, roleArn, allUserArns, reflectedUserArns);
    return {
      roleArn,
      status: hasDrift(drift) ? "drift" : "match",
      missing: drift.missing,
      extra: drift.extra,
      unmanaged: drift.unmanaged,
      readError: null,
    };
  } catch (error) {
    // `message` は `localized` の日本語の描画（`diff-service.ts` と同じ）。
    const cause = localizedOfError(error, localized("diff.readFailed", {}));
    console.error(`[rolust] 乖離の確認で信頼ポリシーの読み取りに失敗しました: roleArn=${roleArn}`, error);
    return {
      roleArn,
      status: "readError",
      missing: [],
      extra: [],
      unmanaged: [],
      readError: {
        errorCode: error instanceof IamOperationError ? error.errorCode : "UnknownError",
        message: renderMessage("ja", cause),
        localized: cause,
      },
    };
  }
}
