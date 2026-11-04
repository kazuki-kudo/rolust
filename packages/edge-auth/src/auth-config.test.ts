import { describe, expect, it } from "vitest";

import { parseAuthMode, parseOidcConfig } from "./auth-config.js";

const VALID = {
  issuer: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_X",
  clientId: "client-1",
  authorizationEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize",
  tokenEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/token",
  jwksUri: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_X/.well-known/jwks.json",
};

describe("parseAuthMode", () => {
  it.each(["basic", "cognito"] as const)("%s を受け入れる", (mode) => {
    expect(parseAuthMode(mode)).toBe(mode);
  });

  it.each([undefined, "", "Cognito", "BASIC", " basic", "basic\n", "oidc", "none"])(
    "不正な値（%j）は例外にする",
    (value) => {
      expect(() => parseAuthMode(value)).toThrow();
    },
  );
});

describe("parseOidcConfig", () => {
  it("有効な JSON を解釈する", () => {
    expect(parseOidcConfig(JSON.stringify(VALID))).toEqual(VALID);
  });

  it("余分なキーは捨てる", () => {
    expect(parseOidcConfig(JSON.stringify({ ...VALID, extra: "x" }))).toEqual(VALID);
  });

  it.each([undefined, "", "not json", "[]", "null", '"x"', "1"])(
    "オブジェクトの JSON でない値（%j）は例外にする",
    (value) => {
      expect(() => parseOidcConfig(value)).toThrow();
    },
  );

  it.each(Object.keys(VALID))("%s が無い・空・文字列でないなら例外にする", (key) => {
    expect(() => parseOidcConfig(JSON.stringify({ ...VALID, [key]: undefined }))).toThrow(key);
    expect(() => parseOidcConfig(JSON.stringify({ ...VALID, [key]: "" }))).toThrow(key);
    expect(() => parseOidcConfig(JSON.stringify({ ...VALID, [key]: 1 }))).toThrow(key);
  });

  it.each(["issuer", "authorizationEndpoint", "tokenEndpoint", "jwksUri"])(
    "%s が https:// で始まらなければ例外にする",
    (key) => {
      expect(() =>
        parseOidcConfig(JSON.stringify({ ...VALID, [key]: "http://example.test/x" })),
      ).toThrow("https://");
    },
  );
});

describe("logoutEndpoint（任意の接続先。Issue #160）", () => {
  const base = {
    issuer: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_X",
    clientId: "client-1",
    authorizationEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize",
    tokenEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/token",
    jwksUri: "https://cognito-idp.ap-northeast-1.amazonaws.com/ap-northeast-1_X/.well-known/jwks.json",
  };
  const LOGOUT = "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/logout";

  it("logoutEndpoint があれば読む", () => {
    expect(parseOidcConfig(JSON.stringify({ ...base, logoutEndpoint: LOGOUT })).logoutEndpoint).toBe(LOGOUT);
  });

  it("logoutEndpoint が無くても成功する（キーを持たない）", () => {
    expect(parseOidcConfig(JSON.stringify(base)).logoutEndpoint).toBeUndefined();
  });

  it.each([
    ["空", ""],
    ["http://", "http://rolust-1.example.com/logout"],
    ["null", null],
  ])("logoutEndpoint が %s なら例外", (_name, value) => {
    expect(() => parseOidcConfig(JSON.stringify({ ...base, logoutEndpoint: value }))).toThrow();
  });
});
