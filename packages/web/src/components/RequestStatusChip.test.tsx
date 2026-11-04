// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ChangeRequestStatus } from "@rolust/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/index.js";
import { RequestStatusChip } from "./RequestStatusChip.js";

/**
 * `RequestStatusChip` のユニットテスト。
 *
 * a11y M-3.6: 状態は色のみで示してはならない。4 状態それぞれが**状態語をテキストとして**
 * 持つことを確かめる。誤読の帰結が AWS 上の権限の誤設定であるため Must に置かれている。
 */

const CASES: { state: ChangeRequestStatus; label: string }[] = [
  { state: "draft", label: "下書き" },
  { state: "applied", label: "反映済み" },
  { state: "failed", label: "失敗" },
  { state: "discarded", label: "破棄" },
];

afterEach(cleanup);

describe("RequestStatusChip", () => {
  it("4 状態が状態語つきで描き分けられる", () => {
    for (const { state, label } of CASES) {
      const { unmount } = render(<RequestStatusChip state={state} />);

      const chip = screen.getByTestId("request-status-chip");
      expect(chip.getAttribute("data-state")).toBe(state);
      expect(chip.textContent).toContain(label);

      unmount();
    }
  });

  it("時刻を併記できる", () => {
    render(<RequestStatusChip state="draft" timestamp="2026-07-30T14:02:00.000Z" />);

    expect(screen.getByTestId("request-status-chip").textContent).toContain("2026-07-30");
  });

  it("エッジケース: interactive のときだけボタンになり onFollow が発火する", () => {
    const onFollow = vi.fn();
    const { unmount } = render(<RequestStatusChip state="failed" />);
    expect(screen.queryByRole("button")).toBeNull();
    unmount();

    render(<RequestStatusChip state="failed" interactive onFollow={onFollow} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onFollow).toHaveBeenCalledTimes(1);
  });

  it("エッジケース: 不正な時刻文字列でも描画が落ちない", () => {
    render(<RequestStatusChip state="applied" timestamp="not-a-date" />);

    expect(screen.getByTestId("request-status-chip").textContent).toContain("反映済み");
  });
});

describe("RequestStatusChip（英語。Issue #94）", () => {
  it("4 状態の状態語が英語になる", () => {
    const expected = { draft: "Draft", applied: "Applied", failed: "Failed", discarded: "Discarded" } as const;
    for (const state of Object.keys(expected) as ChangeRequestStatus[]) {
      const { unmount } = render(
        <LocaleProvider initialLocale="en" storage={null}>
          <RequestStatusChip state={state} />
        </LocaleProvider>,
      );
      expect(screen.getByTestId("request-status-chip").textContent).toBe(expected[state]);
      unmount();
    }
  });
});
