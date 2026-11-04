import type { DiffView } from "@rolust/core";
import { computeTrustPolicyDiff, findUnmanagedPrincipals, frozenInputOf, localized, renderMessage } from "@rolust/core";

import { IamOperationError, createIamTrustPolicyReader } from "../aws/iam-client.js";
import type { IamTrustPolicyReader } from "../aws/iam-client.js";
import { localizedOfError } from "../errors.js";
import { listAllUsers } from "../repository/pool.js";
import { getChangeRequest } from "../repository/change-request.js";

/**
 * 差分確認（FR-4.1 / FR-4.2 / 画面 4）。
 *
 * **管理外 principal の判定基準は「反映時点の全 IamUser の ARN 集合」**（UserPool 横断）。
 * 反映処理（`apply-service`）が凍結入力を基準にするのと異なる。
 * 警告は表示のみで反映を妨げない（FR-4.2 / Q22）ため、基準が異なっても矛盾しない。
 * 詳細は `code-generation-questions.md` 質問 5 の確定事項。
 */

export type { DiffView };

export interface DiffServiceDeps {
  /** 信頼ポリシーを読む。Diff の実行ロールは読み取り専用なので、更新の関数を持たない型にしてある。 */
  iam: IamTrustPolicyReader;
}

/**
 * 指定された ChangeRequest 群について差分を算出する。
 *
 * カードごとに独立して読み込み、1 件の失敗が他を止めない（interaction-spec.md FR-7.4）。
 *
 * @param deployAccountId デプロイ先の AWS アカウント ID（API Gateway の `requestContext.accountId`）。既定の読み取り
 *   クライアントが、ロールのアカウントに応じて資格情報を選ぶために使う（別アカウントのロールは、ターゲット側の Reader を
 *   引き受けて読む。Issue #85）。判定できない（`null`）と、IAM を呼ばずに読み取りエラーにする。
 */
export async function computeDiffViews(
  changeRequestIds: string[],
  deployAccountId: string | null,
  deps: DiffServiceDeps = { iam: createIamTrustPolicyReader(deployAccountId) },
): Promise<DiffView[]> {
  if (changeRequestIds.length === 0) return [];

  // FR-4.2 の基準集合 — 反映時点の全 IamUser（UserPool 横断の和集合）
  const managedArns = (await listAllUsers()).map((user) => user.arn);

  const settled = await Promise.allSettled(
    changeRequestIds.map((id) => buildDiffView(id, managedArns, deps)),
  );

  const views: DiffView[] = [];
  for (const [index, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") {
      if (outcome.value) views.push(outcome.value);
      continue;
    }
    // ここに来るのは ChangeRequest の読み出し自体が失敗した場合。握り潰さず記録する。
    console.error(
      `[rolust] 差分の算出に失敗しました: changeRequestId=${changeRequestIds[index]}`,
      outcome.reason,
    );
  }
  return views;
}

async function buildDiffView(
  changeRequestId: string,
  managedArns: string[],
  deps: DiffServiceDeps,
): Promise<DiffView | null> {
  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) return null;

  try {
    // どの資格情報で読むかは、読み取りクライアントが、ロールのアカウントに応じて選ぶ（Issue #85）。
    // 引き受けに失敗しても、デプロイ先の資格情報では読まない（Issue #27 の再発防止）。失敗は、このカードの読み取りエラーになる。
    const current = await deps.iam.getTrustPolicy(changeRequest.roleArn);
    return {
      changeRequest,
      diff: computeTrustPolicyDiff(current, frozenInputOf(changeRequest)),
      unmanaged: findUnmanagedPrincipals(current, managedArns),
      readError: null,
    };
  } catch (error) {
    // `message` は `localized` の日本語の描画（IamOperationError は自分の文言、ほかの Error は例外の文）。
    const cause = localizedOfError(error, localized("diff.readFailed", {}));
    const failure = {
      errorCode: error instanceof IamOperationError ? error.errorCode : "UnknownError",
      message: renderMessage("ja", cause),
      localized: cause,
    };
    console.error(
      `[rolust] 信頼ポリシーの読み取りに失敗しました: roleArn=${changeRequest.roleArn}`,
      error,
    );
    return { changeRequest, diff: null, unmanaged: [], readError: failure };
  }
}
