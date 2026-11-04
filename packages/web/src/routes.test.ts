import { describe, expect, it } from "vitest";

import { NAV_ITEMS, ROUTES, requestUrl } from "./routes.js";

describe("経路（Issue #108。ユーザプールは 1 つ）", () => {
  it("ユーザプール管理は /pool で、/pools は持たない", () => {
    expect(ROUTES.pool).toBe("/pool");
    expect(ROUTES).not.toHaveProperty("pools");
  });

  it("ナビゲーションの先頭は「ユーザプール」で、/pool へ向かう", () => {
    expect(NAV_ITEMS[0]).toEqual({ path: "/pool", labelKey: "pool", testId: "nav-pools" });
  });

  it("ナビゲーションの 2 番目は「IAMロール管理」（FR-7.2）で、/roles へ向かう", () => {
    expect(NAV_ITEMS[1]).toEqual({ path: "/roles", labelKey: "roles", testId: "nav-roles" });
  });
});

describe("申請の URL（Issue #141）", () => {
  it("origin と画面 4 の経路を連結する", () => {
    expect(requestUrl("https://x.example", "cr-1")).toBe("https://x.example/requests?ids=cr-1");
  });

  it("ID はエンコードする（カンマや日本語で、複数 ID の区切りと混ざらない）", () => {
    expect(requestUrl("https://x.example", "a,b 田中")).toBe(
      `https://x.example/requests?ids=${encodeURIComponent("a,b 田中")}`,
    );
  });
});
