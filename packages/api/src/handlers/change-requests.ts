import { ValidationError, isRoleArn, localized } from "@rolust/core";

import type { Route } from "../http.js";
import { requireObjectBody, requireStringArray } from "../http.js";
import { ensurePool } from "../repository/pool.js";
import {
  createChangeRequests,
  discardChangeRequest,
  listAllChangeRequests,
} from "../services/change-request-service.js";

/**
 * 申請の作成・一覧・破棄の API（FR-4.4 / FR-4.6 / FR-4.8 / 画面 3・画面 5）。
 *
 * 破棄の起点は FR-7.5 申請履歴画面のみである（Q27）。この API に対応する
 * 画面上の導線は画面 5 にしか置かない。
 */

/**
 * `createdFrom`（ISO 8601 の日時）を読む。無い・空なら未指定。解釈できなければ 400。
 * 黙って全件を返すと、不正な呼び出しが気づかれないまま応答が肥大する。
 */
function readCreatedFrom(query: Record<string, string>): string | undefined {
  const raw = query.createdFrom;
  if (raw === undefined || raw === "") return undefined;
  const time = Date.parse(raw);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(raw) || Number.isNaN(time)) {
    throw new ValidationError(localized("changeRequest.createdFromInvalid", { value: raw }), "createdFrom");
  }
  return new Date(time).toISOString();
}

export const changeRequestRoutes: Route[] = [
  {
    method: "GET",
    pattern: "/change-requests",
    requires: "view",
    handler: async ({ query }) => {
      const changeRequests = await listAllChangeRequests({ createdFrom: readCreatedFrom(query) });
      return { statusCode: 200, body: { changeRequests } };
    },
  },
  {
    /**
     * 選択された IamRole ごとに下書きを 1 件ずつ作成する（FR-4.4）。
     *
     * 未反映の申請を持つロールは除外し、除外した旨を `excluded` で返す（FR-4.6）。
     * 既存の ChangeRequest は破棄しない。
     */
    method: "POST",
    pattern: "/change-requests",
    requires: "edit",
    handler: async ({ body, actor }) => {
      const payload = requireObjectBody(body);
      // 申請の元のプールは固定の 1 つ（Issue #108）。本文に poolId があっても読まない。
      const { poolId } = await ensurePool();
      const roleArns = requireStringArray(payload, "roleArns");

      for (const roleArn of roleArns) {
        if (!isRoleArn(roleArn)) {
          throw new ValidationError(localized("arn.notRoleArn", { arn: roleArn }), "roleArns");
        }
      }

      const result = await createChangeRequests(
        poolId,
        roleArns,
        new Date().toISOString(),
        actor,
      );
      return { statusCode: 201, body: result };
    },
  },
  {
    /** 破棄する（FR-4.8）。FR-4.6 のロールロックが解ける副作用を応答に含める。 */
    method: "POST",
    pattern: "/change-requests/:changeRequestId/discard",
    requires: "edit",
    handler: async ({ params }) => {
      const changeRequestId = params.changeRequestId as string;
      const result = await discardChangeRequest(changeRequestId, new Date().toISOString());
      return { statusCode: 200, body: result };
    },
  },
];
