// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ExcludedRole } from "@rolust/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ExclusionBanner } from "./ExclusionBanner.js";

/**
 * `ExclusionBanner` のユニットテスト（FR-4.6）。
 *
 * 除外されたロールと理由が**ロール単位で列挙される**ことを確かめる。件数だけを出して
 * 「どのロールが」を落とすと、管理者は解除すべき申請を特定できない。
 */

const ROLE_ACCOUNT = "555566667777";
const readOnlyAudit = `arn:aws:iam::${ROLE_ACCOUNT}:role/ReadOnlyAudit`;
const billingViewer = `arn:aws:iam::${ROLE_ACCOUNT}:role/BillingViewer`;

const excluded: ExcludedRole[] = [
  { roleArn: readOnlyAudit, reason: "draft", changeRequestId: "cr-0142" },
  { roleArn: billingViewer, reason: "failed", changeRequestId: "cr-0139" },
];

afterEach(cleanup);

describe("ExclusionBanner", () => {
  it("除外されたロールと理由がロール単位で列挙される", () => {
    render(<ExclusionBanner excluded={excluded} />);

    expect(screen.getByTestId("exclusion-banner")).toBeDefined();
    expect(screen.getByText("2 件の IAMロールを申請対象から除外しました")).toBeDefined();

    expect(screen.getByTestId(`exclusion-item-${readOnlyAudit}`).textContent).toContain(
      "ReadOnlyAudit",
    );
    expect(screen.getByTestId(`exclusion-item-${readOnlyAudit}`).textContent).toContain(
      "下書きの申請が 1 件あります",
    );
    expect(screen.getByTestId(`exclusion-item-${billingViewer}`).textContent).toContain(
      "失敗した申請が 1 件あります",
    );
  });

  it("エッジケース: 除外 0 件なら何も描画しない（hidden 状態）", () => {
    const { container } = render(<ExclusionBanner excluded={[]} />);

    expect(container.firstChild).toBeNull();
  });

  it("エッジケース: no-changes は帯に出さない（列自体が選択不可で自明なため）", () => {
    const { container } = render(
      <ExclusionBanner
        excluded={[{ roleArn: readOnlyAudit, reason: "no-changes", changeRequestId: null }]}
      />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("全件除外のときは文面が変わり、理由行から申請履歴へ遷移できる", () => {
    const onNavigateToRequest = vi.fn();
    render(
      <ExclusionBanner
        excluded={excluded}
        allExcluded
        onNavigateToRequest={onNavigateToRequest}
      />,
    );

    expect(screen.getByText("申請を作成できる IAMロールがありません")).toBeDefined();

    fireEvent.click(screen.getByText("下書きの申請が 1 件あります"));
    expect(onNavigateToRequest).toHaveBeenCalledWith("cr-0142");
  });
});
