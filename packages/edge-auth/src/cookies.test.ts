import { describe, expect, it } from "vitest";

import { clearCookie, parseCookies, serializeCookie } from "./cookies.js";

function withCookies(...values: string[]) {
  return { headers: { cookie: values.map((value) => ({ key: "Cookie", value })) } };
}

describe("parseCookies", () => {
  it("1 つのヘッダーの複数の Cookie を読む（空白あり）", () => {
    const cookies = parseCookies(withCookies("a=1; b=2;c=3"));

    expect([...cookies]).toEqual([
      ["a", "1"],
      ["b", "2"],
      ["c", "3"],
    ]);
  });

  it("複数のヘッダー行をまとめて読む", () => {
    const cookies = parseCookies(withCookies("a=1", "b=2"));

    expect(cookies.get("a")).toBe("1");
    expect(cookies.get("b")).toBe("2");
  });

  it("値に = を含んでも、最初の = で分ける", () => {
    expect(parseCookies(withCookies("t=abc==")).get("t")).toBe("abc==");
  });

  it("同名が複数あれば、最初のものを採る", () => {
    expect(parseCookies(withCookies("a=1; a=2")).get("a")).toBe("1");
  });

  it("名前が空・= が無い要素は読み飛ばす", () => {
    const cookies = parseCookies(withCookies("=x; novalue; ok=1"));

    expect([...cookies]).toEqual([["ok", "1"]]);
  });

  it("Cookie ヘッダーが無ければ空", () => {
    expect(parseCookies({ headers: {} }).size).toBe(0);
  });

  it("__proto__ という名前の Cookie も、ただの値として読む", () => {
    const cookies = parseCookies(withCookies("__proto__=x"));

    expect(cookies.get("__proto__")).toBe("x");
  });
});

describe("serializeCookie / clearCookie", () => {
  it("Secure・HttpOnly・SameSite=Lax・Path=/ と Max-Age を付ける", () => {
    expect(serializeCookie("__Host-x", "v", 300)).toBe(
      "__Host-x=v; Max-Age=300; Path=/; Secure; HttpOnly; SameSite=Lax",
    );
  });

  it("clearCookie は Max-Age=0 で値を空にする", () => {
    expect(clearCookie("__Host-x")).toBe(
      "__Host-x=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax",
    );
  });
});
