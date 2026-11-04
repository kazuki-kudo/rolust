import { normalizeAwsPrincipal } from "./arn.js";
import { ROLUST_PLACEHOLDER_SID } from "./placeholder.js";
import type { PrincipalRef } from "./principals.js";
import { listPrincipals } from "./principals.js";
import type { TrustPolicyDocument } from "./trust-policy.js";

/**
 * 管理外 principal の検出（FR-4.2）。
 *
 * **基準集合（`managedArns`）は引数で受け取る。** これが Q5=A の実装上の要である。
 *
 * | 呼び出し経路 | 基準集合 |
 * |---|---|
 * | 反映処理（`mergeTrustPolicy` 経由） | **対象 ChangeRequest の凍結入力の ARN 集合** |
 * | 警告表示（FR-4.2 / 画面 4） | **反映時点の全 IamUser の ARN 集合**（UserPool 横断） |
 *
 * 同じ関数を異なる基準集合で呼ぶことで、FR-5.2（凍結入力どおりに適用される）と
 * FR-5.1（更新前から存在した管理外 principal が全件残る）が同時に成立する。
 * 基準集合を関数内部に固定すると、削除済み IamUser を凍結入力に含む申請について
 * 「削除する」と「保全する」の両方が導かれ、どちらかの要件が必ず壊れる。
 */

export interface UnmanagedPrincipal {
  /** `AWS` / `Service` / `Federated` / `CanonicalUser` / `Wildcard`。 */
  kind: PrincipalRef["kind"];
  value: string;
  statementIndex: number;
  sid: string | null;
  effect: "Allow" | "Deny";
}

/**
 * 信頼ポリシーに含まれるが基準集合に属さない principal を列挙する。
 *
 * `AWS` 以外の種別（サービスプリンシパル、フェデレーテッド、正規ユーザ ID、
 * ワイルドカード）は基準集合が ARN の集合である以上、常に管理外になる。
 * これは意図した挙動である — Rolust はそれらを登録・編集する機能を持たない
 * （requirements.md `## Out of Scope`）。
 *
 * プレースホルダ Statement（`Sid: RolustPlaceholder`）の principal は基準集合に関わらず
 * 数えない。Rolust 自身が注入した Statement であり、管理外ではないためである（Issue #16）。
 * 数えると、プレースホルダの root が差分画面で管理外として警告される。
 *
 * @param document 判定対象の信頼ポリシー
 * @param managedArns 「Rolust 管理下」とみなす ARN の集合（呼び出し側が決める）
 */
export function findUnmanagedPrincipals(
  document: TrustPolicyDocument,
  managedArns: Iterable<string>,
): UnmanagedPrincipal[] {
  const managed = new Set<string>();
  for (const arn of managedArns) {
    managed.add(normalizeAwsPrincipal(arn));
  }

  return listPrincipals(document)
    .filter((ref) => ref.sid !== ROLUST_PLACEHOLDER_SID)
    .filter((ref) => !(ref.kind === "AWS" && managed.has(ref.value)))
    .map((ref) => ({
      kind: ref.kind,
      value: ref.value,
      statementIndex: ref.statementIndex,
      sid: ref.sid,
      effect: ref.effect,
    }));
}

/** 管理外 principal が 1 件でもあるか。 */
export function hasUnmanagedPrincipals(
  document: TrustPolicyDocument,
  managedArns: Iterable<string>,
): boolean {
  return findUnmanagedPrincipals(document, managedArns).length > 0;
}
