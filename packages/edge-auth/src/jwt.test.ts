import type { KeyObject } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { KeySourceError, TokenError, createKeyResolver, verifyIdToken } from "./jwt.js";
import {
  CLIENT_ID,
  ISSUER,
  NOW_MS,
  createTestKey,
  jwksResponse,
  signToken,
  validClaims,
  type TestKey,
} from "./testing/tokens.js";

const key = createTestKey("kid-1");
const resolve = async (kid: string): Promise<KeyObject | undefined> =>
  kid === key.kid ? key.publicKey : undefined;
const expectations = { issuer: ISSUER, clientId: CLIENT_ID, now: NOW_MS };

describe("verifyIdToken", () => {
  it("有効なトークンのクレームを返す", async () => {
    const claims = await verifyIdToken(signToken(validClaims(), key), resolve, expectations);

    expect(claims["cognito:username"]).toBe("alice");
    expect(claims.exp).toBe(Math.floor(NOW_MS / 1000) + 3600);
  });

  it("本文を差し替えた（署名と合わない）トークンは拒否する", async () => {
    const [head, , signature] = signToken(validClaims(), key).split(".");
    const forgedBody = Buffer.from(
      JSON.stringify(validClaims({ "cognito:username": "mallory" })),
      "utf8",
    ).toString("base64url");

    await expect(
      verifyIdToken(`${head}.${forgedBody}.${signature}`, resolve, expectations),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it("同じ kid でも、別の鍵で署名されたトークンは拒否する", async () => {
    const impostor = createTestKey("kid-1");

    await expect(
      verifyIdToken(signToken(validClaims(), impostor), resolve, expectations),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it.each(["none", "HS256", "RS512"])("alg が %s のトークンは拒否する", async (alg) => {
    await expect(
      verifyIdToken(signToken(validClaims(), key, { alg }), resolve, expectations),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it("kid が無い・未知のトークンは拒否する", async () => {
    await expect(
      verifyIdToken(signToken(validClaims(), key, { kid: undefined }), resolve, expectations),
    ).rejects.toBeInstanceOf(TokenError);
    await expect(
      verifyIdToken(signToken(validClaims(), key, { kid: "unknown" }), resolve, expectations),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it.each([
    ["iss が別のプール", { iss: "https://cognito-idp.ap-northeast-1.amazonaws.com/other" }],
    ["aud が別のアプリクライアント", { aud: "client-2" }],
    ["token_use が access", { token_use: "access" }],
    ["exp が過去", { exp: Math.floor(NOW_MS / 1000) - 1 }],
    ["exp が現在と同じ秒", { exp: Math.floor(NOW_MS / 1000) }],
    ["exp が数値でない", { exp: "9999999999" }],
  ])("%s のトークンは拒否する", async (_name, overrides) => {
    await expect(
      verifyIdToken(signToken(validClaims(overrides), key), resolve, expectations),
    ).rejects.toBeInstanceOf(TokenError);
  });

  it.each(["", "a.b", "a.b.c.d", "...", "not-a-jwt"])(
    "3 つの部分でない・壊れた値（%j）は拒否する",
    async (token) => {
      await expect(verifyIdToken(token, resolve, expectations)).rejects.toBeInstanceOf(TokenError);
    },
  );

  it("ヘッダーが JSON でないトークンは拒否する", async () => {
    const head = Buffer.from("not json", "utf8").toString("base64url");

    await expect(verifyIdToken(`${head}.e30.AAAA`, resolve, expectations)).rejects.toBeInstanceOf(
      TokenError,
    );
  });

  it("鍵の解決が KeySourceError で失敗したら、そのまま伝える（TokenError にしない）", async () => {
    const failing = async (): Promise<KeyObject | undefined> => {
      throw new KeySourceError("down");
    };

    await expect(
      verifyIdToken(signToken(validClaims(), key), failing, expectations),
    ).rejects.toBeInstanceOf(KeySourceError);
  });
});

describe("createKeyResolver", () => {
  const ttlMs = 5 * 60 * 1000;
  const minRefreshIntervalMs = 60 * 1000;

  function setup(initial: Array<TestKey | Record<string, unknown>>) {
    let keys = initial;
    let t = NOW_MS;
    const fetchImpl = vi.fn(async () => jwksResponse(keys));
    const resolver = createKeyResolver({
      jwksUri: "https://example.test/jwks.json",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => t,
      ttlMs,
      minRefreshIntervalMs,
    });
    return {
      resolver,
      fetchImpl,
      setKeys: (next: Array<TestKey | Record<string, unknown>>) => {
        keys = next;
      },
      advance: (ms: number) => {
        t += ms;
      },
    };
  }

  it("有効期間内は再取得しない", async () => {
    const { resolver, fetchImpl } = setup([key]);

    expect(await resolver("kid-1")).toBeDefined();
    expect(await resolver("kid-1")).toBeDefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("有効期間を過ぎたら再取得する", async () => {
    const { resolver, fetchImpl, advance } = setup([key]);
    await resolver("kid-1");

    advance(ttlMs + 1);
    await resolver("kid-1");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("未知の kid は、最後の取得から 1 分以上たっていれば 1 回だけ再取得する（鍵のローテーション）", async () => {
    const rotated = createTestKey("kid-2");
    const { resolver, fetchImpl, advance, setKeys } = setup([key]);
    await resolver("kid-1");

    advance(minRefreshIntervalMs + 1);
    setKeys([key, rotated]);

    expect(await resolver("kid-2")).toBeDefined();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("未知の kid を連打しても、1 分以内は再取得しない", async () => {
    const { resolver, fetchImpl } = setup([key]);

    expect(await resolver("zzz")).toBeUndefined();
    expect(await resolver("zzz")).toBeUndefined();
    expect(await resolver("zzz")).toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("初回の取得で未知の kid でも、二重には取得しない", async () => {
    const { resolver, fetchImpl } = setup([key]);

    expect(await resolver("zzz")).toBeUndefined();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("kid の無い鍵と RSA でない鍵は無視する", async () => {
    const { resolver } = setup([
      { kty: "oct", kid: "sym", k: "AAAA" },
      { kty: "RSA", n: "AQAB", e: "AQAB" },
      key,
    ]);

    expect(await resolver("sym")).toBeUndefined();
    expect(await resolver("kid-1")).toBeDefined();
  });

  it("取得のネットワーク失敗は KeySourceError", async () => {
    const resolver = createKeyResolver({
      jwksUri: "https://example.test/jwks.json",
      fetchImpl: (async () => {
        throw new Error("down");
      }) as unknown as typeof fetch,
      now: () => NOW_MS,
      ttlMs,
      minRefreshIntervalMs,
    });

    await expect(resolver("kid-1")).rejects.toBeInstanceOf(KeySourceError);
  });

  it.each([
    ["200 以外", () => new Response("x", { status: 500 })],
    ["JSON でない本文", () => new Response("not json", { status: 200 })],
    ["keys が配列でない", () => new Response(JSON.stringify({ keys: "x" }), { status: 200 })],
  ])("取得の結果が %s なら KeySourceError", async (_name, make) => {
    const resolver = createKeyResolver({
      jwksUri: "https://example.test/jwks.json",
      fetchImpl: (async () => make()) as unknown as typeof fetch,
      now: () => NOW_MS,
      ttlMs,
      minRefreshIntervalMs,
    });

    await expect(resolver("kid-1")).rejects.toBeInstanceOf(KeySourceError);
  });
});
