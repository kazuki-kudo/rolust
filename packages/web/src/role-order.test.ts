import { describe, expect, it } from "vitest";

import { moveInOrder, orderChangeCount } from "./role-order.js";

describe("moveInOrder", () => {
  it("隣と入れ替える", () => {
    expect(moveInOrder(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(moveInOrder(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  });

  it("端なら同じ並びを返す", () => {
    expect(moveInOrder(["a", "b"], "a", -1)).toEqual(["a", "b"]);
    expect(moveInOrder(["a", "b"], "b", 1)).toEqual(["a", "b"]);
  });

  it("並びに無い ARN は同じ並びを返す", () => {
    expect(moveInOrder(["a", "b"], "x", 1)).toEqual(["a", "b"]);
  });

  it("元の配列を変えない", () => {
    const order = ["a", "b"];
    moveInOrder(order, "a", 1);
    expect(order).toEqual(["a", "b"]);
  });
});

describe("orderChangeCount（編集モードの「変更 n 件」「保存（n 件）」）", () => {
  it("位置が変わったロールの件数を数える", () => {
    expect(orderChangeCount(["a", "b", "c"], ["b", "a", "c"])).toBe(2);
    expect(orderChangeCount(["a", "b", "c"], ["c", "a", "b"])).toBe(3);
  });

  it("変わらなければ 0", () => {
    expect(orderChangeCount(["a", "b", "c"], ["a", "b", "c"])).toBe(0);
  });

  it("元に戻せば 0 に戻る", () => {
    const moved = moveInOrder(["a", "b", "c"], "a", 1);
    expect(orderChangeCount(["a", "b", "c"], moveInOrder(moved, "a", -1))).toBe(0);
  });
});
