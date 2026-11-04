import type { RegisterRoleResponse } from "@rolust/core";
import { buildRoleArn, localized } from "@rolust/core";

import { getAllowedAccountIds } from "../aws/allowed-accounts.js";
import type { IamTrustPolicyReader } from "../aws/iam-client.js";
import { createIamTrustPolicyReader } from "../aws/iam-client.js";
import { ConflictError, StorageError } from "../errors.js";
import { deleteAssignment, listAssignments } from "../repository/assignment.js";
import { ensurePool, listUsers } from "../repository/pool.js";
import { appendRoleLink } from "../repository/pool-role-link.js";
import { createRole, getRole } from "../repository/role.js";
import { readImportPlans, writeImport } from "./role-import.js";

/**
 * IamRole の登録と、固定プールへの紐づけ・信頼ポリシーからの取り込み（FR-2.1。Issue #135 spec 3.1）。
 *
 * ロールの紐づけ機能を廃止し、登録＝紐づけにした。書き込みの前に、登録済みかを確かめ（409）、信頼ポリシーを読む
 * （読めなければ何も書かずに拒否する。FR-5.7 の例外。登録はすでに `iam:ListRoleTags` で例外であり、呼ぶのは登録の中だけ）。
 *
 * 書き込みの順序: 古い交点の削除 → 取り込み（IamUser → Assignment）→ 紐づけ → **IamRole（最後）**。
 * IamRole を最後に確定するので、途中で失敗しても「登録済みだが紐づいていない」状態は生まれない。残るのは、
 * マトリクスに出ない孤児（登録の無いロールの交点・紐づけ）だけで、同じ登録のやり直しが続きから直す
 * （取り込みは同じ値の書き直し、紐づけは `appendRoleLink` が既存の `position` を保つ）。
 *
 * **登録済みの確認を、取り込みの前に必ず行う。** 取り込みは `checked = reflected = true` で交点を書くので、
 * 登録済みのロールに対して走ると、利用者の未反映の変更を上書きする。
 */

export interface RegisterRoleDeps {
  /** 信頼ポリシーを読む。読み取り専用で、更新はできない型にしてある。 */
  iam: IamTrustPolicyReader;
  /** 登録を許可するアカウント ID（Issue #139）。既定は SSM の許可リスト。 */
  allowedAccounts?: () => Promise<ReadonlySet<string>>;
}

export async function registerRole(
  input: { accountId: string; roleName: string; description: string | null; displayName: string | null },
  now: string,
  deployAccountId: string | null,
  deps: RegisterRoleDeps = { iam: createIamTrustPolicyReader(deployAccountId) },
): Promise<RegisterRoleResponse> {
  const roleArn = buildRoleArn(input.accountId, input.roleName);

  if ((await getRole(roleArn)) !== null) {
    throw new ConflictError(localized("role.alreadyRegistered", { roleArn }));
  }

  const { poolId } = await ensurePool();
  const [plan] = await readImportPlans([roleArn], deps.iam);
  if (!plan) throw new Error("取り込みの計画を作れませんでした");
  const registeredUsers = new Set<string>(
    plan.userArns.length > 0 ? (await listUsers(poolId)).map((user) => user.arn) : [],
  );
  const assignments = await listAssignments(poolId);

  // 許可リスト（Issue #139）。未登録のユーザがいるときだけ読み、読めなければ、何も書く前に拒否する（fail closed）。
  // 全員が登録済みなら読まない（許可リストの不備で、ロールの登録まで止めない）。
  const needsAllowList = plan.userArns.some((userArn) => !registeredUsers.has(userArn));
  const allowedAccountIds = needsAllowList
    ? await (deps.allowedAccounts ?? getAllowedAccountIds)()
    : new Set<string>();

  try {
    // 以前の登録の途中失敗で残った交点のうち、信頼ポリシーにいないユーザのものは、取り込みの前に消す
    // （消さないと、記録が実態と食い違ったまま残る）。信頼ポリシーにいるユーザの交点は writeImport が書き直す。
    const keep = new Set(plan.userArns);
    for (const stale of assignments) {
      if (stale.roleArn === roleArn && !keep.has(stale.userArn)) {
        await deleteAssignment(poolId, stale.userArn, stale.roleArn);
      }
    }
    const { registeredCount, skippedCount } = await writeImport(poolId, plan, registeredUsers, now, allowedAccountIds);
    await appendRoleLink(poolId, roleArn, now);
    const role = await createRole(input.accountId, input.roleName, now, input.description, input.displayName);
    return { role, imported: { roleArn, userCount: plan.userArns.length, registeredCount, skippedCount } };
  } catch (cause) {
    if (cause instanceof ConflictError) throw cause;
    console.error(`[rolust] IAM ロールの登録が途中で失敗しました: roleArn=${roleArn}`, cause);
    throw new StorageError(localized("storage.roleRegisterPartial", {}), { retryable: true, cause });
  }
}
