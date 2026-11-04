import { createPublicKey, verify, type JsonWebKeyInput, type KeyObject } from "node:crypto";

/** トークンが不正（署名・形式・クレーム）。呼び出し側は 401 / 403 に写す。 */
export class TokenError extends Error {}

/** JWKS を取得・解釈できない。トークンの良否を判定できないので、呼び出し側は 503（fail closed）に写す。 */
export class KeySourceError extends Error {}

export type KeyResolver = (kid: string) => Promise<KeyObject | undefined>;

export interface IdTokenClaims {
  exp: number;
  sub?: string;
  "cognito:username"?: string;
  [claim: string]: unknown;
}

export interface IdTokenExpectations {
  issuer: string;
  clientId: string;
  /** ミリ秒。 */
  now: number;
}

function parseJsonPart(part: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(part, "base64url").toString("utf8"));
  } catch {
    throw new TokenError(`JWT の${label}が JSON ではありません`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TokenError(`JWT の${label}がオブジェクトではありません`);
  }
  return value as Record<string, unknown>;
}

/**
 * Cognito の ID トークン（RS256）を検証する。
 *
 * 署名の前に `alg` を固定する（`none` や HS256 への差し替えを防ぐ）。クレームは `iss`・`aud`・
 * `token_use`・`exp`。アクセストークンには `aud` が無いので、ID トークンだけを受け入れる。
 */
export async function verifyIdToken(
  token: string,
  resolveKey: KeyResolver,
  expect: IdTokenExpectations,
): Promise<IdTokenClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new TokenError("JWT は 3 つの部分でなければなりません");
  }
  const [head, body, signature] = parts as [string, string, string];

  const header = parseJsonPart(head, "ヘッダー");
  if (header.alg !== "RS256") {
    throw new TokenError("JWT の alg は RS256 でなければなりません");
  }
  if (typeof header.kid !== "string" || header.kid === "") {
    throw new TokenError("JWT のヘッダーに kid がありません");
  }

  const key = await resolveKey(header.kid);
  if (!key) {
    throw new TokenError("JWT の kid に対応する鍵がありません");
  }

  const signed = Buffer.from(`${head}.${body}`, "utf8");
  if (!verify("RSA-SHA256", signed, key, Buffer.from(signature, "base64url"))) {
    throw new TokenError("JWT の署名が一致しません");
  }

  const claims = parseJsonPart(body, "本文");
  if (claims.iss !== expect.issuer) {
    throw new TokenError("JWT の iss が一致しません");
  }
  if (claims.aud !== expect.clientId) {
    throw new TokenError("JWT の aud が一致しません");
  }
  if (claims.token_use !== "id") {
    throw new TokenError("JWT の token_use が id ではありません");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= expect.now) {
    throw new TokenError("JWT の期限が切れています");
  }
  return claims as IdTokenClaims;
}

export interface KeyResolverOptions {
  jwksUri: string;
  fetchImpl: typeof fetch;
  now: () => number;
  /** 取得した鍵を保持する期間。 */
  ttlMs: number;
  /** 未知の kid を理由にした再取得の最短間隔。連打で JWKS の取得を増幅させないため。 */
  minRefreshIntervalMs: number;
}

/**
 * JWKS から鍵を解決する。`ttlMs` の間は取得済みの鍵を使う。未知の kid は鍵のローテーションかもしれないので
 * 再取得するが、最後の取得から `minRefreshIntervalMs` 以内は再取得しない。取得できないときは
 * `KeySourceError`（古い鍵で通さない）。
 */
export function createKeyResolver(options: KeyResolverOptions): KeyResolver {
  let keys = new Map<string, KeyObject>();
  let fetchedAt = Number.NEGATIVE_INFINITY;

  async function refresh(): Promise<void> {
    let response: Response;
    try {
      response = await options.fetchImpl(options.jwksUri);
    } catch (error) {
      throw new KeySourceError(`JWKS を取得できませんでした: ${String(error)}`);
    }
    if (!response.ok) {
      throw new KeySourceError(`JWKS の取得が ${response.status} を返しました`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new KeySourceError("JWKS が JSON ではありません");
    }
    const list = (body as { keys?: unknown } | null)?.keys;
    if (!Array.isArray(list)) {
      throw new KeySourceError("JWKS に keys の配列がありません");
    }

    const next = new Map<string, KeyObject>();
    for (const jwk of list as Array<Record<string, unknown>>) {
      if (jwk?.kty !== "RSA" || typeof jwk.kid !== "string") continue;
      try {
        next.set(jwk.kid, createPublicKey({ key: jwk as unknown as JsonWebKeyInput["key"], format: "jwk" }));
      } catch {
        // 解釈できない鍵は使わない。ほかの鍵の解決を止めない。
      }
    }
    keys = next;
    fetchedAt = options.now();
  }

  return async (kid) => {
    let refreshed = false;
    if (options.now() - fetchedAt >= options.ttlMs) {
      await refresh();
      refreshed = true;
    }
    let key = keys.get(kid);
    if (!key && !refreshed && options.now() - fetchedAt >= options.minRefreshIntervalMs) {
      await refresh();
      key = keys.get(kid);
    }
    return key;
  };
}
