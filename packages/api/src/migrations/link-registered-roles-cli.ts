import { getAllowedAccountIds } from "../aws/allowed-accounts.js";
import { createIamTrustPolicyReader } from "../aws/iam-client.js";
import { loadConfig } from "../config.js";
import { listUsers } from "../repository/pool.js";
import { appendRoleLink, listRoleLinks } from "../repository/pool-role-link.js";
import { listRoles } from "../repository/role.js";
import { readImportPlans, writeImport } from "../services/role-import.js";
import { formatLinkReport, linkRegisteredExitCode, linkRegisteredRoles } from "./link-registered-roles.js";

/**
 * 登録済みで紐づいていないロールの紐づけのコマンドの入口（Issue #135 D-5。docs/design/one-time-migrations.md「登録済みで紐づいていないロールの紐づけ」）。
 *
 * `npm run migrate:link-registered-roles --workspace @rolust/api` は dry-run、`-- --apply` で書き込む。
 * 環境変数は Lambda と同じ（ROLUST_STATE_TABLE_NAME・ROLUST_CHANGE_REQUEST_TABLE_NAME・ROLUST_MANAGED_TAG_KEY・
 * ROLUST_MANAGED_TAG_VALUE・ROLUST_POOL_ID。未登録のユーザを取り込むときは ROLUST_ALLOWED_ACCOUNT_IDS_PARAMETER も。
 * 許可リストに無いアカウントのユーザは取り込まない。Issue #139）に、デプロイ先の AWS アカウント ID（ROLUST_DEPLOY_ACCOUNT_ID）を足す。
 * 認証情報は AWS の標準のチェーン（AWS_PROFILE など）から取る（NFR-3）。
 */
async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const deployAccountId = process.env.ROLUST_DEPLOY_ACCOUNT_ID?.trim();
  if (!deployAccountId) {
    console.error("環境変数 ROLUST_DEPLOY_ACCOUNT_ID を設定してください（Rolust をデプロイした AWS アカウント ID）");
    return 2;
  }

  let report;
  try {
    const { poolId } = loadConfig();
    const iam = createIamTrustPolicyReader(deployAccountId);
    const now = new Date().toISOString();
    report = await linkRegisteredRoles(
      {
        listRoleArns: async () => (await listRoles()).map((role) => role.arn),
        listLinkedArns: () => listRoleLinks(poolId),
        readPlan: async (roleArn) => {
          const [plan] = await readImportPlans([roleArn], iam);
          if (!plan) throw new Error("取り込みの計画を作れませんでした");
          return plan;
        },
        link: async (plan) => {
          const registered = new Set((await listUsers(poolId)).map((user) => user.arn));
          // 許可リスト（Issue #139）。未登録のユーザがいるときだけ読む（読めなければ、書く前に止まる）。
          const needsAllowList = plan.userArns.some((userArn) => !registered.has(userArn));
          const allowed = needsAllowList ? await getAllowedAccountIds() : new Set<string>();
          await writeImport(poolId, plan, registered, now, allowed);
          await appendRoleLink(poolId, plan.roleArn, now);
        },
      },
      { apply },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`紐づけの読み取りに失敗しました（何も書き込んでいません）: ${message}`);
    return 1;
  }
  for (const line of formatLinkReport(report, { apply })) console.log(line);
  return linkRegisteredExitCode(report);
}

// process.exit は Windows の端末で stdout の書き出しを待たずに終わるため、終了コードを process.exitCode に入れる（Issue #33）。
process.exitCode = await main();
