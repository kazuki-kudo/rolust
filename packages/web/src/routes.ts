/**
 * 経路の定義（DF-5 / MQ-2）。
 *
 * 画面と URL の対応を 1 箇所に閉じる。ナビゲーション（`AppShell`）と各画面の
 * 遷移先がそれぞれ文字列リテラルを持つと、片方だけ直したときに静かに壊れるため。
 */

export const ROUTES = {
  /** FR-7.1 ユーザプール管理（プールはデプロイにつき 1 つ。Issue #108）。 */
  pool: "/pool",
  /** FR-7.2 IAMロール管理。 */
  roles: "/roles",
  /** FR-7.3 IAMロール割り当て。 */
  matrix: "/matrix",
  /**
   * FR-7.4 差分確認・反映。
   *
   * `?ids=<csv>` で対象 ChangeRequest 群を表す（MQ-2）。FR-4.7 の
   * 「セッションをまたいだ下書き再開」は、この URL の再訪で成立する。
   */
  requests: "/requests",
  /** FR-7.5 申請履歴。`?highlight=<changeRequestId>` で該当行を強調する。 */
  history: "/history",
} as const;

export interface NavItem {
  path: string;
  /** 表示名のカタログのキー（`t.shell.nav[labelKey]`）。文言は描画側で引く。 */
  labelKey: "pool" | "roles" | "matrix" | "history";
  testId: string;
}

/**
 * トップナビゲーションの項目（`mockups.md` § 情報アーキテクチャ）。
 *
 * **`ROUTES.requests`（FR-7.4）はここに含めない。** 特定の ChangeRequest 群に対する
 * 操作画面であり単独で開く意味がないため、到達経路は FR-7.3 の「申請を作成」と
 * FR-7.5 の「再開 / 再反映」の 2 つに限られる。
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: ROUTES.pool, labelKey: "pool", testId: "nav-pools" },
  { path: ROUTES.roles, labelKey: "roles", testId: "nav-roles" },
  { path: ROUTES.matrix, labelKey: "matrix", testId: "nav-matrix" },
  { path: ROUTES.history, labelKey: "history", testId: "nav-history" },
];

/** `/requests?ids=a,b` を組み立てる（MQ-2）。 */
export function requestsPath(changeRequestIds: string[]): string {
  if (changeRequestIds.length === 0) return ROUTES.requests;
  return `${ROUTES.requests}?ids=${encodeURIComponent(changeRequestIds.join(","))}`;
}

/** `/history?highlight=<changeRequestId>` を組み立てる。 */
export function historyPath(changeRequestId?: string | null): string {
  if (!changeRequestId) return ROUTES.history;
  return `${ROUTES.history}?highlight=${encodeURIComponent(changeRequestId)}`;
}

/**
 * 申請の URL（Issue #141）。反映者へ渡し、開けば画面 4（差分確認・反映）が直接出る。
 * `origin` は呼び出し側が渡す（この画面を開いているオリジン。CloudFront のドメイン）。
 */
export function requestUrl(origin: string, changeRequestId: string): string {
  return `${origin}${requestsPath([changeRequestId])}`;
}
