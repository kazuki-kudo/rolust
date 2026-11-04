import {
  localized,
  plainMessage,
  renderMessage,
  RolustError,
  ValidationError,
  type LocalizedMessage,
} from "@rolust/core";

/**
 * API 層のエラーと、統合境界のエラーハンドリング。
 *
 * `phases/construction.md` § Error Handling:
 * - 統合境界（DynamoDB / IAM / SSM）の呼び出しは例外を握り潰さない
 * - 回復可能（再試行・フォールバック）と致命的（fail fast）を区別して呼び出し元へ返す
 * - サイレント失敗を作らない
 */

/** HTTP ステータスを持つ API 層のエラー。 */
export class ApiError extends RolustError {
  readonly statusCode: number;
  /** 呼び出し側が再試行して意味があるか。 */
  readonly retryable: boolean;

  constructor(
    statusCode: number,
    code: string,
    message: LocalizedMessage,
    options: { retryable?: boolean; cause?: unknown } = {},
  ) {
    super(code, message, { cause: options.cause });
    this.statusCode = statusCode;
    this.retryable = options.retryable ?? false;
  }
}

/** 設定不備。起動時に落とす（致命的）。 */
export class ConfigurationError extends ApiError {
  constructor(text: string) {
    super(500, "ConfigurationError", plainMessage(text));
  }
}

/** 対象が存在しない。 */
export class NotFoundError extends ApiError {
  constructor(message: LocalizedMessage) {
    super(404, "NotFound", message);
  }
}

/** 権限が足りない（Issue #141）。何を足せばよいかを、画面と同じ語で伝える。 */
export class ForbiddenError extends ApiError {
  constructor(need: "view" | "edit" | "apply") {
    super(403, "Forbidden", localized("auth.forbidden", { need }));
  }
}

/** 一意性・排他制御に反した（FR-4.6 のロック競合、プール識別子の重複など）。 */
export class ConflictError extends ApiError {
  constructor(message: LocalizedMessage) {
    super(409, "Conflict", message);
  }
}

/** データストアの操作に失敗した。原因の例外を必ず `cause` に載せる。 */
export class StorageError extends ApiError {
  constructor(message: LocalizedMessage, options: { retryable?: boolean; cause?: unknown } = {}) {
    super(502, "StorageError", message, options);
  }
}

/** ルーティングに一致しなかった。 */
export class RouteNotFoundError extends ApiError {
  constructor(method: string, path: string) {
    super(404, "RouteNotFound", localized("route.notFound", { method, path }));
  }
}

export interface ErrorBody {
  code: string;
  message: string;
  field?: string;
  retryable: boolean;
  /** SPA が言語に合わせて訳す文言（Issue #94）。常に載せる。 */
  localized: LocalizedMessage;
}

/**
 * 例外を HTTP 応答へ写像する。
 *
 * 未知の例外を 500 に丸めるが、**必ず `console.error` で記録する**。
 * 握り潰して 200 を返すことはしない。
 */
export function toErrorResponse(error: unknown): { statusCode: number; body: ErrorBody } {
  if (error instanceof ApiError) {
    if (error.statusCode >= 500) {
      console.error(`[rolust] ${error.code}: ${error.message}`, error.cause ?? error);
    }
    return {
      statusCode: error.statusCode,
      body: {
        code: error.code,
        message: error.message,
        retryable: error.retryable,
        // `ConfigurationError` の `operator.plain` は日本語の運用者向けで、SPA には渡さない（英語の画面に日本語が出る）。
        // 詳しい文は `message`（と上のログ）にある。
        localized: error instanceof ConfigurationError ? localized("server.internal", {}) : error.localized,
      },
    };
  }

  if (error instanceof ValidationError) {
    return {
      statusCode: 400,
      body: {
        code: error.code,
        message: error.message,
        ...(error.field ? { field: error.field } : {}),
        retryable: false,
        localized: error.localized,
      },
    };
  }

  if (error instanceof RolustError) {
    return {
      statusCode: 400,
      body: {
        code: error.code,
        message: error.message,
        retryable: false,
        localized: error.localized,
      },
    };
  }

  console.error("[rolust] 未処理の例外", error);
  const internal = localized("server.internal", {});
  return {
    statusCode: 500,
    body: {
      code: "InternalError",
      message: renderMessage("ja", internal),
      retryable: true,
      localized: internal,
    },
  };
}

/** AWS SDK の例外から名前を取り出す（`AccessDeniedException` など）。 */
export function awsErrorName(error: unknown): string | null {
  if (typeof error === "object" && error !== null) {
    const named = error as { name?: unknown; __type?: unknown };
    if (typeof named.name === "string" && named.name !== "Error") return named.name;
    if (typeof named.__type === "string") return named.__type;
  }
  return null;
}

/** AWS SDK の例外メッセージ。空・無いときは null（定型文は、文言の ID の側が言語に合わせて出す。Issue #94）。 */
export function awsErrorDetail(error: unknown): string | null {
  if (error instanceof Error && error.message) return error.message;
  return null;
}

/** 例外が運ぶ文言（`IamOperationError`・`RolustError` の `localized`）。運ばなければ null。 */
export function carriedLocalized(error: unknown): LocalizedMessage | null {
  if (!(error instanceof Error)) return null;
  return (error as { localized?: LocalizedMessage | null }).localized ?? null;
}

/**
 * 200 応答や保存する結果に載せる、失敗の文言（Issue #94）。`message` は、これの日本語の描画にする。
 *
 * `localized` を運ぶ例外（`IamOperationError`・`StorageError` など）はそれをそのまま返す。
 * 運ばない `Error` は AWS・実行環境の文をそのまま出す `common.rawDetail`。`Error` でないものは `fallback`。
 */
export function localizedOfError(error: unknown, fallback: LocalizedMessage): LocalizedMessage {
  const carried = carriedLocalized(error);
  if (carried) return carried;
  if (error instanceof Error) return localized("common.rawDetail", { detail: error.message });
  return fallback;
}
