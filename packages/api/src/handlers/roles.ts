import type { IamRole, LocalizedMessage, RoleColorId, RoleView } from "@rolust/core";
import {
  ValidationError,
  assertAccountId,
  assertIamName,
  buildRoleArn,
  isRoleArn,
  isRoleColorId,
  localized,
  normalizeRoleDescription,
  normalizeRoleDisplayName,
} from "@rolust/core";

import { loadConfig, loadSelfRoleArns, loadTargetRoleNames } from "../config.js";
import { ApiError } from "../errors.js";
import { IamOperationError, createIamRoleTagClient, createIamTrustPolicyReader } from "../aws/iam-client.js";
import type { IamRoleTagClient, IamTrustPolicyReader } from "../aws/iam-client.js";
import type { Route } from "../http.js";
import { readStringArray, requireObjectBody, requireString } from "../http.js";
import { getRoleLocks } from "../repository/change-request.js";
import { listAssignments } from "../repository/assignment.js";
import { listRoleLinkEntries } from "../repository/pool-role-link.js";
import { listRoles } from "../repository/role.js";
import { deleteRole } from "../services/role-delete-service.js";
import { registerRole } from "../services/role-register-service.js";
import { saveRoleColor } from "../services/role-color-service.js";
import { saveRoleDescription } from "../services/role-description-service.js";
import { assertRoleDisplayNameUnused, saveRoleDisplayName } from "../services/role-display-name-service.js";
import { sortByColumnOrder } from "../services/role-column-order.js";
import { reorderRoles } from "../services/role-order-service.js";
import { summarizeAssignments } from "../services/assignment-summary.js";

/**
 * IAM ロール管理の API（FR-2.1 / FR-2.2 / 画面 2）。
 *
 * 一覧には「未反映の申請」を添える。mockups.md 画面 2 の設計判断のとおり、
 * FR-4.6 により新規申請がブロックされる状態をロール一覧で見えるようにするためである。
 *
 * ## 登録時検証（タグ方式・Step 18-B）
 *
 * apply / diff Lambda の IAM ポリシーは `Resource: role/*` を取り、
 * `aws:ResourceTag/<managed_tag_key> = <managed_tag_value>` の条件で絞る
 * （`infra/main.tf`）。**登録時にこの条件を照合しないと、違反は反映まで進んだ末に
 * `AccessDenied` として初めて現れる。** 誤りは、それが作られた場所で報せる。
 *
 * 照合には `iam:ListRoleTags` が要る（3.4 RQ-4 = A で CRUD Lambda に付与済み）。
 * これは **`FR-5.7` / `C-4`（AWS への問い合わせと実在検証を行わない）を明確に破る**。
 * 接頭辞方式の検証は純粋関数で AWS を呼ばなかったが、タグは AWS 上のロールにしか
 * 存在しないため、タグ方式では原理的に呼ばずに判定できない。3.4 の承認ゲートで、
 * 登録時検証を残すほうを人間が選んだ結果である。
 *
 * `iam:ListRoleTags` の `Resource` は `role/*` 条件なし（3.4 RQ-6 = A）。したがって
 * 「タグが無い」と「読めない」は曖昧にならず、下の 3 分岐は互いに排他である。
 *
 * **別アカウントのロールも、同じ検証をする**（Issue #85。FR-2.2）。タグを読むクライアントが、ロールの
 * アカウントに応じて資格情報を選ぶ（ターゲット側の Reader を引き受ける）。ターゲット側が未準備なら、
 * 登録の時点で 502 で報せる（以前は、別アカウントのロールを検証せずに受理し、差分確認で初めて失敗した）。
 *
 * ## 登録は信頼ポリシーも読み、固定プールへ紐づける（Issue #135）
 *
 * タグの検証の後、`registerRole` が、信頼ポリシーにいるパスなしの IAM ユーザの取り込みと、列の末尾への紐づけを行う
 * （`iam:GetRole`。権限は変えない。FR-5.7 の例外は、ロールの紐づけから、この登録に移った）。
 */

export type { RoleView };

/** ハンドラが使う外部依存。テストで差し替えられるように引数で受ける。 */
export interface RoleHandlerDeps {
  iamTags: IamRoleTagClient;
  /** 登録時に信頼ポリシーを読む（Issue #135）。省略すると、リクエストのデプロイ先アカウントで作る。 */
  iamTrust?: IamTrustPolicyReader;
}

/**
 * 実行ロールの権限不足。**利用者の入力の誤りではない**ため 400 では返さない。
 *
 * 入力を直しても解決せず、直すべきはデプロイ側（CRUD 実行ロールの
 * `iam:ListRoleTags`）である。400 で返すと、運用者はロール名を書き換え続ける。
 */
class TagLookupUnavailableError extends ApiError {
  constructor(message: LocalizedMessage, cause: unknown) {
    super(502, "TagLookupUnavailable", message, { cause });
  }
}

/**
 * Rolust 自身の実行ロールの登録を拒否する（Issue #194 H-1）。
 *
 * IAM 側の `Sid: DenySelfEscalation`（`infra/lambda.tf`）は、管理対象タグが付いていても、これらのロールへの
 * `iam:UpdateAssumeRolePolicy` を明示的に拒否する。しかし基盤層だけで止めると、**違反は操作の連鎖の末尾
 * （反映）で初めて現れる**。登録・申請まで進んでから `AccessDenied` になるのを避けるため、登録の時点でも返す。
 *
 * 一覧は `local.self_role_arns` と同じ値（環境変数 `ROLUST_SELF_ROLE_ARNS`）で、ポリシーと食い違わない。
 * 照合はアカウント ID とロール名の対で行い、**ロール名は大文字小文字を無視する**。IAM は大小だけが違う
 * 2 つのロールを作れないため、無視する側が安全である（ARN の照合は大小を区別するので、Deny は
 * `rolust-Apply-exec` に当たらないが、そのロールはそもそも作れない）。
 *
 * AWS も DynamoDB も呼ばずに判定できるので、タグ検証（`assertManagedRoleTag`）より前に呼ぶ。
 */
export function assertNotSelfRole(accountId: string, roleName: string): void {
  const selfRoles = loadSelfRoleArns();
  const matched = selfRoles.some(
    (self) => self.accountId === accountId && self.roleName.toLowerCase() === roleName.toLowerCase(),
  );
  if (!matched) return;

  throw new ValidationError(
    localized("role.selfRoleRejected", {
      roleName,
      accountId,
      managedTagKey: loadConfig().managedTagKey,
    }),
    "roleName",
  );
}

/**
 * ロールが管理対象のタグを持つことを検証する（FR-2.1 / FR-7.2）。
 *
 * 文言は GI-6 の方針に従い、**何が問題か**・**なぜ問題か**・**どう直すか**の 3 点を
 * 隠さずに含める。3 つの失敗は原因も対処も違うため、**文面を分ける**。
 * 「タグが無い」と「ロールが無い」を同じ文面にすると、運用者はタグを付けに行って
 * 存在しないロールを探すことになる。
 */
export async function assertManagedRoleTag(
  accountId: string,
  roleName: string,
  deployAccountId: string | null,
  deps: RoleHandlerDeps,
): Promise<void> {
  // `iam:ListRoleTags` は `RoleName` しか受け取らず、呼び出しに使った資格情報のアカウントに対して解決される。
  // どの資格情報で呼ぶかは、タグを読むクライアント（`deps.iamTags`）が、ロールのアカウントに応じて選ぶ:
  // 別アカウントのロールは、ターゲット側の Reader を引き受けて読む（Issue #85）。同アカウントのロールと
  // 同じ 3 分岐で検証する（FR-2.2「同一アカウントの場合も同じ手順で扱う」）。
  const crossAccount = deployAccountId !== null && accountId !== deployAccountId;

  const { managedTagKey, managedTagValue } = loadConfig();
  const roleArn = buildRoleArn(accountId, roleName);

  let tags: Record<string, string>;
  try {
    tags = await deps.iamTags.listRoleTags(roleArn);
  } catch (error) {
    if (error instanceof IamOperationError && error.kind === "not-found") {
      // 質問 11 = A。実在検証は C-4 / FR-5.7 を破るが、存在しないロールは
      // 管理対象になりようがないため、登録時に返すほうを選んだ。
      throw new ValidationError(localized("role.notFoundInAws", { roleName, accountId }), "roleName");
    }
    if (error instanceof IamOperationError && error.kind === "access-denied") {
      throw new TagLookupUnavailableError(
        crossAccount
          ? localized("role.tagReadDeniedCrossAccount", {
              roleName,
              accountId,
              errorCode: error.errorCode,
              readerRoleName: loadTargetRoleNames().readerRoleName,
            })
          : localized("role.tagReadDeniedLocal", { roleName, errorCode: error.errorCode, roleArn }),
        error,
      );
    }
    if (
      error instanceof IamOperationError &&
      (error.kind === "assume-role" || error.kind === "deploy-account-unknown")
    ) {
      // IAM を呼ぶ前の失敗。ターゲット側の準備（Reader の作成と信頼ポリシー）か、デプロイ先の判定が、登録の前提である。
      // 文言は、何が・なぜ・どう直すかを含む（`iam-client.ts`）ので、内側の localized をそのまま返す。
      throw new TagLookupUnavailableError(error.localized, error);
    }
    throw error;
  }

  const actual = tags[managedTagKey];

  // 別アカウントのロールのタグは、そのアカウントの資格情報で付ける。別のアカウントの資格情報で実行すると、
  // そのアカウントに同名のロールがあれば、そのロールにタグが付く（管理対象が黙って広がる。#27 と同じ形）。
  // 文言の注記（ターゲットアカウントの資格情報で実行する旨）は、`targetAccountId` が非 null のときに付く。
  const targetAccountId = crossAccount ? accountId : null;

  if (actual === undefined) {
    throw new ValidationError(
      localized("role.tagMissing", { roleName, managedTagKey, managedTagValue, targetAccountId }),
      "roleName",
    );
  }

  if (actual !== managedTagValue) {
    throw new ValidationError(
      localized("role.tagValueMismatch", { roleName, managedTagKey, actual, managedTagValue, targetAccountId }),
      "roleName",
    );
  }
}

/**
 * @param deps テストで差し替える。省略すると、リクエストごとに、そのリクエストのデプロイ先アカウントで
 *   タグを読むクライアントを作る（別アカウントのロールは、ターゲット側の Reader を引き受けて読む。Issue #85）。
 */
export function createRoleRoutes(deps?: RoleHandlerDeps): Route[] {
  return [
    {
      method: "GET",
      pattern: "/roles",
      requires: "view",
      handler: async () => {
        const { poolId } = loadConfig();
        const [roles, entries, assignments] = await Promise.all([
          listRoles(),
          listRoleLinkEntries(poolId),
          listAssignments(poolId),
        ]);
        // 列順（position 順）。紐づけを持たない登録済みロールは末尾（listRoles の順: アカウント ID → ロール名）。
        const ordered = sortByColumnOrder(roles, entries);
        const roleArns = ordered.map((role) => role.arn);
        const locks = await getRoleLocks(roleArns);
        const summaries = summarizeAssignments(assignments, roleArns);
        const views: RoleView[] = ordered.map((role) => ({
          ...role,
          unreflected: locks.get(role.arn) ?? null,
          assignments: summaries.get(role.arn) ?? { total: 0, pending: 0 },
        }));
        return { statusCode: 200, body: { roles: views } };
      },
    },
    {
      method: "POST",
      pattern: "/roles",
      requires: "edit",
      handler: async ({ body, deployAccountId }) => {
        const payload = requireObjectBody(body);
        const accountId = assertAccountId(requireString(payload, "accountId"));
        // 書式 → タグの順に検証する。書式不正を「タグ不一致」として報告しないため。
        // 書式が不正なら ARN も組み立てられず、AWS 呼び出しも無駄になる。
        const roleName = assertIamName(requireString(payload, "roleName"), "roleName");
        // Rolust 自身の実行ロールは、AWS を呼ぶ前に弾く（Issue #194。`DenySelfEscalation` の二層目）。
        assertNotSelfRole(accountId, roleName);
        const description = normalizeRoleDescription(readOptionalDescription(payload));
        // 表示名の規則と重複は、AWS を呼ぶ前に判定する（書式 → 表示名 → タグ → 信頼ポリシーの順。Issue #150）。
        const displayName = readOptionalDisplayName(payload) ?? null;
        if (displayName !== null) await assertRoleDisplayNameUnused(displayName);
        await assertManagedRoleTag(
          accountId,
          roleName,
          deployAccountId,
          deps ?? { iamTags: createIamRoleTagClient(deployAccountId) },
        );

        // 登録は、固定プールの列の末尾へ紐づけ、信頼ポリシーにいる IAM ユーザを取り込む（Issue #135）。
        const result = await registerRole(
          { accountId, roleName, description, displayName },
          new Date().toISOString(),
          deployAccountId,
          { iam: deps?.iamTrust ?? createIamTrustPolicyReader(deployAccountId) },
        );
        return { statusCode: 201, body: result };
      },
    },
    {
      /** ロールの並び順（マトリクスの列順）を保存する（FR-2.6 / Issue #135）。本文は全登録ロールの ARN の配列。 */
      method: "PUT",
      pattern: "/roles/order",
      requires: "edit",
      handler: async ({ body }) => {
        const payload = requireObjectBody(body);
        const result = await reorderRoles(readStringArray(payload, "roleArns"));
        return { statusCode: 200, body: result };
      },
    },
    {
      /**
       * ロールの説明と背景色を編集する（Issue #21・#100）。ARN は `:` と `/` を含むためパスパラメータに
       * 載せず、クエリで受ける（`pool.ts` の `DELETE /pool/users?arn=` と同じ理由）。
       */
      method: "PATCH",
      pattern: "/roles",
      requires: "edit",
      handler: async ({ query, body }) => {
        const arn = query.arn;
        if (!arn || !isRoleArn(arn)) {
          throw new ValidationError(localized("role.arnQueryRequiredEdit", {}), "arn");
        }
        const payload = requireObjectBody(body);
        // 検証がすべて終わってから書く（一部だけ書かれて残るのを防ぐ）。
        const displayName = readOptionalDisplayName(payload);
        const description = readOptionalDescription(payload);
        const normalizedDescription = description === undefined ? undefined : normalizeRoleDescription(description);
        const color = payload.color;
        if (color !== undefined && color !== null && !isRoleColorId(color)) {
          throw new ValidationError(localized("role.colorInvalid", {}), "color");
        }
        let saved: { role: IamRole } | undefined;
        if (displayName !== undefined) saved = await saveRoleDisplayName(arn, displayName);
        if (normalizedDescription !== undefined) saved = await saveRoleDescription(arn, normalizedDescription);
        if (color !== undefined) saved = await saveRoleColor(arn, color as RoleColorId | null);
        if (!saved) {
          throw new ValidationError(localized("role.updateFieldsRequired", {}), "displayName");
        }
        return { statusCode: 200, body: saved };
      },
    },
    {
      /**
       * IamRole を削除する（FR-2.4 / Issue #22）。どのユーザプールにも紐づいておらず、未反映の申請も無いロールだけ。
       * 理由があれば 409 で拒否する。Rolust の記録だけを消し、AWS 上の IAM ロールと信頼ポリシーには触れない。
       * ARN は `:` と `/` を含むためパスパラメータに載せず、クエリで受ける（`PATCH /roles` と同じ）。
       */
      method: "DELETE",
      pattern: "/roles",
      requires: "edit",
      handler: async ({ query }) => {
        const arn = query.arn;
        if (!arn || !isRoleArn(arn)) {
          throw new ValidationError(localized("role.arnQueryRequiredDelete", {}), "arn");
        }
        const result = await deleteRole(arn);
        return { statusCode: 200, body: result };
      },
    },
  ];
}

/** `description` は任意項目。無ければ `undefined`、明示的な null / string はそのまま返す。 */
function readOptionalDescription(payload: Record<string, unknown>): string | null | undefined {
  const value = payload.description;
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ValidationError(localized("role.descriptionInvalidType", {}), "description");
  }
  return value;
}

/** `displayName` は任意項目。無ければ `undefined`、null / 空白だけなら `null`、それ以外は正規化して返す（Issue #150）。 */
function readOptionalDisplayName(payload: Record<string, unknown>): string | null | undefined {
  const value = payload.displayName;
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ValidationError(localized("role.displayNameInvalidType", {}), "displayName");
  }
  return normalizeRoleDisplayName(value);
}

export const roleRoutes: Route[] = createRoleRoutes();
