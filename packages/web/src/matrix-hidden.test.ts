import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EMPTY_HIDDEN,
  canHideRole,
  hiddenKey,
  loadHidden,
  pruneHidden,
  saveHidden,
  type MatrixHidden,
} from "./matrix-hidden.js";

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

function hidden(roleArns: string[], foldedColumnIds: string[] = []): MatrixHidden {
  return { roleArns: new Set(roleArns), foldedColumnIds: new Set(foldedColumnIds) };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hiddenKey", () => {
  it("識別子ごとに別のキーになる（D-3）", () => {
    expect(hiddenKey("sub-1")).toBe("rolust:matrix-hidden:v1:sub-1");
    expect(hiddenKey("sub-1")).not.toBe(hiddenKey("sub-2"));
  });
});

describe("saveHidden / loadHidden", () => {
  it("書いた状態を読み戻せる。配列は整列して書く", () => {
    const storage = memoryStorage();
    saveHidden(storage, "u", hidden(["b", "a"], ["z", "y"]));
    expect(storage.getItem(hiddenKey("u"))).toBe(
      JSON.stringify({ roleArns: ["a", "b"], foldedColumnIds: ["y", "z"] }),
    );
    const loaded = loadHidden(storage, "u");
    expect([...loaded.roleArns]).toEqual(["a", "b"]);
    expect([...loaded.foldedColumnIds]).toEqual(["y", "z"]);
  });

  it("保存が無ければ空", () => {
    expect(loadHidden(memoryStorage(), "u")).toEqual(EMPTY_HIDDEN);
  });

  it("識別子が違えば、別の管理者の状態は読まない", () => {
    const storage = memoryStorage();
    saveHidden(storage, "u1", hidden(["a"]));
    expect(loadHidden(storage, "u2")).toEqual(EMPTY_HIDDEN);
  });

  it("壊れた JSON・型の違う値は空に倒し、console.warn に残す（D-10）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const raw of ["{not json", "123", "null", '{"roleArns":"a"}', "[1,2]"]) {
      expect(loadHidden(memoryStorage({ [hiddenKey("u")]: raw }), "u")).toEqual(EMPTY_HIDDEN);
    }
    expect(warn).toHaveBeenCalled();
  });

  it("配列の中の文字列でない要素だけを捨てる", () => {
    const raw = JSON.stringify({ roleArns: ["a", 1, null, "b"], foldedColumnIds: [true, "c"] });
    const loaded = loadHidden(memoryStorage({ [hiddenKey("u")]: raw }), "u");
    expect([...loaded.roleArns]).toEqual(["a", "b"]);
    expect([...loaded.foldedColumnIds]).toEqual(["c"]);
  });

  it("getItem が投げても空で返し、画面を止めない（D-10）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(loadHidden(throwing, "u")).toEqual(EMPTY_HIDDEN);
    expect(warn).toHaveBeenCalled();
  });

  it("setItem が投げても投げ返さず、console.warn に残す（D-10）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const throwing = {
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => saveHidden(throwing, "u", hidden(["a"]))).not.toThrow();
    expect(warn).toHaveBeenCalled();
  });

  it("storage が無い（null）ときは何もせず、空を返す", () => {
    expect(loadHidden(null, "u")).toEqual(EMPTY_HIDDEN);
    expect(() => saveHidden(null, "u", hidden(["a"]))).not.toThrow();
  });
});

describe("pruneHidden（D-9）", () => {
  it("現在の列に無い値を捨てる", () => {
    const pruned = pruneHidden(hidden(["a", "gone"], ["c1", "gone-col"]), ["a", "b"], ["c1"]);
    expect([...pruned.roleArns]).toEqual(["a"]);
    expect([...pruned.foldedColumnIds]).toEqual(["c1"]);
  });

  it("変化が無ければ同じ参照を返す（不要な保存・再描画を避ける）", () => {
    const current = hidden(["a"], ["c1"]);
    expect(pruneHidden(current, ["a", "b"], ["c1", "c2"])).toBe(current);
  });
});

describe("canHideRole（D-5）", () => {
  it("選択中のロールは隠せない。選択していなければ隠せる", () => {
    expect(canHideRole("a", new Set(["a"]))).toBe(false);
    expect(canHideRole("b", new Set(["a"]))).toBe(true);
  });
});
