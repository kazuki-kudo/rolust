import { describe, expect, it } from "vitest";

import { detectLocale, LOCALE_STORAGE_KEY, readStoredLocale, saveLocale } from "./locale.js";

describe("detectLocale", () => {
  it("保存した言語を、ブラウザの言語より優先する", () => {
    expect(detectLocale({ stored: "en", languages: ["ja-JP"] })).toBe("en");
    expect(detectLocale({ stored: "ja", languages: ["en-US"] })).toBe("ja");
  });

  it.each([
    [["ja"], "ja"],
    [["ja-JP", "en-US"], "ja"],
    [["JA"], "ja"],
    [["en-US"], "en"],
    [["zh-CN"], "en"],
    [["jaz"], "en"],
    [[], "en"],
  ] as const)("ブラウザの言語 %j は %s になる", (languages, expected) => {
    expect(detectLocale({ stored: null, languages })).toBe(expected);
  });

  it("壊れた保存値（ja・en 以外）は無視して、ブラウザの言語で決める", () => {
    expect(detectLocale({ stored: "fr", languages: ["ja"] })).toBe("ja");
    expect(detectLocale({ stored: "", languages: ["en"] })).toBe("en");
  });
});

describe("readStoredLocale / saveLocale", () => {
  it("読み書きできる", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    };
    saveLocale(storage, "en");
    expect(memory.get(LOCALE_STORAGE_KEY)).toBe("en");
    expect(readStoredLocale(storage)).toBe("en");
  });

  it("localStorage が例外を投げても、読みは null、書きは何もしない（動作を止めない）", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredLocale(broken)).toBeNull();
    expect(() => saveLocale(broken, "en")).not.toThrow();
  });

  it("storage が無い（null）ときも落ちない", () => {
    expect(readStoredLocale(null)).toBeNull();
    expect(() => saveLocale(null, "ja")).not.toThrow();
  });
});
