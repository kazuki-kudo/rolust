/**
 * SPA に届く文言の契約（Issue #94）。
 *
 * 文言そのものではなく、ID と引数を API が返し、SPA が言語に合わせて描画する。ID を足すときは、
 * 1. `ErrorMessageParams` に ID と引数の型を足す
 * 2. `ja.ts` と `en.ts` に描画を足す（足さないと `tsc` が落ちる）
 * 3. `messages.test.ts` の `SAMPLE_PARAMS` に例を足す（足さないと `tsc` が落ちる）
 * `params` に `undefined` を入れない（JSON・DynamoDB の往復で落ちる）。無い値は `null`。
 */

export type Locale = "ja" | "en";

/** ID → 引数の型。タスクごとにここへ足す。 */
export interface ErrorMessageParams {
  /** 運用者向けの文字列（設定不備・移行 CLI）。SPA に届くエラーには使わない。 */
  "operator.plain": { text: string };
  "auth.forbidden": { need: "view" | "edit" | "apply" };
  "route.notFound": { method: string; path: string };
  "server.internal": Record<string, never>;
  /** AWS や未知の例外の文をそのまま出す。 */
  "common.rawDetail": { detail: string };
  "arn.accountIdFormat": Record<string, never>;
  "arn.nameFormat": { field: string; value: string };
  "arn.notUserArn": { arn: string };
  "arn.notRoleArn": { arn: string };
  "merge.frozenConflict": { arn: string };
  "merge.sidConflict": { sid: string };
  "attribute.nameRequired": Record<string, never>;
  "attribute.nameControlChar": Record<string, never>;
  "attribute.nameNotVisible": Record<string, never>;
  "attribute.nameTooLong": { max: number };
  "attribute.valueControlChar": Record<string, never>;
  "attribute.valueNotVisible": Record<string, never>;
  "attribute.valueTooLong": { max: number };
  "attribute.columnsNotArray": Record<string, never>;
  "attribute.columnNotObject": Record<string, never>;
  "attribute.columnNameNotString": Record<string, never>;
  "attribute.columnIdNotString": Record<string, never>;
  "attribute.tooManyColumns": { max: number };
  "attribute.duplicateColumnName": { name: string };
  "attribute.unknownColumn": { columnId: string };
  "attribute.duplicateColumnId": { columnId: string };
  "attribute.attributesNotObject": Record<string, never>;
  "attribute.valueNotString": Record<string, never>;
  "role.descriptionControlChar": Record<string, never>;
  "role.descriptionNotVisible": Record<string, never>;
  "role.descriptionTooLong": { max: number };
  "role.displayNameControlChar": Record<string, never>;
  "role.displayNameNotVisible": Record<string, never>;
  "role.displayNameTooLong": { max: number };
  "csv.usersNotArray": Record<string, never>;
  "csv.usersEmpty": Record<string, never>;
  "csv.tooManyUsers": { max: number };
  "csv.rowError": { position: number; cause: LocalizedMessage };
  "csv.userNotObject": Record<string, never>;
  "csv.userNameNotString": Record<string, never>;
  "csv.userNameInvalidChars": { userName: string };
  "csv.duplicateUserName": { name: string };
  "csv.unknownAttributeColumn": { columnName: string };
  "csv.attributeValueNotString": { columnName: string };
  "csv.attributeValueInvalid": { columnName: string; cause: LocalizedMessage };
  "policy.empty": Record<string, never>;
  "policy.notJson": Record<string, never>;
  "policy.urlDecodeFailed": Record<string, never>;
  "policy.notObject": Record<string, never>;
  "policy.statementNotObject": { index: number };
  "policy.badEffect": { index: number };
  "changeRequest.invalidTransition": { from: string; to: string };
  /** ブラウザ側の CSV 構文エラー（`parseUserCsv`。Issue #94）。 */
  "csvParse.afterQuote": Record<string, never>;
  "csvParse.unclosedQuote": Record<string, never>;
  "csvParse.moreErrors": { rest: number };
  "csvParse.empty": { header: string };
  "csvParse.tooManyRows": { max: number; actual: number };
  "csvParse.missingUserNameColumn": { header: string };
  "csvParse.unknownColumn": { name: string };
  "csvParse.noUsers": Record<string, never>;
  "csvParse.columnCountMismatch": { header: number; actual: number };
  "csvParse.userNameEmpty": Record<string, never>;
  "csvParse.userNameInvalid": { userName: string };
  "csvParse.duplicateUserName": { name: string; firstLine: number };
  "request.bodyNotJson": { detail: string };
  "request.bodyNotObject": Record<string, never>;
  "request.fieldRequired": { field: string };
  "request.fieldNotBoolean": { field: string };
  "request.fieldEmptyList": { field: string };
  "request.fieldEmptyElement": { field: string };
  "request.fieldNotStringArray": { field: string };
  "request.fieldNotLineList": { field: string };
  "request.userNamesRequired": Record<string, never>;
  "matrix.roleNotLinked": { roleName: string };
  "matrix.userNotInPool": { userArn: string };
  "changeRequest.createdFromInvalid": { value: string };
  "pool.usersSpecifyOne": Record<string, never>;
  "pool.arnQueryRequiredDeleteUser": Record<string, never>;
  "pool.arnQueryRequiredUser": Record<string, never>;
  "role.arnQueryRequiredEdit": Record<string, never>;
  "role.colorInvalid": Record<string, never>;
  "role.updateFieldsRequired": Record<string, never>;
  "role.arnQueryRequiredDelete": Record<string, never>;
  "role.descriptionInvalidType": Record<string, never>;
  "role.displayNameInvalidType": Record<string, never>;
  "role.notRegistered": { roleArn: string };
  "role.alreadyRegistered": { roleArn: string };
  "pool.notFound": { poolId: string };
  "pool.userNotFound": { userArn: string };
  "changeRequest.notFound": { changeRequestId: string };
  "changeRequest.stateUpdateRefused": { changeRequestId: string };
  /** DynamoDB の操作の失敗。`detail` は SDK の例外の文（無ければ null）。 */
  "storage.operationFailed": { operation: string; detail: string | null };
  "storage.roleLockIncomplete": Record<string, never>;
  "storage.roleOrderPartial": Record<string, never>;
  "storage.roleRegisterPartial": Record<string, never>;
  "storage.roleDeletePartial": { roleName: string };
  "role.deleteBlocked": { roleName: string; status: "draft" | "failed" };
  "user.deleteBlocked": { userName: string; roleNames: string[]; changeRequestIds: string[] };
  "role.displayNameTaken": { displayName: string };
  "role.orderUnregistered": { roleArns: string[] };
  "changeRequest.noRoles": Record<string, never>;
  "changeRequest.applyingByOther": Record<string, never>;
  "changeRequest.discardRefused": { status: string };
  /** IAM クライアント（`iam-client.ts`）の失敗。`detail` は AWS の文（無ければ null）。 */
  "iam.deployAccountUnknown": { roleArn: string };
  "iam.assumeRoleFailed": { accountId: string; assumeRoleName: string; code: string; detail: string | null };
  "iam.emptyPolicy": Record<string, never>;
  "iam.awsMessage": { operation: string; detail: string | null };
  "iam.awsMessageForRole": { accountId: string; roleName: string; operation: string; detail: string | null };
  /** 信頼ポリシーの更新が、IAM に存在しないユーザのせいで拒否された（Issue #208）。`detail` は AWS の原文（隠さない。GI-6）。 */
  "iam.invalidPrincipalUser": { userArn: string; detail: string };
  /** ロール登録時のタグ検索と検証。`targetAccountId` は別アカウントのロールのときだけ入る。 */
  "role.notFoundInAws": { roleName: string; accountId: string };
  /** Rolust 自身の実行ロールの登録（Issue #194）。`DenySelfEscalation` の対象であることを登録時に返す。 */
  "role.selfRoleRejected": { roleName: string; accountId: string; managedTagKey: string };
  "role.tagMissing": {
    roleName: string;
    managedTagKey: string;
    managedTagValue: string;
    targetAccountId: string | null;
  };
  "role.tagValueMismatch": {
    roleName: string;
    managedTagKey: string;
    actual: string;
    managedTagValue: string;
    targetAccountId: string | null;
  };
  "role.tagReadDeniedCrossAccount": { roleName: string; accountId: string; errorCode: string; readerRoleName: string };
  "role.tagReadDeniedLocal": { roleName: string; errorCode: string; roleArn: string };
  /** 信頼ポリシーの取り込み（`role-import.ts`）の読み取りの失敗。 */
  "import.roleNotInAws": { roleName: string; accountId: string; errorCode: string };
  "import.readDenied": {
    roleName: string;
    accountId: string;
    errorCode: string;
    managedTagKey: string;
    managedTagValue: string;
  };
  "import.readThrottled": { roleName: string; accountId: string; errorCode: string };
  /** `cause` は内側の失敗（`IamOperationError.localized`）。AWS の文でも定型文でも、言語に合わせて描画される。 */
  "import.readFailed": { roleName: string; accountId: string; errorCode: string; cause: LocalizedMessage };
  /** 許可アカウント ID の一覧（SSM。Issue #139）。 */
  "allowedAccounts.empty": Record<string, never>;
  "allowedAccounts.invalidValues": { invalid: string[] };
  "allowedAccounts.notAllowed": { accountId: string; parameterName: string };
  "allowedAccounts.paramMissing": { name: string; code: string };
  "allowedAccounts.accessDenied": { name: string; code: string };
  "allowedAccounts.throttled": { name: string; code: string };
  "allowedAccounts.readFailed": { name: string; code: string; detail: string | null };
  /** 反映（`POST /api/apply`）の結果。ロック解放の失敗は、内側の失敗を `cause` に入れ子で持つ（無ければ null）。 */
  "apply.updated": { added: number; removed: number };
  "apply.alreadyApplied": Record<string, never>;
  "apply.updateFailed": Record<string, never>;
  "apply.crashed": Record<string, never>;
  "apply.invalidState": { status: string };
  "apply.notFound": Record<string, never>;
  "apply.inProgressByOther": Record<string, never>;
  "apply.lockNotHeld": Record<string, never>;
  "apply.lockReleaseFailed": { cause: LocalizedMessage | null };
  "apply.baselineFailed": { count: number };
  "driftRepair.adopted": { added: number; removed: number };
  "driftRepair.cellFailed": { userArn: string; detail: string | null };
  "diff.readFailed": Record<string, never>;
  "changeRequest.saveFailed": { detail: string | null };
  "changeRequest.lockReleaseFailed": { cause: LocalizedMessage | null };
}

export type ErrorMessageId = keyof ErrorMessageParams;

/** ID と、その ID の引数の組。`id` で絞ると `params` の型が決まる。 */
export type LocalizedMessage = {
  [I in ErrorMessageId]: { id: I; params: ErrorMessageParams[I] };
}[ErrorMessageId];

/** 入れ子の文（CSV の行のエラーなど）を描画する関数。 */
export type Render = (message: LocalizedMessage) => string;

export type ErrorCatalog = {
  [I in ErrorMessageId]: (params: ErrorMessageParams[I], render: Render) => string;
};

export function localized<I extends ErrorMessageId>(
  id: I,
  params: ErrorMessageParams[I],
): LocalizedMessage {
  return { id, params } as LocalizedMessage;
}

/** 運用者向けの文字列を `LocalizedMessage` に包む。言語に依らず `text` をそのまま出す。 */
export function plainMessage(text: string): LocalizedMessage {
  return localized("operator.plain", { text });
}
