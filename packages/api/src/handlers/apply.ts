import type { Route } from "../http.js";
import { readCsvQuery, requireObjectBody, requireString, requireStringArray } from "../http.js";
import { applyChangeRequests } from "../services/apply-service.js";
import { computeDiffViews } from "../services/diff-service.js";
import { adoptDrift, restoreDrift } from "../services/drift-repair-service.js";
import { computeDriftViews } from "../services/drift-service.js";

/**
 * 差分確認と反映の API（FR-4.1 / FR-4.2 / FR-5.1〜FR-5.6 / 画面 4）。
 *
 * この 2 系統（差分・反映）だけが AWS の IAM API を呼ぶ（FR-5.7）。
 * 差分は `iam:GetRole` まで、反映は `iam:GetRole` + `iam:UpdateAssumeRolePolicy`。
 * 乖離の確認（`GET /drift`。FR-4.9）も Diff 系統で、`iam:GetRole` だけを使う読み取りである。
 */

export const diffRoutes: Route[] = [
  {
    /** `/diff?ids=cr-1,cr-2`（MQ-2 の URL 設計に対応）。 */
    method: "GET",
    pattern: "/diff",
    requires: "view",
    handler: async ({ query, deployAccountId }) => {
      const ids = readCsvQuery(query, "ids");
      const views = await computeDiffViews(ids, deployAccountId);
      return { statusCode: 200, body: { views } };
    },
  },
  {
    /**
     * 登録済みの割り当てと実際の信頼ポリシーの乖離の確認（FR-4.9。Issue #170）。
     * 利用者の指示でだけ呼ばれ、全ロールを読み取りだけで確かめる。保存しない（D-1）。
     */
    method: "GET",
    pattern: "/drift",
    requires: "view",
    handler: async ({ deployAccountId }) => {
      const response = await computeDriftViews(deployAccountId);
      return { statusCode: 200, body: response };
    },
  },
  {
    /** 乖離を直す: IAM を記録に合わせる下書きの申請を作る（FR-4.10。Issue #172）。 */
    method: "POST",
    pattern: "/drift/restore",
    requires: "edit",
    handler: async ({ body, deployAccountId, actor }) => {
      const roleArn = requireString(requireObjectBody(body), "roleArn");
      const response = await restoreDrift(roleArn, new Date().toISOString(), actor, deployAccountId);
      return { statusCode: 200, body: response };
    },
  },
  {
    /** 乖離を直す: 記録を IAM の現状に合わせる。AWS は書き換えない（FR-4.11。Issue #172）。 */
    method: "POST",
    pattern: "/drift/adopt",
    requires: "edit",
    handler: async ({ body, deployAccountId, actor }) => {
      const roleArn = requireString(requireObjectBody(body), "roleArn");
      const response = await adoptDrift(roleArn, new Date().toISOString(), actor, deployAccountId);
      return { statusCode: 200, body: response };
    },
  },
];

export const applyRoutes: Route[] = [
  {
    /**
     * 一括反映（FR-5.4）。ロール単位の成否を必ず返す。
     *
     * 1 ロールの失敗が他ロールの結果を不明にしてはならないため、
     * 全体を 500 にせず 200 で成否の配列を返す。
     */
    method: "POST",
    pattern: "/apply",
    requires: "apply",
    handler: async ({ body, deployAccountId, actor }) => {
      const payload = requireObjectBody(body);
      const changeRequestIds = requireStringArray(payload, "changeRequestIds");

      const reports = await applyChangeRequests(
        changeRequestIds,
        new Date().toISOString(),
        deployAccountId,
        actor,
      );
      const applied = reports.filter((report) => report.ok).length;

      return {
        statusCode: 200,
        body: { reports, total: reports.length, applied },
      };
    },
  },
];
