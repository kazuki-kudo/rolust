import { describe, expect, it } from "vitest";

import {
  EMPTY_VIEW,
  computeVisibleUserArns,
  isViewActive,
  withFilter,
  withSort,
  withAttrFilter,
  withAttrSort,
  attributeValueOptions,
  ATTRIBUTE_UNSET,
  withUserText,
  type CellValue,
} from "./matrix-view.js";

const USERS = ["u1", "u2", "u3", "u4"];

/** `u1`・`u2` が R1 にチェックあり。`u2` は未反映（checked ≠ reflected）。`u3` は R2 にだけチェックあり。 */
const CELLS: Record<string, CellValue> = {
  "u1|R1": { checked: true, reflected: true },
  "u2|R1": { checked: true, reflected: false },
  "u3|R2": { checked: true, reflected: true },
  "u4|R1": { checked: false, reflected: true },
};

const cellOf = (userArn: string, roleArn: string): CellValue =>
  CELLS[`${userArn}|${roleArn}`] ?? { checked: false, reflected: false };

describe("computeVisibleUserArns", () => {
  it("条件が無ければ元の順のまま返す", () => {
    expect(computeVisibleUserArns(USERS, cellOf, EMPTY_VIEW)).toEqual(USERS);
  });

  it("フィルタ checked は、その列にチェックのある行だけを残す", () => {
    const state = withFilter(EMPTY_VIEW, "R1", "checked");
    expect(computeVisibleUserArns(USERS, cellOf, state)).toEqual(["u1", "u2"]);
  });

  it("フィルタ unchecked は、チェックの無い行（交点のレコードが無い行を含む）を残す", () => {
    const state = withFilter(EMPTY_VIEW, "R1", "unchecked");
    expect(computeVisibleUserArns(USERS, cellOf, state)).toEqual(["u3", "u4"]);
  });

  it("フィルタ changed は checked ≠ reflected の行だけを残す（未反映の削除も含む）", () => {
    const state = withFilter(EMPTY_VIEW, "R1", "changed");
    expect(computeVisibleUserArns(USERS, cellOf, state)).toEqual(["u2", "u4"]);
  });

  it("複数の列のフィルタは AND でかかる", () => {
    const state = withFilter(withFilter(EMPTY_VIEW, "R1", "checked"), "R2", "unchecked");
    expect(computeVisibleUserArns(USERS, cellOf, state)).toEqual(["u1", "u2"]);
    const none = withFilter(withFilter(EMPTY_VIEW, "R1", "checked"), "R2", "checked");
    expect(computeVisibleUserArns(USERS, cellOf, none)).toEqual([]);
  });

  it("ソート checked-first は、チェックありを上に寄せ、同順の行は元の順を保つ（安定）", () => {
    const state = withSort(EMPTY_VIEW, "R1", "checked-first");
    expect(computeVisibleUserArns(USERS, cellOf, state)).toEqual(["u1", "u2", "u3", "u4"]);
    const r2 = withSort(EMPTY_VIEW, "R2", "checked-first");
    expect(computeVisibleUserArns(USERS, cellOf, r2)).toEqual(["u3", "u1", "u2", "u4"]);
  });

  it("ソート unchecked-first は、チェックなしを上に寄せ、同順の行は元の順を保つ（安定）", () => {
    const state = withSort(EMPTY_VIEW, "R2", "unchecked-first");
    expect(computeVisibleUserArns(USERS, cellOf, state)).toEqual(["u1", "u2", "u4", "u3"]);
  });

  it("フィルタとソートは併用できる（絞ってから並べる）", () => {
    const state = withSort(withFilter(EMPTY_VIEW, "R1", "changed"), "R2", "checked-first");
    expect(computeVisibleUserArns(USERS, cellOf, state)).toEqual(["u2", "u4"]);
    const reverse = withSort(withFilter(EMPTY_VIEW, "R1", "unchecked"), "R2", "checked-first");
    expect(computeVisibleUserArns(USERS, cellOf, reverse)).toEqual(["u3", "u4"]);
  });

  it("入力の配列を書き換えない", () => {
    const input = [...USERS];
    computeVisibleUserArns(input, cellOf, withSort(EMPTY_VIEW, "R2", "checked-first"));
    expect(input).toEqual(USERS);
  });
});

describe("withFilter / withSort / isViewActive", () => {
  it("withFilter は列ごとに足し、null で外す。ほかの列と元の状態は変えない", () => {
    const a = withFilter(EMPTY_VIEW, "R1", "checked");
    const b = withFilter(a, "R2", "changed");
    expect(b.filters).toEqual({ R1: "checked", R2: "changed" });
    expect(withFilter(b, "R1", null).filters).toEqual({ R2: "changed" });
    expect(EMPTY_VIEW.filters).toEqual({});
    expect(a.filters).toEqual({ R1: "checked" });
  });

  it("withSort は 1 列だけを持つ。別の列に付けると置き換わり、null で解除する", () => {
    const a = withSort(EMPTY_VIEW, "R1", "checked-first");
    expect(a.sort).toEqual({ kind: "role", roleArn: "R1", order: "checked-first" });
    expect(withSort(a, "R2", "unchecked-first").sort).toEqual({
      kind: "role",
      roleArn: "R2",
      order: "unchecked-first",
    });
    expect(withSort(a, "R1", null).sort).toBeNull();
  });

  it("isViewActive は、フィルタかソートが 1 つでもあれば true", () => {
    expect(isViewActive(EMPTY_VIEW)).toBe(false);
    expect(isViewActive(withFilter(EMPTY_VIEW, "R1", "checked"))).toBe(true);
    expect(isViewActive(withSort(EMPTY_VIEW, "R1", "checked-first"))).toBe(true);
    expect(isViewActive(withFilter(withFilter(EMPTY_VIEW, "R1", "checked"), "R1", null))).toBe(false);
  });
});

describe("ユーザのテキスト絞り込み（Issue #106）", () => {
  const TEXTS: Record<string, string> = {
    u1: "Ayaka.Mori 111122223333",
    u2: "kenji.sato 111122223333",
    u3: "kenji.suzuki 999900001111",
    u4: "mori.taro 999900001111",
  };
  const textOf = (userArn: string): string => TEXTS[userArn] ?? "";
  const visible = (state: Parameters<typeof computeVisibleUserArns>[2]): string[] =>
    computeVisibleUserArns(USERS, cellOf, state, textOf);

  it("部分一致で、大文字小文字を無視する", () => {
    expect(visible(withUserText(EMPTY_VIEW, "MORI"))).toEqual(["u1", "u4"]);
    expect(visible(withUserText(EMPTY_VIEW, "kenji.s"))).toEqual(["u2", "u3"]);
  });

  it("AWSアカウントID でも絞れる", () => {
    expect(visible(withUserText(EMPTY_VIEW, "9999"))).toEqual(["u3", "u4"]);
  });

  it("前後の空白は無視し、空白だけなら条件なし。入力全体を 1 つの語として扱う", () => {
    expect(visible(withUserText(EMPTY_VIEW, "  sato  "))).toEqual(["u2"]);
    expect(visible(withUserText(EMPTY_VIEW, "   "))).toEqual(USERS);
    expect(visible(withUserText(EMPTY_VIEW, "kenji sato"))).toEqual([]);
    expect(isViewActive(withUserText(EMPTY_VIEW, "   "))).toBe(false);
  });

  it("列のフィルタと AND、ソートとも併用できる", () => {
    const state = withFilter(withUserText(EMPTY_VIEW, "mori"), "R1", "checked");
    expect(visible(state)).toEqual(["u1"]);
    const sorted = withSort(withUserText(EMPTY_VIEW, "kenji"), "R1", "checked-first");
    expect(visible(sorted)).toEqual(["u2", "u3"]);
  });

  it("テキストだけでも isViewActive は true。withUserText は元の状態を変えない", () => {
    const next = withUserText(EMPTY_VIEW, "x");
    expect(isViewActive(next)).toBe(true);
    expect(EMPTY_VIEW.userText).toBe("");
    expect(withUserText(next, "").userText).toBe("");
  });

  it("textOf を渡さなければテキスト条件は無いものとして扱う（既存の呼び出しを壊さない）", () => {
    expect(computeVisibleUserArns(USERS, cellOf, withUserText(EMPTY_VIEW, "zzz"))).toEqual(USERS);
  });
});

describe("属性のフィルタ・ソート（Issue #107）", () => {
  const ATTRS: Record<string, Record<string, string>> = {
    u1: { dept: "うま", grade: "2" },
    u2: { dept: "あか", grade: "10" },
    u3: { dept: "いぬ" },
    u4: {},
  };
  const attributeOf = (userArn: string, columnId: string): string | undefined =>
    ATTRS[userArn]?.[columnId];
  const visible = (state: Parameters<typeof computeVisibleUserArns>[2]): string[] =>
    computeVisibleUserArns(USERS, cellOf, state, undefined, attributeOf);

  it("属性フィルタは、その値の行だけを残す。ATTRIBUTE_UNSET は値の無い行（空文字も）を残す", () => {
    expect(visible(withAttrFilter(EMPTY_VIEW, "dept", "あか"))).toEqual(["u2"]);
    expect(visible(withAttrFilter(EMPTY_VIEW, "dept", ATTRIBUTE_UNSET))).toEqual(["u4"]);
    expect(visible(withAttrFilter(EMPTY_VIEW, "grade", ATTRIBUTE_UNSET))).toEqual(["u3", "u4"]);
  });

  it("属性フィルタは、列をまたいで AND で、ロール列のフィルタとも AND", () => {
    const both = withAttrFilter(withAttrFilter(EMPTY_VIEW, "dept", "あか"), "grade", "10");
    expect(visible(both)).toEqual(["u2"]);
    const withRole = withFilter(withAttrFilter(EMPTY_VIEW, "dept", "あか"), "R1", "checked");
    expect(visible(withRole)).toEqual(["u2"]);
    expect(visible(withFilter(withAttrFilter(EMPTY_VIEW, "dept", "うま"), "R1", "unchecked"))).toEqual([]);
  });

  it("属性ソートは日本語の並び。値の無い行は昇順でも降順でも最後。同値は元の順", () => {
    expect(visible(withAttrSort(EMPTY_VIEW, "dept", "asc"))).toEqual(["u2", "u3", "u1", "u4"]);
    expect(visible(withAttrSort(EMPTY_VIEW, "dept", "desc"))).toEqual(["u1", "u3", "u2", "u4"]);
    // grade は u1・u2 だけが値を持つ。数値としては比べない（文字列: "10" < "2"）。
    expect(visible(withAttrSort(EMPTY_VIEW, "grade", "asc"))).toEqual(["u2", "u1", "u3", "u4"]);
    // 値がすべて同じ（無い）列では元の順のまま。
    expect(visible(withAttrSort(EMPTY_VIEW, "none", "desc"))).toEqual(USERS);
  });

  it("ロール列のソートと属性のソートは置き換わる。解除は、その列のソートのときだけ効く", () => {
    const attr = withAttrSort(EMPTY_VIEW, "dept", "asc");
    expect(attr.sort).toEqual({ kind: "attr", columnId: "dept", order: "asc" });
    const role = withSort(attr, "R1", "checked-first");
    expect(role.sort).toEqual({ kind: "role", roleArn: "R1", order: "checked-first" });
    expect(withAttrSort(role, "dept", "desc").sort).toEqual({ kind: "attr", columnId: "dept", order: "desc" });
    // 別の列の「解除」は、有効なソートを消さない。
    expect(withAttrSort(attr, "grade", null).sort).toEqual(attr.sort);
    expect(withSort(attr, "R1", null).sort).toEqual(attr.sort);
    expect(withAttrSort(attr, "dept", null).sort).toBeNull();
  });

  it("withAttrFilter は列ごとに足し、null で外す。元の状態は変えない", () => {
    const a = withAttrFilter(EMPTY_VIEW, "dept", "あか");
    expect(a.attrFilters).toEqual({ dept: "あか" });
    expect(withAttrFilter(a, "dept", null).attrFilters).toEqual({});
    expect(EMPTY_VIEW.attrFilters).toEqual({});
  });

  it("isViewActive は、属性のフィルタか属性のソートがあれば true", () => {
    expect(isViewActive(withAttrFilter(EMPTY_VIEW, "dept", "あか"))).toBe(true);
    expect(isViewActive(withAttrSort(EMPTY_VIEW, "dept", "asc"))).toBe(true);
  });

  it("attributeOf を渡さなければ、属性の条件は無いものとして扱う（既存の呼び出しを壊さない）", () => {
    expect(computeVisibleUserArns(USERS, cellOf, withAttrFilter(EMPTY_VIEW, "dept", "あか"))).toEqual(USERS);
  });

  it("attributeValueOptions は、実在する値（日本語の並び）と件数、値の無いユーザの数を返す", () => {
    const users: { attributes: Record<string, string> }[] = [
      { attributes: { dept: "うま" } },
      { attributes: { dept: "あか" } },
      { attributes: { dept: "あか" } },
      { attributes: { dept: "" } },
      { attributes: {} },
    ];
    expect(attributeValueOptions(users, "dept")).toEqual({
      values: [
        { value: "あか", count: 2 },
        { value: "うま", count: 1 },
      ],
      unset: 2,
    });
    expect(attributeValueOptions([], "dept")).toEqual({ values: [], unset: 0 });
  });
});
