// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { localized } from "@rolust/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "../api-client.js";
import { LocaleProvider } from "../i18n/index.js";
import { ErrorPanel } from "./ErrorPanel.js";

afterEach(cleanup);

const notFound = new ApiClientError(404, {
  code: "NotFound",
  message: "IAM ロールが登録されていません: arn:x",
  localized: localized("role.notRegistered", { roleArn: "arn:x" }),
  retryable: true,
});

describe("ErrorPanel", () => {
  it("英語の Provider の下では、本文・エラーコードの見出し・再試行が英語になり、コードは併記される", () => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <ErrorPanel header="Failed to load" error={notFound} onRetry={vi.fn()} />
      </LocaleProvider>,
    );
    const panel = screen.getByTestId("error-panel");
    expect(panel.textContent).toContain("The IAM role is not registered: arn:x");
    expect(panel.textContent).toContain("Error code:");
    expect(panel.querySelector("code")?.textContent).toBe("NotFound");
    expect(panel.textContent).toContain("try again after a while");
    expect(screen.getByTestId("error-panel-retry").textContent).toBe("Retry");
    expect(panel.textContent).not.toMatch(/[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/);
  });

  it("Provider なし（日本語）では、従来の文言が出る", () => {
    render(<ErrorPanel header="読み込めませんでした" error={notFound} onRetry={vi.fn()} />);
    const panel = screen.getByTestId("error-panel");
    expect(panel.textContent).toContain("IAM ロールが登録されていません: arn:x");
    expect(panel.textContent).toContain("エラーコード: NotFound");
    expect(panel.textContent).toContain("（時間をおいて再試行してください）");
    expect(screen.getByTestId("error-panel-retry").textContent).toBe("再試行");
  });
});
