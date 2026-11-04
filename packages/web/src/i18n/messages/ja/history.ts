/**
 * 画面 5（申請履歴）。一覧・絞り込み・破棄の確認・通知。
 * 通知・エラーなど、画面の状態から組み立てる文言は関数で持つ（言語を切り替えたとき、出ている通知も追随する）。
 */
export const history = {
  title: "申請履歴",
  counts: (total: number, draft: number, failed: number, applied: number, discarded: number) =>
    `${total} 件 / 下書き ${draft} · 失敗 ${failed} · 反映済み ${applied} · 破棄 ${discarded}`,
  countsLoading: "— 件",
  /** 取得した範囲の注記（Issue #116）。 */
  rangeNote: (from: string) => `作成日 ${from} 以降の申請（下書き・失敗は期間によらず）を表示しています`,
  loading: "申請履歴を読み込み中",
  loadErrorHeader: "申請履歴を読み込めませんでした",
  warningAriaLabel: "警告",

  /** 絞り込み（Issue #109・#117・#145）。 */
  filter: {
    statusLabel: "状態",
    statusAria: "状態で絞り込む",
    all: "すべて",
    createdLabel: "作成日（日付範囲。下書き・失敗は対象外）",
    createdAria: "作成日の日付範囲で絞り込む",
    appliedLabel: "反映日（日付範囲）",
    appliedAria: "反映日の日付範囲で絞り込む",
    rangePlaceholder: "日付範囲を選ぶ",
    roleLabel: "対象の IAMロール",
    roleAria: "対象の IAMロールで絞り込む",
    rolePlaceholder: "IAMロール名・AWSアカウントID など",
    requestIdLabel: "申請 ID（前方一致）",
    requestIdAria: "申請 ID の前方一致で絞り込む",
    matchCount: (shown: number, total: number) => `表示 ${shown} / 全 ${total} 件`,
    clearAll: "すべて解除",
    /** 日付範囲の検証エラー（開始日が終了日より後）。 */
    invalidRange: "開始日は終了日より前にしてください。",
  },

  /** 日付範囲の入力（Cloudscape の `DateRangePicker` の文言）。 */
  dateRange: {
    applyButtonLabel: "適用",
    cancelButtonLabel: "キャンセル",
    clearButtonLabel: "クリア",
    startDateLabel: "開始日",
    endDateLabel: "終了日",
    startMonthLabel: "開始月",
    endMonthLabel: "終了月",
    todayAriaLabel: "今日",
    nextMonthAriaLabel: "次の月",
    previousMonthAriaLabel: "前の月",
    currentMonthAriaLabel: "今月",
    nextYearAriaLabel: "次の年",
    previousYearAriaLabel: "前の年",
    errorIconAriaLabel: "エラー",
    isoDatePlaceholder: "YYYY-MM-DD",
    slashedDatePlaceholder: "YYYY/MM/DD",
    dateConstraintText: "日付を YYYY/MM/DD の形式で入力してください。",
    slashedDateConstraintText: "日付を YYYY/MM/DD の形式で入力してください。",
    isoDateConstraintText: "日付を YYYY-MM-DD の形式で入力してください。",
    selectedRangeAriaLive: (start: string, end: string) => `${start} から ${end} までを選びました`,
  },

  /** 一覧が 0 件・条件に一致なしのときの案内。 */
  empty: {
    none: "まだ申請がありません",
    noMatch: "条件に一致する申請はありません",
    toMatrix: "IAMロール割り当てへ",
    clearFilter: "条件をすべて解除する",
  },

  columns: {
    status: "状態",
    role: "対象の IAMロール",
    requestId: "申請 ID",
    createdAt: "作成日",
    appliedAt: "反映日",
    createdBy: "作成者",
    appliedBy: "反映者",
    actions: "操作",
  },

  /** 行の詳細（展開部）。ラベルの末尾の空白は、続く値との区切り。 */
  detail: {
    requestId: "申請 ID: ",
    roleArn: "対象の IAMロール ARN: ",
    addHeading: "追加するプリンシパル",
    removeHeading: "削除するプリンシパル",
    arnList: (heading: string, count: number) => `${heading}（${count}）`,
    appliedAt: "反映日: ",
    result: "反映結果: ",
  },

  actions: {
    resume: "再開",
    reapply: "再反映",
    discard: "破棄",
    details: "詳細",
  },

  /** 破棄の確認モーダル（この画面が破棄の唯一の起点）。 */
  discardModal: {
    header: "この申請を破棄しますか",
    cancel: "キャンセル",
    confirm: "破棄する",
    confirming: "破棄中",
    keptInHistory: "この申請は状態「破棄」として履歴に残ります。削除はされません。",
    /** ロール名の前後。ロール名は太字で挟む。 */
    unlockBefore: "破棄すると ",
    unlockAfter: " の 新しい申請を作成できるようになります。",
  },

  /** 破棄の結果の通知。成功は 5 秒で消え、警告とエラーは残る（GI-5）。 */
  notices: {
    discarded: "申請を破棄しました。",
    discardedUnlocked: (roleName: string) =>
      `申請を破棄しました。${roleName} の新しい申請を作成できるようになりました。`,
    /** `lockWarning` は API が返したロールロック解放失敗の文（「ロールロックを…」で始まる）。 */
    discardedLockLeaked: (roleName: string, lockWarning: string) =>
      `申請を破棄しました。ただし ${roleName} の${lockWarning}`,
    discardFailed: (message: string) => `破棄できませんでした: ${message}`,
  },
};
