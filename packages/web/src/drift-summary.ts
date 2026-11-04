import type { TrustDriftView } from "@rolust/core";

/**
 * 乖離の確認結果の集計（サマリの種類と件数。FR-4.9）。
 *
 * - `empty`: 確認するロールが 0 件。
 * - `allMatch`: すべてのロールで一致。
 * - `allFailed`: すべてのロールで読み取りに失敗。
 * - `issues`: 乖離があるか、一部のロールが読み取りに失敗した（乖離と読み取り失敗は別に数える）。
 */
export interface DriftSummary {
  kind: "empty" | "allMatch" | "allFailed" | "issues";
  total: number;
  drifted: number;
  failed: number;
}

export function summarizeDrift(views: TrustDriftView[]): DriftSummary {
  const total = views.length;
  const drifted = views.filter((view) => view.status === "drift").length;
  const failed = views.filter((view) => view.status === "readError").length;

  if (total === 0) return { kind: "empty", total, drifted, failed };
  if (failed === total) return { kind: "allFailed", total, drifted, failed };
  if (drifted === 0 && failed === 0) return { kind: "allMatch", total, drifted, failed };
  return { kind: "issues", total, drifted, failed };
}
