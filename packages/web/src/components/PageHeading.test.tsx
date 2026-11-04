// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PageHeading } from "./PageHeading.js";

afterEach(cleanup);

describe("PageHeading（Issue #155）", () => {
  it("見出しと件数が同じ行にある", () => {
    render(<PageHeading title="IAMロール割り当て" counts="IAMユーザ 14 / IAMロール 6" />);
    const heading = screen.getByRole("heading", { level: 1, name: "IAMロール割り当て" });
    const counts = screen.getByTestId("page-heading-counts");
    expect(counts.textContent).toBe("IAMユーザ 14 / IAMロール 6");
    // 見出しと件数は、件数の親（自前の flex の行）の中にある。Cloudscape の Header は内側に独自の div を挟むので、
    // 見出しの直接の親とは比べない。
    const row = counts.parentElement as HTMLElement;
    expect(row.contains(heading)).toBe(true);
    // 件数が見出しの下へ折り返さないよう、内側の行は折り返さない（実測で確かめた。Issue #155）。
    expect(row.style.flexWrap).toBe("nowrap");
    // 件数は縮めない・折り返さない（縮むと 2 行に割れる。実測で確かめた。Issue #155）。
    expect(counts.style.whiteSpace).toBe("nowrap");
    expect(counts.style.flexShrink).toBe("0");
  });

  it("操作は見出しと同じ外側の行の右側に置く", () => {
    render(
      <PageHeading title="IAMユーザ" counts="IAMユーザ 3 件" actions={<button>ユーザを新規登録</button>} />,
    );
    const row = screen.getByTestId("page-heading");
    expect(within(row).getByRole("button", { name: "ユーザを新規登録" })).toBeTruthy();
    expect(within(row).getByRole("heading", { level: 1 })).toBeTruthy();
  });

  it("件数と操作を省略できる", () => {
    render(<PageHeading title="申請履歴" />);
    expect(screen.queryByTestId("page-heading-counts")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "申請履歴" })).toBeTruthy();
  });
});
