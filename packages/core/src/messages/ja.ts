import { PERMISSION_LABELS } from "../permission.js";
import type { ErrorCatalog } from "./types.js";

/** 日本語のカタログ。`message` の文言は、移行前の文言と一字一句同じにする。 */
export const errorMessagesJa: ErrorCatalog = {
  "operator.plain": ({ text }) => text,
  "auth.forbidden": ({ need }) => `この操作には「${PERMISSION_LABELS[need]}」の権限が必要です`,
  "route.notFound": ({ method, path }) => `${method} ${path} に対応する API がありません`,
  "server.internal": () => "サーバ内部でエラーが発生しました",
  "common.rawDetail": ({ detail }) => detail,
  "arn.accountIdFormat": () => "AWS アカウント ID は 12 桁の数字です",
  "arn.nameFormat": ({ field, value }) => `${field} は英数字と +=,.@_- のみ、1〜64 文字です: ${JSON.stringify(value)}`,
  "arn.notUserArn": ({ arn }) => `IAM ユーザの ARN ではありません: ${arn}`,
  "arn.notRoleArn": ({ arn }) => `IAM ロールの ARN ではありません: ${arn}`,
  "merge.frozenConflict": ({ arn }) => `凍結入力の追加と削除に同じ principal が含まれています: ${arn}`,
  "merge.sidConflict": ({ sid }) =>
    `信頼ポリシーに、Rolust が使う Sid「${sid}」の Statement が、Rolust が書ける形ではない状態で既にあります。` +
    "IAM は同じ Sid を 2 つ許さないため、反映できません。" +
    "その Statement の Sid を別の名前に変えるか、条件を外して Allow の sts:AssumeRole にしてから、もう一度反映してください。",
  "attribute.nameRequired": () => "列名を入力してください",
  "attribute.nameControlChar": () => "列名に制御文字（改行・タブなど）は使えません",
  "attribute.nameNotVisible": () => "列名に見える文字がありません",
  "attribute.nameTooLong": ({ max }) => `列名は ${max} 文字以内で入力してください`,
  "attribute.valueControlChar": () => "値に制御文字（改行・タブなど）は使えません",
  "attribute.valueNotVisible": () => "値に見える文字がありません",
  "attribute.valueTooLong": ({ max }) => `値は ${max} 文字以内で入力してください`,
  "attribute.columnsNotArray": () => "columns は配列で指定してください",
  "attribute.columnNotObject": () => "columns の要素はオブジェクトで指定してください",
  "attribute.columnNameNotString": () => "列名は文字列で指定してください",
  "attribute.columnIdNotString": () => "columnId は文字列で指定してください",
  "attribute.tooManyColumns": ({ max }) => `属性列は ${max} 列までです`,
  "attribute.duplicateColumnName": ({ name }) => `列名「${name}」が重複しています`,
  "attribute.unknownColumn": ({ columnId }) => `存在しない属性列です: ${columnId}`,
  "attribute.duplicateColumnId": ({ columnId }) => `属性列の ID が重複しています: ${columnId}`,
  "attribute.attributesNotObject": () => "attributes はオブジェクトで指定してください",
  "attribute.valueNotString": () => "値は文字列で指定してください",
  "role.descriptionControlChar": () => "説明に制御文字(改行・タブなど)は使えません",
  "role.descriptionNotVisible": () => "説明に見える文字がありません",
  "role.descriptionTooLong": ({ max }) => `説明は ${max} 文字以内で入力してください`,
  "role.displayNameControlChar": () => "表示名に制御文字(改行・タブなど)は使えません",
  "role.displayNameNotVisible": () => "表示名に見える文字がありません",
  "role.displayNameTooLong": ({ max }) => `表示名は ${max} 文字以内で入力してください`,
  "csv.usersNotArray": () => "users は配列で指定してください",
  "csv.usersEmpty": () => "登録するユーザを 1 件以上指定してください",
  "csv.tooManyUsers": ({ max }) => `1 回に登録できるのは ${max} 件までです`,
  "csv.rowError": ({ position, cause }, render) => `${position} 件目: ${render(cause)}`,
  "csv.userNotObject": () => "ユーザはオブジェクトで指定してください",
  "csv.userNameNotString": () => "userName は文字列で指定してください",
  "csv.userNameInvalidChars": ({ userName }) => `ユーザ名に使えない文字が含まれています: ${JSON.stringify(userName)}`,
  "csv.duplicateUserName": ({ name }) => `ユーザ名「${name}」が重複しています`,
  "csv.unknownAttributeColumn": ({ columnName }) => `属性列「${columnName}」はこのプールにありません`,
  "csv.attributeValueNotString": ({ columnName }) => `${columnName}: 値は文字列で指定してください`,
  "csv.attributeValueInvalid": ({ columnName, cause }, render) => `${columnName}: ${render(cause)}`,
  "policy.empty": () => "信頼ポリシー文書が空です",
  "policy.notJson": () => "信頼ポリシー文書を JSON として解釈できません",
  "policy.urlDecodeFailed": () => "信頼ポリシー文書を URL デコードできません",
  "policy.notObject": () => "信頼ポリシー文書がオブジェクトではありません",
  "policy.statementNotObject": ({ index }) => `Statement[${index}] がオブジェクトではありません`,
  "policy.badEffect": ({ index }) => `Statement[${index}].Effect が Allow / Deny のいずれでもありません`,
  "changeRequest.invalidTransition": ({ from, to }) => `ChangeRequest の状態を ${from} から ${to} へ遷移できません`,
  "csvParse.afterQuote": () => "引用符で囲んだ値の後に、カンマか改行以外の文字があります",
  "csvParse.unclosedQuote": () => "引用符が閉じていません",
  "csvParse.moreErrors": ({ rest }) => `ほか ${rest} 件のエラーがあります`,
  "csvParse.empty": ({ header }) => `CSV が空です。1 行目にヘッダ（${header},…）が必要です`,
  "csvParse.tooManyRows": ({ max, actual }) =>
    `1 回に登録できるのは ${max} 行までです（${actual} 行あります）。分けて登録してください`,
  "csvParse.missingUserNameColumn": ({ header }) => `ヘッダに「${header}」列がありません`,
  "csvParse.unknownColumn": ({ name }) =>
    `列名「${name}」はこのプールの属性列にありません（属性列は「属性列を編集」で先に作ります）`,
  "csvParse.noUsers": () => "登録するユーザの行がありません",
  "csvParse.columnCountMismatch": ({ header, actual }) =>
    `列の数が合いません（ヘッダ ${header} 列、この行 ${actual} 列）`,
  "csvParse.userNameEmpty": () => "ユーザ名が空です",
  "csvParse.userNameInvalid": ({ userName }) =>
    `ユーザ名に使えない文字が含まれています（英数字と +=,.@_- のみ、1〜64 文字）: ${userName}`,
  "csvParse.duplicateUserName": ({ name, firstLine }) => `ユーザ名「${name}」が ${firstLine} 行目と重複しています`,
  "request.bodyNotJson": ({ detail }) => `リクエスト本文が JSON として解釈できません: ${detail}`,
  "request.bodyNotObject": () => "リクエスト本文が JSON オブジェクトではありません",
  "request.fieldRequired": ({ field }) => `${field} は必須です`,
  "request.fieldNotBoolean": ({ field }) => `${field} は true / false で指定してください`,
  "request.fieldEmptyList": ({ field }) => `${field} には 1 件以上を指定してください`,
  "request.fieldEmptyElement": ({ field }) => `${field} に空の要素が含まれています`,
  "request.fieldNotStringArray": ({ field }) => `${field} は文字列の配列で指定してください`,
  "request.fieldNotLineList": ({ field }) => `${field} は改行区切りの文字列または文字列配列で指定してください`,
  "request.userNamesRequired": () => "IAM ユーザ名を 1 件以上入力してください",
  "matrix.roleNotLinked": ({ roleName }) =>
    `IAM ロール ${roleName} はユーザプールに紐づいていません。` +
    "画面 2 で IAM ロールを削除して登録し直してください（登録が紐づけと信頼ポリシーの取り込みを行います）。",
  "matrix.userNotInPool": ({ userArn }) =>
    `IAM ユーザ ${userArn} はユーザプールに登録されていません。` +
    "画面 1 で登録してから、割り当てを変更してください（登録のときに、許可されたアカウントかを確かめます）。",
  "changeRequest.createdFromInvalid": ({ value }) => `createdFrom は ISO 8601 の日時で指定してください: ${value}`,
  "pool.usersSpecifyOne": () => "userNames と users のどちらか一方を指定してください",
  "pool.arnQueryRequiredDeleteUser": () => "削除対象の IAM ユーザ ARN を arn クエリで指定してください",
  "pool.arnQueryRequiredUser": () => "対象の IAM ユーザ ARN を arn クエリで指定してください",
  "role.arnQueryRequiredEdit": () => "編集対象の IAM ロール ARN を arn クエリで指定してください",
  "role.colorInvalid": () => "color はパレットの ID または null で指定してください",
  "role.updateFieldsRequired": () => "displayName・description・color のいずれかを指定してください",
  "role.arnQueryRequiredDelete": () => "削除対象の IAM ロール ARN を arn クエリで指定してください",
  "role.descriptionInvalidType": () => "description は文字列または null で指定してください",
  "role.displayNameInvalidType": () => "displayName は文字列または null で指定してください",
  "role.notRegistered": ({ roleArn }) => `IAM ロールが登録されていません: ${roleArn}`,
  "role.alreadyRegistered": ({ roleArn }) => `この IAM ロールは既に登録されています: ${roleArn}`,
  "pool.notFound": ({ poolId }) => `ユーザプールが見つかりません: ${poolId}`,
  "pool.userNotFound": ({ userArn }) => `IAM ユーザが見つかりません: ${userArn}`,
  "changeRequest.notFound": ({ changeRequestId }) => `申請が見つかりません: ${changeRequestId}`,
  "changeRequest.stateUpdateRefused": ({ changeRequestId }) =>
    `申請の状態を更新できませんでした（別の管理者の操作が先に確定したか、反映の権利が切れました）: ${changeRequestId}`,
  "storage.operationFailed": ({ operation, detail }) =>
    `DynamoDB の ${operation} に失敗しました: ${detail ?? "原因不明"}`,
  "storage.roleLockIncomplete": () =>
    "IAM ロールの未反映の申請（ロック）を読み切れませんでした。時間をおいて再試行してください。",
  "storage.roleOrderPartial": () =>
    "ロールの並び順を一部しか保存できていない可能性があります。最新の状態を読み込み直し、必要ならもう一度保存してください。",
  "storage.roleRegisterPartial": () =>
    "IAM ロールの登録が途中で失敗しました。ロールは登録されていません。もう一度登録すると、続きから直ります。",
  "storage.roleDeletePartial": ({ roleName }) =>
    `${roleName} の削除が途中で失敗しました。ロールの登録は残っています。もう一度削除すると、続きから片付きます。`,
  "role.deleteBlocked": ({ roleName, status }) =>
    `${roleName} を削除できません。未反映の申請（${status === "failed" ? "失敗" : "下書き"}）があります。` +
    "申請履歴で反映するか破棄してください。",
  "user.deleteBlocked": ({ userName, roleNames, changeRequestIds }) => {
    const reasons: string[] = [];
    if (roleNames.length > 0) {
      reasons.push(
        `信頼ポリシーに反映済みの割り当てがあります（${roleNames.join("、")}）。` +
          "削除しても信頼ポリシーには残り、マトリクスから見えなくなります。" +
          "マトリクスでチェックを外し、申請して反映してから削除してください。",
      );
    }
    if (changeRequestIds.length > 0) {
      reasons.push(
        `このユーザを含む未反映の申請があります（${changeRequestIds.join("、")}）。` +
          "反映するか、申請履歴で破棄してから削除してください。",
      );
    }
    return `${userName} を削除できません。${reasons.join("")}`;
  },
  "role.displayNameTaken": ({ displayName }) => `表示名「${displayName}」は、ほかのロールで使われています`,
  "role.orderUnregistered": ({ roleArns }) => `登録されていない IAM ロールは並べられません: ${roleArns.join(", ")}`,
  "changeRequest.noRoles": () => "申請対象のロールが 1 件も指定されていません",
  "changeRequest.applyingByOther": () => "この申請は別の管理者が反映中です。しばらくしてから、もう一度操作してください。",
  "changeRequest.discardRefused": ({ status }) =>
    `状態「${status}」の申請は破棄できません（破棄できるのは下書きまたは失敗のみ）`,
  "iam.deployAccountUnknown": ({ roleArn }) =>
    "デプロイ先の AWS アカウント ID を判定できないため、IAM を呼ばずに止めました。" +
    `ロール ${roleArn} が Rolust と同じアカウントのものか別アカウントのものかを判定できないと、` +
    "どの資格情報で IAM を呼ぶかを決められません" +
    "（別アカウントのロールをデプロイ先の資格情報で呼ぶと、同名のロールに作用しうるためです）。" +
    "API Gateway を経由して呼び出してください（requestContext.accountId が判定に要ります）。",
  "iam.assumeRoleFailed": ({ accountId, assumeRoleName, code, detail }) =>
    `アカウント ${accountId} のロール ${assumeRoleName} を引き受けられませんでした（${code}）。` +
    "ターゲットアカウントにこのロールが無いか、その信頼ポリシーが Rolust の Lambda の実行ロールを許可していません。" +
    "ロールや信頼ポリシーを直した直後は、IAM への反映に数分かかることがあります（実測で約 7 分。Rolust は失敗を覚えないので、待ってからやり直せば、再起動なしで通ります）。" +
    "docs/guide/cross-account.md の手順で作成してください。" +
    `（AWS のメッセージ: ${detail ?? "詳細なし"}）`,
  "iam.emptyPolicy": () => "IAM が信頼ポリシー文書を返しませんでした",
  "iam.awsMessage": ({ operation, detail }) => detail ?? `${operation} に失敗しました`,
  "iam.awsMessageForRole": ({ accountId, roleName, operation, detail }) =>
    `アカウント ${accountId} のロール「${roleName}」: ${detail ?? `${operation} に失敗しました`}`,
  "iam.invalidPrincipalUser": ({ userArn, detail }) =>
    `IAM ユーザ ${userArn} が IAM に存在しないため、信頼ポリシーを更新できませんでした（AWS 側は変わっていません）。` +
    "IAM にこのユーザを作成してから、この申請を再反映してください。" +
    "作成の直後は、IAM が受け付けるまで 10 秒ほどかかることがあります（その間は同じ失敗になります）。" +
    "このユーザを使わないなら、申請履歴でこの申請を破棄し、Rolust のユーザプールからこのユーザを削除してから、申請を作り直します。" +
    `（AWS のメッセージ: ${detail}）`,
  "role.notFoundInAws": ({ roleName, accountId }) =>
    `IAM ロール「${roleName}」はアカウント ${accountId} に存在しません。` +
    "Rolust は登録時にロールのタグを読んで管理対象かどうかを判定するため、" +
    "実在しないロールは登録できません。" +
    "ロール名とアカウント ID を確認するか、対象ロールを先に作成してください。",
  "role.selfRoleRejected": ({ roleName, accountId, managedTagKey }) =>
    `IAM ロール「${roleName}」（アカウント ${accountId}）は Rolust 自身の実行ロールのため、管理対象として登録できません。` +
    "Rolust が自分の信頼ポリシーを書き換えられると、権限を自分で広げられてしまうため、" +
    "反映用の IAM ポリシー（DenySelfEscalation）がこのロールへの iam:UpdateAssumeRolePolicy を明示的に拒否します。" +
    "登録しても反映の時点で必ず失敗します。" +
    `管理対象のタグが付いているなら、次のコマンドで外してください: ` +
    `aws iam untag-role --role-name ${roleName} --tag-keys ${managedTagKey}`,
  "role.tagMissing": ({ roleName, managedTagKey, managedTagValue, targetAccountId }) =>
    `IAM ロール「${roleName}」に管理対象のタグ「${managedTagKey}」が付いていません。` +
    `Rolust の反映用 Lambda は ${managedTagKey} が「${managedTagValue}」であるロールに対してのみ ` +
    "iam:GetRole / iam:UpdateAssumeRolePolicy を持つため、このまま登録しても反映時に AccessDenied になります。" +
    `次のコマンドでタグを付けてから登録し直してください${whereToRun(targetAccountId)}: ` +
    `aws iam tag-role --role-name ${roleName} --tags Key=${managedTagKey},Value=${managedTagValue}`,
  "role.tagValueMismatch": ({ roleName, managedTagKey, actual, managedTagValue, targetAccountId }) =>
    `IAM ロール「${roleName}」のタグ「${managedTagKey}」の値が「${actual}」であり、` +
    `管理対象の値「${managedTagValue}」と一致しません。` +
    "IAM ポリシーは StringEquals で完全一致を要求するため、このまま登録しても反映時に AccessDenied になります。" +
    `次のコマンドで値を書き換えてください${whereToRun(targetAccountId)}: ` +
    `aws iam tag-role --role-name ${roleName} --tags Key=${managedTagKey},Value=${managedTagValue}`,
  "role.tagReadDeniedCrossAccount": ({ roleName, accountId, errorCode, readerRoleName }) =>
    `IAM ロール「${roleName}」（アカウント ${accountId}）のタグを読み取れませんでした（${errorCode}）。` +
    "これは入力の誤りではなく、ターゲットアカウント側の権限不足です。" +
    `ターゲットアカウントの ${readerRoleName} に、iam:ListRoleTags の許可があるか確認してください` +
    "（docs/guide/cross-account.md）。",
  "role.tagReadDeniedLocal": ({ roleName, errorCode, roleArn }) =>
    `IAM ロール「${roleName}」のタグを読み取れませんでした（${errorCode}）。` +
    "これは入力の誤りではなくデプロイ側の権限不足です。" +
    `CRUD Lambda の実行ロールに ${roleArn} に対する iam:ListRoleTags が必要です` +
    "（infra/lambda.tf の crud_iam_read_tags）。terraform apply が最新か確認してください。",
  "import.roleNotInAws": ({ roleName, accountId, errorCode }) =>
    `IAM ロール「${roleName}」（アカウント ${accountId}）は AWS に存在しません（${errorCode}）。` +
    "ロールが削除された可能性があります。IAM ロール管理で登録を確かめてください。",
  "import.readDenied": ({ roleName, accountId, errorCode, managedTagKey, managedTagValue }) =>
    `${importReadHead(roleName, accountId, errorCode)}。ロールに管理対象タグ（${managedTagKey}=${managedTagValue}）が付いていない可能性と、` +
    "CRUD Lambda の実行ロールに iam:GetRole が付いていない可能性があります" +
    "（infra/lambda.tf の crud_iam_read_trust。terraform apply が最新か確認してください）。" +
    "別アカウントのロールなら、ターゲットアカウントの Reader ロールに iam:GetRole が付いていない可能性もあります" +
    "（docs/guide/cross-account.md）。",
  "import.readThrottled": ({ roleName, accountId, errorCode }) =>
    `${importReadHead(roleName, accountId, errorCode)}。しばらくしてから、もう一度保存してください。`,
  "import.readFailed": ({ roleName, accountId, errorCode, cause }, render) =>
    `${importReadHead(roleName, accountId, errorCode)}: ${render(cause)}`,
  "allowedAccounts.empty": () =>
    "許可するアカウント ID の一覧が空、または空の要素を含んでいます。" +
    "12 桁のアカウント ID をカンマ区切りで置いてください（例: 111122223333,444455556666）。",
  "allowedAccounts.invalidValues": ({ invalid }) =>
    `許可するアカウント ID の一覧に、12 桁の数字でない値があります: ${invalid.join(", ")}。` +
    "12 桁のアカウント ID をカンマ区切りで置いてください。",
  "allowedAccounts.notAllowed": ({ accountId, parameterName }) =>
    `AWS アカウント ${accountId} は、登録を許可されていません。` +
    `許可するアカウント ID の一覧（SSM パラメータ ${parameterName}）に追加してから、もう一度登録してください。`,
  "allowedAccounts.paramMissing": ({ name, code }) =>
    `${allowedAccountsReadHead(name, code)}。パラメータがありません。terraform apply が最新か確認してください（infra/lambda.tf の allowed_account_ids）。`,
  "allowedAccounts.accessDenied": ({ name, code }) =>
    `${allowedAccountsReadHead(name, code)}。CRUD Lambda の実行ロールに ssm:GetParameter が付いていない可能性があります` +
    "（infra/lambda.tf の crud_ssm_allowed_accounts。terraform apply が最新か確認してください）。",
  "allowedAccounts.throttled": ({ name, code }) =>
    `${allowedAccountsReadHead(name, code)}。しばらくしてから、もう一度試してください。`,
  "allowedAccounts.readFailed": ({ name, code, detail }) =>
    `${allowedAccountsReadHead(name, code)}: ${detail ?? "原因不明"}`,
  "apply.updated": ({ added, removed }) => `信頼ポリシーを更新しました（追加 ${added} / 削除 ${removed}）`,
  "apply.alreadyApplied": () => "信頼ポリシーは既に申請どおりの状態でした",
  "apply.updateFailed": () => "信頼ポリシーの更新に失敗しました",
  "apply.crashed": () => "反映処理が異常終了しました",
  "apply.invalidState": ({ status }) => `状態「${status}」の申請は反映できません`,
  "apply.notFound": () => "申請が見つかりません",
  "apply.inProgressByOther": () => "別の管理者がこの申請を反映中です。しばらくしてから申請履歴で状態を確かめてください。",
  "apply.lockNotHeld": () => "この申請はロールロックを保持していませんでした（別の申請が保持しています）",
  "apply.lockReleaseFailed": ({ cause }, render) =>
    `反映は成功しましたが、ロールロックを解放できませんでした（${cause ? render(cause) : "ロールロックを解放できませんでした"}）。` +
    "解放されるまでこのロールの新しい申請は作成できません。",
  "apply.baselineFailed": ({ count }) =>
    `信頼ポリシーは更新されましたが、マトリクスの反映済み状態を ${count} 件更新できませんでした`,
  "driftRepair.adopted": ({ added, removed }) =>
    `記録を信頼ポリシーの現状に合わせました（取り込み ${added} / 外し ${removed}）。AWS は書き換えていません`,
  "driftRepair.cellFailed": ({ userArn, detail }) => `${userArn} の記録を更新できませんでした${detail ? `: ${detail}` : ""}`,
  "diff.readFailed": () => "現在の信頼ポリシーを読み取れませんでした",
  "changeRequest.saveFailed": ({ detail }) => detail ?? "申請を保存できませんでした",
  "changeRequest.lockReleaseFailed": ({ cause }, render) =>
    `ロールロックを解放できませんでした（${cause ? render(cause) : "ロールロックを解放できませんでした"}）。` +
    "解放されるまでこのロールの新しい申請は作成できません。",
};

/** 別アカウントのロールのタグは、そのアカウントの資格情報で付ける（同名のロールが別アカウントにあると、そちらにタグが付くため）。 */
function whereToRun(targetAccountId: string | null): string {
  return targetAccountId === null
    ? ""
    : `（ターゲットアカウント ${targetAccountId} の資格情報で実行してください。別のアカウントの資格情報で実行すると、そのアカウントに同名のロールがあれば、そのロールにタグが付きます）`;
}

function importReadHead(roleName: string, accountId: string, errorCode: string): string {
  return `IAM ロール「${roleName}」（アカウント ${accountId}）の信頼ポリシーを読み取れませんでした（${errorCode}）`;
}

function allowedAccountsReadHead(name: string, code: string): string {
  return `許可するアカウント ID の一覧（SSM パラメータ ${name}）を読み取れませんでした（${code}）`;
}
