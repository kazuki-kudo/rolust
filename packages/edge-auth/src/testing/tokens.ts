import { generateKeyPairSync, sign, type KeyObject } from "node:crypto";

/** テストだけが使う。`index.ts` から辿れないので Lambda のバンドルには入らない。 */

export interface TestKey {
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  jwk: Record<string, unknown>;
}

export const ISSUER = "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_TEST";
export const CLIENT_ID = "client-1";
/** 秒に丸めても変わらない時刻（`exp` と同じ秒との境界を試すため）。 */
export const NOW_MS = Date.parse("2026-10-05T00:00:00Z");

export function createTestKey(kid: string): TestKey {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return {
    kid,
    privateKey,
    publicKey,
    jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" },
  };
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/** `header` で `alg` や `kid` を上書きできる（署名は常に RSA-SHA256）。 */
export function signToken(
  claims: Record<string, unknown>,
  key: TestKey,
  header: Record<string, unknown> = {},
): string {
  const head = encode({ alg: "RS256", kid: key.kid, typ: "JWT", ...header });
  const body = encode(claims);
  const signature = sign("RSA-SHA256", Buffer.from(`${head}.${body}`, "utf8"), key.privateKey);
  return `${head}.${body}.${signature.toString("base64url")}`;
}

export function validClaims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const seconds = Math.floor(NOW_MS / 1000);
  return {
    sub: "user-1",
    "cognito:username": "alice",
    iss: ISSUER,
    aud: CLIENT_ID,
    token_use: "id",
    iat: seconds - 10,
    exp: seconds + 3600,
    ...overrides,
  };
}

/** `TestKey` はその公開鍵を、それ以外の値はそのまま JWKS の要素にする。 */
export function jwksResponse(keys: Array<TestKey | Record<string, unknown>>): Response {
  const body = { keys: keys.map((key) => ("privateKey" in key ? key.jwk : key)) };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
