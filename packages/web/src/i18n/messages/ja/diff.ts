/**
 * 画面 4（差分確認・反映）。画面本体（`DiffScreen`）と、1 件の申請のカード（`PolicyDiffPanel`）の文言。
 * 一括反映の失敗など、画面の状態から組み立てる文言は関数で持つ（言語を切り替えたとき、出ている文言も追随する）。
 */
export const diff = {
  title: "差分確認・反映",
  backToMatrix: "← IAMロール割り当てへ戻る",
  counts: (count: number, createdAt: string) => `${count} 件 / 作成 ${createdAt}`,
  countsLoading: (loaded: number, total: number) => `${loaded} / ${total} 件を読み込み中`,
  errorAriaLabel: "エラー",
  warningAriaLabel: "警告",

  /** ツールバーの「選択した n 件を反映」。 */
  applying: "反映中",
  applySelected: (count: number) => `選択した ${count} 件を反映`,
  summary: (total: number, applied: number) => `${total} 件中 ${applied} 件を反映しました。`,
  applyErrorHeader: "反映を実行できませんでした",
  /** 一括反映そのものが失敗したとき。個々のロールの成否は不明なので、その旨を添える。 */
  applyErrorBody: (message: string) =>
    `${message}（どの IAMロールが反映されたかは申請履歴で確認してください）`,

  missingHeader: (count: number) => `${count} 件の申請が見つかりませんでした`,
  empty: {
    header: "反映待ちの申請はありません",
    body: "この URL が指す申請は、すべて反映済みまたは破棄済みです。",
    toMatrix: "IAMロール割り当てへ",
  },

  /** 読み込み中のカードと、読み込めなかったカード。 */
  loadingPolicy: "現在の信頼ポリシーを読み込み中",
  cardLoadErrorHeader: (id: string) => `申請 ${id} を読み込めませんでした`,
  reloadAll: (count: number) => `${count} 件を読み込めませんでした — すべて再試行`,

  /** 1 件の申請のカード（`PolicyDiffPanel`）。 */
  panel: {
    sectionAria: (roleName: string) => `${roleName} の差分`,
    include: "反映対象",
    includeAria: (roleName: string) => `${roleName} を反映対象に含める`,
    applying: "反映中",
    readErrorHeader: "現在の信頼ポリシーを読み取れませんでした",
    addedHeading: "追加されるプリンシパル",
    addedMarker: "追加",
    removedHeading: "削除されるプリンシパル",
    removedMarker: "削除",
    none: "（なし）",
    placeholderRemoved: "誰も引き受けられない状態を表すプレースホルダ（RolustPlaceholder）を削除します。",
    placeholderInjected:
      "Rolust 管理下のプリンシパルが 0 件になるため、プレースホルダ（RolustPlaceholder）を挿入します。反映後、この IAMロールは誰も引き受けられません。",
    noop: (total: number, present: number, absent: number) =>
      `反映しても変化しない項目が${total} 件あります （既に存在する追加対象 ${present} 件 / 既に存在しない削除対象 ${absent} 件）。`,
    /** 管理外 principal の種別（`kind`）と、Deny の文であること。ARN などの値の後ろに添える。 */
    unmanagedDetail: (kind: string, deny: boolean) => `（${kind}${deny ? " / Deny" : ""}）`,
    unmanagedHeader: (count: number) =>
      `Rolust 管理外のプリンシパルが ${count} 件あります。反映してもこれらは削除されません。`,
  },

  /** 反映の結果（カード内）。 */
  result: {
    counts: (added: number, removed: number) => `追加 ${added} 件 / 削除 ${removed} 件`,
    failedHeader: "反映に失敗しました",
    retry: "この申請を再反映",
  },
};
