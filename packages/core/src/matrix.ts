import type { Assignment, FrozenInput } from "./types.js";

/**
 * マトリクスの変更集合から凍結入力を組み立てる（FR-4.4 / FR-4.5）。
 *
 * `Assignment.checked`（あるべき状態）と `Assignment.reflected`（最後に反映された状態）が
 * 食い違う交点が「この申請で変更される点」である。
 * この算出は API と UI の双方が行うため（UI は列ヘッダの変更件数、API は凍結入力）、
 * 二重の情報源にならないよう core に置く。
 */

export interface RoleChangeSet {
  roleArn: string;
  addUserArns: string[];
  removeUserArns: string[];
}

/** ロール単位の変更件数（`AssignmentMatrix` の列ヘッダに出す導出値）。 */
export function countChangesByRole(assignments: Assignment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const assignment of assignments) {
    if (assignment.checked === assignment.reflected) continue;
    counts.set(assignment.roleArn, (counts.get(assignment.roleArn) ?? 0) + 1);
  }
  return counts;
}

/** 変更のあるロールの ARN（列ヘッダの自動プリセレクト対象。DF-4）。 */
export function changedRoleArns(assignments: Assignment[]): string[] {
  return [...countChangesByRole(assignments).keys()];
}

/** 指定ロールについて、現在の Assignment から凍結すべき入力を算出する。 */
export function buildFrozenInput(
  roleArn: string,
  assignments: Assignment[],
): FrozenInput {
  const addUserArns: string[] = [];
  const removeUserArns: string[] = [];

  for (const assignment of assignments) {
    if (assignment.roleArn !== roleArn) continue;
    if (assignment.checked === assignment.reflected) continue;
    if (assignment.checked) {
      addUserArns.push(assignment.userArn);
    } else {
      removeUserArns.push(assignment.userArn);
    }
  }

  return {
    roleArn,
    addUserArns: addUserArns.sort(),
    removeUserArns: removeUserArns.sort(),
  };
}

/** 凍結入力が空（追加も削除もない）か。空の申請は作らない（FR-4.4 の設計上の帰結）。 */
export function isEmptyInput(input: FrozenInput): boolean {
  return input.addUserArns.length === 0 && input.removeUserArns.length === 0;
}
