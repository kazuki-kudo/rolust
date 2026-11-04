// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../i18n/index.js";
import { SkipToActions } from "./SkipToActions.js";

afterEach(cleanup);

describe("SkipToActions の文言（Issue #94）", () => {
  it("日本語では既定の文言を出す", () => {
    render(
      <LocaleProvider initialLocale="ja" storage={null}>
        <SkipToActions targetId="create-request" />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("skip-to-actions").textContent).toBe("マトリクスを飛ばして申請操作へ");
  });

  it("英語では、英語の既定の文言を出す", () => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <SkipToActions targetId="create-request" />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("skip-to-actions").textContent).toBe("Skip the matrix and go to the request actions");
  });

  it("label を渡せば、言語に関わらずそれを出す", () => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <SkipToActions targetId="create-request" label="custom" />
      </LocaleProvider>,
    );
    expect(screen.getByTestId("skip-to-actions").textContent).toBe("custom");
  });
});
