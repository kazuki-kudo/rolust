import { ValidationError } from "./errors.js";
import { localized } from "./messages/types.js";
import type { AttributeColumn } from "./types.js";

/**
 * IAM ユーザの属性列（Issue #61）。
 *
 * 列定義はユーザプールごとに持ち、値は列の安定 ID（`columnId`）で持つ。名前を変えても値が残り、
 * 列を削除して同じ名前で作り直しても古い値は戻らない。規則は表示名（`pool.ts`）と同系統。
 */

/** 属性列の上限。 */
export const ATTRIBUTE_COLUMN_MAX_COUNT = 10;
/** 列名の上限。コードポイントで数える。 */
export const ATTRIBUTE_COLUMN_NAME_MAX_LENGTH = 32;
/** 値の上限。コードポイントで数える。 */
export const ATTRIBUTE_VALUE_MAX_LENGTH = 128;

/** 制御文字: Unicode の Cc（C0・DEL・C1）と行区切り（U+2028 / U+2029）。`pool.ts` と同じ範囲。 */
const CONTROL_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}]/u;
/** 見える文字: 書式文字（Cf。ゼロ幅空白など）と空白以外。 */
const VISIBLE_CHARACTER = /[^\p{Cf}\p{White_Space}]/u;

/** 保存の入力の列。`columnId` が無い列が新規。 */
export interface AttributeColumnInput {
  columnId?: string;
  name: string;
}

/**
 * 列名を正規化する。前後の空白を除く。
 *
 * @throws ValidationError 空・制御文字・見える文字が無い・32 文字超（`field: "name"`）
 */
export function normalizeColumnName(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    throw new ValidationError(localized("attribute.nameRequired", {}), "name");
  }
  if (CONTROL_CHARACTER.test(trimmed)) {
    throw new ValidationError(localized("attribute.nameControlChar", {}), "name");
  }
  if (!VISIBLE_CHARACTER.test(trimmed)) {
    throw new ValidationError(localized("attribute.nameNotVisible", {}), "name");
  }
  if ([...trimmed].length > ATTRIBUTE_COLUMN_NAME_MAX_LENGTH) {
    throw new ValidationError(
      localized("attribute.nameTooLong", { max: ATTRIBUTE_COLUMN_NAME_MAX_LENGTH }),
      "name",
    );
  }
  return trimmed;
}

/**
 * 属性の値を正規化する。前後の空白を除き、空なら `null`（未設定）を返す。
 *
 * @throws ValidationError 制御文字・見える文字が無い・128 文字超（`field: "attributes"`）
 */
export function normalizeAttributeValue(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (CONTROL_CHARACTER.test(trimmed)) {
    throw new ValidationError(localized("attribute.valueControlChar", {}), "attributes");
  }
  if (!VISIBLE_CHARACTER.test(trimmed)) {
    throw new ValidationError(localized("attribute.valueNotVisible", {}), "attributes");
  }
  if ([...trimmed].length > ATTRIBUTE_VALUE_MAX_LENGTH) {
    throw new ValidationError(
      localized("attribute.valueTooLong", { max: ATTRIBUTE_VALUE_MAX_LENGTH }),
      "attributes",
    );
  }
  return trimmed;
}

/**
 * 列定義の保存の入力（リクエスト本文の `columns`）の形を検証する。中身の規則は `normalizeColumnInputs`。
 *
 * @throws ValidationError 配列でない・要素がオブジェクトでない・`name` が文字列でない・`columnId` が文字列でない（`field: "columns"`）
 */
export function readColumnInputs(raw: unknown): AttributeColumnInput[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError(localized("attribute.columnsNotArray", {}), "columns");
  }
  return raw.map((entry: unknown) => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ValidationError(localized("attribute.columnNotObject", {}), "columns");
    }
    const { columnId, name } = entry as Record<string, unknown>;
    if (typeof name !== "string") {
      throw new ValidationError(localized("attribute.columnNameNotString", {}), "columns");
    }
    if (columnId !== undefined && typeof columnId !== "string") {
      throw new ValidationError(localized("attribute.columnIdNotString", {}), "columns");
    }
    return columnId === undefined ? { name } : { columnId, name };
  });
}

/**
 * 列定義を丸ごと置き換える入力を、保存する列定義に正規化する。
 *
 * 順序は入力のまま。`columnId` を持たない列は `newId()` で採番する（新しい列は、削除した列の ID を再利用しない）。
 *
 * @throws ValidationError 11 列以上・列名の規則違反・列名の重複・存在しない `columnId`・`columnId` の重複（`field: "columns"` か `"name"`）
 */
export function normalizeColumnInputs(
  inputs: AttributeColumnInput[],
  existing: AttributeColumn[],
  newId: () => string,
): AttributeColumn[] {
  if (inputs.length > ATTRIBUTE_COLUMN_MAX_COUNT) {
    throw new ValidationError(localized("attribute.tooManyColumns", { max: ATTRIBUTE_COLUMN_MAX_COUNT }), "columns");
  }
  const known = new Set(existing.map((column) => column.columnId));
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();

  return inputs.map((input) => {
    const name = normalizeColumnName(input.name);
    if (seenNames.has(name)) {
      throw new ValidationError(localized("attribute.duplicateColumnName", { name }), "columns");
    }
    seenNames.add(name);

    if (input.columnId !== undefined && !known.has(input.columnId)) {
      throw new ValidationError(localized("attribute.unknownColumn", { columnId: input.columnId }), "columns");
    }
    const columnId = input.columnId ?? newId();
    if (seenIds.has(columnId)) {
      throw new ValidationError(localized("attribute.duplicateColumnId", { columnId }), "columns");
    }
    seenIds.add(columnId);
    return { columnId, name };
  });
}

/**
 * 1 ユーザの属性の保存の入力を、保存する値に正規化する。空の値は落とす。
 *
 * @throws ValidationError オブジェクトでない・定義に無い `columnId`・値が文字列でない・値の規則違反（`field: "attributes"`）
 */
export function normalizeUserAttributes(
  raw: unknown,
  columns: AttributeColumn[],
): Record<string, string> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ValidationError(localized("attribute.attributesNotObject", {}), "attributes");
  }
  const known = new Set(columns.map((column) => column.columnId));
  const result: Record<string, string> = {};
  for (const [columnId, value] of Object.entries(raw)) {
    if (!known.has(columnId)) {
      throw new ValidationError(localized("attribute.unknownColumn", { columnId }), "attributes");
    }
    if (typeof value !== "string") {
      throw new ValidationError(localized("attribute.valueNotString", {}), "attributes");
    }
    const normalized = normalizeAttributeValue(value);
    if (normalized !== null) result[columnId] = normalized;
  }
  return result;
}

/**
 * 定義に無い `columnId` の値を落とす（読み取り用）。属性を持たない既存のアイテム（`undefined`）は空にする。
 */
export function pruneAttributes(
  attributes: Record<string, string> | undefined,
  columns: AttributeColumn[],
): Record<string, string> {
  if (!attributes) return {};
  const known = new Set(columns.map((column) => column.columnId));
  return Object.fromEntries(Object.entries(attributes).filter(([columnId]) => known.has(columnId)));
}
