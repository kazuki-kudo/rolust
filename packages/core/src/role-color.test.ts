import { describe, expect, it } from "vitest";

import {
  ROLE_COLORS,
  ROLE_SECONDARY_TEXT_COLOR,
  ROLE_TEXT_COLOR,
  contrastRatio,
  isRoleColorId,
  roleColorOf,
} from "./role-color.js";

describe("contrastRatio（WCAG 2.x の相対輝度）", () => {
  it("黒と白は 21、#767676 と白は約 4.54", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });

  it("前景と背景を入れ替えても同じ", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });
});

describe("パレット（spec D-4・成功基準 5）", () => {
  it("8 色で、ID・名前・背景色が重複しない", () => {
    expect(ROLE_COLORS).toHaveLength(8);
    expect(new Set(ROLE_COLORS.map((color) => color.id)).size).toBe(8);
    expect(new Set(ROLE_COLORS.map((color) => color.name)).size).toBe(8);
    expect(new Set(ROLE_COLORS.map((color) => color.background)).size).toBe(8);
  });

  it.each(ROLE_COLORS.map((color) => [color.id, color.background] as const))(
    "%s の背景に対して、ヘッダの本文・補助文字が 4.5:1 以上",
    (_id, background) => {
      expect(contrastRatio(ROLE_TEXT_COLOR, background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(ROLE_SECONDARY_TEXT_COLOR, background)).toBeGreaterThanOrEqual(4.5);
    },
  );
});

describe("isRoleColorId・roleColorOf", () => {
  it("パレットの ID だけを受ける", () => {
    expect(isRoleColorId("red")).toBe(true);
    expect(isRoleColorId("fuchsia")).toBe(false);
    expect(isRoleColorId("")).toBe(false);
    expect(isRoleColorId(1)).toBe(false);
    expect(isRoleColorId(null)).toBe(false);
  });

  it("roleColorOf は ID から色を引き、null（なし）は null", () => {
    expect(roleColorOf("blue")?.name).toBe("青");
    expect(roleColorOf(null)).toBeNull();
  });
});
