/**
 * 管理者の権限（Issue #141）。Cognito のグループ名から決める。
 *
 * 階層: `apply` ⊃ `edit` ⊃ `view`。複数のグループに属すときは、持っている中で最上位が効く。
 * 権限が互いを打ち消すことはない。どのグループにも属さない（または未知の名前だけ）なら `none`。
 */

export type Permission = "none" | "view" | "edit" | "apply";

/** `Route.requires` の型。`none` は「認証を通った人なら誰でも」を表す（`GET /me`）。 */
export type RequiredPermission = Permission;

export const PERMISSION_GROUPS = {
  viewer: "view",
  editor: "edit",
  applier: "apply",
} as const;

/** 画面と API が、足りない権限を利用者に伝える語。「承認」は使わない（用語は「反映」に統一）。 */
export const PERMISSION_LABELS: Record<"view" | "edit" | "apply", string> = {
  view: "参照",
  edit: "作成",
  apply: "反映",
};

const RANK: Record<Permission, number> = { none: 0, view: 1, edit: 2, apply: 3 };

const GROUP_MAX_LENGTH = 256;
const GROUPS_MAX_COUNT = 50;

export function permissionFromGroups(groups: readonly string[]): Permission {
  let best: Permission = "none";
  for (const group of groups) {
    // `__proto__` や `constructor` の名前のグループが継承したプロパティを引かないよう、自前のキーだけを見る。
    if (!Object.prototype.hasOwnProperty.call(PERMISSION_GROUPS, group)) continue;
    const permission = PERMISSION_GROUPS[group as keyof typeof PERMISSION_GROUPS];
    if (RANK[permission] > RANK[best]) best = permission;
  }
  return best;
}

export function permits(have: Permission, need: Permission): boolean {
  return RANK[have] >= RANK[need];
}

/** `x-rolust-actor` の `groups`（信頼できない入力）を読む。文字列の要素だけを残し、肥大を防ぐ。 */
export function parseGroups(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const groups: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "" || entry.length > GROUP_MAX_LENGTH) continue;
    groups.push(entry);
    if (groups.length >= GROUPS_MAX_COUNT) break;
  }
  return groups;
}
