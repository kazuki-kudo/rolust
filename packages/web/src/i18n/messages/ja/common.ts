/** 複数の画面・部品で使う文言。各部品が必要とした分を足す。 */
export const common = {
  /** `GuardedModal`: 入力があるモーダルを閉じるときの破棄の確認。 */
  guardedModal: {
    warningAriaLabel: "警告",
    discardHeader: "入力内容を破棄しますか",
    defaultConfirmText: "このモーダルを閉じると、入力した内容は保存されずに失われます。",
    backToEdit: "編集に戻る",
    discard: "破棄する",
  },
  /** `SkipToActions`: マトリクスを飛ばすスキップリンク。 */
  skipToActions: "マトリクスを飛ばして申請操作へ",
  /** `RequestLink`: 申請の ID と URL のコピー。 */
  requestLink: {
    idLabel: "申請 ID: ",
    copyUrl: "URL をコピー",
    copied: "URL をコピーしました",
    copyFailed: "コピーできませんでした。手で選択してください",
  },
};
