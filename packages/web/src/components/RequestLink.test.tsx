// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/index.js";
import { RequestLink } from "./RequestLink.js";

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});
afterEach(cleanup);

describe("RequestLink（Issue #141）", () => {
  it("申請の ID を出し、コピーすると、この画面の origin の画面 4 の URL を渡す", async () => {
    render(<RequestLink changeRequestId="cr-0142" />);

    expect(screen.getByTestId("request-link-cr-0142").textContent).toContain("cr-0142");

    const button = screen.getByTestId("request-link-cr-0142").querySelector("button");
    expect(button).not.toBeNull();
    fireEvent.click(button as HTMLButtonElement);

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/requests?ids=cr-0142`);
    });
  });

  it("showId=false なら ID を出さず、コピーのボタンだけを出す（申請履歴の操作列）", () => {
    render(<RequestLink changeRequestId="cr-0142" showId={false} />);

    expect(screen.getByTestId("request-link-cr-0142").textContent).not.toContain("cr-0142");
    expect(screen.getByRole("button", { name: "URL をコピー" })).toBeDefined();
  });
});

describe("RequestLink（英語。Issue #94）", () => {
  it("ID の見出しとコピーのボタンの名前が英語になる", () => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <RequestLink changeRequestId="cr-0142" />
      </LocaleProvider>,
    );

    expect(screen.getByTestId("request-link-cr-0142").textContent).toContain("Request ID: ");
    expect(screen.getByRole("button", { name: "Copy URL" })).toBeDefined();
  });
});
