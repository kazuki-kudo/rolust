import type { Locale } from "@rolust/core";

/** 言語の保存先（localStorage）。サーバ側の利用者設定は持たない（Issue #94 決定 3）。 */
export const LOCALE_STORAGE_KEY = "rolust.locale";

export function isLocale(value: unknown): value is Locale {
  return value === "ja" || value === "en";
}

/**
 * 保存した言語があればそれに、なければブラウザの言語に従う。
 * ブラウザの言語は先頭だけを見る: `ja` または `ja-*` なら日本語、それ以外は英語。
 */
export function detectLocale(input: { stored: string | null; languages: readonly string[] }): Locale {
  if (isLocale(input.stored)) return input.stored;
  const first = (input.languages[0] ?? "").toLowerCase();
  return first === "ja" || first.startsWith("ja-") ? "ja" : "en";
}

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem">;

/** 読めなくても（ブロック・無効）落とさない。 */
export function readStoredLocale(storage: ReadableStorage | null): string | null {
  try {
    return storage?.getItem(LOCALE_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/** 書けなくても動作は止めない（その場の切り替えは効き、保存だけが効かない）。 */
export function saveLocale(storage: WritableStorage | null, locale: Locale): void {
  try {
    storage?.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // 保存できなくても、画面の言語は切り替わる。
  }
}

export function getBrowserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}
