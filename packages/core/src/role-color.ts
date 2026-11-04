/**
 * IamRole の背景色の固定パレット（FR-2.5。Issue #100）。
 *
 * 自由な色を受けず、パレットの ID だけを保存する。各背景に対する文字の色のコントラスト比は、
 * `role-color.test.ts` が全色で 4.5:1 以上を機械判定する。ライトテーマだけを扱う
 * （ダークモードは poc では扱わない。`design-system-mapping.md`）。
 */
export const ROLE_COLORS = [
  { id: "red", name: "赤", background: "#fbd9d9" },
  { id: "orange", name: "橙", background: "#fde5cc" },
  { id: "yellow", name: "黄", background: "#fbf2c0" },
  { id: "green", name: "緑", background: "#d6f0d3" },
  { id: "teal", name: "青緑", background: "#cdeeee" },
  { id: "blue", name: "青", background: "#d3e5fb" },
  { id: "purple", name: "紫", background: "#e5d9f7" },
  { id: "pink", name: "桃", background: "#f9d9ea" },
] as const;

export type RoleColorId = (typeof ROLE_COLORS)[number]["id"];

/** Cloudscape のライトテーマの本文色。色付きのヘッダの文字に使う。 */
export const ROLE_TEXT_COLOR = "#000716";
/** 補助文字（アカウント ID など）。既定の `#5f6b7a` は淡い背景で 4.5:1 を下回る（最小 4.03）ので、色付きのヘッダでは濃くする。 */
export const ROLE_SECONDARY_TEXT_COLOR = "#414d5c";

export function isRoleColorId(value: unknown): value is RoleColorId {
  return typeof value === "string" && ROLE_COLORS.some((color) => color.id === value);
}

export function roleColorOf(
  id: RoleColorId | null,
): { id: RoleColorId; name: string; background: string } | null {
  if (id === null) return null;
  const found = ROLE_COLORS.find((color) => color.id === id);
  return found ? { id: found.id, name: found.name, background: found.background } : null;
}

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : Math.pow((scaled + 0.055) / 1.055, 2.4);
}

function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

/** WCAG 2.x のコントラスト比（`#rrggbb` 同士）。 */
export function contrastRatio(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
