import { normalizeAwsPrincipal } from "./arn.js";
import { mergeTrustPolicy } from "./merge.js";
import type { TrustPolicyDocument } from "./trust-policy.js";
import type { FrozenInput } from "./types.js";

/**
 * 差分算出（FR-4.1）。
 *
 * AWS 上の現在の信頼ポリシーと ChangeRequest の凍結入力を突き合わせ、
 * 「実際に追加される principal」と「実際に削除される principal」を ARN 単位で列挙する。
 *
 * **差分は `mergeTrustPolicy` の結果から導く。** 反映が決めることを差分側で
 * 別に判定すると、両者が食い違う余地が生まれる。とくにプレースホルダの挿入（規則 5）は
 * 「マージ後の Statement が 0 件になるか」で決まり、マージしてみないと分からない（Issue #16）。
 */

export interface TrustPolicyDiff {
  roleArn: string;
  /** 凍結入力の追加対象のうち、現在の信頼ポリシーにまだ存在しないもの。 */
  added: string[];
  /** 凍結入力の削除対象のうち、現在の信頼ポリシーに存在するもの。凍結入力の順に並ぶ。 */
  removed: string[];
  /** 追加対象だが既に存在するため、反映しても変化しないもの。 */
  alreadyPresent: string[];
  /** 削除対象だが既に存在しないため、反映しても変化しないもの。 */
  alreadyAbsent: string[];
  /** 反映によって信頼ポリシーが変化するか。 */
  changed: boolean;
  /** 反映すると、管理下の principal が 0 件になるためプレースホルダを挿入するか（規則 5）。 */
  placeholderInjected: boolean;
  /** 反映すると、追加によってプレースホルダを取り除くか（規則 6）。 */
  placeholderRemoved: boolean;
}

/** 現在の信頼ポリシーと凍結入力から差分を算出する（FR-4.1）。 */
export function computeTrustPolicyDiff(
  current: TrustPolicyDocument,
  input: FrozenInput,
): TrustPolicyDiff {
  const merged = mergeTrustPolicy(current, input);

  // マージは文書中の出現順に削除を記録する。画面には凍結入力の順で見せる。
  const removedSet = new Set(merged.removed);
  const removed = dedupe(input.removeUserArns).filter((arn) => removedSet.has(arn));

  return {
    roleArn: input.roleArn,
    added: merged.added,
    removed,
    alreadyPresent: merged.alreadyPresent,
    alreadyAbsent: merged.alreadyAbsent,
    changed: merged.changed,
    placeholderInjected: merged.placeholderInjected,
    placeholderRemoved: merged.placeholderRemoved,
  };
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.map(normalizeAwsPrincipal))];
}
