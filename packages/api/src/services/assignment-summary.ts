import type { AssignmentSummary } from "@rolust/core";

/**
 * ロールごとの割り当ての件数（Issue #79。Issue #135 で、削除の確認に出すものとして `GET /roles` が使う）。
 * DynamoDB に触れない純粋な関数。
 */

/** 件数の計算に要る Assignment の属性。 */
export interface AssignmentFlags {
  roleArn: string;
  checked: boolean;
  reflected: boolean;
}

/**
 * roleArns のそれぞれについて、そのプールの割り当ての件数を数える。
 *
 * `total` は `checked` または `reflected` の交点の数（残骸は数えない）、`pending` はそのうち
 * `checked` と `reflected` が食い違う（削除すると失われる未反映の変更がある）交点の数。
 * 交点が無いロールも 0 件で返す。対象外のロールは含めない。
 */
export function summarizeAssignments(
  assignments: AssignmentFlags[],
  roleArns: string[],
): Map<string, AssignmentSummary> {
  const summaries = new Map<string, AssignmentSummary>(
    roleArns.map((roleArn) => [roleArn, { total: 0, pending: 0 }]),
  );
  for (const assignment of assignments) {
    const summary = summaries.get(assignment.roleArn);
    if (!summary) continue;
    if (!assignment.checked && !assignment.reflected) continue;
    summary.total += 1;
    if (assignment.checked !== assignment.reflected) summary.pending += 1;
  }
  return summaries;
}
