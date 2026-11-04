// @vitest-environment jsdom
import { Suspense } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { lazyScreen } from "../lazy-screen.js";
import { ScreenErrorBoundary } from "./ScreenErrorBoundary.js";

/**
 * `ScreenErrorBoundary` のユニットテスト（Issue #4、`interaction-spec.md` GI-11）。
 *
 * 画面チャンクを読み込めなかったときだけ案内と「再読込」を出し、自動では再読込しない。
 * それ以外のエラーは受け止めず、描画中のバグを「新しい版」の案内で覆い隠さない。
 */

beforeEach(() => {
  // React は ErrorBoundary が受け止めたエラーも console.error に出す。テストの出力を汚さない。
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(cleanup);

const Broken = lazyScreen<object>(() =>
  Promise.reject(new TypeError("Failed to fetch dynamically imported module")),
);

describe("ScreenErrorBoundary", () => {
  it("画面チャンクを読み込めないと、案内と元のエラーの文言と「再読込」を出す", async () => {
    render(
      <ScreenErrorBoundary onReload={() => undefined}>
        <Suspense fallback={<div>読み込み中</div>}>
          <Broken />
        </Suspense>
      </ScreenErrorBoundary>,
    );

    const panel = await screen.findByTestId("screen-load-error");
    expect(panel.textContent).toContain("画面を読み込めませんでした");
    expect(panel.textContent).toContain(
      "新しい版が反映されたか、通信が途切れた可能性があります。ページを再読込してください。",
    );
    expect(panel.textContent).toContain("Failed to fetch dynamically imported module");
    expect(screen.getByTestId("screen-load-error-reload").textContent).toContain("再読込");
  });

  it("「再読込」を押すと onReload を呼ぶ。押すまでは呼ばない", async () => {
    const onReload = vi.fn();
    render(
      <ScreenErrorBoundary onReload={onReload}>
        <Suspense fallback={<div>読み込み中</div>}>
          <Broken />
        </Suspense>
      </ScreenErrorBoundary>,
    );

    const button = await screen.findByTestId("screen-load-error-reload");
    expect(onReload).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it("ScreenLoadError 以外のエラーは受け止めず外へ伝える", () => {
    function Buggy(): React.JSX.Element {
      throw new Error("描画中のバグ");
    }

    expect(() =>
      render(
        <ScreenErrorBoundary onReload={() => undefined}>
          <Buggy />
        </ScreenErrorBoundary>,
      ),
    ).toThrow("描画中のバグ");
    expect(screen.queryByTestId("screen-load-error")).toBeNull();
  });

  it("エラーが無ければ子をそのまま描く", () => {
    render(
      <ScreenErrorBoundary>
        <p>本体</p>
      </ScreenErrorBoundary>,
    );
    expect(screen.getByText("本体")).toBeDefined();
  });
});
