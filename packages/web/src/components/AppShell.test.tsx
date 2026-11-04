// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../i18n/index.js";
import { AppShell } from "./AppShell.js";

afterEach(() => {
  cleanup();
  document.documentElement.lang = "";
  document.title = "";
});

describe("トップナビの固定（Issue #133）", () => {
  it("トップナビは画面上端に固定する。AppLayout は headerSelector のナビが固定である前提で、表の固定ヘッダの位置をナビの高さだけ下げるため、固定でないと上端に隙間ができ、行がそこを通り抜ける", () => {
    const { container } = render(
      <AppShell path="/pool">
        <p>本文</p>
      </AppShell>,
    );

    const nav = container.querySelector<HTMLElement>("#rolust-top-nav");
    expect(nav).not.toBeNull();
    expect(nav?.style.position).toBe("sticky");
    expect(nav?.style.top).toBe("0px");
  });
});

describe("横幅の上限（Issue #155）", () => {
  it("コンテンツに最大幅を設けない。ウィンドウ幅に合わせて広がる", () => {
    const { container } = render(
      <AppShell path="/matrix">
        <p>本文</p>
      </AppShell>,
    );

    // AppLayout は maxContentWidth を CSS 変数 --awsui-max-content-width-<hash> で渡す（max-width ではない）。
    // その値が 1440px でないこと。変数の名前は実行ごとに接尾辞が変わるので、接頭辞で探す。
    const styles = [...container.querySelectorAll<HTMLElement>("[style]")].map((el) => el.getAttribute("style") ?? "");
    expect(styles.join("\n")).not.toMatch(/--awsui-max-content-width-\S+: 1440px/);
  });
});

describe("ログアウトのリンク（Issue #160）", () => {
  it("cognito なら、/logout へのリンクを出す（画面遷移。ルーターを通さない）", () => {
    render(
      <AppShell path="/pool" authMode="cognito">
        <p>本文</p>
      </AppShell>,
    );

    const link = screen.getByTestId("logout-link");
    expect(link.getAttribute("href")).toBe("/logout");
    expect(link.textContent).toBe("ログアウト");
  });

  it("basic なら出さない（Review Focus 4）", () => {
    render(
      <AppShell path="/pool" authMode="basic">
        <p>本文</p>
      </AppShell>,
    );

    expect(screen.queryByTestId("logout-link")).toBeNull();
  });

  it("authMode が無ければ出さない（古い API・読み込み前。Review Focus 5）", () => {
    render(
      <AppShell path="/pool">
        <p>本文</p>
      </AppShell>,
    );

    expect(screen.queryByTestId("logout-link")).toBeNull();
  });
});

describe("英語の表示（Issue #94）", () => {
  it("ナビ・ログアウト・ARIA ラベルが英語になる", () => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <AppShell path="/roles" authMode="cognito">
          <div>body</div>
        </AppShell>
      </LocaleProvider>,
    );

    expect(screen.getByTestId("nav-pools").textContent).toBe("IAM users");
    expect(screen.getByTestId("nav-roles").textContent).toBe("IAM roles");
    expect(screen.getByTestId("nav-matrix").textContent).toBe("Role assignments");
    expect(screen.getByTestId("nav-history").textContent).toBe("Request history");
    expect(screen.getByTestId("logout-link").textContent).toBe("Log out");
    expect(screen.getByRole("navigation").getAttribute("aria-label")).toBe("Main navigation");
  });

  it("狭い画面では、デスクトップ専用の案内が英語になる", () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 800 });
    try {
      render(
        <LocaleProvider initialLocale="en" storage={null}>
          <AppShell path="/pool">
            <div>body</div>
          </AppShell>
        </LocaleProvider>,
      );

      const notice = screen.getByTestId("viewport-unsupported");
      expect(notice.textContent).toContain("Use a desktop browser (1024px or wider)");
      expect(notice.textContent).not.toMatch(/[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/);
    } finally {
      Object.defineProperty(window, "innerWidth", { configurable: true, value: original });
    }
  });
});

describe("言語の切替（Issue #94）", () => {
  it("言語を切り替えると、ナビが英語になり、<html lang> と保存が変わる", async () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => void memory.set(key, value),
    };
    render(
      <LocaleProvider initialLocale="ja" storage={storage}>
        <AppShell path="/roles">
          <div>body</div>
        </AppShell>
      </LocaleProvider>,
    );
    expect(screen.getByTestId("nav-roles").textContent).toBe("IAMロール管理");

    fireEvent.click(within(screen.getByTestId("locale-switch")).getByRole("button"));
    fireEvent.click(await screen.findByRole("menuitem", { name: "English" }));

    expect(screen.getByTestId("nav-roles").textContent).toBe("IAM roles");
    expect(document.documentElement.lang).toBe("en");
    expect(memory.get("rolust.locale")).toBe("en");
  });

  it("切替のメニューは、各言語が自分の言語で表記される。ARIA ラベルの先頭はどちらの言語でも同じ", async () => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <AppShell path="/roles">
          <div>body</div>
        </AppShell>
      </LocaleProvider>,
    );
    const trigger = within(screen.getByTestId("locale-switch")).getByRole("button");
    expect(trigger.getAttribute("aria-label")).toBe("言語 / Language: English");
    fireEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: "日本語" })).toBeTruthy();
    expect(await screen.findByRole("menuitem", { name: "English" })).toBeTruthy();
  });

  it("ログアウトのリンクと言語切替は、右端の同じ組に入る", () => {
    render(
      <AppShell path="/pool" authMode="cognito">
        <p>本文</p>
      </AppShell>,
    );
    const group = screen.getByTestId("locale-switch").parentElement;
    expect(group?.contains(screen.getByTestId("logout-link"))).toBe(true);
    expect(group?.style.marginLeft).toBe("auto");
  });
});

describe("言語切替のアクセシブルな名前（Issue #94。WCAG 2.5.3 Label in Name）", () => {
  it.each([
    ["ja", "日本語"],
    ["en", "English"],
  ] as const)("%s: ボタンの見える文字は言語名で、アクセシブルな名前にその言語名を含む", (initialLocale, name) => {
    render(
      <LocaleProvider initialLocale={initialLocale} storage={null}>
        <AppShell path="/roles">
          <div>body</div>
        </AppShell>
      </LocaleProvider>,
    );

    const trigger = within(screen.getByTestId("locale-switch")).getByRole("button");
    expect(trigger.textContent?.trim()).toBe(name);
    const label = trigger.getAttribute("aria-label") ?? "";
    expect(label.startsWith("言語 / Language")).toBe(true);
    expect(label).toContain(name);
    expect(screen.getByRole("button", { name: `言語 / Language: ${name}` })).toBe(trigger);
  });

  it("英語へ切り替えると、アクセシブルな名前が English を含む", async () => {
    render(
      <LocaleProvider initialLocale="ja" storage={null}>
        <AppShell path="/roles">
          <div>body</div>
        </AppShell>
      </LocaleProvider>,
    );
    const trigger = within(screen.getByTestId("locale-switch")).getByRole("button");
    expect(trigger.getAttribute("aria-label")).toContain("日本語");

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("menuitem", { name: "English" }));

    const after = within(screen.getByTestId("locale-switch")).getByRole("button");
    expect(after.getAttribute("aria-label")).toContain("English");
    expect(after.getAttribute("aria-label")).not.toContain("日本語");
  });

  it("メニューの項目に、それぞれの言語の lang が付く（スクリーンリーダーが読み分ける）", async () => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <AppShell path="/roles">
          <div>body</div>
        </AppShell>
      </LocaleProvider>,
    );
    fireEvent.click(within(screen.getByTestId("locale-switch")).getByRole("button"));

    const ja = await screen.findByRole("menuitem", { name: "日本語" });
    const en = await screen.findByRole("menuitem", { name: "English" });
    expect(ja.closest("[lang]")?.getAttribute("lang")).toBe("ja");
    expect(en.closest("[lang]")?.getAttribute("lang")).toBe("en");
  });
});
