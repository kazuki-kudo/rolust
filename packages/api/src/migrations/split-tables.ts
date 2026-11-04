import type { TableKey } from "../ddb/keys.js";

/**
 * 旧テーブル `rolust` の状態のアイテムを状態テーブルへ写す一度きりの移行（Issue #36。spec 3.2・D-8）。
 *
 * Scan を使わず、既存のアクセスパターンで辿る: GSI1 `POOLS` → 各プールの `pk = POOL#<id>` を
 * sk で絞らず全件 → `pk = ROLE` → そのロールの `ROLELINK#<arn>` / `OWNER`。申請（ChangeRequest・RoleLock）は写さない。
 * 書き込みは既存を上書きしない条件付き PutItem。途中で失敗したら止め、再実行で既存を飛ばして続きから書く。
 * 取りこぼしは運用者が Scan の件数で突き合わせて見つける（spec D-9）。
 */

export type StateItem = Record<string, unknown> & TableKey;

export interface SplitTablesStore {
  /** 旧テーブルの GSI1 `gsi1pk = POOLS` の poolId。 */
  listPoolIds(): Promise<string[]>;
  /** 旧テーブルの `pk = POOL#<poolId>` の全アイテム（sk で絞らない）。 */
  listPoolPartition(poolId: string): Promise<StateItem[]>;
  /** 旧テーブルの `pk = ROLE` の全アイテム。 */
  listRoles(): Promise<StateItem[]>;
  /** 旧テーブルの `ROLELINK#<roleArn>` / `OWNER`。無いロールは含まない。 */
  getRoleLinkOwners(roleArns: string[]): Promise<StateItem[]>;
  /** 状態テーブルに既にあるキー（`keyOf` の形）。 */
  findExistingKeys(keys: TableKey[]): Promise<Set<string>>;
  /** 状態テーブルに無ければ書く。既にあれば false。 */
  putIfAbsent(item: StateItem): Promise<boolean>;
}

export interface TypeCount {
  /** 旧テーブルで見つけた件数。 */
  found: number;
  /** 状態テーブルに既にあった件数（書き込みの競合を含む）。 */
  existing: number;
  /** 書く対象（辿った時点で状態テーブルに無かった）件数。 */
  toWrite: number;
  /** 実際に書いた件数（dry-run では 0）。 */
  written: number;
}

export interface SplitTablesReport {
  mode: "dry-run" | "apply";
  /** 種別（itemType）ごとの件数。itemType を持たないアイテムは {@link NO_ITEM_TYPE}。 */
  counts: Record<string, TypeCount>;
  /** 書き込みに失敗したアイテム。これより後のアイテムは書いていない。 */
  failure: { pk: string; sk: string; message: string } | null;
}

export const NO_ITEM_TYPE = "(itemType なし)";

/** 状態テーブルの種別の表示順。 */
const STATE_ITEM_TYPES = ["UserPool", "IamUser", "Assignment", "PoolRoleLink", "IamRole", "RoleLinkOwner"];

export function keyOf(key: TableKey): string {
  return `${key.pk}|${key.sk}`;
}

export async function copyStateItems(
  store: SplitTablesStore,
  options: { apply: boolean },
): Promise<SplitTablesReport> {
  const items: StateItem[] = [];
  for (const poolId of await store.listPoolIds()) {
    items.push(...(await store.listPoolPartition(poolId)));
  }
  const roles = await store.listRoles();
  items.push(...roles);
  items.push(...(await store.getRoleLinkOwners(roles.map((role) => String(role.arn)))));

  const existing = await store.findExistingKeys(items.map(({ pk, sk }) => ({ pk, sk })));
  const report: SplitTablesReport = { mode: options.apply ? "apply" : "dry-run", counts: {}, failure: null };
  const countOf = (item: StateItem): TypeCount => {
    const type = typeof item.itemType === "string" ? item.itemType : NO_ITEM_TYPE;
    return (report.counts[type] ??= { found: 0, existing: 0, toWrite: 0, written: 0 });
  };

  const pending: StateItem[] = [];
  for (const item of items) {
    const count = countOf(item);
    count.found += 1;
    if (existing.has(keyOf(item))) {
      count.existing += 1;
    } else {
      count.toWrite += 1;
      pending.push(item);
    }
  }
  if (!options.apply) return report;

  for (const item of pending) {
    try {
      if (await store.putIfAbsent(item)) countOf(item).written += 1;
      else countOf(item).existing += 1;
    } catch (error) {
      report.failure = { pk: item.pk, sk: item.sk, message: error instanceof Error ? error.message : String(error) };
      break;
    }
  }
  return report;
}

export function formatSplitTablesReport(report: SplitTablesReport): string[] {
  const lines = [
    report.mode === "dry-run"
      ? "モード: dry-run（何も書き込みません。書き込むには -- --apply を付けて実行してください）"
      : "モード: apply",
  ];
  const types = [
    ...STATE_ITEM_TYPES.filter((type) => type in report.counts),
    ...Object.keys(report.counts).filter((type) => !STATE_ITEM_TYPES.includes(type)).sort(),
  ];
  if (types.length === 0) {
    lines.push("旧テーブルに状態のアイテムが見つかりませんでした");
  } else {
    lines.push("種別ごとの件数（旧テーブルで見つけた／状態テーブルに既にある／書く／書いた）:");
    for (const type of types) {
      const count = report.counts[type];
      if (!count) continue;
      lines.push(`  ${type}: 見つけた ${count.found}／既存 ${count.existing}／書く ${count.toWrite}／書いた ${count.written}`);
    }
  }
  if (report.failure) {
    lines.push(
      `書き込みに失敗しました（pk=${report.failure.pk}, sk=${report.failure.sk}）: ${report.failure.message}。` +
        "これより後のアイテムは書いていません。原因を直して再実行すると、既存を飛ばして続きから書きます",
    );
  } else if (Object.values(report.counts).every((count) => count.toWrite === 0)) {
    lines.push("書く対象はありません（見つけたアイテムはすべて状態テーブルにあります）");
  }
  return lines;
}

export function splitTablesExitCode(report: SplitTablesReport): 0 | 1 {
  return report.failure ? 1 : 0;
}
