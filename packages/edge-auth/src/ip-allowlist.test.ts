import { describe, expect, it } from "vitest";

import { isAllowed, parseAllowlist } from "./ip-allowlist.js";

describe("parseAllowlist / isAllowed（FR-6.2）", () => {
  it("CIDR を付けない IP は、その 1 つだけを許可する（/32）", () => {
    const list = parseAllowlist("203.0.113.5");

    expect(isAllowed("203.0.113.5", list)).toBe(true);
    expect(isAllowed("203.0.113.4", list)).toBe(false);
    expect(isAllowed("203.0.113.6", list)).toBe(false);
  });

  it("/24 は最初と最後のアドレスを含み、そのすぐ外側を含まない", () => {
    const list = parseAllowlist("123.5.7.0/24");

    expect(isAllowed("123.5.7.0", list)).toBe(true);
    expect(isAllowed("123.5.7.255", list)).toBe(true);
    expect(isAllowed("123.5.6.255", list)).toBe(false);
    expect(isAllowed("123.5.8.0", list)).toBe(false);
  });

  it("/0 は全アドレスを許可する（32 ビットのシフトが 0 ビットのシフトになる落とし穴を踏まない）", () => {
    const list = parseAllowlist("0.0.0.0/0");

    for (const ip of ["0.0.0.0", "1.2.3.4", "127.0.0.1", "128.0.0.0", "255.255.255.255"]) {
      expect(isAllowed(ip, list)).toBe(true);
    }
  });

  it("128.0.0.0 以上のアドレスでも、符号付き整数の扱いで判定を誤らない", () => {
    const list = parseAllowlist("128.0.0.0/1");

    expect(isAllowed("128.0.0.0", list)).toBe(true);
    expect(isAllowed("200.1.1.1", list)).toBe(true);
    expect(isAllowed("255.255.255.255", list)).toBe(true);
    expect(isAllowed("127.255.255.255", list)).toBe(false);
    expect(isAllowed("100.1.1.1", list)).toBe(false);
  });

  it("/32 は完全一致だけを許可する（255.255.255.255 を含む）", () => {
    const list = parseAllowlist("255.255.255.255/32");

    expect(isAllowed("255.255.255.255", list)).toBe(true);
    expect(isAllowed("255.255.255.254", list)).toBe(false);
  });

  it("ホストビットが立った CIDR は、マスクして受け入れる", () => {
    const list = parseAllowlist("123.5.7.9/24");

    expect(isAllowed("123.5.7.200", list)).toBe(true);
    expect(isAllowed("123.5.8.9", list)).toBe(false);
  });

  it("カンマ区切りで複数を並べられ、空白は無視され、いずれかに一致すれば許可する", () => {
    const list = parseAllowlist(" 203.0.113.0/24 , 198.51.100.7,10.0.0.0/8 ");

    expect(isAllowed("203.0.113.99", list)).toBe(true);
    expect(isAllowed("198.51.100.7", list)).toBe(true);
    expect(isAllowed("10.200.3.4", list)).toBe(true);
    expect(isAllowed("198.51.100.8", list)).toBe(false);
    expect(isAllowed("11.0.0.1", list)).toBe(false);
  });

  it("put-parameter をファイルから行ったときの末尾の改行を許容する", () => {
    expect(isAllowed("203.0.113.5", parseAllowlist("203.0.113.5\n"))).toBe(true);
    expect(isAllowed("203.0.113.5", parseAllowlist("203.0.113.5\r\n"))).toBe(true);
  });

  it("重複した要素を許容する", () => {
    const list = parseAllowlist("203.0.113.5,203.0.113.5,203.0.113.0/24");

    expect(isAllowed("203.0.113.5", list)).toBe(true);
  });
});

describe("parseAllowlist: 不正な値は例外にする", () => {
  it.each([
    "",
    " ",
    ",",
    "203.0.113.5,",
    ",203.0.113.5",
    "203.0.113.5,,198.51.100.7",
    "1.2.3",
    "1.2.3.4.5",
    "256.1.1.1",
    "1.2.3.256",
    "010.1.1.1",
    "1.2.3.04",
    "1.2.3.4/33",
    "1.2.3.4/",
    "1.2.3.4/08",
    "1.2.3.4/-1",
    "1.2.3.4/2a",
    "1.2.3.4/24/1",
    "/24",
    "1..3.4",
    "-1.2.3.4",
    "+1.2.3.4",
    "1.2.3.a",
    "::1",
    "2001:db8::/32",
    "abc",
    "203.0.113.5 198.51.100.7",
    "203.0.113.5，198.51.100.7",
  ])("%j", (value) => {
    expect(() => parseAllowlist(value)).toThrow();
  });

  it("1 要素でも不正なら全体を不正とし、有効な要素だけを返さない", () => {
    expect(() => parseAllowlist("203.0.113.5,not-an-ip")).toThrow();
  });

  it("例外の文面に不正な要素を含める（運用者が原因を特定できる）", () => {
    expect(() => parseAllowlist("203.0.113.5,256.1.1.1")).toThrow(/256\.1\.1\.1/);
  });
});

describe("isAllowed: IPv4 でない・不正な clientIp", () => {
  const everything = parseAllowlist("0.0.0.0/0");

  it.each([
    undefined,
    "",
    "::1",
    "2001:db8::1",
    "[::1]",
    "abc",
    "203.0.113.1 ",
    "203.0.113.01",
    "1.2.3",
    "1.2.3.4.5",
  ])("全許可でも許可しない: %j", (clientIp) => {
    expect(isAllowed(clientIp, everything)).toBe(false);
  });
});
