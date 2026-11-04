import { errorMessagesEn } from "./en.js";
import { errorMessagesJa } from "./ja.js";
import type { ErrorMessageId, Locale, LocalizedMessage, Render } from "./types.js";

type AnyRenderer = (params: unknown, render: Render) => string;

function catalogOf(locale: Locale): Record<string, AnyRenderer> {
  return (locale === "ja" ? errorMessagesJa : errorMessagesEn) as unknown as Record<string, AnyRenderer>;
}

/**
 * 文言を描画する。知らない ID は `null`（新しい API の ID を古い SPA が受けた場合に、`message` へ戻れるように）。
 * 引数が壊れていて描画が例外になる場合・文字列にならない場合も `null` を返し、画面を落とさない。
 */
export function tryRenderMessage(locale: Locale, message: LocalizedMessage): string | null {
  // 通信で受けた壊れた値（null・id が文字列でない）でも例外にしない。
  if (typeof message !== "object" || message === null || typeof message.id !== "string") return null;
  const catalog = catalogOf(locale);
  // `toString` など継承したプロパティを ID として引かない。
  if (!Object.hasOwn(catalog, message.id)) return null;
  // 入れ子の文が描画できないとき、空文字で埋めると外側の文に黙って空欄ができる。例外にして外側ごと失敗させる
  // （外側の呼び出しの try が受けて null にする）。
  const render: Render = (inner) => {
    const rendered = tryRenderMessage(locale, inner);
    if (rendered === null) throw new Error(`入れ子の文言を描画できません: ${String((inner as { id?: unknown }).id)}`);
    return rendered;
  };
  try {
    const rendered: unknown = (catalog[message.id] as AnyRenderer)(message.params, render);
    return typeof rendered === "string" ? rendered : null;
  } catch {
    return null;
  }
}

/** サーバ側の描画（`message` への日本語の詰め込み）。知らない ID・壊れた引数は、書いた側の誤りなので例外にする。 */
export function renderMessage(locale: Locale, message: LocalizedMessage): string {
  const rendered = tryRenderMessage(locale, message);
  if (rendered === null) {
    throw new Error(`文言を描画できません: ${String((message as { id?: unknown }).id)}`);
  }
  return rendered;
}

export type { ErrorMessageId };
