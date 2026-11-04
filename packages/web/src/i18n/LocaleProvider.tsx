import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { I18nProvider } from "@cloudscape-design/components/i18n";
import cloudscapeEn from "@cloudscape-design/components/i18n/messages/all.en";
import cloudscapeJa from "@cloudscape-design/components/i18n/messages/all.ja";
import type { Locale } from "@rolust/core";

import { detectLocale, getBrowserStorage, readStoredLocale, saveLocale } from "./locale.js";
import { en } from "./messages/en.js";
import { ja, type Messages } from "./messages/ja.js";

interface LocaleContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Messages;
}

/** 既定は日本語。Provider なしで描画する既存のテストを変えないため（本番は `main.tsx` が必ず包む）。 */
const LocaleContext = createContext<LocaleContextValue>({
  locale: "ja",
  setLocale: () => undefined,
  t: ja,
});

/** ブラウザの言語の優先順。`languages` が空・無いときは `language` に退く（どちらも無ければ空）。 */
function browserLanguages(): readonly string[] {
  if (typeof navigator === "undefined") return [];
  if (Array.isArray(navigator.languages) && navigator.languages.length > 0) return navigator.languages;
  return typeof navigator.language === "string" && navigator.language !== "" ? [navigator.language] : [];
}

export interface LocaleProviderProps {
  /** テスト用。省略すると、保存した言語、なければブラウザの言語で決める。 */
  initialLocale?: Locale;
  /** テスト用。`null` は保存しない。省略するとブラウザの localStorage。 */
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  children: React.ReactNode;
}

export function LocaleProvider({ initialLocale, storage, children }: LocaleProviderProps): React.JSX.Element {
  const store = storage === undefined ? getBrowserStorage() : storage;
  const [locale, setLocaleState] = useState<Locale>(
    () =>
      initialLocale ??
      detectLocale({
        stored: readStoredLocale(store),
        languages: browserLanguages(),
      }),
  );
  const t = locale === "ja" ? ja : en;

  const setLocale = useCallback(
    (next: Locale): void => {
      setLocaleState(next);
      saveLocale(store, next);
    },
    [store],
  );

  // 言語が変わったら、<html lang> とタブの題名も合わせる（スクリーンリーダーと翻訳機能のため）。
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.app.documentTitle;
  }, [locale, t]);

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return (
    <LocaleContext.Provider value={value}>
      <I18nProvider locale={locale} messages={[locale === "ja" ? cloudscapeJa : cloudscapeEn]}>
        {children}
      </I18nProvider>
    </LocaleContext.Provider>
  );
}

export function useT(): Messages {
  return useContext(LocaleContext).t;
}

export function useLocale(): { locale: Locale; setLocale: (locale: Locale) => void } {
  const { locale, setLocale } = useContext(LocaleContext);
  return { locale, setLocale };
}
