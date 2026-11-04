import type { LocalizedMessage } from "@rolust/core";
import { ValidationError, importableUserArns, localized, parseRoleArn, parseUserArn } from "@rolust/core";

import { IamOperationError } from "../aws/iam-client.js";
import type { IamTrustPolicyReader } from "../aws/iam-client.js";
import { loadConfig } from "../config.js";
import { ApiError } from "../errors.js";
import { putReflectedAssignment } from "../repository/assignment.js";
import { addUserIfAbsent } from "../repository/pool.js";

/**
 * ロールの紐づけ時の、信頼ポリシーからの IAM ユーザの取り込み（Issue #80。spec 3.4）。
 *
 * 読み取り（`readImportPlans`）と書き込み（`writeImport`）を分けるのは、書き込みの前に、足すロールの信頼ポリシーを
 * すべて読み、1 件でも読めなければ何も書かずに拒否するため（D-9。FR-1.7 の慣行）。
 *
 * 読み取りは CRUD 系統の `iam:GetRole`（タグ条件つき）で行う（D-11・D-12）。FR-5.7 の例外である
 * （`requirements.md` FR-5.7 の注記）。IAM ユーザ／ロールの一覧取得は行わない。
 *
 * **別アカウントのロールも、同じように読んで取り込む**（Issue #85。#79・#80 の spec の D-10「読まずに紐づける」を覆す）。
 * どの資格情報で読むかは、読み取りクライアント（`iam-client.ts`）が、ロールのアカウントに応じて選ぶ:
 * 別アカウントのロールは、ターゲット側の Reader を引き受けて読む。引き受けに失敗しても、デプロイ先の資格情報では読まない。
 */

/**
 * 信頼ポリシーを読めなかった。**入力の誤りではない**ため 400 では返さない（ロールが存在しない場合を除く）。
 * 直すのは、ロールのタグか、デプロイ側の権限である。
 */
export class TrustPolicyUnavailableError extends ApiError {
  constructor(message: LocalizedMessage, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(502, "TrustPolicyUnavailable", message, options);
  }
}

/** 1 ロールの取り込みの計画。 */
export interface ImportPlan {
  roleArn: string;
  /** 取り込む IAM ユーザの ARN（重複なし・昇順）。 */
  userArns: string[];
}

/**
 * 足すロールの信頼ポリシーを読み、取り込む IAM ユーザを決める。並列に読み、1 件でも失敗すれば全体が失敗する。
 *
 * どの資格情報で読むかは、読み取りクライアント（`iam`）が、ロールのアカウントに応じて選ぶ。デプロイ先を判定できない
 * （`null`）ときは、クライアントが IAM を呼ばずに止め、ここで 502 に変える（`DeployAccountUnknown`）。
 */
export async function readImportPlans(roleArns: string[], iam: IamTrustPolicyReader): Promise<ImportPlan[]> {
  return await Promise.all(roleArns.map((roleArn) => readImportPlan(roleArn, iam)));
}

async function readImportPlan(roleArn: string, iam: IamTrustPolicyReader): Promise<ImportPlan> {
  try {
    const document = await iam.getTrustPolicy(roleArn);
    return { roleArn, userArns: importableUserArns(document) };
  } catch (error) {
    if (!(error instanceof IamOperationError)) throw error;
    throw toReadFailure(roleArn, error);
  }
}

/** 読み取りの失敗を、GI-6 の文言（AWS のコードをそのまま出す）の API エラーにする。 */
function toReadFailure(roleArn: string, error: IamOperationError): Error {
  // アカウント ID を入れる: デプロイ先に同名のロールがあっても、どのアカウントのロールかを取り違えない（spec D-10）。
  const { roleName, accountId } = parseRoleArn(roleArn);
  const { errorCode } = error;

  switch (error.kind) {
    case "not-found":
      return new ValidationError(localized("import.roleNotInAws", { roleName, accountId, errorCode }), "roleArns");
    case "access-denied": {
      const { managedTagKey, managedTagValue } = loadConfig();
      return new TrustPolicyUnavailableError(
        localized("import.readDenied", { roleName, accountId, errorCode, managedTagKey, managedTagValue }),
        { cause: error },
      );
    }
    case "assume-role":
      // IAM を呼ぶ前の失敗（ターゲット側のロールを引き受けられなかった）。文言は、原因と直し方を含む
      // （`iam-client.ts`）ので、内側の localized をそのまま返す。
      return new TrustPolicyUnavailableError(error.localized, { cause: error });
    case "throttling":
      return new TrustPolicyUnavailableError(localized("import.readThrottled", { roleName, accountId, errorCode }), {
        retryable: true,
        cause: error,
      });
    default:
      // 内側の失敗（AWS の文、または iam.emptyPolicy などの定型文）を、そのまま入れ子で運ぶ。
      return new TrustPolicyUnavailableError(
        localized("import.readFailed", { roleName, accountId, errorCode, cause: error.localized }),
        { cause: error },
      );
  }
}

export interface ImportWriteResult {
  /** 取り込み対象だった IAM ユーザの数。 */
  userCount: number;
  /** そのうち、当該プールに新しく登録した数。 */
  registeredCount: number;
  /** 許可リスト（Issue #139）に無いアカウントのため、登録も割り当ても書かなかった未登録ユーザの数。 */
  skippedCount: number;
}

/**
 * 1 ロール分の取り込みを書く: 各ユーザについて、未登録なら IamUser（条件付き Put）→ 交点（`checked = reflected = true`）。
 *
 * 紐づけは書かない（呼び出し側が、この後の最後に書く。途中で失敗したら、紐づけは無いまま残る）。
 * 何度実行しても同じ結果になる（IamUser は条件付き Put、交点は同じ値の Put）ので、再保存で続きから直る。
 *
 * @param registered 当該プールに登録済みの IamUser の ARN。登録したユーザをここへ足すので、同じ保存で複数のロールを
 *   取り込むときは、同じ集合を渡し続ける（同じユーザを 2 回登録しない）。
 * @param allowedAccountIds 登録を許可するアカウント ID（Issue #139）。**未登録の**ユーザのうち、ここに無いアカウントの
 *   ものは、登録も割り当てもせず飛ばす（信頼ポリシーには管理外の principal として残り、保全方式で保たれる）。
 *   すでに登録済みのユーザには適用しない（後から許可リストを外れても、既存の登録は変えない）。
 */
export async function writeImport(
  poolId: string,
  plan: ImportPlan,
  registered: Set<string>,
  now: string,
  allowedAccountIds: ReadonlySet<string>,
): Promise<ImportWriteResult> {
  let registeredCount = 0;
  let skippedCount = 0;
  for (const userArn of plan.userArns) {
    if (!registered.has(userArn)) {
      const { accountId, userName } = parseUserArn(userArn);
      if (!allowedAccountIds.has(accountId)) {
        skippedCount += 1;
        console.warn(
          `[rolust] 許可リストに無いアカウントの IAM ユーザを、取り込まずに飛ばしました: ${userArn}（ロール ${plan.roleArn}）`,
        );
        continue;
      }
      if (await addUserIfAbsent(poolId, accountId, userName, now)) registeredCount += 1;
      registered.add(userArn);
    }
    await putReflectedAssignment(poolId, userArn, plan.roleArn, now);
  }
  return { userCount: plan.userArns.length, registeredCount, skippedCount };
}
