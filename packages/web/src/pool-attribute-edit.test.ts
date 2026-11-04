import type { AttributeColumn, IamUser } from "@rolust/core";
import { describe, expect, it } from "vitest";

import {
  cellError,
  cellValue,
  changedCellCount,
  hasInvalidCell,
  pendingChanges,
  runWithLimit,
  setDraft,
} from "./pool-attribute-edit.js";

const COLUMNS: AttributeColumn[] = [
  { columnId: "c-dept", name: "所属" },
  { columnId: "c-role", name: "役割" },
];

function user(userName: string, attributes: Record<string, string> = {}): IamUser {
  return {
    poolId: "pool",
    accountId: "111122223333",
    userName,
    arn: `arn:aws:iam::111122223333:user/${userName}`,
    createdAt: "2026-07-30T00:00:00.000Z",
    attributes,
  };
}

const kenji = user("kenji.sato", { "c-dept": "システム 1 課", "c-role": "開発" });
const dana = user("dana.okafor");
const USERS = [kenji, dana];

describe("setDraft / cellValue（Issue #103）", () => {
  it("下書きが無いセルは保存済みの値、保存済みも無ければ空文字", () => {
    expect(cellValue(kenji, {}, "c-role")).toBe("開発");
    expect(cellValue(dana, {}, "c-role")).toBe("");
  });

  it("下書きを置くと、そのセルの値が下書きになる（元の drafts は書き換えない）", () => {
    const before = {};
    const next = setDraft(before, kenji, "c-role", "開発リーダー");
    expect(cellValue(kenji, next, "c-role")).toBe("開発リーダー");
    expect(before).toEqual({});
  });

  it("保存済みの値に戻したら下書きを消す（ユーザの分も空になったら外す）", () => {
    const edited = setDraft({}, kenji, "c-role", "開発リーダー");
    expect(setDraft(edited, kenji, "c-role", "開発")).toEqual({});
  });

  it("別のセルの下書きは残す", () => {
    let drafts = setDraft({}, kenji, "c-role", "開発リーダー");
    drafts = setDraft(drafts, kenji, "c-dept", "システム 2 課");
    drafts = setDraft(drafts, kenji, "c-role", "開発");
    expect(drafts).toEqual({ [kenji.arn]: { "c-dept": "システム 2 課" } });
  });
});

describe("pendingChanges / changedCellCount（Issue #103）", () => {
  it("下書きが無ければ変更なし", () => {
    expect(pendingChanges(USERS, COLUMNS, {})).toEqual([]);
    expect(changedCellCount(USERS, COLUMNS, {})).toBe(0);
  });

  it("変更のあったユーザだけを返し、属性は列ごとに丸ごと（保存済み + 下書き）にする", () => {
    const drafts = setDraft({}, kenji, "c-role", "開発リーダー");
    expect(pendingChanges(USERS, COLUMNS, drafts)).toEqual([
      { user: kenji, attributes: { "c-dept": "システム 1 課", "c-role": "開発リーダー" } },
    ]);
  });

  it("空にしたセルは属性から外す（未設定）。前後の空白は除く", () => {
    let drafts = setDraft({}, kenji, "c-role", "");
    drafts = setDraft(drafts, dana, "c-dept", "  システム 2 課  ");
    expect(pendingChanges(USERS, COLUMNS, drafts)).toEqual([
      { user: kenji, attributes: { "c-dept": "システム 1 課" } },
      { user: dana, attributes: { "c-dept": "システム 2 課" } },
    ]);
  });

  it("空白だけを入れた未設定のセルは、変更としない（正規化すると同じ）", () => {
    const drafts = setDraft({}, dana, "c-role", "   ");
    expect(pendingChanges(USERS, COLUMNS, drafts)).toEqual([]);
    expect(changedCellCount(USERS, COLUMNS, drafts)).toBe(0);
  });

  it("定義に無い列（削除済みの列）の値は、送る属性に含めない", () => {
    const stale = user("stale.user", { "c-old": "昔の値", "c-role": "開発" });
    const drafts = setDraft({}, stale, "c-role", "管理者");
    expect(pendingChanges([stale], COLUMNS, drafts)).toEqual([
      { user: stale, attributes: { "c-role": "管理者" } },
    ]);
  });

  it("変更したセルの数を数える（ユーザ数ではない）", () => {
    let drafts = setDraft({}, kenji, "c-role", "開発リーダー");
    drafts = setDraft(drafts, dana, "c-dept", "システム 2 課");
    drafts = setDraft(drafts, dana, "c-role", "開発");
    expect(changedCellCount(USERS, COLUMNS, drafts)).toBe(3);
    expect(pendingChanges(USERS, COLUMNS, drafts)).toHaveLength(2);
  });

  it("一覧に居ないユーザの下書きは無視する（削除された）", () => {
    const ghost = user("ghost.user");
    const drafts = setDraft({}, ghost, "c-role", "開発");
    expect(pendingChanges(USERS, COLUMNS, drafts)).toEqual([]);
  });
});

describe("cellError / hasInvalidCell（Issue #103）", () => {
  it("空・通常の値はエラーなし", () => {
    expect(cellError("")).toBeNull();
    expect(cellError("開発")).toBeNull();
  });

  it("128 文字を超える値と、制御文字はエラー", () => {
    expect(cellError("あ".repeat(128))).toBeNull();
    expect(cellError("あ".repeat(129))).toContain("128");
    expect(cellError("a\nb")).toContain("制御文字");
  });

  it("不正な下書きが 1 つでもあれば hasInvalidCell が真", () => {
    const ok = setDraft({}, kenji, "c-role", "開発リーダー");
    expect(hasInvalidCell(USERS, COLUMNS, ok)).toBe(false);
    const bad = setDraft(ok, dana, "c-role", "あ".repeat(129));
    expect(hasInvalidCell(USERS, COLUMNS, bad)).toBe(true);
  });

  it("不正な下書きも「変更あり」として数える（保存は止める側で行う）", () => {
    const bad = setDraft({}, dana, "c-role", "あ".repeat(129));
    expect(changedCellCount(USERS, COLUMNS, bad)).toBe(1);
  });
});

describe("runWithLimit（Issue #103）", () => {
  it("同時に走る数を上限までに抑え、結果を入力の順で返す", async () => {
    let running = 0;
    let peak = 0;
    const results = await runWithLimit([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return n * 10;
    });
    expect(peak).toBe(3);
    expect(results).toEqual(
      [10, 20, 30, 40, 50, 60, 70].map((value) => ({ status: "fulfilled", value })),
    );
  });

  it("失敗しても残りを止めず、失敗は rejected で返す", async () => {
    const results = await runWithLimit(["a", "b", "c"], 2, async (item) => {
      if (item === "b") throw new Error("boom");
      return item;
    });
    expect(results.map((result) => result.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    const failed = results[1];
    expect(failed?.status === "rejected" && (failed.reason as Error).message).toBe("boom");
  });

  it("空の入力は空の結果", async () => {
    expect(await runWithLimit([], 4, async () => 1)).toEqual([]);
  });
});
