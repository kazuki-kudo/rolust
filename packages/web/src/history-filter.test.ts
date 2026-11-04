import type { ChangeRequest } from "@rolust/core";
import { describe, expect, it } from "vitest";

import {
  NO_CONDITIONS,
  createdFromParam,
  defaultCreatedRange,
  filterRequests,
  hasConditions,
} from "./history-filter.js";

/**
 * 申請履歴の絞り込み条件（Issue #109 / FR-7.5）。
 * 日付はブラウザのローカル時刻で解釈する（一覧の表示 `formatTimestamp` と同じ基準）。
 */

function requestOf(
  id: string,
  overrides: Partial<ChangeRequest> = {},
): ChangeRequest {
  return {
    changeRequestId: id,
    poolId: "platform-team",
    roleArn: "arn:aws:iam::555566667777:role/DeployProd",
    addUserArns: [],
    removeUserArns: [],
    status: "applied",
    createdAt: new Date(2026, 6, 31, 10, 4).toISOString(),
    createdBy: null,
    appliedAt: null,
    appliedBy: null,
    result: null,
    ...overrides,
  };
}

/** ローカル時刻の日時を作成日時の ISO 文字列にする。 */
function localIso(y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0): string {
  return new Date(y, m - 1, d, h, min, s, ms).toISOString();
}

describe("hasConditions", () => {
  it("条件が何も無ければ false", () => {
    expect(hasConditions(NO_CONDITIONS)).toBe(false);
  });

  it("空白だけのロール名は条件とみなさない", () => {
    expect(hasConditions({ ...NO_CONDITIONS, role: "   " })).toBe(false);
  });

  it("状態・日付範囲・ロール名のどれかがあれば true", () => {
    expect(hasConditions({ ...NO_CONDITIONS, status: "failed" })).toBe(true);
    expect(hasConditions({ ...NO_CONDITIONS, range: { from: "2026-07-01", to: "2026-07-31" } })).toBe(true);
    expect(hasConditions({ ...NO_CONDITIONS, role: "deploy" })).toBe(true);
    expect(hasConditions({ ...NO_CONDITIONS, requestId: "cr-ccb6" })).toBe(true);
    expect(hasConditions({ ...NO_CONDITIONS, requestId: "   " })).toBe(false);
  });

  it("反映日の範囲があれば true（Issue #117）", () => {
    expect(hasConditions({ ...NO_CONDITIONS, appliedRange: { from: "2026-07-01", to: null } })).toBe(true);
  });
});

describe("filterRequests", () => {
  it("条件が無ければ全件を作成日の新しい順で返す", () => {
    const older = requestOf("a", { createdAt: localIso(2026, 7, 1) });
    const newer = requestOf("b", { createdAt: localIso(2026, 7, 2) });

    expect(filterRequests([older, newer], NO_CONDITIONS).map((r) => r.changeRequestId)).toEqual(["b", "a"]);
  });

  it("日付範囲は両端の日を含む（開始日 00:00:00.000 から終了日 23:59:59.999 まで）", () => {
    const beforeStart = requestOf("before", { createdAt: localIso(2026, 7, 28, 23, 59, 59, 999) });
    const atStart = requestOf("start", { createdAt: localIso(2026, 7, 29, 0, 0, 0, 0) });
    const atEnd = requestOf("end", { createdAt: localIso(2026, 7, 31, 23, 59, 59, 999) });
    const afterEnd = requestOf("after", { createdAt: localIso(2026, 8, 1, 0, 0, 0, 0) });

    const result = filterRequests([beforeStart, atStart, atEnd, afterEnd], {
      ...NO_CONDITIONS,
      range: { from: "2026-07-29", to: "2026-07-31" },
    });

    expect(result.map((r) => r.changeRequestId).sort()).toEqual(["end", "start"]);
  });

  it("日付範囲の片方だけでも絞れる", () => {
    const early = requestOf("early", { createdAt: localIso(2026, 7, 1) });
    const late = requestOf("late", { createdAt: localIso(2026, 7, 20) });

    expect(
      filterRequests([early, late], { ...NO_CONDITIONS, range: { from: "2026-07-10", to: null } }).map(
        (r) => r.changeRequestId,
      ),
    ).toEqual(["late"]);
    expect(
      filterRequests([early, late], { ...NO_CONDITIONS, range: { from: null, to: "2026-07-10" } }).map(
        (r) => r.changeRequestId,
      ),
    ).toEqual(["early"]);
  });

  it("ロール名は roleArn の部分一致で、大文字小文字を区別しない", () => {
    const deploy = requestOf("d", { roleArn: "arn:aws:iam::555566667777:role/DeployProd" });
    const billing = requestOf("b", { roleArn: "arn:aws:iam::111122223333:role/path/BillingViewer" });

    const ids = (role: string): string[] =>
      filterRequests([deploy, billing], { ...NO_CONDITIONS, role }).map((r) => r.changeRequestId);

    expect(ids("deployprod")).toEqual(["d"]);
    expect(ids("BILLING")).toEqual(["b"]);
    expect(ids("role/path")).toEqual(["b"]);
    expect(ids("1111222")).toEqual(["b"]); // AWSアカウントID
    expect(ids("  deploy  ")).toEqual(["d"]); // 前後の空白は除く
    expect(ids("nothing")).toEqual([]);
  });

  it("申請 ID は前方一致で、`cr-` の有無と大文字小文字を問わず、前後の空白は除く（Issue #145）", () => {
    const first = requestOf("cr-ccb630aa-1111-4222-8333-444455556666");
    const second = requestOf("cr-ccb7ffff-1111-4222-8333-444455556666");
    const third = requestOf("cr-0a1b2c3d-1111-4222-8333-444455556666");

    const ids = (requestId: string): string[] =>
      filterRequests([first, second, third], { ...NO_CONDITIONS, requestId })
        .map((r) => r.changeRequestId.slice(3, 9))
        .sort();

    expect(ids("cr-ccb630")).toEqual(["ccb630"]);
    expect(ids("ccb630")).toEqual(["ccb630"]); // `cr-` なし
    expect(ids("CR-CCB6")).toEqual(["ccb630"]); // 大文字小文字を区別しない
    expect(ids("  cr-ccb  ")).toEqual(["ccb630", "ccb7ff"]); // 前後の空白は除く
    expect(ids("cr-ccb630aa-1111-4222-8333-444455556666")).toEqual(["ccb630"]); // 全文
    expect(ids("b630")).toEqual([]); // 前方一致で、途中一致は拾わない
    expect(ids("")).toEqual(["0a1b2c", "ccb630", "ccb7ff"]);
  });

  it("状態・日付範囲・ロール名は AND で組み合わせる", () => {
    const hit = requestOf("hit", { createdAt: localIso(2026, 7, 30) });
    const wrongStatus = requestOf("status", { createdAt: localIso(2026, 7, 30), status: "failed" });
    const wrongDate = requestOf("date", { createdAt: localIso(2026, 6, 1) });
    const wrongRole = requestOf("role", {
      createdAt: localIso(2026, 7, 30),
      roleArn: "arn:aws:iam::111122223333:role/Other",
    });

    const result = filterRequests([hit, wrongStatus, wrongDate, wrongRole], {
      status: "applied",
      range: { from: "2026-07-01", to: "2026-07-31" },
      appliedRange: null,
      role: "deploy",
      requestId: "",
    });

    expect(result.map((r) => r.changeRequestId)).toEqual(["hit"]);
  });

  describe("反映日の範囲（Issue #117）", () => {
    const ids = (requests: ChangeRequest[], from: string | null, to: string | null): string[] =>
      filterRequests(requests, { ...NO_CONDITIONS, appliedRange: { from, to } }).map((r) => r.changeRequestId);

    it("両端の日を含む", () => {
      const before = requestOf("before", { appliedAt: localIso(2026, 7, 28, 23, 59, 59, 999) });
      const atStart = requestOf("start", { appliedAt: localIso(2026, 7, 29, 0, 0, 0, 0) });
      const atEnd = requestOf("end", { appliedAt: localIso(2026, 7, 31, 23, 59, 59, 999) });
      const after = requestOf("after", { appliedAt: localIso(2026, 8, 1, 0, 0, 0, 0) });

      expect(ids([before, atStart, atEnd, after], "2026-07-29", "2026-07-31").sort()).toEqual(["end", "start"]);
    });

    it("片方だけでも絞れる", () => {
      const early = requestOf("early", { appliedAt: localIso(2026, 7, 1) });
      const late = requestOf("late", { appliedAt: localIso(2026, 7, 20) });

      expect(ids([early, late], "2026-07-10", null)).toEqual(["late"]);
      expect(ids([early, late], null, "2026-07-10")).toEqual(["early"]);
    });

    it("反映日が無い行（下書き・破棄）は、範囲を指定したら除外する", () => {
      const draft = requestOf("draft", { status: "draft", appliedAt: null });
      const discarded = requestOf("discarded", { status: "discarded", appliedAt: null });
      const applied = requestOf("applied", { appliedAt: localIso(2026, 7, 30) });

      expect(ids([draft, discarded, applied], "2026-07-01", null)).toEqual(["applied"]);
      expect(ids([draft, discarded, applied], null, "2026-07-31")).toEqual(["applied"]);
    });

    it("範囲を指定しなければ反映日の無い行も残る", () => {
      const draft = requestOf("draft", { status: "draft", appliedAt: null });

      expect(filterRequests([draft], { ...NO_CONDITIONS, appliedRange: { from: null, to: null } })).toHaveLength(1);
    });

    it("失敗の行も反映日で絞れる", () => {
      const failed = requestOf("failed", { status: "failed", appliedAt: localIso(2026, 7, 30) });

      expect(ids([failed], "2026-07-30", "2026-07-30")).toEqual(["failed"]);
    });

    it("作成日の範囲と AND で組み合わせる", () => {
      const hit = requestOf("hit", { createdAt: localIso(2026, 7, 1), appliedAt: localIso(2026, 7, 30) });
      const wrongCreated = requestOf("created", { createdAt: localIso(2026, 6, 1), appliedAt: localIso(2026, 7, 30) });
      const wrongApplied = requestOf("applied", { createdAt: localIso(2026, 7, 1), appliedAt: localIso(2026, 8, 5) });

      const result = filterRequests([hit, wrongCreated, wrongApplied], {
        ...NO_CONDITIONS,
        range: { from: "2026-07-01", to: "2026-07-31" },
        appliedRange: { from: "2026-07-20", to: "2026-07-31" },
      });

      expect(result.map((r) => r.changeRequestId)).toEqual(["hit"]);
    });
  });
});

describe("defaultCreatedRange（Issue #116）", () => {
  it("今日から 3 か月前の日付を始端にし、終端は無い", () => {
    expect(defaultCreatedRange(new Date(2026, 9, 6, 12))).toEqual({ from: "2026-07-06", to: null });
  });

  it("年をまたぐ", () => {
    expect(defaultCreatedRange(new Date(2026, 0, 15))).toEqual({ from: "2025-10-15", to: null });
  });

  it("3 か月前に同じ日が無ければ、その月の末日にする（5/31 → 2/28）", () => {
    expect(defaultCreatedRange(new Date(2026, 4, 31))).toEqual({ from: "2026-02-28", to: null });
    expect(defaultCreatedRange(new Date(2024, 4, 31))).toEqual({ from: "2024-02-29", to: null });
  });
});

describe("createdFromParam（Issue #116）", () => {
  it("始端のローカルの開始日 00:00:00.000 を UTC の ISO にする", () => {
    expect(createdFromParam({ from: "2026-07-06", to: null })).toBe(new Date(2026, 6, 6, 0, 0, 0, 0).toISOString());
    // 終端は API に渡さない。
    expect(createdFromParam({ from: "2026-07-06", to: "2026-07-31" })).toBe(new Date(2026, 6, 6).toISOString());
  });

  it("始端が無い・範囲が無いなら undefined（全期間を取得する）", () => {
    expect(createdFromParam(null)).toBeUndefined();
    expect(createdFromParam({ from: null, to: "2026-07-31" })).toBeUndefined();
  });
});

describe("作成日の範囲は下書き・失敗に効かない（Issue #116）", () => {
  it("範囲の外でも、下書き・失敗は残り、反映済み・破棄は除かれる", () => {
    const old = localIso(2026, 1, 1);
    const requests = [
      requestOf("draft", { status: "draft", createdAt: old }),
      requestOf("failed", { status: "failed", createdAt: old }),
      requestOf("applied", { status: "applied", createdAt: old }),
      requestOf("discarded", { status: "discarded", createdAt: old }),
    ];

    const result = filterRequests(requests, {
      ...NO_CONDITIONS,
      range: { from: "2026-07-06", to: null },
    });

    expect(result.map((r) => r.changeRequestId).sort()).toEqual(["draft", "failed"]);
  });
});

describe("hasConditions に既定の範囲を渡す（Issue #116）", () => {
  const initial = { from: "2026-07-06", to: null };

  it("範囲が既定のままなら条件に数えない", () => {
    expect(hasConditions({ ...NO_CONDITIONS, range: { ...initial } }, initial)).toBe(false);
  });

  it("範囲が既定と違う・空（全期間）なら条件に数える", () => {
    expect(hasConditions({ ...NO_CONDITIONS, range: { from: "2026-08-01", to: null } }, initial)).toBe(true);
    expect(hasConditions({ ...NO_CONDITIONS, range: null }, initial)).toBe(true);
  });

  it("既定の範囲を渡さなければ、従来どおり範囲があれば条件", () => {
    expect(hasConditions({ ...NO_CONDITIONS, range: { ...initial } })).toBe(true);
  });
});
