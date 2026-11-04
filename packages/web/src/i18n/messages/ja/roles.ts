/**
 * 画面 2（IAMロール管理）。一覧・並び順の編集モード・登録・表示名と説明の編集・背景色の編集・登録の解除。
 * 通知・エラーなど、画面の状態から組み立てる文言は関数で持つ（言語を切り替えたとき、出ている通知も追随する）。
 */
export const roles = {
  title: "IAMロール管理",
  counts: (roles: number, accounts: number) => `IAMロール ${roles} 件 / AWSアカウント ${accounts}`,
  countsLoading: "IAMロール — 件 / AWSアカウント —",
  editOrder: "並び順を編集",
  register: "ロールを新規登録",
  loading: "IAMロールを読み込み中",
  loadErrorHeader: "IAMロールを読み込めませんでした",
  errorAriaLabel: "エラー",
  warningAriaLabel: "警告",
  cancel: "キャンセル",
  close: "閉じる",
  save: "保存",
  saving: "保存中",
  edit: "編集",
  unregister: "登録を解除",

  /** 並び順の編集モードのバーと、移動の読み上げ。 */
  orderBar: {
    title: "並び順を編集中",
    changes: (count: number) => `変更 ${count} 件`,
    save: (count: number) => `保存（${count} 件）`,
  },
  moved: (roleName: string, position: number) => `${roleName} を ${position} 番目に移動しました`,
  moveUpAria: (roleName: string) => `${roleName} を上へ`,
  moveDownAria: (roleName: string) => `${roleName} を下へ`,

  /** 並び順の編集モードの破棄確認（キャンセル・アプリ内の遷移）。 */
  discard: {
    header: "入力内容を破棄しますか",
    back: "編集に戻る",
    body: (count: number) => `保存していない変更が ${count} 件あります。破棄すると元に戻せません。`,
    navigateReason: "別の画面へ移動しようとしました。",
    navigateConfirm: "破棄して移動",
    confirm: "破棄",
  },

  /** 一覧が 0 件のときの案内。 */
  empty: {
    header: "まだ IAMロールが登録されていません",
    body: "IAMロール割り当ては、IAMロールが 0 件だと列を持てません。 まず IAMロールを新規登録してください。",
    register: "ロールを新規登録",
    toMatrix: "IAMロール割り当てへ",
  },

  columns: {
    order: "順",
    accountId: "AWSアカウント",
    roleName: "IAMロール名",
    displayName: "表示名",
    unreflected: "未反映の申請",
    drift: "信頼ポリシー",
    description: "説明",
    color: "背景色",
    move: "移動",
    actions: "操作",
  },
  editDescriptionAria: (roleName: string) => `${roleName} の表示名と説明を編集`,
  editColorAria: (roleName: string) => `${roleName} の背景色を編集`,
  unregisterAria: (roleName: string) => `${roleName} の登録を解除`,

  /** 成功通知（5 秒で消える。GI-5）。 */
  notices: {
    orderSaved: (count: number) => `IAMロールの並び順を保存しました（${count} 件）`,
    descriptionSaved: (roleName: string) => `${roleName} の表示名と説明を保存しました`,
    colorSaved: (roleName: string) => `${roleName} の背景色を保存しました`,
    unregistered: (roleName: string) => `IAMロール ${roleName} の登録を解除しました`,
    /**
     * 登録の成功通知（Issue #135）。信頼ポリシーから IAMユーザを取り込んだときは件数（うち新規登録）を添える。
     * 許可リスト（Issue #139）に無いアカウントのユーザは取り込まないので、件数と理由を示す。
     */
    registered: (arn: string, userCount: number, registeredCount: number, skippedCount: number): string => {
      const base =
        userCount === 0
          ? `IAMロール ${arn} を登録しました。`
          : `IAMロール ${arn} を登録しました（信頼ポリシーから IAMユーザ ${userCount} 件を取り込みました。新規登録 ${registeredCount} 件）`;
      return skippedCount > 0
        ? `${base}。許可リストに無いアカウントの IAMユーザ ${skippedCount} 件は取り込んでいません（信頼ポリシーには残ります）。`
        : base;
    },
  },

  /** 登録モーダル。 */
  create: {
    header: "IAMロールを新規登録",
    submit: "登録",
    submitting: "登録中",
    accountIdLabel: "AWSアカウントID",
    accountIdDescription:
      "デプロイ先と異なるアカウントのロールも登録できます。ターゲットアカウント側の準備は docs/guide/cross-account.md にあります。",
    accountIdRequired: "AWSアカウントID は必須です",
    accountIdFormat: "AWSアカウントID は 12 桁の数字です",
    roleNameLabel: "IAMロール名",
    roleNameRequired: "IAMロール名は必須です",
    roleNameInvalid: (name: string) => `IAMロール名に使えない文字が含まれています: ${name}`,
    /** 管理対象タグの要件（GI-1 / 質問 10 = A）。取得できなかったときは `tagUnknown`。 */
    tagUnknown: "AWS 上に実在するかは登録時に確認します。",
    tagRequirement: (key: string, value: string) =>
      `対象の IAMロールには ${key} = ${value} のタグが必要です（値は完全一致）。タグが無い場合は ` +
      `aws iam tag-role --role-name <名前> --tags Key=${key},Value=${value} ` +
      `で付けてから登録してください。`,
    arnPreviewLabel: "導出される ARN",
    linkNote:
      "登録すると、IAMロール割り当ての末尾の列になり、信頼ポリシーにいる IAMユーザ（パスなし）は 反映済みの割り当てとして取り込まれます。",
    displayNameLabel: "ロールの表示名",
    optionalMax: (max: number) => `任意。${max} 文字以内。`,
    descriptionLabel: "説明",
  },

  /** 表示名と説明の編集モーダル。 */
  editDescription: {
    header: "表示名と説明を編集",
    roleNameLabel: "IAMロール名",
    displayNameLabel: "ロールの表示名",
    displayNameDescription: (max: number) =>
      `任意。${max} 文字以内。マトリクスの列の名前になります。IAMロール名は変わりません。`,
    descriptionLabel: "説明",
    optionalMax: (max: number) => `任意。${max} 文字以内。`,
  },

  /** 背景色の編集モーダル。 */
  editColor: {
    header: "背景色を編集",
    roleNameLabel: "IAMロール名",
    label: "背景色",
    description: "マトリクスの、この IAMロールの列に付く色です。色は飾りで、IAMロールの識別は IAMロール名で行います。",
    none: "なし",
    /** パレットの色名（`ROLE_COLORS` の `id` で引く）。 */
    names: {
      red: "赤",
      orange: "橙",
      yellow: "黄",
      green: "緑",
      teal: "青緑",
      blue: "青",
      purple: "紫",
      pink: "桃",
    },
  },

  /** 登録の解除モーダル。 */
  delete: {
    blockedHeader: "IAMロールの登録を解除できません",
    header: "IAMロールの登録を解除しますか",
    unregistering: "解除中",
    confirmWithAssignments: "割り当てごと登録を解除",
    /** 太字のロール名の後ろに続く文。 */
    blockedBody: "は解除できません。 解除できるのは、未反映の申請が無い IAMロールだけです。",
    unreflectedRequest: (statusLabel: string) =>
      `未反映の申請（${statusLabel}）があります。申請履歴で反映するか破棄してください。`,
    openHistory: "申請履歴で開く",
    assignmentsRemain: (total: number, pending: number) =>
      `割り当てが ${total} 件残っています（うち未反映の変更 ${pending} 件）。 解除すると、この IAMロールの割り当てもすべて消えます。`,
    /** 「<太字のロール名>（<ARN>）の登録を解除します。」の、ロール名と ARN を挟む前後の文字。 */
    introBeforeArn: "（",
    introAfterArn: "）の登録を解除します。",
    notTouched:
      "AWS 上の IAMロールと信頼ポリシーには触れません。Rolust が反映した IAMユーザは信頼ポリシーに残ります。 信頼ポリシーから外したいときは、解除の前に、IAMロール割り当てでチェックを外して申請・反映してください。",
    historyKept: "作成済みの申請は申請履歴に残ります。同じ ARN で登録し直せます。",
  },

  /** 信頼ポリシーの乖離の確認（FR-4.9。Issue #170）。読み取りだけ・保存しない。 */
  drift: {
    check: "信頼ポリシーを確認",
    /** ボタンの近くに常時出す説明（Issue #206）。何を比べるか・読み取りだけ・乖離したときにできること。 */
    caption:
      "「信頼ポリシーを確認」は、AWS 上の信頼ポリシーと Rolust の記録（反映済みの割り当て）を読み取りで比べます。" +
      "AWS は書き換えません。食い違いがあれば、詳細から直す操作を選べます。",
    /** 説明を開く「i」ボタンの読み上げ名（Issue #232）。 */
    helpAria: "「信頼ポリシーを確認」について",
    checking: "確認中",
    cellChecking: "確認中…",
    match: "✓ 一致",
    mismatch: (count: number) => `! 乖離 ${count} 件`,
    readFailed: "✗ 読み取り失敗",
    detail: "詳細",
    detailAria: (roleName: string) => `${roleName} の信頼ポリシーの確認結果の詳細`,
    dismiss: "閉じる",
    successAriaLabel: "成功",
    infoAriaLabel: "情報",
    errorHeader: "信頼ポリシーを確認できませんでした",
    summary: {
      empty: "確認するロールがありません",
      allMatch: (count: number, time: string) =>
        `すべてのロール（${count} 件）で一致しています（${time} 時点）。再読み込みすると消えます。`,
      allFailed: (count: number, time: string) =>
        `${count} ロールすべてで、信頼ポリシーを読み取れませんでした（${time} 時点）。再読み込みすると消えます。`,
      issues: (total: number, drifted: number, failed: number, time: string) =>
        `${total} ロール中 ${drifted} ロールで、Rolust の記録と信頼ポリシーが食い違っています` +
        (failed > 0 ? `（読み取り失敗 ${failed} ロール）` : "") +
        `。${time} 時点。再読み込みすると消えます。`,
    },
    modal: {
      header: (roleName: string) => `${roleName} の信頼ポリシーの乖離`,
      close: "閉じる",
      missingHeading: "Rolust は引き受けられる状態と記録しているが、IAM 上に無い",
      extraHeading: "Rolust の記録に無い（未反映）のに、IAM 上にある",
      unmanagedHeading: "参考: Rolust の管理外の principal（乖離には数えません）",
      denySuffix: "（Deny）",
      none: "なし",
      readErrorHeading: "信頼ポリシーを読み取れませんでした",
      errorCode: (code: string) => `エラーコード: ${code}`,
    },
    needsRecheck: "再確認が必要",
    repair: {
      restore: {
        button: "IAM を記録に合わせる（申請を作成）",
        hint: "Rolust の記録を正として、IAM の信頼ポリシーを戻します。下書きの申請を作り、差分の確認画面で反映を指示します。",
        running: "申請を作成中",
      },
      adopt: {
        button: "記録を IAM に合わせる",
        hint: "IAM の信頼ポリシーを正として、Rolust の記録を更新します。AWS は書き換えません。",
        running: "記録を更新中",
      },
      noDrift: "乖離はなくなっていました。もう一度「信頼ポリシーを確認」を押してください。",
      excluded: (status: "draft" | "failed", requestId: string | null) =>
        `未反映の申請（${status === "failed" ? "失敗" : "下書き"}${requestId ? `: ${requestId}` : ""}）があるため実行できません。申請履歴で、反映するか破棄してから実行してください。`,
      errorHeader: "乖離を直せませんでした",
      adoptedNotice: (count: number) =>
        `${count} 件を記録に合わせました。AWS は書き換えていません。「信頼ポリシーを確認」で確かめられます。`,
      partialHeader: "一部の記録を更新できませんでした",
      partialBody: "もう一度実行すると、残りを直せます。",
      confirm: {
        header: (roleName: string) => `${roleName}: 記録を IAM に合わせる`,
        body: "Rolust の記録を、IAM の信頼ポリシーの現状に合わせます。AWS の信頼ポリシーは書き換えません。",
        adoptHeading: "記録に取り込む（IAM にいる）",
        dropHeading: "記録から外す（IAM にいない）",
        overwriteWarning: "これらのユーザの未反映の編集（チェックの変更）は上書きされます。",
        confirm: "記録を合わせる",
        cancel: "キャンセル",
      },
    },
  },
};
