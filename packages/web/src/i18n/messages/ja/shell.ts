export const shell = {
  /** ナビの項目の表示名。`routes.ts` の `NAV_ITEMS` が `labelKey` で引く。 */
  nav: {
    pool: "IAMユーザ",
    roles: "IAMロール管理",
    matrix: "IAMロール割り当て",
    history: "申請履歴",
  },
  mainNavigation: "メインナビゲーション",
  logout: "ログアウト",
  /** 言語切替の ARIA ラベル。どちらの言語の利用者にも読めるよう、両言語を併記する。 */
  languageLabel: "言語 / Language",
  desktopOnlyHeader: "デスクトップでご利用ください（1024px 以上）",
  desktopOnlyBody:
    "IAMロール割り当ては横方向に伸びる表であり、狭い画面では列の対応が読めません。 Rolust はデスクトップ専用です。",
};
