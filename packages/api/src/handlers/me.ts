import type { MeResponse } from "@rolust/core";

import { loadAuthMode } from "../config.js";
import type { Route } from "../http.js";

/**
 * `GET /api/me` — 呼び出した人の権限と実行者（Issue #141）。
 *
 * SPA が操作の有効・無効（と、権限が無いときの案内）を決めるのに使う。拒否そのものは各ルートが行うので、
 * この値は表示の都合にすぎない。権限なし（`none`）の人にも 200 で返す（返せないと、画面が理由を出せない）。
 * IAM にも DynamoDB にも触らない。
 */
export const meRoutes: Route[] = [
  {
    method: "GET",
    pattern: "/me",
    requires: "none",
    handler: async ({ permission, actor }) => {
      const body: MeResponse = { permission, actor, authMode: loadAuthMode() };
      return { statusCode: 200, body };
    },
  },
];
