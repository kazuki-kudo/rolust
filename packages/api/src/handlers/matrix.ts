import type { MatrixView, RevertAssignmentsResponse, RoleLock } from "@rolust/core";
import { ValidationError, isRoleArn, isUserArn, localized, parseRoleArn, pruneAttributes } from "@rolust/core";

import { ConflictError, localizedOfError } from "../errors.js";
import type { Route } from "../http.js";
import { requireBoolean, requireObjectBody, requireString } from "../http.js";
import { listAssignments, revertChecked, saveChecked } from "../repository/assignment.js";
import { getRoleLocks } from "../repository/change-request.js";
import { ensurePool, getUser, listUsers } from "../repository/pool.js";
import { isRoleLinked, listRoleLinks } from "../repository/pool-role-link.js";
import { listRoles } from "../repository/role.js";

/**
 * 割り当てマトリクスの API（FR-3.1 / FR-3.2 / 画面 3）。
 * 列は `listRoleLinks` で紐づけたロールに絞る（登録したロールは常に紐づく。Issue #135）。
 *
 * **FR-3.2 の担保**: チェック増減は Assignment を 1 件保存するだけであり、
 * AWS への書き込みも ChangeRequest の生成も行わない。この Lambda（CRUD 系統）の
 * 実行ロールには IAM の書き込み権限が無い（読み取りの `iam:ListRoleTags` のみ）ため、構造的にも書き込めない
 * （`iam-policy-design-note.md` 2 節）。
 */

export type { MatrixView };

export const matrixRoutes: Route[] = [
  {
    method: "GET",
    pattern: "/pool/matrix",
    requires: "view",
    handler: async () => {
      const pool = await ensurePool();
      const poolId = pool.poolId;

      const [users, roles, linkedArns, assignments] = await Promise.all([
        listUsers(poolId),
        listRoles(),
        listRoleLinks(poolId),
        listAssignments(poolId),
      ]);
      // FR-3.1（Issue #19 で改訂）: 列はこのプールに紐づけたロールだけ。
      const linked = new Set(linkedArns);
      // 列の順は紐づけの並び順（`position` 順。Issue #100）。`listRoleLinks` が整列して返す。
      const roleByArn = new Map(roles.map((role) => [role.arn, role] as const));
      const linkedRoles = linkedArns.flatMap((arn) => {
        const role = roleByArn.get(arn);
        return role ? [role] : [];
      });
      const lockMap = await getRoleLocks(linkedRoles.map((role) => role.arn));

      const locks: Record<string, RoleLock> = {};
      for (const [roleArn, lock] of lockMap) {
        locks[roleArn] = lock;
      }

      const view: MatrixView = {
        pool,
        // 削除済みの列の値は返さない（Issue #61）。
        users: users.map((user) => ({
          ...user,
          attributes: pruneAttributes(user.attributes, pool.attributeColumns),
        })),
        roles: linkedRoles,
        assignments: assignments.filter((assignment) => linked.has(assignment.roleArn)),
        locks,
      };
      return { statusCode: 200, body: view };
    },
  },
  {
    /**
     * 交点 1 件を保存する（MQ-4: セル単位の即時 API 呼び出し）。
     *
     * 画面は楽観的更新を行わず、この応答を待ってチェック状態を確定する
     * （mockups.md 画面 3 の error 状態）。
     */
    method: "PUT",
    pattern: "/pool/assignments",
    requires: "edit",
    handler: async ({ body }) => {
      const { poolId } = await ensurePool();

      const payload = requireObjectBody(body);
      const userArn = requireString(payload, "userArn");
      const roleArn = requireString(payload, "roleArn");
      const checked = requireBoolean(payload, "checked");

      if (!isUserArn(userArn)) {
        throw new ValidationError(localized("arn.notUserArn", { arn: userArn }), "userArn");
      }
      if (!isRoleArn(roleArn)) {
        throw new ValidationError(localized("arn.notRoleArn", { arn: roleArn }), "roleArn");
      }
      // 操作の場での検証（CLAUDE.md）: 紐づけの無いロールに割り当てを作らせない。登録したロールは常に紐づくので、
      // 通常は起きない（紐づけを持たない既存のロールだけ。Issue #135）。
      if (!(await isRoleLinked(poolId, roleArn))) {
        throw new ConflictError(localized("matrix.roleNotLinked", { roleName: parseRoleArn(roleArn).roleName }));
      }
      // 同じく操作の場での検証（Issue #194）: 登録されていないユーザの交点を作らせない。
      // 交点はそのまま凍結入力になり（`buildFrozenInput`）、反映で信頼ポリシーに書かれる。
      // 登録の入口（POST /pool/users）が許可リスト（FR-1.11）とユーザ名の規則を検証するので、
      // ここで登録済みであることを確かめれば、その両方をこの経路も継承する。
      if (!(await getUser(poolId, userArn))) {
        throw new ConflictError(localized("matrix.userNotInPool", { userArn }));
      }

      const assignment = await saveChecked(
        poolId,
        userArn,
        roleArn,
        checked,
        new Date().toISOString(),
      );
      return { statusCode: 200, body: { assignment } };
    },
  },
  {
    /**
     * 未反映の変更（`checked` ≠ `reflected`）をまとめて取り消す（Issue #88）。
     *
     * 交点ごとに `checked` を `reflected` にそろえるだけで、AWS へも ChangeRequest へも触れない（FR-3.2）。
     * 未反映の申請（ロック。FR-4.6）があるロールは、凍結された下書きの入力と食い違うため触れない。
     * ロックは取り消しの時点で読み直す（画面を開いた後に下書きが作られた・破棄された場合に追従する）。
     * 一部の交点が失敗しても止めず、`failures` に返す。取り消しは冪等なので、やり直せば残りが戻る。
     */
    method: "POST",
    pattern: "/pool/assignments/revert",
    requires: "edit",
    handler: async () => {
      const { poolId } = await ensurePool();

      const [linkedArns, assignments] = await Promise.all([listRoleLinks(poolId), listAssignments(poolId)]);
      const linked = new Set(linkedArns);
      const changed = assignments.filter(
        (assignment) => linked.has(assignment.roleArn) && assignment.checked !== assignment.reflected,
      );

      const changedRoleArns = [...new Set(changed.map((assignment) => assignment.roleArn))];
      const locks = await getRoleLocks(changedRoleArns);
      const skippedRoleArns = changedRoleArns.filter((roleArn) => locks.has(roleArn));
      const targets = changed.filter((assignment) => !locks.has(assignment.roleArn));

      const now = new Date().toISOString();
      const result: RevertAssignmentsResponse = { reverted: 0, skippedRoleArns, failures: [] };
      for (const target of targets) {
        try {
          if (await revertChecked(poolId, target.userArn, target.roleArn, now)) result.reverted += 1;
        } catch (cause) {
          // 握りつぶさない。ログに残し、失敗した交点を呼び出し元へ返す。
          console.error("[rolust] 割り当ての取り消しに失敗しました", target.userArn, target.roleArn, cause);
          const detail = cause instanceof Error ? cause.message : String(cause);
          result.failures.push({
            userArn: target.userArn,
            roleArn: target.roleArn,
            message: detail,
            localized: localizedOfError(cause, localized("common.rawDetail", { detail })),
          });
        }
      }
      return { statusCode: 200, body: result };
    },
  },
];
