import type { IamUser } from "@rolust/core";

/**
 * IAMユーザ画面（画面 1）の IamUser の表の絞り込みとソート（Issue #104）。
 *
 * 表示だけの計算で、保存も API 呼び出しも無い。絞り込みはマトリクスのユーザ絞り込み
 * （`matrix-view.ts` の `userText`。Issue #106・#107）と同じ意味にする。
 */

/** ソート中の列。`columnId` は表の列 ID（`accountId`・`userName`・`attr-<columnId>`）。 */
export interface PoolSort {
  columnId: string;
  descending: boolean;
}

export interface AccountRow {
  accountId: string;
  users: IamUser[];
}

const collator = new Intl.Collator("ja");

/**
 * AWSアカウントID・ユーザ名・属性値のいずれかに、入力全体を 1 語として部分一致させる（大文字小文字を無視）。
 * 属性値は `attributeColumnIds`（現在の属性の項目）のものだけを見る。列を削除したあとの値は見えないため、一致させない。
 */
export function filterUsers(
  users: readonly IamUser[],
  text: string,
  attributeColumnIds: readonly string[],
): IamUser[] {
  const needle = text.trim().toLowerCase();
  if (needle === "") return [...users];
  return users.filter((user) =>
    [
      user.accountId,
      user.userName,
      ...attributeColumnIds.map((columnId) => user.attributes[columnId] ?? ""),
    ].some((value) => value.toLowerCase().includes(needle)),
  );
}

/** 既定の並び: AWSアカウントID、ユーザ名の昇順。 */
function byDefault(left: IamUser, right: IamUser): number {
  return left.accountId.localeCompare(right.accountId) || left.userName.localeCompare(right.userName);
}

/** 属性の値が無い（属性を持たない・空文字）。 */
function isUnset(value: string | undefined): boolean {
  return value === undefined || value === "";
}

/**
 * ソートした配列を返す（入力は書き換えない）。同順のユーザは既定の並びを保つ。
 * 属性の項目は日本語の並びで比べ、値の無いユーザは昇順でも降順でも最後に置く（マトリクスの #107 と同じ）。
 */
export function sortUsers(users: readonly IamUser[], sort: PoolSort | null): IamUser[] {
  const base = [...users].sort(byDefault);
  if (!sort) return base;

  const direction = sort.descending ? -1 : 1;
  if (sort.columnId === "accountId") {
    return base.sort((left, right) => direction * left.accountId.localeCompare(right.accountId));
  }
  if (sort.columnId === "userName") {
    return base.sort((left, right) => direction * left.userName.localeCompare(right.userName));
  }

  const attributeId = sort.columnId.replace(/^attr-/, "");
  return base.sort((left, right) => {
    const x = left.attributes[attributeId];
    const y = right.attributes[attributeId];
    if (isUnset(x) && isUnset(y)) return 0;
    if (isUnset(x)) return 1;
    if (isUnset(y)) return -1;
    return direction * collator.compare(x as string, y as string);
  });
}

/**
 * AWSアカウントID ごとにユーザを束ねる（C-5 の登録単位に合わせた表示）。行の中のユーザ名は昇順で固定し、
 * `descending` は行（AWSアカウントID）の並びだけを逆にする。
 */
export function groupByAccount(users: readonly IamUser[], descending: boolean): AccountRow[] {
  const grouped = new Map<string, IamUser[]>();
  for (const user of [...users].sort(byDefault)) {
    const bucket = grouped.get(user.accountId);
    if (bucket) bucket.push(user);
    else grouped.set(user.accountId, [user]);
  }
  const rows = [...grouped.entries()].map(([accountId, list]) => ({ accountId, users: list }));
  return descending ? rows.reverse() : rows;
}
