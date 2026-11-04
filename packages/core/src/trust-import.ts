import { isPathlessUserArn } from "./arn.js";
import { allowedAwsPrincipalSet } from "./principals.js";
import type { TrustPolicyDocument } from "./trust-policy.js";

/**
 * 信頼ポリシーから、Rolust の IamUser として取り込める IAM ユーザの ARN を取り出す
 * （ロールの紐づけ時の取り込み。Issue #80、spec D-6）。
 *
 * 対象は `Effect: Allow` の Statement にある、パスなしの IAM ユーザ（`isPathlessUserArn`）。
 * `Action` と `Condition` は見ない。これは、マージの規則 4（既に存在する principal は追加しない）と
 * FR-4.2 の警告の判定（どちらも `allowedAwsPrincipalSet`）と同じ定義で、3 つが食い違わないようにするため。
 * 条件付きで許可されているユーザも取り込むので、取り込んだ後にそのユーザのチェックを外して反映すると、
 * 条件付きの Statement からも削除される（マージの規則 2）。
 *
 * 取り込まないもの（管理外のまま警告される）: パス付きのユーザ、`aws` 以外の partition、削除された
 * IAM ユーザの一意 ID（`AIDA…`）、ロール・root・サービス・ワイルドカード、`Deny` の principal、
 * プレースホルダ Statement。
 *
 * @returns 重複なし・昇順の ARN
 */
export function importableUserArns(document: TrustPolicyDocument): string[] {
  return [...allowedAwsPrincipalSet(document)].filter(isPathlessUserArn).sort();
}
