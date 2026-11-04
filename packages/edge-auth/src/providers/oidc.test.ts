import { createHash } from "node:crypto";

import type { CloudFrontRequest, CloudFrontResultResponse } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ACTOR_HEADER, encodeActor } from "../actor.js";
import type { OidcConfig } from "../auth-config.js";
import {
  CLIENT_ID,
  ISSUER,
  NOW_MS,
  createTestKey,
  jwksResponse,
  signToken,
  validClaims,
} from "../testing/tokens.js";
import { CALLBACK_PATH, ID_COOKIE, PKCE_COOKIE, createOidcProvider } from "./oidc.js";

const HOST = "rolust.example.com";
const AUTHORIZE = "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize";
const TOKEN = "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/token";
const JWKS = `${ISSUER}/.well-known/jwks.json`;

const CONFIG: OidcConfig = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  authorizationEndpoint: AUTHORIZE,
  tokenEndpoint: TOKEN,
  jwksUri: JWKS,
};

const key = createTestKey("kid-1");

function request(
  uri: string,
  options: { querystring?: string; cookie?: string; host?: string | null } = {},
): CloudFrontRequest {
  const headers: CloudFrontRequest["headers"] = {};
  if (options.host !== null) {
    headers.host = [{ key: "Host", value: options.host ?? HOST }];
  }
  if (options.cookie !== undefined) {
    headers.cookie = [{ key: "Cookie", value: options.cookie }];
  }
  return {
    clientIp: "203.0.113.1",
    headers,
    method: "GET",
    querystring: options.querystring ?? "",
    uri,
  };
}

function asResponse(result: unknown): CloudFrontResultResponse {
  return result as CloudFrontResultResponse;
}

function setCookies(response: CloudFrontResultResponse): string[] {
  return (response.headers?.["set-cookie"] ?? []).map((entry) => entry.value);
}

function pkceCookie(state: string, verifier: string, path: string): string {
  return Buffer.from(JSON.stringify({ s: state, v: verifier, p: path }), "utf8").toString(
    "base64url",
  );
}

/** 認可の応答。`tokenResponse` を差し替えてトークン交換の結果を作る。 */
function makeFetch(
  tokenResponse: () => Response | Promise<Response> = () =>
    new Response(JSON.stringify({ id_token: signToken(validClaims(), key) }), { status: 200 }),
) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    void init;
    const url = String(input);
    if (url === JWKS) return jwksResponse([key]);
    if (url === TOKEN) return tokenResponse();
    throw new Error(`想定外の URL: ${url}`);
  });
}

function provider(overrides: Partial<Parameters<typeof createOidcProvider>[0]> = {}) {
  const fetchImpl = overrides.fetchImpl ?? (makeFetch() as unknown as typeof fetch);
  return {
    fetchImpl,
    run: createOidcProvider({
      getConfig: async () => CONFIG,
      fetchImpl,
      now: () => NOW_MS,
      randomBytes: (size) => Buffer.alloc(size, 1),
      ...overrides,
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("セッションの検証", () => {
  it("有効な ID トークンの Cookie があれば、リクエストをそのまま通す", async () => {
    const { run } = provider();
    const req = request("/matrix", { cookie: `${ID_COOKIE}=${signToken(validClaims(), key)}` });

    expect(await run(req)).toBe(req);
  });

  it("通すとき、検証済みのクレームから x-rolust-actor を付ける（同じ request を返す）", async () => {
    const { run } = provider();
    const req = request("/api/pools", { cookie: `${ID_COOKIE}=${signToken(validClaims(), key)}` });

    const result = (await run(req)) as CloudFrontRequest;

    expect(result).toBe(req);
    expect(result.headers[ACTOR_HEADER]).toEqual([
      { key: "X-Rolust-Actor", value: encodeActor({ name: "alice", sub: "user-1" }) },
    ]);
  });

  it("ID トークンに cognito:groups があれば、x-rolust-actor に groups を載せる（Issue #141）", async () => {
    const { run } = provider();
    const token = signToken(validClaims({ "cognito:groups": ["applier"] }), key);
    const req = request("/api/pools", { cookie: `${ID_COOKIE}=${token}` });

    const result = (await run(req)) as CloudFrontRequest;

    expect(result.headers[ACTOR_HEADER]).toEqual([
      { key: "X-Rolust-Actor", value: encodeActor({ name: "alice", sub: "user-1", groups: ["applier"] }) },
    ]);
  });

  it("cognito:username も sub も無い ID トークンは、署名が正しければヘッダーなしで通す", async () => {
    const { run } = provider();
    const token = signToken(validClaims({ sub: undefined, "cognito:username": undefined }), key);
    const req = request("/", { cookie: `${ID_COOKIE}=${token}` });

    const result = (await run(req)) as CloudFrontRequest;

    expect(result).toBe(req);
    expect(result.headers[ACTOR_HEADER]).toBeUndefined();
  });

  it("サインインへのリダイレクトと 401 の応答には x-rolust-actor を付けない", async () => {
    const { run } = provider();

    const redirect = asResponse(await run(request("/")));
    const unauthorized = asResponse(await run(request("/api/pools")));

    expect(redirect.headers?.[ACTOR_HEADER]).toBeUndefined();
    expect(unauthorized.headers?.[ACTOR_HEADER]).toBeUndefined();
  });

  it("他の Cookie が混ざっていても読める", async () => {
    const { run } = provider();
    const req = request("/", {
      cookie: `a=1; ${ID_COOKIE}=${signToken(validClaims(), key)}; b=2`,
    });

    expect(await run(req)).toBe(req);
  });

  it("期限切れのトークンは通さず、サインインへ送る", async () => {
    const { run } = provider();
    const expired = signToken(validClaims({ exp: Math.floor(NOW_MS / 1000) - 1 }), key);

    const result = asResponse(await run(request("/", { cookie: `${ID_COOKIE}=${expired}` })));

    expect(result.status).toBe("302");
  });

  it.each([
    ["別のプールの iss", { iss: "https://cognito-idp.ap-northeast-1.amazonaws.com/other" }],
    ["別のアプリクライアントの aud", { aud: "client-2" }],
    ["アクセストークン", { token_use: "access" }],
  ])("%s のトークンは通さない", async (_name, overrides) => {
    const { run } = provider();
    const token = signToken(validClaims(overrides), key);

    const result = asResponse(await run(request("/", { cookie: `${ID_COOKIE}=${token}` })));

    expect(result.status).toBe("302");
  });

  it("別の鍵で署名された（kid は同じ）トークンは通さない", async () => {
    const { run } = provider();
    const forged = signToken(validClaims(), createTestKey("kid-1"));

    const result = asResponse(await run(request("/", { cookie: `${ID_COOKIE}=${forged}` })));

    expect(result.status).toBe("302");
  });

  it("壊れた ID Cookie の値は、503 ではなく「未認証」として扱う（HTML は 302、/api/ は 401）", async () => {
    const { run } = provider();
    const garbage = `${ID_COOKIE}=%%%not-a-jwt%%%`;

    expect(asResponse(await run(request("/", { cookie: garbage }))).status).toBe("302");
    expect(asResponse(await run(request("/api/pools", { cookie: garbage }))).status).toBe("401");
  });

  it("JWKS を取得できなければ、通さず 503（fail closed）", async () => {
    const fetchImpl = vi.fn(async () => new Response("x", { status: 500 }));
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { run } = provider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = asResponse(
      await run(request("/", { cookie: `${ID_COOKIE}=${signToken(validClaims(), key)}` })),
    );

    expect(result.status).toBe("503");
  });

  it("設定を取得できなければ 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { run } = provider({
      getConfig: async () => {
        throw new Error("denied");
      },
    });

    expect(asResponse(await run(request("/"))).status).toBe("503");
  });
});

describe("未認証のとき", () => {
  it("/api/ は 302 ではなく 401（JSON）で、WWW-Authenticate を付けない", async () => {
    const { run } = provider();

    const result = asResponse(await run(request("/api/pools")));

    expect(result.status).toBe("401");
    expect(result.headers?.["www-authenticate"]).toBeUndefined();
    expect(result.headers?.["content-type"]?.[0]?.value).toBe("application/json");
    expect(result.headers?.["cache-control"]?.[0]?.value).toBe("no-store");
    expect(JSON.parse(result.body ?? "")).toEqual({ message: "Unauthorized" });
  });

  it("画面のパスは、認可エンドポイントへ 302 する（PKCE・state・redirect_uri）", async () => {
    const { run } = provider();

    const result = asResponse(await run(request("/matrix", { querystring: "sort=name" })));

    expect(result.status).toBe("302");
    const location = new URL(result.headers?.location?.[0]?.value ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(AUTHORIZE);
    const params = location.searchParams;
    expect(params.get("response_type")).toBe("code");
    expect(params.get("client_id")).toBe(CLIENT_ID);
    expect(params.get("scope")).toBe("openid");
    expect(params.get("redirect_uri")).toBe(`https://${HOST}${CALLBACK_PATH}`);
    expect(params.get("code_challenge_method")).toBe("S256");

    const [cookie] = setCookies(result);
    const [pair, ...attributes] = (cookie ?? "").split("; ");
    expect(attributes).toEqual(["Max-Age=900", "Path=/", "Secure", "HttpOnly", "SameSite=Lax"]);
    expect(pair?.startsWith(`${PKCE_COOKIE}=`)).toBe(true);
    const saved = JSON.parse(
      Buffer.from((pair ?? "").slice(PKCE_COOKIE.length + 1), "base64url").toString("utf8"),
    ) as { s: string; v: string; p: string };
    expect(saved.s).toBe(params.get("state"));
    expect(saved.p).toBe("/matrix?sort=name");
    expect(createHash("sha256").update(saved.v).digest("base64url")).toBe(
      params.get("code_challenge"),
    );
    expect(result.headers?.["cache-control"]?.[0]?.value).toBe("no-store");
  });

  it("Host が無いリクエストは、リダイレクトせず 403", async () => {
    const { run } = provider();

    expect(asResponse(await run(request("/", { host: null }))).status).toBe("403");
  });
});

describe("/callback", () => {
  const STATE = "state-1";
  const VERIFIER = "verifier-1";

  function callback(
    options: { querystring?: string; cookie?: string | null; host?: string } = {},
  ): CloudFrontRequest {
    const cookie =
      options.cookie === null
        ? undefined
        : (options.cookie ?? `${PKCE_COOKIE}=${pkceCookie(STATE, VERIFIER, "/matrix?x=1")}`);
    return request(CALLBACK_PATH, {
      querystring: options.querystring ?? `code=abc&state=${STATE}`,
      ...(cookie !== undefined ? { cookie } : {}),
      ...(options.host !== undefined ? { host: options.host } : {}),
    });
  }

  it("成功: コードを交換し、ID トークンを Cookie に載せて元のパスへ 302 する", async () => {
    const fetchImpl = makeFetch();
    const { run } = provider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = asResponse(await run(callback()));

    expect(result.status).toBe("302");
    expect(result.headers?.location?.[0]?.value).toBe("/matrix?x=1");
    const cookies = setCookies(result);
    expect(cookies[0]).toMatch(
      new RegExp(
        `^${ID_COOKIE}=[\\w-]+\\.[\\w-]+\\.[\\w-]+; Max-Age=3600; Path=/; Secure; HttpOnly; SameSite=Lax$`,
      ),
    );
    expect(cookies[1]).toBe(`${PKCE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`);

    const exchange = fetchImpl.mock.calls.find(([url]) => String(url) === TOKEN);
    const init = exchange?.[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      code: "abc",
      redirect_uri: `https://${HOST}${CALLBACK_PATH}`,
      code_verifier: VERIFIER,
    });
  });

  it.each([
    ["error パラメータ", { querystring: `error=access_denied&state=${STATE}` }],
    ["code が無い", { querystring: `state=${STATE}` }],
    ["state が無い", { querystring: "code=abc" }],
    ["state の不一致", { querystring: "code=abc&state=other" }],
    ["一時 Cookie が無い", { cookie: null }],
    ["一時 Cookie が壊れている（base64 でない）", { cookie: `${PKCE_COOKIE}=%%%` }],
    [
      "一時 Cookie が JSON でない",
      { cookie: `${PKCE_COOKIE}=${Buffer.from("x").toString("base64url")}` },
    ],
    [
      "一時 Cookie が配列",
      { cookie: `${PKCE_COOKIE}=${Buffer.from("[]").toString("base64url")}` },
    ],
  ])("%s は 403 の固定本文で、リダイレクトせず、一時 Cookie を消す", async (_name, options) => {
    const fetchImpl = makeFetch();
    const { run } = provider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = asResponse(await run(callback(options)));

    expect(result.status).toBe("403");
    expect(result.body).toBe("Forbidden");
    expect(result.headers?.location).toBeUndefined();
    expect(setCookies(result)).toEqual([
      `${PKCE_COOKIE}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`,
    ]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("トークンエンドポイントが 200 以外なら 403", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { run } = provider({
      fetchImpl: makeFetch(() => new Response("{}", { status: 400 })) as unknown as typeof fetch,
    });

    expect(asResponse(await run(callback())).status).toBe("403");
  });

  it.each([
    ["id_token が無い", () => new Response(JSON.stringify({}), { status: 200 })],
    ["本文が JSON でない", () => new Response("x", { status: 200 })],
    [
      "id_token が文字列でない",
      () => new Response(JSON.stringify({ id_token: 1 }), { status: 200 }),
    ],
  ])("交換の応答で %s なら 403", async (_name, make) => {
    const { run } = provider({ fetchImpl: makeFetch(make) as unknown as typeof fetch });

    expect(asResponse(await run(callback())).status).toBe("403");
  });

  it("検証に通らない ID トークン（別のアプリクライアント）は 403", async () => {
    const bad = signToken(validClaims({ aud: "client-2" }), key);
    const { run } = provider({
      fetchImpl: makeFetch(
        () => new Response(JSON.stringify({ id_token: bad }), { status: 200 }),
      ) as unknown as typeof fetch,
    });

    expect(asResponse(await run(callback())).status).toBe("403");
  });

  it("トークン交換のネットワーク失敗は 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { run } = provider({
      fetchImpl: makeFetch(() => {
        throw new Error("timeout");
      }) as unknown as typeof fetch,
    });

    expect(asResponse(await run(callback())).status).toBe("503");
  });

  it.each([
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example/", "/"],
    ["evil", "/"],
    ["/ok?a=1", "/ok?a=1"],
  ])("戻り先 %j は %j にする（オープンリダイレクトを防ぐ）", async (original, expected) => {
    const { run } = provider();
    const cookie = `${PKCE_COOKIE}=${pkceCookie(STATE, VERIFIER, original)}`;

    const result = asResponse(await run(callback({ cookie })));

    expect(result.status).toBe("302");
    expect(result.headers?.location?.[0]?.value).toBe(expected);
  });

  it("redirect_uri は Host から作る（登録外のホストは Cognito が拒否する）", async () => {
    const fetchImpl = makeFetch();
    const { run } = provider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await run(callback({ host: "other.example.com" }));

    const exchange = fetchImpl.mock.calls.find(([url]) => String(url) === TOKEN);
    const body = new URLSearchParams(String((exchange?.[1] as RequestInit).body));
    expect(body.get("redirect_uri")).toBe("https://other.example.com/callback");
  });
});
