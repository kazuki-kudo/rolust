import { normalizeAwsPrincipal } from "./arn.js";
import { computeTrustPolicyDiff } from "./diff.js";
import type { TrustPolicyDocument } from "./trust-policy.js";
import type { FrozenInput } from "./types.js";
import { findUnmanagedPrincipals } from "./unmanaged.js";
import type { UnmanagedPrincipal } from "./unmanaged.js";

/**
 * 登録済みの割り当てと実際の信頼ポリシーの乖離（FR-4.9。Issue #170）。
 *
 * **乖離は、申請の差分と同じマージ（`computeTrustPolicyDiff` → `mergeTrustPolicy`）から導く。**
 * 「反映済みの割り当て（`reflected`）を、いまの信頼ポリシーへ反映したら何が変わるか」を求め、
 * マージが「追加する」ものを「足りない」、「削除する」ものを「余分」と読み替える。
 * Allow・Deny、条件つき Statement、ARN の正規化の定義が、反映・登録時の取り込み・FR-4.2 の警告と食い違わない。
 *
 * - 足りない: `reflected = true` なのに、信頼ポリシーで許可されていない管理下のユーザ。
 * - 余分: `reflected = false` なのに、信頼ポリシーで許可されている管理下のユーザ。
 * - 管理外の principal（FR-4.2）とプレースホルダ Statement は乖離に数えない。Rolust が意図して保全するもので、
 *   登録前から居たものと区別できないため。管理外は参考として `unmanaged` に出す。
 */

export interface TrustDrift {
  roleArn: string;
  /** Rolust は引き受けられると記録している（reflected）が、信頼ポリシーで許可されていない管理下のユーザ。昇順。 */
  missing: string[];
  /** Rolust は引き受けられないと記録している（reflected でない）が、信頼ポリシーで許可されている管理下のユーザ。昇順。 */
  extra: string[];
  /** FR-4.2 の管理外 principal（乖離に数えない）。基準集合は全 IamUser の ARN。 */
  unmanaged: UnmanagedPrincipal[];
}

/**
 * @param current 実際の信頼ポリシー
 * @param allUserArns 固定プールの全 IamUser の ARN（管理下の集合）
 * @param reflectedUserArns 当該ロールで `reflected = true` の IamUser の ARN。`allUserArns` に無い ARN は無視する
 *   （IamUser の登録を消した後に残る孤児の Assignment への備え）。
 */
export function computeTrustDrift(
  current: TrustPolicyDocument,
  roleArn: string,
  allUserArns: string[],
  reflectedUserArns: string[],
): TrustDrift {
  const managed = [...new Set(allUserArns.map(normalizeAwsPrincipal))];
  const managedSet = new Set(managed);
  const reflected = [...new Set(reflectedUserArns.map(normalizeAwsPrincipal))]
    .filter((arn) => managedSet.has(arn))
    .sort();
  const reflectedSet = new Set(reflected);
  const notReflected = managed.filter((arn) => !reflectedSet.has(arn)).sort();

  // 管理下の全ユーザを、追加側（reflected）と削除側（それ以外）に分けて入力にする。両方に挙がるユーザは無い
  // （マージは、同じ ARN が両側にあると例外を投げる）。プレースホルダの項目（placeholderInjected・placeholderRemoved）は使わない。
  const diff = computeTrustPolicyDiff(current, {
    roleArn,
    addUserArns: reflected,
    removeUserArns: notReflected,
  });

  return {
    roleArn,
    missing: [...diff.added].sort(),
    extra: [...diff.removed].sort(),
    unmanaged: findUnmanagedPrincipals(current, managed),
  };
}

/** 乖離があるか（足りない・余分のどちらか。管理外は数えない）。`status` の導出と操作の判定で共通に使う。 */
export function hasDrift(drift: Pick<TrustDrift, "missing" | "extra">): boolean {
  return drift.missing.length > 0 || drift.extra.length > 0;
}

/** restore（IAM を記録に合わせる）の凍結入力。足りない → 追加、余分 → 削除。管理外は入らない。 */
export function restoreInputOf(drift: TrustDrift): FrozenInput {
  return {
    roleArn: drift.roleArn,
    addUserArns: [...drift.missing].sort(),
    removeUserArns: [...drift.extra].sort(),
  };
}

/** adopt（記録を IAM に合わせる）で書く値。余分は真（IAM にいる）、足りないは偽（IAM にいない）。 */
export function adoptChangesOf(drift: TrustDrift): { checkedTrue: string[]; checkedFalse: string[] } {
  return { checkedTrue: [...drift.extra].sort(), checkedFalse: [...drift.missing].sort() };
}
