// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { syncReducedMotionPreference } from "./reduced-motion.js";

/**
 * GI-8 の後半 — `prefers-reduced-motion: reduce` を Cloudscape へ伝える配線。
 *
 * `disableMotion()` はモックしない。`@cloudscape-design/global-styles` の実装が
 * `<body>` に付ける `awsui-motion-disabled` クラスを直接確かめる。ここをモックすると
 * 「Cloudscape 任せ」を「実装した」と言い換えるだけになり、何も証明しない。
 */

const MOTION_DISABLED_CLASS = "awsui-motion-disabled";

interface FakeQuery {
  matches: boolean;
  listeners: ((event: MediaQueryListEvent) => void)[];
  addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => void;
  removeEventListener: (
    type: string,
    listener: (event: MediaQueryListEvent) => void,
  ) => void;
}

const originalMatchMedia = window.matchMedia;
const queries: FakeQuery[] = [];

function stubMatchMedia(matches: boolean): FakeQuery {
  const query: FakeQuery = {
    matches,
    listeners: [],
    addEventListener: (_type, listener) => {
      query.listeners.push(listener);
    },
    removeEventListener: (_type, listener) => {
      query.listeners = query.listeners.filter((entry) => entry !== listener);
    },
  };
  queries.push(query);
  window.matchMedia = ((requested: string) => {
    // 購読対象のメディアクエリを取り違えていないことも固定する。
    expect(requested).toBe("(prefers-reduced-motion: reduce)");
    return query as unknown as MediaQueryList;
  }) as unknown as typeof window.matchMedia;
  return query;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
  queries.length = 0;
  document.body.classList.remove(MOTION_DISABLED_CLASS);
});

describe("syncReducedMotionPreference（GI-8）", () => {
  it("reduce を宣言している環境では Cloudscape のモーションを無効化する", () => {
    stubMatchMedia(true);

    syncReducedMotionPreference();

    expect(document.body.classList.contains(MOTION_DISABLED_CLASS)).toBe(true);
  });

  it("reduce を宣言していない環境では無効化しない", () => {
    stubMatchMedia(false);

    syncReducedMotionPreference();

    expect(document.body.classList.contains(MOTION_DISABLED_CLASS)).toBe(false);
  });

  it("実行中の OS 設定の変更に追従する", () => {
    const query = stubMatchMedia(false);

    syncReducedMotionPreference();
    expect(document.body.classList.contains(MOTION_DISABLED_CLASS)).toBe(false);

    for (const listener of query.listeners) {
      listener({ matches: true } as MediaQueryListEvent);
    }
    expect(document.body.classList.contains(MOTION_DISABLED_CLASS)).toBe(true);

    for (const listener of query.listeners) {
      listener({ matches: false } as MediaQueryListEvent);
    }
    expect(document.body.classList.contains(MOTION_DISABLED_CLASS)).toBe(false);
  });

  it("解除関数を呼ぶと購読が外れる", () => {
    const query = stubMatchMedia(false);

    const unsubscribe = syncReducedMotionPreference();
    expect(query.listeners).toHaveLength(1);

    unsubscribe();
    expect(query.listeners).toHaveLength(0);
  });

  it("matchMedia を持たない環境では例外を投げない（SPA のマウントを止めない）", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;

    expect(() => syncReducedMotionPreference()()).not.toThrow();
    expect(document.body.classList.contains(MOTION_DISABLED_CLASS)).toBe(false);
  });
});
