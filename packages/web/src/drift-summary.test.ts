import type { TrustDriftView } from "@rolust/core";
import { describe, expect, it } from "vitest";

import { summarizeDrift } from "./drift-summary.js";

let sequence = 0;
function view(status: TrustDriftView["status"]): TrustDriftView {
  sequence += 1;
  return {
    roleArn: `arn:aws:iam::555566667777:role/R-${sequence}`,
    status,
    missing: status === "drift" ? ["x"] : [],
    extra: [],
    unmanaged: [],
    readError: status === "readError" ? { errorCode: "AccessDenied", message: "m" } : null,
  };
}

describe("乖離の確認結果の集計（FR-4.9）", () => {
  it("ロールが 0 件なら empty", () => {
    expect(summarizeDrift([])).toEqual({ kind: "empty", total: 0, drifted: 0, failed: 0 });
  });

  it("すべて一致なら allMatch", () => {
    expect(summarizeDrift([view("match"), view("match")])).toEqual({ kind: "allMatch", total: 2, drifted: 0, failed: 0 });
  });

  it("すべて読み取り失敗なら allFailed", () => {
    expect(summarizeDrift([view("readError"), view("readError")])).toEqual({ kind: "allFailed", total: 2, drifted: 0, failed: 2 });
  });

  it("乖離がある、または一部が読み取り失敗なら issues（件数を別に数える）", () => {
    expect(summarizeDrift([view("match"), view("drift"), view("readError")])).toEqual({
      kind: "issues",
      total: 3,
      drifted: 1,
      failed: 1,
    });
    expect(summarizeDrift([view("match"), view("readError")])).toEqual({ kind: "issues", total: 2, drifted: 0, failed: 1 });
  });
});
