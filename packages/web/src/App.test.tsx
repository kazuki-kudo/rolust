// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as ApiClientModule from "./api-client.js";
import { navigate } from "./router.js";
import { ROUTES } from "./routes.js";

/**
 * `App` の画面読み込み失敗時のテスト（Issue #4、`interaction-spec.md` GI-11）。
 *
 * 反映で旧チャンクが消えたタブを模して、ユーザプール管理のチャンクの読み込みを失敗させる。
 */

// 権限は apply（Issue #141）。この試験は画面の読み込み失敗を見るもので、権限は別の試験（App.permission.test.tsx）。
vi.mock("./api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: { getMe: vi.fn(async () => ({ permission: "apply", actor: { name: "alice" } })) },
  };
});
vi.mock("./screens/PoolScreen.js", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});
vi.mock("./screens/RolesScreen.js", () => ({
  RolesScreen: () => <p data-testid="roles-stub">IAMロール管理</p>,
}));

const { App } = await import("./App.js");

/**
 * 初回の描画（Cloudscape の部品の初期化）と、遅延読み込みの失敗がエラー境界に届くまでを待つ時間（Issue #228）。
 *
 * `findBy*` の既定（1000ms）は、全体を並列で走らせて CPU を奪い合うと足りなくなり、このファイルの
 * 最初のテストだけが落ちた。条件が成り立てば即座に返るので、通常時は遅くならず、検査も弱くならない。
 */
const WAIT = { timeout: 10_000 };

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  window.history.replaceState({}, "", ROUTES.pool);
});
afterEach(cleanup);

describe("App の画面読み込み失敗", () => {
  it("案内を出し、ナビゲーションは残る", async () => {
    render(<App />);

    expect(await screen.findByTestId("screen-load-error", undefined, WAIT)).toBeDefined();
    expect(screen.getByRole("navigation", { name: "メインナビゲーション" })).toBeDefined();
  });

  it("読み込めた別の画面へ移ると、その画面が出て案内は消える", async () => {
    render(<App />);
    await screen.findByTestId("screen-load-error", undefined, WAIT);

    act(() => navigate(ROUTES.roles));

    expect(await screen.findByTestId("roles-stub", undefined, WAIT)).toBeDefined();
    expect(screen.queryByTestId("screen-load-error")).toBeNull();
  });

  it("旧い /pools は「画面がありません」の案内になる（Issue #108）", async () => {
    window.history.replaceState({}, "", "/pools");
    render(<App />);

    expect(await screen.findByTestId("route-not-found", undefined, WAIT)).toBeDefined();
  });

  it("失敗した画面へ戻ると、同じ案内がもう一度出る", async () => {
    render(<App />);
    await screen.findByTestId("screen-load-error", undefined, WAIT);

    act(() => navigate(ROUTES.roles));
    await screen.findByTestId("roles-stub", undefined, WAIT);
    act(() => navigate(ROUTES.pool));

    expect(await screen.findByTestId("screen-load-error", undefined, WAIT)).toBeDefined();
  });
});
