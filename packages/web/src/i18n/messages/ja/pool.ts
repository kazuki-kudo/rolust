/**
 * 画面 1（IAMユーザ）。表・絞り込み・属性の編集モード・登録（1 件ずつ／CSV）・属性の項目の編集・属性の編集・登録の解除。
 * 通知・エラーなど、画面の状態から組み立てる文言は関数で持つ（言語を切り替えたとき、出ている通知も追随する）。
 */
export const pool = {
  title: "IAMユーザ",
  counts: (users: number, accounts: number, roles: number) =>
    `IAMユーザ ${users} 件 / AWSアカウント ${accounts} / IAMロール ${roles} 件`,
  countsLoading: "IAMユーザ — 件 / AWSアカウント — / IAMロール — 件",
  addUsers: "ユーザを新規登録",
  editAttributeColumns: "属性の項目を編集",
  loading: "IAMユーザを読み込み中",
  loadErrorHeader: "IAMユーザを読み込めませんでした",
  errorAriaLabel: "エラー",
  warningAriaLabel: "警告",
  cancel: "キャンセル",
  save: "保存",
  saving: "保存中",

  filter: {
    placeholder: "AWSアカウントID・IAMユーザ名・属性値で絞り込み",
    ariaLabel: "IAMユーザを絞り込む",
    countText: (shown: number, total: number) => `${shown} 件の一致（全 ${total} 件）`,
  },
  empty: {
    noMatch: "条件に合う IAMユーザがありません",
    clear: "条件をクリア",
    none: "まだ IAMユーザがありません",
  },

  columns: {
    accountId: "AWSアカウント",
    userName: "IAMユーザ名",
    actions: "操作",
  },
  editAttributes: "属性を編集",
  editAttributesAria: (userName: string) => `${userName} の属性を編集`,
  unregister: "登録を解除",
  unregisterAria: (userName: string) => `${userName} の登録を解除`,

  /** 属性の編集モード（Issue #103）。 */
  edit: {
    start: "属性一括編集モード",
    title: "編集中",
    changes: (count: number) => `変更 ${count} 件`,
    save: (count: number) => `保存（${count} 件）`,
    cellAria: (userName: string, columnName: string) => `${userName} の ${columnName}`,
    rowFailed: (reason: string) => `保存できませんでした: ${reason}`,
    rowSaved: "保存済み",
    retry: (failed: number) => `失敗した ${failed} 人を再送`,
    partial: (saved: number, failed: number) =>
      `${saved > 0 ? `${saved} 人の属性を保存しました。` : ""}${failed} 人を保存できませんでした。保存できなかった行は、理由を確かめて再送してください。`,
  },

  /** 編集モードの破棄確認（キャンセル・アプリ内の遷移）。 */
  discard: {
    header: "入力内容を破棄しますか",
    back: "編集に戻る",
    body: (count: number) => `保存していない変更が ${count} 件あります。破棄すると元に戻せません。`,
    navigateReason: "別の画面へ移動しようとしました。",
    navigateConfirm: "破棄して移動",
    confirm: "破棄",
  },

  /** 成功通知（5 秒で消える。GI-5）。 */
  notices: {
    attributesSaved: (count: number) => `${count} 人の属性を保存しました`,
    userAttributesSaved: (userName: string) => `${userName} の属性を保存しました`,
    columnsSaved: "属性の項目を保存しました",
    unregistered: (userName: string, removedAssignments: number) =>
      `${userName} の登録を解除しました（連鎖削除した割り当て ${removedAssignments} 件）`,
    /** 登録の成功通知。登録済みで変更しなかった人数があれば添える（Issue #98）。 */
    registered: (created: number, skipped: number) => {
      const base = `IAMユーザを ${created} 件登録しました`;
      return skipped > 0 ? `${base}（登録済みのため変更なし ${skipped} 件）` : base;
    },
  },

  /** 登録の解除モーダル。 */
  delete: {
    header: "IAMユーザの登録を解除しますか",
    unregistering: "解除中",
    /** 「<ARN>」の後ろに続く文。 */
    afterArn: " の登録を解除します。",
    cascade:
      "この IAMユーザの割り当て（IAMロール割り当てのチェック）もすべて消えます。 AWS 上の IAMユーザは削除されません。",
    requestsKept: "作成済みの申請に記録された追加・削除の内容は変わりません。",
    blocked:
      "信頼ポリシーに反映済みの割り当て、またはこの IAMユーザを含む未反映の申請があると解除できません。 解除しても信頼ポリシーには残り、マトリクスから見えなくなるためです。",
  },

  /** 登録モーダル（1 件ずつ／CSV）。 */
  register: {
    header: "ユーザを新規登録",
    submit: "登録",
    submitting: "登録中",
    methodLabel: "登録の方法",
    single: "1 件ずつ",
    csv: "CSV",
    accountIdLabel: "AWSアカウントID",
    accountIdRequired: "AWSアカウントID は必須です",
    accountIdFormat: "AWSアカウントID は 12 桁の数字です",
    userNamesLabel: "IAMユーザ名",
    userNamesDescription: "1 行に 1 名。前後の空白と空行は無視し、重複は 1 件に畳みます。",
    userNamesRequired: "IAMユーザ名を 1 件以上入力してください",
    userNameInvalid: (name: string) => `IAMユーザ名に使えない文字が含まれています: ${name}`,
    arnPreviewLabel: "導出される ARN（1 件目）",
    /** CSV の登録に失敗したとき、サーバのエラーの後ろに添える。 */
    csvRetry: (message: string) =>
      `${message}（同じ CSV をそのまま再送できます。登録済みの IAMユーザは変更しません）`,
  },

  /** CSV の入力欄（Issue #98）。 */
  csv: {
    label: "CSV",
    /** 形式の説明。`header` は必須の列名、`max` は 1 回の行数の上限。 */
    help: (header: string, max: number) =>
      `1 行目のヘッダは入力済みです。「${header}」列が必須で、ほかの列名はこのプールの属性の項目の名前に合わせます （列の順序は自由、属性の項目は一部だけでも構いません）。区切りはカンマ、1 回に ${max} 行まで。 登録済みの IAMユーザは変更しません。1 行でも不正なら何も登録しません。`,
    /** 説明の下に出す、データ行の例の前置き。 */
    exampleLead: "2 行目以降に、次のような行を足します。",
    /** 例の行の、属性の値。 */
    exampleValue: (position: number) => `値${position}`,
    /** 行番号つきのエラーの前置き。 */
    line: (line: number) => `${line} 行目: `,
    required: "CSV を入力してください",
  },

  /** 属性の項目を編集モーダル（Issue #61）。 */
  attributeColumns: {
    header: "属性の項目を編集",
    label: "属性の項目",
    description: (max: number) =>
      `IAMユーザごとに値を持てる項目です。最大 ${max} 項目。項目名はプール内で重複できません。`,
    nameAria: (position: number) => `列 ${position} の名前`,
    remove: "削除",
    removeAria: (position: number, name: string) => `項目 ${position}（${name}）を削除`,
    add: "項目を追加",
    removedWarning: (names: readonly string[]) =>
      `${names.map((name) => `「${name}」`).join("")}を削除すると、その列の値は見えなくなります。 同じ名前で作り直しても、値は戻りません。`,
  },

  /** 属性を編集モーダル（Issue #61）。 */
  userAttributes: {
    header: "属性を編集",
    userLabel: "IAMユーザ",
    valueDescription: (max: number) => `空にすると未設定になります。${max} 文字以内。`,
  },
};
