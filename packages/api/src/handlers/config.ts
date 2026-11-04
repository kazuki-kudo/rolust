import type { ConfigResponse } from "@rolust/core";

import { loadConfig } from "../config.js";
import type { Route } from "../http.js";

/**
 * `GET /api/config` — デプロイ全体の実行時設定（質問 9 = A / 質問 10 = A）。
 *
 * 返すのは管理対象ロールを示すタグのキーと値。画面 2 のロール登録モーダルが
 * 「対象ロールにはこのタグが必要」という**要件の提示**に使う（GI-1 の意図）。
 *
 * **事前検証には使えない。** 接頭辞方式ではロール名そのものが判定材料だったため
 * 画面側で blur 時に照合できたが、タグは AWS 上のロールにしか存在せず、画面が
 * 持っている情報だけでは原理的に判定できない。判定は `POST /roles` が
 * `iam:ListRoleTags` で行う（Step 18-B）。
 *
 * この経路は **IAM にも DynamoDB にも触らない**。CRUD Lambda の実行ロールは
 * DynamoDB と `iam:ListRoleTags` を持つが、この経路はそのどちらも使わない
 * 純粋な設定の読み出しである。
 *
 * 秘匿情報ではない: 同じ値は登録時検証が返す 400 の本文に含まれており、タグの無い
 * ロール名を 1 度送れば読み取れる。したがって新たに露出する情報はない。
 *
 * `/api/config` は API Gateway の greedy proxy 経由で CRUD Lambda に届くため、
 * Terraform の変更は不要である。
 */
export const configRoutes: Route[] = [
  {
    method: "GET",
    pattern: "/config",
    requires: "view",
    handler: async () => {
      // 設定不備は握り潰さず fail fast させる（`errors.ts` が 500 に写像する）。
      // 空の設定を返すと、画面は要件を表示できないまま登録を促すことになる。
      const { managedTagKey, managedTagValue } = loadConfig();
      const body: ConfigResponse = { managedTagKey, managedTagValue };
      return { statusCode: 200, body };
    },
  },
];
