import type { RequiredPermission } from "@rolust/core";
import { describe, expect, it } from "vitest";

import type { Route } from "../http.js";
import { applyRoutes, diffRoutes } from "./apply.js";
import { changeRequestRoutes } from "./change-requests.js";
import { configRoutes } from "./config.js";
import { matrixRoutes } from "./matrix.js";
import { meRoutes } from "./me.js";
import { poolRoutes } from "./pool.js";
import { roleRoutes } from "./roles.js";

/**
 * 全ルートの必要権限の宣言を、規則に照らして確かめる（Issue #141）。
 *
 * ルートを足して `requires` を書き忘れると、既定の `apply`（最も厳しい）になって安全側には倒れるが、
 * 意図した権限と食い違う。書き忘れをここで落とす。規則:
 * GET は `view`、`POST /apply` は `apply`、`GET /me` は `none`、それ以外の書き込みは `edit`。
 */

const allRoutes: Route[] = [
  ...configRoutes,
  ...poolRoutes,
  ...roleRoutes,
  ...matrixRoutes,
  ...changeRequestRoutes,
  ...diffRoutes,
  ...applyRoutes,
  ...meRoutes,
];

function expected(route: Route): RequiredPermission {
  if (route.method === "GET" && route.pattern === "/me") return "none";
  if (route.method === "POST" && route.pattern === "/apply") return "apply";
  return route.method === "GET" ? "view" : "edit";
}

describe("全ルートの必要権限（Issue #141）", () => {
  it("ルートを集められている（空のテストで素通りしない）", () => {
    expect(allRoutes.length).toBeGreaterThanOrEqual(20);
  });

  it.each(allRoutes.map((route) => [`${route.method} ${route.pattern}`, route] as const))(
    "%s は規則どおりの requires を明示している",
    (_name, route) => {
      expect(route.requires).toBe(expected(route));
    },
  );
});
