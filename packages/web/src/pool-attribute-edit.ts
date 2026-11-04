import type { AttributeColumn, IamUser, Locale } from "@rolust/core";
import { ValidationError, normalizeAttributeValue } from "@rolust/core";

import { localizeMessage } from "./i18n/describe.js";

/**
 * IAMユーザ画面（画面 1）の属性の編集モード（Issue #103）。
 *
 * 編集モードの下書きは、ユーザの ARN と列 ID をキーにする。保存済みの値と違うセルだけを持ち、
 * 保存済みの値に戻したら消す。表示と保存の計算だけを担い、API 呼び出しと状態は画面が持つ。
 */

/** ユーザの ARN → 列 ID → 入力中の値（未正規化。入力のまま）。 */
export type AttributeDrafts = Record<string, Record<string, string>>;

/** 1 ユーザ分の保存内容。`attributes` は定義済みの列の値だけで、保存時に丸ごと置き換える（`PUT /pool/users/attributes`）。 */
export interface UserChange {
  user: IamUser;
  attributes: Record<string, string>;
}

/**
 * 値の検証（0〜128 文字・制御文字なし）。空は未設定として正しい。
 * 文言は `locale` で描画する（省略時は日本語。言語に依らず有無だけ見る呼び出し用）。
 */
export function cellError(value: string, locale: Locale = "ja"): string | null {
  try {
    normalizeAttributeValue(value);
    return null;
  } catch (error) {
    if (error instanceof ValidationError) return localizeMessage(locale, error.message, error.localized);
    throw error;
  }
}

/** 入力欄に出す値: 下書きがあれば下書き、無ければ保存済み、それも無ければ空文字。 */
export function cellValue(user: IamUser, drafts: AttributeDrafts, columnId: string): string {
  return drafts[user.arn]?.[columnId] ?? user.attributes[columnId] ?? "";
}

/** 下書きを置く。保存済みの値と同じになったら外し、ユーザの分が空になったらユーザごと外す。 */
export function setDraft(
  drafts: AttributeDrafts,
  user: IamUser,
  columnId: string,
  value: string,
): AttributeDrafts {
  const { [user.arn]: current = {}, ...others } = drafts;
  const { [columnId]: _removed, ...rest } = current;
  const userDraft = value === (user.attributes[columnId] ?? "") ? rest : { ...rest, [columnId]: value };
  return Object.keys(userDraft).length === 0 ? others : { ...others, [user.arn]: userDraft };
}

/** 正規化した値（未設定は null）。不正な値は `undefined`。 */
function normalizedOrInvalid(value: string): string | null | undefined {
  try {
    return normalizeAttributeValue(value);
  } catch (error) {
    if (error instanceof ValidationError) return undefined;
    throw error;
  }
}

/** 保存済みの値と、正規化したときに違うか。不正な値は「変更あり」（保存は呼び出し側が止める）。 */
function isChanged(user: IamUser, columnId: string, draft: string): boolean {
  const next = normalizedOrInvalid(draft);
  if (next === undefined) return true;
  return next !== (normalizedOrInvalid(user.attributes[columnId] ?? "") ?? null);
}

/** 下書きのうち、一覧にいるユーザと定義済みの列のセルだけを（変更の有無つきで）列挙する。 */
function draftCells(
  users: readonly IamUser[],
  columns: readonly AttributeColumn[],
  drafts: AttributeDrafts,
): { user: IamUser; columnId: string; draft: string }[] {
  return users.flatMap((user) =>
    columns.flatMap(({ columnId }) => {
      const draft = drafts[user.arn]?.[columnId];
      return draft === undefined ? [] : [{ user, columnId, draft }];
    }),
  );
}

/** 変更のあったセルの数（ユーザの数ではない）。 */
export function changedCellCount(
  users: readonly IamUser[],
  columns: readonly AttributeColumn[],
  drafts: AttributeDrafts,
): number {
  return draftCells(users, columns, drafts).filter(({ user, columnId, draft }) =>
    isChanged(user, columnId, draft),
  ).length;
}

/** 不正な値の下書きが 1 つでもあるか。あれば保存しない。 */
export function hasInvalidCell(
  users: readonly IamUser[],
  columns: readonly AttributeColumn[],
  drafts: AttributeDrafts,
): boolean {
  return draftCells(users, columns, drafts).some(({ draft }) => cellError(draft) !== null);
}

/**
 * 保存するユーザと、そのユーザの属性（定義済みの列ごとに、保存済みの値へ下書きを重ねて正規化したもの）。
 * 変更のあったユーザだけを、一覧の順で返す。不正な値が含まれるときは `hasInvalidCell` で止めてから呼ぶ。
 */
export function pendingChanges(
  users: readonly IamUser[],
  columns: readonly AttributeColumn[],
  drafts: AttributeDrafts,
): UserChange[] {
  return users.flatMap((user) => {
    const changed = columns.some(({ columnId }) => {
      const draft = drafts[user.arn]?.[columnId];
      return draft !== undefined && isChanged(user, columnId, draft);
    });
    if (!changed) return [];
    const attributes = Object.fromEntries(
      columns.flatMap(({ columnId }) => {
        const value = normalizedOrInvalid(cellValue(user, drafts, columnId)) ?? null;
        return value === null ? [] : [[columnId, value]];
      }),
    );
    return [{ user, attributes }];
  });
}

/**
 * 同時に走る数を `limit` までにして `worker` を全件に掛け、結果を入力の順で返す。
 * 失敗しても残りを止めず、`rejected` で返す。
 */
export async function runWithLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const run = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index] as T) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}
