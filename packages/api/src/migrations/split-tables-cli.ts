import { readTableNames } from "./env.js";
import { copyStateItems, formatSplitTablesReport, splitTablesExitCode } from "./split-tables.js";
import { createSplitTablesStore } from "./split-tables-store.js";

/**
 * 状態のコピーのコマンドの入口（Issue #36。docs/design/one-time-migrations.md「状態テーブルと申請テーブルへの分割」）。
 *
 * `npm run migrate:split-tables --workspace @rolust/api` は dry-run、`-- --apply` で書き込む。
 * 旧テーブル名は ROLUST_LEGACY_TABLE_NAME（既定のデプロイでは rolust）、写し先は ROLUST_STATE_TABLE_NAME。
 * 認証情報は AWS の標準のチェーン（AWS_PROFILE など）から取る（NFR-3）。
 */
async function main(): Promise<number> {
  const apply = process.argv.includes("--apply");
  const tables = readTableNames(process.env, {
    legacyTableName: "ROLUST_LEGACY_TABLE_NAME",
    stateTableName: "ROLUST_STATE_TABLE_NAME",
  });
  if (!tables.ok) {
    console.error(tables.message);
    return 2;
  }

  let report;
  try {
    report = await copyStateItems(
      createSplitTablesStore(tables.names, process.env.AWS_REGION?.trim() || undefined),
      { apply },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`状態のコピーの読み取りに失敗しました（何も書き込んでいません）: ${message}`);
    return 1;
  }
  for (const line of formatSplitTablesReport(report)) {
    console.log(line);
  }
  return splitTablesExitCode(report);
}

// process.exit は Windows の端末で stdout の書き出しを待たずに終わり、報告の末尾が欠けうるため、
// 終了コードを process.exitCode に入れて自然に終わらせる（Issue #33）。
process.exitCode = await main();
