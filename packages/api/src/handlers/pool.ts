import type { AddUsersResponse, PoolResponse, PoolView } from "@rolust/core";
import {
  ValidationError,
  assertAccountId,
  isUserArn,
  localized,
  normalizeImportUsers,
  pruneAttributes,
} from "@rolust/core";

import { assertAccountAllowed } from "../aws/allowed-accounts.js";
import type { Route } from "../http.js";
import { readUserNameList, requireObjectBody, requireString } from "../http.js";
import { addUserRows, ensurePool, listUsers } from "../repository/pool.js";
import { listRoleLinks } from "../repository/pool-role-link.js";
import { savePoolAttributeColumns } from "../services/attribute-columns-service.js";
import { deletePoolUser } from "../services/user-delete-service.js";
import { saveUserAttributes } from "../services/user-attributes-service.js";

/**
 * ユーザプール管理の API（FR-1.1〜FR-1.9 / 画面 1）。
 *
 * **AWS へは問い合わせない**（FR-5.7 / C-4。信頼ポリシーを読むのは、ロールの登録 `POST /roles` だけ。Issue #135 で、
 * ロールの紐づけ `PUT /pool/roles` を廃止し、読み取りの例外は登録に移った）。アカウント ID とユーザ名は
 * 書式のみを検証し、実在確認は行わない。
 */

export type { PoolView };

/** 固定プールの識別子を返す。META が無ければ作る（Issue #108）。 */
async function fixedPoolId(): Promise<string> {
  return (await ensurePool()).poolId;
}

export const poolRoutes: Route[] = [
  {
    method: "GET",
    pattern: "/pool",
    requires: "view",
    handler: async () => {
      const pool = await ensurePool();
      const [users, roleArns] = await Promise.all([listUsers(pool.poolId), listRoleLinks(pool.poolId)]);
      // 定義に無い columnId の値（削除した列の古い値）は出さない（Issue #61 spec D-6）。
      const view: PoolView = {
        ...pool,
        users: users.map((user) => ({
          ...user,
          attributes: pruneAttributes(user.attributes, pool.attributeColumns),
        })),
        linkedRoleCount: roleArns.length,
      };
      const body: PoolResponse = { pool: view };
      return { statusCode: 200, body };
    },
  },
  {
    method: "POST",
    pattern: "/pool/users",
    requires: "edit",
    handler: async ({ body }) => {
      const pool = await ensurePool();
      const poolId = pool.poolId;

      const payload = requireObjectBody(body);
      const accountId = assertAccountId(requireString(payload, "accountId"));
      // `userNames`（改行区切り・属性なし）か `users`（属性つき。Issue #98）のどちらか一方。
      const hasUsers = payload.users !== undefined;
      const hasUserNames = payload.userNames !== undefined;
      if (hasUsers === hasUserNames) {
        throw new ValidationError(localized("pool.usersSpecifyOne", {}), "users");
      }
      const rows = hasUsers
        ? normalizeImportUsers(payload.users, pool.attributeColumns)
        : readUserNameList(payload).map((userName) => ({ userName, attributes: {} }));

      // 許可リスト（Issue #139）。入力の書式を確かめた後、1 件も書く前に検証する。CSV 一括登録（users 形式）も同じ入口を通る。
      await assertAccountAllowed(accountId);

      const results = await addUserRows(poolId, accountId, rows, new Date().toISOString());
      const created = results.filter((result) => result.created).length;
      const response: AddUsersResponse = {
        users: results.map((result) => result.user),
        createdCount: created,
        skippedCount: results.length - created,
      };
      return { statusCode: 201, body: response };
    },
  },
  {
    /**
     * IamUser を削除する（質問 4 = B）。配下の Assignment を連鎖削除する。
     * 反映済みの割り当てや、このユーザを含む未反映の申請があれば 409 で拒否する（Issue #44）。
     *
     * ARN は `:` と `/` を含むためパスパラメータに載せず、クエリで受ける。
     * 未反映 ChangeRequest の凍結入力は影響を受けない（FR-4.5）。
     */
    method: "DELETE",
    pattern: "/pool/users",
    requires: "edit",
    handler: async ({ query }) => {
      const poolId = await fixedPoolId();

      const arn = query.arn;
      if (!arn || !isUserArn(arn)) {
        throw new ValidationError(localized("pool.arnQueryRequiredDeleteUser", {}), "arn");
      }

      const removedAssignments = await deletePoolUser(poolId, arn);
      return { statusCode: 200, body: { arn, removedAssignments } };
    },
  },
  {
    /** 属性列の定義を丸ごと置き換える（Issue #61）。IamUser のアイテムには触れない。 */
    method: "PUT",
    pattern: "/pool/attribute-columns",
    requires: "edit",
    handler: async ({ body }) => {
      const payload = requireObjectBody(body);
      const result = await savePoolAttributeColumns(await fixedPoolId(), payload.columns);
      return { statusCode: 200, body: result };
    },
  },
  {
    /** 1 ユーザの属性を丸ごと置き換える（Issue #61）。ARN は `:` と `/` を含むのでクエリで受ける。 */
    method: "PUT",
    pattern: "/pool/users/attributes",
    requires: "edit",
    handler: async ({ query, body }) => {
      const arn = query.arn;
      if (!arn || !isUserArn(arn)) {
        throw new ValidationError(localized("pool.arnQueryRequiredUser", {}), "arn");
      }
      const payload = requireObjectBody(body);
      const result = await saveUserAttributes(await fixedPoolId(), arn, payload.attributes);
      return { statusCode: 200, body: result };
    },
  },
];
