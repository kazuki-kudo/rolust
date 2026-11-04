import { ValidationError } from "./errors.js";
import { localized } from "./messages/types.js";

/**
 * IAM ロールの説明（Issue #21）。
 *
 * `pool.ts` の表示名と同じ理由（一覧の列・マトリクス列ヘッダの短い注記）で
 * 単一行のみを許す。上限だけを 256 文字（Issue の提案）にする。
 */

/** 説明の上限（Issue #21 の「256 文字程度」）。コードポイントで数える。 */
export const ROLE_DESCRIPTION_MAX_LENGTH = 256;

/**
 * 説明を正規化する。前後の空白を除き、空なら `null`（未設定）を返す。
 *
 * @throws ValidationError 制御文字を含む、見える文字が無い、または上限を超える（`field: "description"`）
 */
export function normalizeRoleDescription(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (CONTROL_CHARACTER.test(trimmed)) {
    throw new ValidationError(localized("role.descriptionControlChar", {}), "description");
  }
  if (!VISIBLE_CHARACTER.test(trimmed)) {
    throw new ValidationError(localized("role.descriptionNotVisible", {}), "description");
  }
  if ([...trimmed].length > ROLE_DESCRIPTION_MAX_LENGTH) {
    throw new ValidationError(
      localized("role.descriptionTooLong", { max: ROLE_DESCRIPTION_MAX_LENGTH }),
      "description",
    );
  }
  return trimmed;
}

/** 制御文字: Unicode の Cc（C0・DEL・C1）と行区切り（U+2028 / U+2029）。`pool.ts` と同じ範囲。 */
const CONTROL_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}]/u;

/** 見える文字: 書式文字（Cf。ゼロ幅空白など）と空白以外。 */
const VISIBLE_CHARACTER = /[^\p{Cf}\p{White_Space}]/u;

/**
 * IAM ロールの表示名（Issue #150）。
 *
 * マトリクスの列の名前に使うため、説明と同じ単一行・同じ制御文字の規則にし、上限だけを 32 文字にする
 * （日本語は全角で、列ヘッダの幅に収まる長さ）。重複の検査は登録済みの一覧が要るので、service で行う。
 */

/** 表示名の上限（Issue #150 の決定 D-3）。コードポイントで数える。 */
export const ROLE_DISPLAY_NAME_MAX_LENGTH = 32;

/**
 * 表示名を正規化する。前後の空白を除き、空なら `null`（未設定）を返す。
 *
 * @throws ValidationError 制御文字を含む、見える文字が無い、または上限を超える（`field: "displayName"`）
 */
export function normalizeRoleDisplayName(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  if (CONTROL_CHARACTER.test(trimmed)) {
    throw new ValidationError(localized("role.displayNameControlChar", {}), "displayName");
  }
  if (!VISIBLE_CHARACTER.test(trimmed)) {
    throw new ValidationError(localized("role.displayNameNotVisible", {}), "displayName");
  }
  if ([...trimmed].length > ROLE_DISPLAY_NAME_MAX_LENGTH) {
    throw new ValidationError(
      localized("role.displayNameTooLong", { max: ROLE_DISPLAY_NAME_MAX_LENGTH }),
      "displayName",
    );
  }
  return trimmed;
}
