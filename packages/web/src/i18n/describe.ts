import { tryRenderMessage, type Locale, type LocalizedMessage } from "@rolust/core";

import type { ApiClientError } from "../api-client.js";
import type { Messages } from "./messages/ja.js";

/**
 * API が返した文言を、選んだ言語で描画する。`localized` が無い（旧 API）、または知らない ID
 * （新しい API）のときは、サーバが詰めた `message`（日本語）に戻る。
 */
export function localizeMessage(
  locale: Locale,
  message: string,
  localized: LocalizedMessage | null | undefined,
): string {
  if (!localized) return message;
  return tryRenderMessage(locale, localized) ?? message;
}

/**
 * 画面に出す API エラーの本文。`Error.message`（ログと旧テスト向けの日本語）は直接出さず、ここを通す。
 * `localized` を描画できればそれ、なければ通信失敗・HTTP ステータス・5xx の定型文、最後に旧 API の `message`。
 */
export function describeError(locale: Locale, t: Messages, error: ApiClientError): string {
  if (error.localized) {
    const rendered = tryRenderMessage(locale, error.localized);
    if (rendered !== null) return rendered;
  }
  if (error.code === "NetworkError") return t.error.network(error.detail ?? "");
  if (!error.hasServerMessage) return t.error.requestFailed(error.status);
  if (error.status >= 500) return t.error.server;
  return error.message;
}
