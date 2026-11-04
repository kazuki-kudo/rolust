// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { identityOf } from "../actor.js";
import { hiddenKey } from "../matrix-hidden.js";
import { useMatrixHidden } from "./useMatrixHidden.js";

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function stored(identity: string): unknown {
  const raw = window.localStorage.getItem(hiddenKey(identity));
  return raw === null ? null : JSON.parse(raw);
}

describe("identityOf", () => {
  it("sub を優先し、無ければ name、どちらも無ければ null", () => {
    expect(identityOf({ name: "alice", sub: "sub-1" })).toBe("sub-1");
    expect(identityOf({ name: "alice" })).toBe("alice");
    expect(identityOf(null)).toBeNull();
  });
});

describe("useMatrixHidden", () => {
  it("隠す・再表示・すべて表示・畳みが状態に出て、変わるたびに保存される", () => {
    const { result } = renderHook(() => useMatrixHidden("sub-1"));
    act(() => result.current.hideRole("a"));
    act(() => result.current.hideRole("b"));
    act(() => result.current.toggleFold("c1"));
    expect([...result.current.hidden.roleArns].sort()).toEqual(["a", "b"]);
    expect(stored("sub-1")).toEqual({ roleArns: ["a", "b"], foldedColumnIds: ["c1"] });

    act(() => result.current.showRole("a"));
    expect(stored("sub-1")).toEqual({ roleArns: ["b"], foldedColumnIds: ["c1"] });
    act(() => result.current.toggleFold("c1"));
    act(() => result.current.showAllRoles());
    expect(stored("sub-1")).toEqual({ roleArns: [], foldedColumnIds: [] });
  });

  it("マウントし直しても状態が残る（読み直しをまたぐ）", () => {
    const first = renderHook(() => useMatrixHidden("sub-1"));
    act(() => first.result.current.hideRole("a"));
    first.unmount();

    const second = renderHook(() => useMatrixHidden("sub-1"));
    expect([...second.result.current.hidden.roleArns]).toEqual(["a"]);
  });

  it("別の識別子の状態は混ざらない", () => {
    const one = renderHook(() => useMatrixHidden("sub-1"));
    act(() => one.result.current.hideRole("a"));
    const two = renderHook(() => useMatrixHidden("sub-2"));
    expect([...two.result.current.hidden.roleArns]).toEqual([]);
    expect(stored("sub-2")).toBeNull();
  });

  it("識別子が null の間は、メモリ上で動くが、保存しない", () => {
    const { result } = renderHook(() => useMatrixHidden(null));
    act(() => result.current.hideRole("a"));
    expect([...result.current.hidden.roleArns]).toEqual(["a"]);
    expect(window.localStorage.length).toBe(0);
  });

  it("sync は現在の列に無い値を捨て、保存し直す（D-9）。変化が無ければ書かない", () => {
    const { result } = renderHook(() => useMatrixHidden("sub-1"));
    act(() => result.current.hideRole("a"));
    act(() => result.current.hideRole("gone"));
    act(() => result.current.toggleFold("gone-col"));

    act(() => result.current.sync(["a", "b"], ["c1"]));
    expect(stored("sub-1")).toEqual({ roleArns: ["a"], foldedColumnIds: [] });

    const setItem = vi.spyOn(Storage.prototype, "setItem");
    act(() => result.current.sync(["a", "b"], ["c1"]));
    expect(setItem).not.toHaveBeenCalled();
  });

  it("localStorage が投げても、状態は動く（D-10）", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const { result } = renderHook(() => useMatrixHidden("sub-1"));
    act(() => result.current.hideRole("a"));
    expect([...result.current.hidden.roleArns]).toEqual(["a"]);
  });
});
