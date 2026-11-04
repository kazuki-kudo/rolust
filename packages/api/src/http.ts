import type { APIGatewayProxyEvent, APIGatewayProxyResult } from "aws-lambda";
import type { Actor, Permission, RequiredPermission } from "@rolust/core";
import { localized, permissionFromGroups, permits, ValidationError } from "@rolust/core";

import { readActor, readGroups } from "./actor.js";
import { loadAuthMode, type AuthMode } from "./config.js";
import { ForbiddenError, RouteNotFoundError, toErrorResponse } from "./errors.js";

/**
 * 最小限の HTTP ルータ。
 *
 * API Gateway (REST) の proxy 統合を前提とする。CloudFront が `/api/*` を
 * この API へ振り分けるため、SPA と API は同一オリジンになる。
 * したがって CORS ヘッダは付けない — 付けると Lambda@Edge の Basic 認証を
 * 迂回する別オリジンからの利用を許すことになる（FR-6.1）。
 */

/** CloudFront のビヘイビアと合わせたベースパス。 */
export const API_BASE_PATH = "/api";

export interface RequestContext {
  method: string;
  /** ベースパスを取り除いたパス（例: `/pools/platform-team/users`）。 */
  path: string;
  params: Record<string, string>;
  query: Record<string, string>;
  /** JSON としてパース済みの本文。本文がなければ null。 */
  body: unknown;
  /**
   * このデプロイが載っている AWS アカウント ID（API Gateway の `requestContext.accountId`）。
   *
   * IAM の API（`iam:ListRoleTags` / `iam:GetRole` / `iam:UpdateAssumeRolePolicy`）は `RoleName` しか
   * 受け取らず、**呼び出しに使った資格情報のアカウントに対して解決される**。したがって、ロールのアカウントが
   * この値と同じなら実行ロール自身の資格情報で、違えばターゲット側の Reader・Manager を引き受けた資格情報で
   * 呼ぶ（`aws/iam-client.ts`。Issue #85）。どちらかを判定するためにこの値が要る。
   *
   * `null` は「判定できない」を意味する。実 API Gateway 経由では常に入るため、
   * null になるのはユニットテストが `RequestContext` を直接組み立てる場合だけである。
   * 判定できないと、どの資格情報で呼ぶかを決められないので、どの経路も IAM を呼ばずに止める
   * （`DeployAccountUnknown`。Issue #27）。
   */
  deployAccountId: string | null;
  /**
   * 操作した人（Lambda@Edge が付ける `x-rolust-actor`。Issue #120）。無い・不正なら null（`readActor`）。
   * 申請の作成者・反映者として保存する。
   */
  actor: Actor | null;
  /** 呼び出した人の権限（Issue #141）。ルートの `requires` を満たしたうえで渡る。 */
  permission: Permission;
}

export interface RouteResult {
  statusCode: number;
  body: unknown;
}

export type RouteHandler = (context: RequestContext) => Promise<RouteResult>;

export interface Route {
  method: string;
  /** `/pool/users` のようなパターン。`:name` がパラメータになる。 */
  pattern: string;
  /**
   * このルートを呼べる最低限の権限（Issue #141）。`none` は認証を通った人なら誰でも（`GET /me`）。
   * 書かないと、最も厳しい `apply` を要する（宣言の付け忘れが権限過多にならない）。
   * 全ルートの宣言は `handlers/route-permissions.test.ts` が規則に照らして確かめる。
   */
  requires?: RequiredPermission;
  handler: RouteHandler;
}

/**
 * 呼び出した人の権限を決める。`basic` はグループを識別できないので全権限。`cognito` は Lambda@Edge が付けた
 * `x-rolust-actor` のグループから決め、ヘッダーが無い・不正なら権限なし（認証を通ったのに実行者が読めないのは異常で、通さない）。
 */
export function resolvePermission(
  headers: Record<string, string | undefined> | null | undefined,
  authMode: AuthMode,
): Permission {
  if (authMode === "basic") return "apply";
  const groups = readGroups(headers);
  return groups === null ? "none" : permissionFromGroups(groups);
}

/** API Gateway のイベントを処理する Lambda ハンドラを作る。 */
export function createHandler(routes: Route[]) {
  const compiled = routes.map((route) => ({ ...route, segments: split(route.pattern) }));

  return async function handler(
    event: APIGatewayProxyEvent,
  ): Promise<APIGatewayProxyResult> {
    const method = (event.httpMethod ?? "GET").toUpperCase();
    const path = normalizePath(event.path ?? "/");

    try {
      const segments = split(path);
      for (const route of compiled) {
        if (route.method !== method) continue;
        const params = match(route.segments, segments);
        if (!params) continue;

        // 権限の判定は、ハンドラ（AWS・DynamoDB を呼ぶ）より前。足りなければ何にも触れずに 403 にする。
        const permission = resolvePermission(event.headers, loadAuthMode());
        const need = route.requires ?? "apply";
        if (!permits(permission, need)) {
          // `none` は常に満たされるので、ここに届く `need` は view・edit・apply のどれか。
          throw new ForbiddenError(need as "view" | "edit" | "apply");
        }

        const result = await route.handler({
          method,
          path,
          params,
          query: readQuery(event),
          body: readBody(event),
          deployAccountId: event.requestContext?.accountId ?? null,
          actor: readActor(event.headers),
          permission,
        });
        return respond(result.statusCode, result.body);
      }
      throw new RouteNotFoundError(method, path);
    } catch (error) {
      const { statusCode, body } = toErrorResponse(error);
      return respond(statusCode, body);
    }
  };
}

function respond(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // 管理画面のデータをブラウザ・中間キャッシュに残さない。
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
    body: JSON.stringify(body ?? null),
  };
}

function normalizePath(rawPath: string): string {
  let path = rawPath;
  if (path.startsWith(API_BASE_PATH)) {
    path = path.slice(API_BASE_PATH.length);
  }
  if (path.length > 1 && path.endsWith("/")) {
    path = path.slice(0, -1);
  }
  return path === "" ? "/" : path;
}

function split(path: string): string[] {
  return path.split("/").filter((segment) => segment !== "");
}

function match(
  patternSegments: string[],
  pathSegments: string[],
): Record<string, string> | null {
  const base = split(API_BASE_PATH);
  // パターンは `/api` を含めて書いても書かなくてもよい。含む場合は取り除く。
  const expected =
    patternSegments.length >= base.length &&
    base.every((segment, index) => patternSegments[index] === segment)
      ? patternSegments.slice(base.length)
      : patternSegments;

  if (expected.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};
  for (const [index, segment] of expected.entries()) {
    const actual = pathSegments[index] as string;
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeURIComponent(actual);
      continue;
    }
    if (segment !== actual) return null;
  }
  return params;
}

function readQuery(event: APIGatewayProxyEvent): Record<string, string> {
  const query: Record<string, string> = {};
  for (const [key, value] of Object.entries(event.queryStringParameters ?? {})) {
    if (typeof value === "string") query[key] = value;
  }
  return query;
}

function readBody(event: APIGatewayProxyEvent): unknown {
  if (event.body === null || event.body === undefined || event.body === "") return null;

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body, "base64").toString("utf8")
    : event.body;

  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new ValidationError(localized("request.bodyNotJson", { detail: String(cause) }), "body");
  }
}

/** 本文をオブジェクトとして読む。オブジェクトでなければ ValidationError。 */
export function requireObjectBody(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ValidationError(localized("request.bodyNotObject", {}), "body");
  }
  return body as Record<string, unknown>;
}

/** 必須の文字列項目を取り出す。 */
export function requireString(
  body: Record<string, unknown>,
  field: string,
): string {
  const value = body[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new ValidationError(localized("request.fieldRequired", { field }), field);
  }
  return value.trim();
}

/** 必須の真偽値項目を取り出す。 */
export function requireBoolean(
  body: Record<string, unknown>,
  field: string,
): boolean {
  const value = body[field];
  if (typeof value !== "boolean") {
    throw new ValidationError(localized("request.fieldNotBoolean", { field }), field);
  }
  return value;
}

/** 必須の文字列配列を取り出す。空配列は許さない。 */
export function requireStringArray(
  body: Record<string, unknown>,
  field: string,
): string[] {
  const value = body[field];
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError(localized("request.fieldEmptyList", { field }), field);
  }
  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new ValidationError(localized("request.fieldEmptyElement", { field }), field);
    }
    values.push(entry.trim());
  }
  return values;
}

/** 文字列配列を取り出す。空配列を許す（「すべて外す」を表すため）。要素は空でない文字列に限る。 */
export function readStringArray(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (!Array.isArray(value)) {
    throw new ValidationError(localized("request.fieldNotStringArray", { field }), field);
  }
  const values: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || entry.trim() === "") {
      throw new ValidationError(localized("request.fieldEmptyElement", { field }), field);
    }
    values.push(entry.trim());
  }
  return values;
}

/**
 * IAM ユーザ名リストを読む。
 *
 * 画面は改行区切りの Textarea を使う（design-system-mapping.md FR-7.1）ため、
 * 文字列と配列の両方を受け付ける。前後の空白を除去し、空行を無視し、重複を畳む
 * （interaction-spec.md § FR-7.1「ユーザ名リストの入力」）。
 */
export function readUserNameList(
  body: Record<string, unknown>,
  field = "userNames",
): string[] {
  const value = body[field];
  const raw =
    typeof value === "string"
      ? value.split(/\r?\n/)
      : Array.isArray(value)
        ? value.map((entry) => (typeof entry === "string" ? entry : ""))
        : null;

  if (raw === null) {
    throw new ValidationError(localized("request.fieldNotLineList", { field }), field);
  }

  const names = [...new Set(raw.map((entry) => entry.trim()).filter((entry) => entry !== ""))];
  if (names.length === 0) {
    throw new ValidationError(localized("request.userNamesRequired", {}), field);
  }
  return names;
}

/** カンマ区切りのクエリを配列にする（`/diff?ids=a,b,c` — MQ-2）。 */
export function readCsvQuery(
  query: Record<string, string>,
  key: string,
): string[] {
  const raw = query[key];
  if (!raw) return [];
  return [...new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean))];
}
