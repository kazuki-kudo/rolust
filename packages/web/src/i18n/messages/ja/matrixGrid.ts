/** 画面 3 のグリッド（`MatrixGrid`）と、列ヘッダのメニュー（`ColumnMenu`）。 */
export const matrixGrid = {
  caption:
    "行が IAMユーザ、列が IAMロールの割り当ての表。矢印キーでセル間を移動し、 Space でチェックを切り替えます。",
  corner: "IAMユーザ \\ IAMロール",
  openColumn: (name: string) => `${name} の列を開く`,
  foldColumn: (name: string) => `${name} の列を畳む`,
  /** 列ヘッダの「▾」とメニューの `aria-label`（ロール列・属性の項目に共通）。 */
  sortAndFilter: (name: string) => `${name} のソートとフィルタ`,
  noMatch: "条件に一致する IAMユーザがいません。",
  assignAriaLabel: (userName: string, roleName: string) => `${userName} に ${roleName} を割り当てる`,
  added: "追加",
  removed: "削除",
  hideDisabledReason: "申請に含めている列は隠せません",
  /** 除外列の状態チップの読み上げ。`failed` が失敗した申請、そうでなければ下書きの申請。 */
  lockedChipAriaLabel: (roleName: string, failed: boolean) =>
    `${roleName}: ${failed ? "失敗した申請が 1 件ある" : "下書きの申請が 1 件ある"}ため申請対象外`,
  noChange: "変更なし",
  includeAriaLabel: (roleName: string) => `${roleName} を申請対象に含める`,
  includeLabel: (changes: number) => `申請に含める（変更 ${changes}）`,

  /** 列フィルタの値（ロール列のメニューと、見出しのバッジ）。 */
  filterLabel: {
    checked: "チェックあり",
    unchecked: "チェックなし",
    changed: "未反映の変更あり",
  },
  /** 列ヘッダのバッジ。色だけに頼らず語で示す。 */
  badge: {
    sortCheckedFirst: "↑ チェックあり",
    sortUncheckedFirst: "↑ チェックなし",
    sortAsc: "↑ 昇順",
    sortDesc: "↓ 降順",
    filter: (label: string) => `絞り込み: ${label}`,
    unset: "（未設定）",
    separator: " ／ ",
  },

  /** 列ヘッダのメニュー。 */
  menu: {
    groupSort: "ソート",
    groupFilter: "フィルタ",
    groupColumn: "列",
    checkedFirst: "チェックありを上に",
    uncheckedFirst: "チェックなしを上に",
    clearSort: "ソートを解除",
    filterAll: "すべて",
    hideColumn: "この列を隠す",
    ascending: "昇順",
    descending: "降順",
    valueCount: (value: string, count: number) => `${value}（${count}）`,
    unsetCount: (count: number) => `（未設定）（${count}）`,
    openColumn: "この列を開く",
    foldColumn: "この列を畳む",
  },
};
