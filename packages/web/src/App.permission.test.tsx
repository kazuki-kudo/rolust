// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { MeResponse, Permission } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "./api-client.js";
import { LocaleProvider } from "./i18n/index.js";
import type * as ApiClientModule from "./api-client.js";
import { usePermission } from "./permission.js";
import { ROUTES } from "./routes.js";

/**
 * 権限の読み込みと出し分け（Issue #141）。`GET /me` を読むまで画面を出さず、
 * 読めなければ操作できる状態で出さない。
 */

vi.mock("./api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, api: { getMe: vi.fn() } };
});
vi.mock("./screens/PoolScreen.js", () => ({
  PoolScreen: () => {
    const permission = usePermission();
    return <p data-testid="pool-stub">{permission}</p>;
  },
}));

const { App } = await import("./App.js");
const { api } = await import("./api-client.js");

/**
 * 初回の描画（Cloudscape の部品の初期化）を待つ時間（Issue #228）。
 *
 * `findBy*` の既定（1000ms）は、全体を並列で走らせて CPU を奪い合うと足りなくなり、
 * 「読み込みに失敗したら…」が落ちた。条件が成り立てば即座に返るので、通常時は遅くならず、検査も弱くならない。
 */
const WAIT = { timeout: 10_000 };

function me(permission: Permission): MeResponse {
  return { permission, actor: { name: "alice" }, authMode: "basic" };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  window.history.replaceState({}, "", ROUTES.pool);
});
afterEach(() => {
  cleanup();
  // /nowhere などに動かしたまま残さない（同じファイル内の次のテストと、他のテストへ漏らさない）。
  window.history.replaceState({}, "", "/");
});

describe("App の権限（Issue #141）", () => {
  it("読み込み中は画面を出さず、待機表示を出す", async () => {
    vi.mocked(api.getMe).mockReturnValue(new Promise(() => undefined));
    render(<App />);

    expect(screen.getByTestId("permission-loading")).toBeDefined();
    expect(screen.queryByTestId("pool-stub")).toBeNull();
  });

  it("読み込みに失敗したら、画面を出さずに再試行を案内する。再試行で成功すれば画面が出る", async () => {
    vi.mocked(api.getMe)
      .mockRejectedValueOnce(new ApiClientError(0, { code: "NetworkError", message: "接続できません", retryable: true }))
      .mockResolvedValueOnce(me("view"));
    render(<App />);

    expect(await screen.findByTestId("permission-error", undefined, WAIT)).toBeDefined();
    expect(screen.queryByTestId("pool-stub")).toBeNull();

    fireEvent.click(screen.getByTestId("permission-error-retry"));

    expect((await screen.findByTestId("pool-stub", undefined, WAIT)).textContent).toBe("view");
  });

  it("権限なしは、画面を出さずに案内を出す。ナビゲーションは残る", async () => {
    vi.mocked(api.getMe).mockResolvedValue(me("none"));
    render(<App />);

    const notice = await screen.findByTestId("no-permission", undefined, WAIT);
    expect(notice.textContent).toContain("操作できる権限がありません");
    expect(screen.queryByTestId("pool-stub")).toBeNull();
    expect(screen.getByRole("navigation", { name: "メインナビゲーション" })).toBeDefined();
  });

  it.each(["view", "edit", "apply"] as const)("%s なら画面が出て、画面は usePermission で権限を読める", async (permission) => {
    vi.mocked(api.getMe).mockResolvedValue(me(permission));
    render(<App />);

    expect((await screen.findByTestId("pool-stub", undefined, WAIT)).textContent).toBe(permission);
  });

  it("cognito なら、画面と一緒にログアウトのリンクを出す（Issue #160）", async () => {
    vi.mocked(api.getMe).mockResolvedValue({ ...me("apply"), authMode: "cognito" });
    render(<App />);

    expect((await screen.findByTestId("logout-link", undefined, WAIT)).getAttribute("href")).toBe("/logout");
  });
});

describe("App の権限の表示（英語。Issue #94）", () => {
  const renderEn = (): void => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <App />
      </LocaleProvider>,
    );
  };

  it("権限を確認中の表示が英語になる", () => {
    vi.mocked(api.getMe).mockReturnValue(new Promise(() => undefined));
    renderEn();

    expect(screen.getByTestId("permission-loading").textContent).toContain("Checking permissions");
  });

  it("権限を確認できなかった案内が英語になる", async () => {
    vi.mocked(api.getMe).mockRejectedValue(
      new ApiClientError(0, { code: "NetworkError", message: "x", retryable: true }),
    );
    renderEn();

    expect((await screen.findByTestId("permission-error", undefined, WAIT)).textContent).toContain("Could not check permissions");
  });

  it("権限なしの案内とナビが英語になる", async () => {
    vi.mocked(api.getMe).mockResolvedValue(me("none"));
    renderEn();

    const notice = await screen.findByTestId("no-permission", undefined, WAIT);
    expect(notice.textContent).toContain("You have no permission for any operation");
    expect(notice.textContent).toContain("view, edit, or apply");
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeDefined();
  });

  it("対応する画面がない URL の案内が英語になる", async () => {
    vi.mocked(api.getMe).mockResolvedValue(me("view"));
    window.history.replaceState({}, "", "/nowhere");
    renderEn();

    const notice = await screen.findByTestId("route-not-found", undefined, WAIT);
    expect(notice.textContent).toContain("No screen matches this URL");
    expect(screen.getByTestId("route-not-found-home").textContent).toBe("Go to IAM users");
  });
});
