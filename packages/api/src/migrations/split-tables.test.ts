import { describe, expect, it } from "vitest";

import type { TableKey } from "../ddb/keys.js";
import {
  NO_ITEM_TYPE,
  copyStateItems,
  formatSplitTablesReport,
  keyOf,
  splitTablesExitCode,
  type SplitTablesStore,
  type StateItem,
} from "./split-tables.js";

const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";

const legacy: StateItem[] = [
  { pk: "POOL#a", sk: "META", itemType: "UserPool", poolId: "a", gsi1pk: "POOLS", gsi1sk: "POOL#a" },
  { pk: "POOL#a", sk: "USER#u1", itemType: "IamUser" },
  { pk: "POOL#a", sk: `ASSIGN#u1#${DEPLOY}`, itemType: "Assignment", checked: true },
  { pk: "POOL#a", sk: `ROLE#${DEPLOY}`, itemType: "PoolRoleLink" },
  { pk: "POOL#a", sk: "LEGACY#x" }, // itemType を持たない未知のアイテムも取りこぼさない
  { pk: "ROLE", sk: `ROLE#${DEPLOY}`, itemType: "IamRole", arn: DEPLOY },
  { pk: `ROLELINK#${DEPLOY}`, sk: "OWNER", itemType: "RoleLinkOwner", poolId: "a" },
];

/** 旧テーブル（legacy）と状態テーブル（state）をメモリ上に持つストア。 */
function memoryStore(options: { state?: StateItem[]; failOn?: string } = {}) {
  const state = new Map((options.state ?? []).map((item) => [keyOf(item), item]));
  const store: SplitTablesStore = {
    listPoolIds: async () => legacy.filter((item) => item.gsi1pk === "POOLS").map((item) => String(item.poolId)),
    listPoolPartition: async (poolId) => legacy.filter((item) => item.pk === `POOL#${poolId}`),
    listRoles: async () => legacy.filter((item) => item.pk === "ROLE"),
    getRoleLinkOwners: async (roleArns) =>
      legacy.filter((item) => item.sk === "OWNER" && roleArns.some((arn) => item.pk === `ROLELINK#${arn}`)),
    findExistingKeys: async (keys: TableKey[]) => new Set(keys.map(keyOf).filter((key) => state.has(key))),
    putIfAbsent: async (item) => {
      if (options.failOn === keyOf(item)) throw new Error("throttled");
      if (state.has(keyOf(item))) return false;
      state.set(keyOf(item), item);
      return true;
    },
  };
  return { store, state };
}

describe("copyStateItems（Issue #36。spec 3.2）", () => {
  it("dry-run は何も書かず、種別ごとに見つけた件数と書く件数を数える", async () => {
    const { store, state } = memoryStore();
    const report = await copyStateItems(store, { apply: false });

    expect(state.size).toBe(0);
    expect(report.mode).toBe("dry-run");
    expect(report.counts.UserPool).toEqual({ found: 1, existing: 0, toWrite: 1, written: 0 });
    expect(report.counts.RoleLinkOwner).toEqual({ found: 1, existing: 0, toWrite: 1, written: 0 });
    expect(report.counts[NO_ITEM_TYPE]).toEqual({ found: 1, existing: 0, toWrite: 1, written: 0 });
    expect(Object.values(report.counts).reduce((sum, count) => sum + count.found, 0)).toBe(legacy.length);
  });

  it("apply はアイテムを加工せずに書き、既存は上書きしない", async () => {
    const kept = { pk: "POOL#a", sk: "USER#u1", itemType: "IamUser", note: "状態テーブルで書き換え済み" };
    const { store, state } = memoryStore({ state: [kept] });
    const report = await copyStateItems(store, { apply: true });

    expect(report.failure).toBeNull();
    expect(state.size).toBe(legacy.length);
    expect(state.get("POOL#a|USER#u1")).toBe(kept);
    expect(state.get("POOL#a|META")).toEqual(legacy[0]);
    expect(report.counts.IamUser).toEqual({ found: 1, existing: 1, toWrite: 0, written: 0 });
    expect(report.counts.Assignment).toEqual({ found: 1, existing: 0, toWrite: 1, written: 1 });
  });

  it("途中で失敗したら止めて場所を返し、再実行で続きから書く", async () => {
    const { store, state } = memoryStore({ failOn: `POOL#a|ROLE#${DEPLOY}` });
    const first = await copyStateItems(store, { apply: true });

    expect(first.failure).toEqual({ pk: "POOL#a", sk: `ROLE#${DEPLOY}`, message: "throttled" });
    expect(splitTablesExitCode(first)).toBe(1);
    const writtenBefore = state.size;
    expect(writtenBefore).toBeLessThan(legacy.length);

    const retry = memoryStore({ state: [...state.values()] });
    const second = await copyStateItems(retry.store, { apply: true });
    expect(second.failure).toBeNull();
    expect(retry.state.size).toBe(legacy.length);
    expect(Object.values(second.counts).reduce((sum, count) => sum + count.written, 0)).toBe(legacy.length - writtenBefore);
  });

  it("書き終えた後の dry-run は書く件数が 0 で、そう表示する", async () => {
    const { store } = memoryStore({ state: legacy });
    const report = await copyStateItems(store, { apply: false });

    expect(Object.values(report.counts).every((count) => count.toWrite === 0)).toBe(true);
    expect(formatSplitTablesReport(report).join("\n")).toContain("書く対象はありません");
    expect(splitTablesExitCode(report)).toBe(0);
  });

  it("表示は種別ごとの 4 つの数と、失敗の場所を含む", () => {
    const lines = formatSplitTablesReport({
      mode: "apply",
      counts: { UserPool: { found: 2, existing: 1, toWrite: 1, written: 1 } },
      failure: { pk: "POOL#a", sk: "USER#u1", message: "throttled" },
    });
    expect(lines).toContain("  UserPool: 見つけた 2／既存 1／書く 1／書いた 1");
    expect(lines.join("\n")).toMatch(/pk=POOL#a, sk=USER#u1.*throttled/);
  });
});
