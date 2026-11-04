import { randomUUID } from "node:crypto";

import type { SaveAttributeColumnsResponse } from "@rolust/core";
import { normalizeColumnInputs, readColumnInputs } from "@rolust/core";

import { requirePool, updateAttributeColumns } from "../repository/pool.js";

/**
 * ユーザプールの属性列の定義の保存（Issue #61。アクセスパターン 23）。
 *
 * 定義を丸ごと置き換える。**IamUser のアイテムには触れない** — 列を削除しても値は書き換えず、
 * 読み取りが定義に無い `columnId` の値を捨てる（spec D-6）。AWS へは問い合わせない。
 * プールが無ければ `requirePool` が、読んだ後に削除されていれば `updateAttributeColumns` の条件付き更新が
 * `NotFoundError`（404）を投げる。
 *
 * @param newId 新しい列の ID の採番。テストで差し替える。
 */
export async function savePoolAttributeColumns(
  poolId: string,
  rawColumns: unknown,
  newId: () => string = randomUUID,
): Promise<SaveAttributeColumnsResponse> {
  const pool = await requirePool(poolId);
  const columns = normalizeColumnInputs(readColumnInputs(rawColumns), pool.attributeColumns, newId);
  await updateAttributeColumns(poolId, columns);
  return { columns };
}
