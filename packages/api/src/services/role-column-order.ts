import type { RoleLinkEntry } from "../repository/pool-role-link.js";

/**
 * ロールをマトリクスの列順（紐づけの `position` 順）に並べる（FR-2.6）。
 *
 * 紐づけを持たない登録済みのロールは末尾に、与えられた順（`listRoles` の順: アカウント ID → ロール名）のまま置く
 * （`Array.prototype.sort` は安定）。`GET /roles` と乖離の確認（`GET /drift`）が同じ順で返すために 1 か所にする。
 *
 * @param entries 列順に整列済みの紐づけ（`listRoleLinkEntries` の戻り値）
 */
export function sortByColumnOrder<T extends { arn: string }>(roles: T[], entries: RoleLinkEntry[]): T[] {
  const rank = new Map(entries.map((entry, index) => [entry.roleArn, index] as const));
  return [...roles].sort((left, right) => (rank.get(left.arn) ?? Infinity) - (rank.get(right.arn) ?? Infinity));
}
