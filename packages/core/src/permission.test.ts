import { describe, expect, it } from "vitest";

import { parseGroups, permissionFromGroups, permits, PERMISSION_LABELS } from "./permission.js";

describe("permissionFromGroups", () => {
  it.each([
    [["viewer"], "view"],
    [["editor"], "edit"],
    [["applier"], "apply"],
  ] as const)("%j は %s", (groups, expected) => {
    expect(permissionFromGroups(groups)).toBe(expected);
  });

  it("複数のグループは最上位が効く（順序によらない）", () => {
    expect(permissionFromGroups(["viewer", "applier"])).toBe("apply");
    expect(permissionFromGroups(["applier", "viewer"])).toBe("apply");
    expect(permissionFromGroups(["editor", "viewer"])).toBe("edit");
  });

  it("無い・空・未知の名前だけなら none", () => {
    expect(permissionFromGroups([])).toBe("none");
    expect(permissionFromGroups(["admins", "Applier"])).toBe("none");
  });

  it("未知の名前が混ざっても、既知のグループの権限は変わらない", () => {
    expect(permissionFromGroups(["admins", "viewer"])).toBe("view");
  });

  it("プロトタイプのキーに当たる名前は none（継承したプロパティを引かない）", () => {
    expect(permissionFromGroups(["__proto__", "constructor", "toString", "hasOwnProperty"])).toBe("none");
  });
});

describe("permits", () => {
  it.each([
    ["none", "none", true],
    ["none", "view", false],
    ["view", "view", true],
    ["view", "edit", false],
    ["edit", "view", true],
    ["edit", "apply", false],
    ["apply", "edit", true],
    ["apply", "apply", true],
    ["apply", "none", true],
  ] as const)("have=%s need=%s は %s", (have, need, expected) => {
    expect(permits(have, need)).toBe(expected);
  });
});

describe("parseGroups", () => {
  it("文字列の配列だけを読む", () => {
    expect(parseGroups(["viewer", "editor"])).toEqual(["viewer", "editor"]);
  });
  it("配列でなければ空", () => {
    expect(parseGroups(undefined)).toEqual([]);
    expect(parseGroups("applier")).toEqual([]);
    expect(parseGroups({ 0: "applier" })).toEqual([]);
  });
  it("文字列でない要素・空・長すぎる要素は捨てる", () => {
    expect(parseGroups(["a", 1, null, "", "  ", "x".repeat(257), "b"])).toEqual(["a", "b"]);
  });
  it("要素は最大 50 件まで", () => {
    const many = Array.from({ length: 80 }, (_, i) => `g${i}`);
    expect(parseGroups(many)).toHaveLength(50);
  });
});

describe("PERMISSION_LABELS", () => {
  it("画面と API の文言の元", () => {
    expect(PERMISSION_LABELS).toEqual({ view: "参照", edit: "作成", apply: "反映" });
  });
});
