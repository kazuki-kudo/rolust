import { createHash, randomBytes as nodeRandomBytes } from "node:crypto";

import type { CloudFrontRequest, CloudFrontResultResponse } from "aws-lambda";

import { actorFromClaims, setActor } from "../actor.js";
import type { OidcConfig } from "../auth-config.js";
import { clearCookie, parseCookies, serializeCookie } from "../cookies.js";
import {
  KeySourceError,
  TokenError,
  createKeyResolver,
  verifyIdToken,
  type IdTokenClaims,
  type KeyResolver,
} from "../jwt.js";
import { forbidden, serviceUnavailable, unauthorizedJson } from "../responses.js";
import type { AuthProvider } from "./types.js";

/**
 * OIDC の認可コード + PKCE（`auth_mode = "cognito"`。FR-6.4）。
 *
 * ログインは IdP の画面（Cognito の Hosted UI）に任せ、`/callback` で受けたコードを ID トークンに交換して
 * Cookie に載せる。以降のリクエストは Cookie の ID トークンの検証だけで通る（IdP を呼ばない）。
 * 設定の型は IdP に依らない。外部 IdP を足すときは、設定の値を差し替えるだけで載る。
 */

export const ID_COOKIE = "__Host-rolust-id";
export const PKCE_COOKIE = "__Host-rolust-pkce";
export const CALLBACK_PATH = "/callback";

/** 初回のサインインは、一時パスワードの変更で時間がかかりうる。5 分では切れて、行き止まりの 403 になる。 */
const PKCE_COOKIE_MAX_AGE_SECONDS = 900;
const JWKS_TTL_MS = 5 * 60 * 1000;
const JWKS_MIN_REFRESH_MS = 60 * 1000;
/** viewer-request の関数の timeout（5 秒）に収める。 */
const TOKEN_TIMEOUT_MS = 3000;

export interface OidcDeps {
  getConfig: () => Promise<OidcConfig>;
  fetchImpl?: typeof fetch;
  now?: () => number;
  randomBytes?: (size: number) => Buffer;
}

interface SavedAuthorization {
  s: string;
  v: string;
  p: unknown;
}

/** `/` で始まり、`//` と `/\` で始まらない相対パスだけを戻り先にする（オープンリダイレクトを防ぐ）。 */
function safeReturnPath(value: unknown): string {
  if (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\")
  ) {
    return value;
  }
  return "/";
}

function readSaved(raw: string | undefined): SavedAuthorization | null {
  if (raw === undefined) return null;
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const { s, v, p } = value as Record<string, unknown>;
    if (typeof s !== "string" || typeof v !== "string") return null;
    return { s, v, p };
  } catch {
    return null;
  }
}

export function createOidcProvider(deps: OidcDeps): AuthProvider {
  // 呼び出しの時点でグローバルの fetch を引く（テストの差し替えと、実行環境の fetch の両方に追従する）。
  const fetchImpl: typeof fetch = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const random = deps.randomBytes ?? nodeRandomBytes;
  let resolver: { jwksUri: string; resolve: KeyResolver } | null = null;

  function keyResolverFor(config: OidcConfig): KeyResolver {
    if (!resolver || resolver.jwksUri !== config.jwksUri) {
      resolver = {
        jwksUri: config.jwksUri,
        resolve: createKeyResolver({
          jwksUri: config.jwksUri,
          fetchImpl,
          now,
          ttlMs: JWKS_TTL_MS,
          minRefreshIntervalMs: JWKS_MIN_REFRESH_MS,
        }),
      };
    }
    return resolver.resolve;
  }

  function verify(token: string, config: OidcConfig): Promise<IdTokenClaims> {
    return verifyIdToken(token, keyResolverFor(config), {
      issuer: config.issuer,
      clientId: config.clientId,
      now: now(),
    });
  }

  /** 検証済みのクレームを返す。`TokenError` なら null（未認証）、鍵を取得できなければ例外を伝え、呼び出し側が 503 にする。 */
  async function readSession(
    request: CloudFrontRequest,
    config: OidcConfig,
  ): Promise<IdTokenClaims | null> {
    const token = parseCookies(request).get(ID_COOKIE);
    if (!token) return null;
    try {
      return await verify(token, config);
    } catch (error) {
      if (error instanceof TokenError) return null;
      throw error;
    }
  }

  function hostOf(request: CloudFrontRequest): string | undefined {
    return request.headers.host?.[0]?.value || undefined;
  }

  function redirectToSignIn(
    request: CloudFrontRequest,
    config: OidcConfig,
  ): CloudFrontResultResponse {
    const host = hostOf(request);
    if (!host) return forbidden();

    const verifier = random(32).toString("base64url");
    const state = random(16).toString("base64url");
    const challenge = createHash("sha256").update(verifier).digest("base64url");
    const original = request.querystring ? `${request.uri}?${request.querystring}` : request.uri;
    const params = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: `https://${host}${CALLBACK_PATH}`,
      scope: "openid",
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const saved = Buffer.from(
      JSON.stringify({ s: state, v: verifier, p: original }),
      "utf8",
    ).toString("base64url");

    return {
      status: "302",
      statusDescription: "Found",
      headers: {
        location: [
          { key: "Location", value: `${config.authorizationEndpoint}?${params.toString()}` },
        ],
        "set-cookie": [
          {
            key: "Set-Cookie",
            value: serializeCookie(PKCE_COOKIE, saved, PKCE_COOKIE_MAX_AGE_SECONDS),
          },
        ],
        "cache-control": [{ key: "Cache-Control", value: "no-store" }],
      },
    };
  }

  /** サインインの失敗。リダイレクトしない（失敗のたびに IdP へ戻すと、ループになる）。 */
  function signInFailed(): CloudFrontResultResponse {
    const response = forbidden();
    response.headers = {
      ...response.headers,
      "set-cookie": [{ key: "Set-Cookie", value: clearCookie(PKCE_COOKIE) }],
    };
    return response;
  }

  async function handleCallback(
    request: CloudFrontRequest,
    config: OidcConfig,
  ): Promise<CloudFrontResultResponse> {
    const host = hostOf(request);
    if (!host) return forbidden();

    const query = new URLSearchParams(request.querystring);
    const code = query.get("code");
    const state = query.get("state");
    const saved = readSaved(parseCookies(request).get(PKCE_COOKIE));
    if (query.has("error") || !code || !state || !saved || saved.s !== state) {
      return signInFailed();
    }

    let response: Response;
    try {
      response = await fetchImpl(config.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          code,
          redirect_uri: `https://${host}${CALLBACK_PATH}`,
          code_verifier: saved.v,
        }).toString(),
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      });
    } catch (error) {
      console.error("[rolust-edge-auth] トークンエンドポイントを呼べませんでした", error);
      return serviceUnavailable();
    }
    if (response.status !== 200) {
      console.error(`[rolust-edge-auth] トークンエンドポイントが ${response.status} を返しました`);
      return signInFailed();
    }

    let idToken: unknown;
    try {
      idToken = ((await response.json()) as { id_token?: unknown }).id_token;
    } catch {
      return signInFailed();
    }
    if (typeof idToken !== "string") return signInFailed();

    let claims: IdTokenClaims;
    try {
      claims = await verify(idToken, config);
    } catch (error) {
      if (error instanceof TokenError) return signInFailed();
      throw error;
    }

    const maxAge = claims.exp - Math.floor(now() / 1000);
    return {
      status: "302",
      statusDescription: "Found",
      headers: {
        location: [{ key: "Location", value: safeReturnPath(saved.p) }],
        "set-cookie": [
          { key: "Set-Cookie", value: serializeCookie(ID_COOKIE, idToken, maxAge) },
          { key: "Set-Cookie", value: clearCookie(PKCE_COOKIE) },
        ],
        "cache-control": [{ key: "Cache-Control", value: "no-store" }],
      },
    };
  }

  return async (request) => {
    let config: OidcConfig;
    try {
      config = await deps.getConfig();
    } catch (error) {
      console.error("[rolust-edge-auth] OIDC の設定を取得できませんでした", error);
      return serviceUnavailable();
    }

    try {
      if (request.uri === CALLBACK_PATH) {
        return await handleCallback(request, config);
      }
      const session = await readSession(request, config);
      if (session) {
        // 実行者の記録（Issue #120）。クレームに名前が無ければ付けない（API が null で受ける）。
        const actor = actorFromClaims(session);
        if (actor) setActor(request, actor);
        return request;
      }
      if (request.uri.startsWith("/api/")) {
        return unauthorizedJson();
      }
      return redirectToSignIn(request, config);
    } catch (error) {
      // 鍵を取得できない（KeySourceError）ほか、想定外の例外も通さない。握り潰さず記録する。
      console.error(
        error instanceof KeySourceError
          ? "[rolust-edge-auth] 署名の鍵を取得できませんでした"
          : "[rolust-edge-auth] 認証の処理で想定外の例外が起きました",
        error,
      );
      return serviceUnavailable();
    }
  };
}
