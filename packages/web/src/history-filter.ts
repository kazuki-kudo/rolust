import type { ChangeRequest, ChangeRequestStatus } from "@rolust/core";

/**
 * 申請履歴（画面 5 / FR-7.5）の絞り込み条件（Issue #109）。
 *
 * 状態・反映日・対象の IAMロールは、取得済みの申請を画面側で絞る（NFR-1・A-7）。作成日の範囲は、
 * 取得する範囲も決める（Issue #116。画面が始端を API の `createdFrom` に渡す）。
 * 日付はブラウザのローカル時刻で解釈する。
 * 一覧の表示（`formatTimestamp`）がローカル時刻なので、画面に見える日付と絞り込みの日付が一致する。
 */

export type StatusFilter = ChangeRequestStatus | "all";

/** 日付の範囲（作成日・反映日）。`YYYY-MM-DD`（ローカルの日付）。null はその端が無いこと。 */
export interface DateRange {
  from: string | null;
  to: string | null;
}

export interface HistoryConditions {
  status: StatusFilter;
  range: DateRange | null;
  /** 反映日（`appliedAt`）の範囲（Issue #117）。反映日の無い行（下書き・破棄）は、範囲を指定したら除外する。 */
  appliedRange: DateRange | null;
  /** 対象の IAMロール。`roleArn` の部分一致（ロール名・パス・AWSアカウントID）。 */
  role: string;
  /** 申請 ID（Issue #145）。前方一致。`cr-` の有無・大文字小文字を問わない。 */
  requestId: string;
}

export const NO_CONDITIONS: HistoryConditions = {
  status: "all",
  range: null,
  appliedRange: null,
  role: "",
  requestId: "",
};

function sameRange(left: DateRange | null, right: DateRange | null): boolean {
  if (left === null || right === null) return left === right;
  return left.from === right.from && left.to === right.to;
}

/**
 * @param defaultRange 作成日の範囲の初期値。これと同じ範囲は、利用者が選んだ条件ではないので数えない。
 */
export function hasConditions(
  conditions: HistoryConditions,
  defaultRange: DateRange | null = null,
): boolean {
  return (
    conditions.status !== "all" ||
    !sameRange(conditions.range, defaultRange) ||
    conditions.appliedRange !== null ||
    conditions.role.trim() !== "" ||
    conditions.requestId.trim() !== ""
  );
}

/** `YYYY-MM-DD` をローカル時刻のその日の始まり（または終わり）にする。壊れた値は null。 */
function localDayBoundary(date: string, edge: "start" | "end"): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const time =
    edge === "start"
      ? new Date(year, month - 1, day, 0, 0, 0, 0)
      : new Date(year, month - 1, day, 23, 59, 59, 999);
  return time.getTime();
}

/** ISO 時刻が `range` に収まるか。範囲の端が両方無ければ常に true。時刻が無い・壊れていれば false。 */
function inRange(iso: string | null, range: { from: number | null; to: number | null }): boolean {
  if (range.from === null && range.to === null) return true;
  if (iso === null) return false;
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return false;
  if (range.from !== null && time < range.from) return false;
  if (range.to !== null && time > range.to) return false;
  return true;
}

function boundaries(range: DateRange | null): { from: number | null; to: number | null } {
  return {
    from: range?.from ? localDayBoundary(range.from, "start") : null,
    to: range?.to ? localDayBoundary(range.to, "end") : null,
  };
}

/** ローカル時刻の日付を `YYYY-MM-DD` にする。 */
function formatLocalDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

const DEFAULT_CREATED_RANGE_MONTHS = 3;

/**
 * 作成日の範囲の初期値（Issue #116）: 今日から 3 か月前〜（終端なし）。
 * 3 か月前に同じ日が無ければ（5/31 → 2/28）、その月の末日にする。
 */
export function defaultCreatedRange(now: Date): DateRange {
  const targetMonth = now.getMonth() - DEFAULT_CREATED_RANGE_MONTHS;
  const lastDay = new Date(now.getFullYear(), targetMonth + 1, 0).getDate();
  const from = new Date(now.getFullYear(), targetMonth, Math.min(now.getDate(), lastDay));
  return { from: formatLocalDate(from), to: null };
}

/**
 * API の `createdFrom` に渡す値。範囲の始端のローカルの開始日 00:00:00.000 を UTC の ISO にする。
 * 始端が無ければ undefined（全期間を取得する）。終端は画面側で絞るので渡さない。
 */
export function createdFromParam(range: DateRange | null): string | undefined {
  const start = range?.from ? localDayBoundary(range.from, "start") : null;
  return start === null ? undefined : new Date(start).toISOString();
}

/** 作成日の範囲の対象外の状態。未反映の申請は FR-4.6 のロックを握るので、期間で隠さない（Issue #116）。 */
const CREATED_RANGE_EXEMPT: ReadonlySet<ChangeRequestStatus> = new Set(["draft", "failed"]);

/** 申請 ID の前方一致。`query` は小文字・trim 済み。`cr-` を付けても付けなくても、ID の先頭から一致を見る。 */
function matchesRequestId(changeRequestId: string, query: string): boolean {
  const id = changeRequestId.toLowerCase();
  return id.startsWith(query) || id.replace(/^cr-/, "").startsWith(query);
}

/** 条件に合う申請を、作成日の新しい順で返す。条件どうしは AND。 */
export function filterRequests(
  requests: readonly ChangeRequest[],
  conditions: HistoryConditions,
): ChangeRequest[] {
  const role = conditions.role.trim().toLowerCase();
  const requestId = conditions.requestId.trim().toLowerCase();
  const created = boundaries(conditions.range);
  const applied = boundaries(conditions.appliedRange);

  return requests
    .filter((request) => {
      if (conditions.status !== "all" && request.status !== conditions.status) return false;
      if (role !== "" && !request.roleArn.toLowerCase().includes(role)) return false;
      if (requestId !== "" && !matchesRequestId(request.changeRequestId, requestId)) return false;
      if (!CREATED_RANGE_EXEMPT.has(request.status) && !inRange(request.createdAt, created)) {
        return false;
      }
      if (!inRange(request.appliedAt, applied)) return false;
      return true;
    })
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}
