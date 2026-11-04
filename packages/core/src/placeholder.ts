import type { TrustPolicyStatement } from "./trust-policy.js";

/**
 * プレースホルダ Statement — 「Rolust 管理下の principal が 1 件も無い」ことを表す。
 *
 * IAM の信頼ポリシーは「空」を表現できない（`Statement: []` は `MalformedPolicyDocument`）。
 * そのため最後の管理下 principal を削除して Statement が 0 件になるとき、`mergeTrustPolicy` が
 * これを注入する（規則 5）。追加が反映された時点で役目を終えるため取り除く（規則 6。Issue #16）。
 *
 * **識別は Sid だけで行う。** Principal や Condition が手で書き換えられていても、Sid が一致すれば
 * Rolust 自身の Statement とみなす。したがって管理外 principal には数えず（`unmanaged.ts`）、
 * 保全の対象にもしない（`merge.ts`）。
 */

/** 誰も引き受けられない状態を表すプレースホルダ Statement の Sid。 */
export const ROLUST_PLACEHOLDER_SID = "RolustPlaceholder";

/**
 * 恒久的に偽となる条件。`aws:CurrentTime` が 1970-01-01 より前になることはない。
 *
 * `Effect: Deny` でこれを表現してはならない — 明示的 Deny は後から Rolust が追加する
 * Allow に勝つため、ロールが恒久的に引き受け不能になる。Allow + 偽の条件であれば
 * 後続の Allow を阻害しない。
 */
const NEVER_CONDITION = {
  DateLessThan: { "aws:CurrentTime": "1970-01-01T00:00:00Z" },
} as const;

/**
 * 「誰も引き受けられない」を表す、構文上妥当な最小の Statement を組み立てる。
 *
 * principal にアカウント root を使うのは、IAM が書き込み時に `Principal.AWS` の
 * 実在を検証するため。root は常に実在する唯一の選択肢である。条件が恒久的に偽なので
 * root に権限を与えることにはならない。
 */
export function buildPlaceholderStatement(accountId: string): TrustPolicyStatement {
  return {
    Sid: ROLUST_PLACEHOLDER_SID,
    Effect: "Allow",
    Principal: { AWS: `arn:aws:iam::${accountId}:root` },
    Action: "sts:AssumeRole",
    Condition: { ...NEVER_CONDITION },
  };
}

/** Rolust が注入したプレースホルダか（Sid だけで判定する）。 */
export function isPlaceholderStatement(statement: TrustPolicyStatement): boolean {
  return statement.Sid === ROLUST_PLACEHOLDER_SID;
}
