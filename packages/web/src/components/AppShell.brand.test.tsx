// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AppShell } from "./AppShell.js";

/**
 * 左上の ROLUST の見分けやすさ（Issue #225）。
 *
 * Cloudscape の `warnOnce` は、同じ警告をモジュールの寿命の間に 1 度しか出さない。
 * 警告の有無を見るテストは、AppShell を最初に描画するものでなければならないので、
 * `AppShell.test.tsx` とは別のファイルにして、このファイルの最初のテストに置く。
 */

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ブランド表示（Issue #225）", () => {
  it("TopNavigation に children と identity を併用しない。併用すると Cloudscape が identity を無視し、効かない指定が残る（開発時に警告が出る）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    render(
      <AppShell path="/pool">
        <p>本文</p>
      </AppShell>,
    );

    const messages = warn.mock.calls.map((call) => call.join(" "));
    expect(messages.filter((message) => message.includes("structured props"))).toEqual([]);
  });

  it("ROLUST は、右隣の画面名の文字サイズを継承せず、自分のサイズを持つ。同じ大きさだと見分けがつかない", () => {
    const { container } = render(
      <AppShell path="/pool">
        <p>本文</p>
      </AppShell>,
    );

    const brand = screen.getByTestId("brand");
    const current = container.querySelector<HTMLElement>('a[aria-current="page"]');
    expect(current).not.toBeNull();

    expect(brand.style.fontSize).not.toBe("");
    expect(brand.style.fontSize).not.toBe(current?.style.fontSize);
  });

  it("ROLUST とナビ項目の間に区切りがある。大きさだけでなく、まとまりでも分ける", () => {
    render(
      <AppShell path="/pool">
        <p>本文</p>
      </AppShell>,
    );

    expect(screen.getByTestId("brand").style.borderRight).toMatch(/^1px solid /);
  });
});
