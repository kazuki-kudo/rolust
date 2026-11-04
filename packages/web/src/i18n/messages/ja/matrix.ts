/** 画面 3（IAMロール割り当て）。画面・変更の取り消しの確認・マトリクスの殻・非表示の列・除外の帯。グリッドとメニューは `matrixGrid`。 */

/** 取り消しの完了通知に添える、対象外にしたロール数。0 件なら空。 */
const skippedNote = (skipped: number): string =>
  skipped > 0 ? `（未反映の申請があるため ${skipped} 件の IAMロールは対象外でした）` : "";

export const matrix = {
  title: "IAMロール割り当て",
  counts: (users: number, roles: number) => `IAMユーザ ${users} / IAMロール ${roles}`,
  countsLoading: "IAMユーザ — / IAMロール —",
  /** ツールバーの件数。`totalChanges` が 0 のときは「変更はありません」。 */
  selectionSummary: (selected: number, excluded: number, totalChanges: number) =>
    `${selected} 件の IAMロールを選択中 · ${excluded} 件の IAMロールを除外` +
    (totalChanges === 0 ? " · 変更はありません" : ` · 変更 ${totalChanges} 件`),
  loading: "マトリクスを読み込み中",
  loadErrorHeader: "IAMロール割り当てを読み込めませんでした",
  saving: "保存中",
  saved: "保存済み",
  revertChanges: "変更を取り消す",
  createRequests: "申請を作成",
  creating: "作成中",
  infoAriaLabel: "情報",
  warningAriaLabel: "警告",

  saveFailed: (roleName: string, detail: string) =>
    `割り当てを保存できませんでした（${roleName}）: ${detail}。再度チェックしてください。`,
  /** ロール名と、その理由・失敗の本文を並べる 1 行。 */
  roleLine: (roleName: string, text: string) => `${roleName} — ${text}`,
  creationFailedHeader: (count: number) => `${count} 件の IAMロールの申請を作成できませんでした`,
  noRequestsHeader: "作成できる申請がありませんでした",
  createFailedHeader: "申請の作成に失敗しました",

  revertedNotice: (reverted: number, skipped: number) =>
    `${reverted} 件の変更を取り消しました${skippedNote(skipped)}`,
  nothingToRevertNotice: (skipped: number) => `取り消せる変更はありませんでした${skippedNote(skipped)}`,
  revertFailureHeader: (count: number) => `${count} 件を取り消せませんでした`,
  revertedCount: (count: number) => `${count} 件は取り消しました。`,
  /** 取り消せなかった交点の 1 行。 */
  revertFailureItem: (roleName: string, userName: string, message: string) =>
    `${roleName}（${userName}）— ${message}`,
  revertRetryHint:
    "「変更を取り消す」をもう一度押すと、残りを戻せます（取り消しは何度行っても同じ結果になります）。",

  /** `RevertChangesModal`。 */
  revertModal: {
    header: "未反映の変更を取り消しますか",
    cancel: "キャンセル",
    confirm: "取り消す",
    confirming: "取り消し中",
    body: (changes: number, roles: number) =>
      `${changes} 件の未反映の変更（${roles} 件の IAMロール）を取り消し、反映済みの状態に戻します。 この操作は元に戻せません。`,
    noEffect: "AWS には影響しません。申請も作成しません。",
    excluded: (roles: number) =>
      `未反映の申請があるため ${roles} 件の IAMロールは対象外です。その変更をやめるには、 申請履歴で破棄してから取り消してください。`,
  },

  /** ロールが 0 件・ユーザが 0 件のときの案内。 */
  empty: {
    noUsersHeader: "マトリクスを描画できません",
    noRolesHeader: "IAMロールが登録されていません",
    goToRoles: "IAMロール管理へ",
    noUsersBody: "IAMユーザが登録されていません。IAMユーザ画面から登録してください。",
    noRolesBody: "IAMロールを新規登録すると、IAMロール割り当ての列として表示されます。",
  },

  filterField: {
    ariaLabel: "IAMユーザを絞り込み",
    placeholder: "IAMユーザ名・AWSアカウントID・属性で絞り込み",
  },
  viewStatus: (shown: number, total: number) => `表示 ${shown} / 全 ${total} 行`,
  clearAll: "すべて解除",

  /** 列を隠す・表示する読み上げ（`aria-live`）。 */
  announce: {
    roleHidden: (name: string) => `${name} の列を隠しました`,
    roleShown: (name: string) => `${name} の列を表示しました`,
    allShown: "すべての列を表示しました",
  },
  allHidden: {
    message: "すべての列を隠しています",
    showAll: "すべて表示",
  },
  /** 表の下の凡例。`+` と `−` は記号なので文言に含めない。 */
  legend: {
    add: "追加",
    remove: "削除",
    separator: "／",
    lockNote: "「下書き」「失敗」の列は、未反映の申請があるため申請を作成できません",
  },

  /** `HiddenColumnsStatus`。 */
  hiddenColumns: {
    summary: (count: number, changed: number) =>
      `非表示 ${count} 列${changed > 0 ? `（変更あり ${changed} 列）` : ""}`,
    openListAriaLabel: (summary: string) => `${summary}。表示する一覧を開く`,
    groupAriaLabel: "非表示の列",
    changed: "（変更あり）",
    conditioned: "（条件あり）",
    show: "表示する",
    showAll: "すべて表示",
  },

  /** `ExclusionBanner`。 */
  exclusionBanner: {
    allExcluded: "申請を作成できる IAMロールがありません",
    excluded: (count: number) => `${count} 件の IAMロールを申請対象から除外しました`,
    body: "未反映の申請が残っているため、新しい申請を作成できません。既存の申請を反映または破棄してください。",
  },
};
