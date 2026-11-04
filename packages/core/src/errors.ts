/**
 * ドメイン層のエラー。
 *
 * `phases/construction.md` § Error Handling に従い、回復可能／致命的の区別を
 * 呼び出し元が判断できる形で返す。握り潰さない。
 */

import { renderMessage } from "./messages/render.js";
import type { LocalizedMessage } from "./messages/types.js";

/** Rolust のすべてのドメインエラーの基底。 */
export class RolustError extends Error {
  /** 機械可読なエラーコード。API の応答本文にそのまま載せる。 */
  readonly code: string;
  /** SPA が言語に合わせて訳す文言（Issue #94）。`message` は、これを日本語で描画した文になる。 */
  readonly localized: LocalizedMessage;

  constructor(code: string, message: LocalizedMessage, options?: { cause?: unknown }) {
    super(renderMessage("ja", message), options as ErrorOptions);
    this.code = code;
    this.localized = message;
    this.name = new.target.name;
  }
}

/** 入力が境界の規約を満たさない（呼び出し側の誤り。再試行しても直らない）。 */
export class ValidationError extends RolustError {
  /** エラーの原因となった入力項目名。 */
  readonly field: string | null;

  constructor(message: LocalizedMessage, field: string | null = null) {
    super("ValidationError", message);
    this.field = field;
  }
}

/** 信頼ポリシー文書を解釈できない（AWS からの応答が想定外）。 */
export class TrustPolicyParseError extends RolustError {
  constructor(message: LocalizedMessage, options?: { cause?: unknown }) {
    super("TrustPolicyParseError", message, options);
  }
}

/** ChangeRequest の状態遷移が許されていない。 */
export class InvalidStateTransitionError extends RolustError {
  constructor(message: LocalizedMessage) {
    super("InvalidStateTransition", message);
  }
}
