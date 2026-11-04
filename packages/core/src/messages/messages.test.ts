import { describe, expect, it } from "vitest";

import { errorMessagesEn, errorMessagesJa } from "./index.js";
import {
  localized,
  plainMessage,
  renderMessage,
  tryRenderMessage,
  type ErrorMessageId,
  type ErrorMessageParams,
  type LocalizedMessage,
} from "./index.js";

/**
 * すべての ID に、描画できる引数の例を 1 つずつ持たせる。型が `ErrorMessageParams` の全 ID を要求するので、
 * ID を足して例を足し忘れると `tsc` が落ちる。例の文字列は ASCII にする（英語の描画に日本語が残る事故を見つけるため）。
 */
export const SAMPLE_PARAMS: { [I in ErrorMessageId]: ErrorMessageParams[I] } = {
  "operator.plain": { text: "sample text" },
  "auth.forbidden": { need: "apply" },
  "route.notFound": { method: "GET", path: "/x" },
  "server.internal": {},
  "common.rawDetail": { detail: "sample detail" },
  "arn.accountIdFormat": {},
  "arn.nameFormat": { field: "userName", value: "bad name" },
  "arn.notUserArn": { arn: "arn:aws:iam::123456789012:role/x" },
  "arn.notRoleArn": { arn: "arn:aws:iam::123456789012:user/x" },
  "merge.frozenConflict": { arn: "arn:aws:iam::123456789012:user/x" },
  "merge.sidConflict": { sid: "RolustManagedPrincipals" },
  "attribute.nameRequired": {},
  "attribute.nameControlChar": {},
  "attribute.nameNotVisible": {},
  "attribute.nameTooLong": { max: 32 },
  "attribute.valueControlChar": {},
  "attribute.valueNotVisible": {},
  "attribute.valueTooLong": { max: 128 },
  "attribute.columnsNotArray": {},
  "attribute.columnNotObject": {},
  "attribute.columnNameNotString": {},
  "attribute.columnIdNotString": {},
  "attribute.tooManyColumns": { max: 10 },
  "attribute.duplicateColumnName": { name: "dept" },
  "attribute.unknownColumn": { columnId: "c-x" },
  "attribute.duplicateColumnId": { columnId: "c-x" },
  "attribute.attributesNotObject": {},
  "attribute.valueNotString": {},
  "role.descriptionControlChar": {},
  "role.descriptionNotVisible": {},
  "role.descriptionTooLong": { max: 256 },
  "role.displayNameControlChar": {},
  "role.displayNameNotVisible": {},
  "role.displayNameTooLong": { max: 32 },
  "csv.usersNotArray": {},
  "csv.usersEmpty": {},
  "csv.tooManyUsers": { max: 500 },
  "csv.rowError": { position: 3, cause: localized("operator.plain", { text: "inner" }) },
  "csv.userNotObject": {},
  "csv.userNameNotString": {},
  "csv.userNameInvalidChars": { userName: "bad name" },
  "csv.duplicateUserName": { name: "alice" },
  "csv.unknownAttributeColumn": { columnName: "dept" },
  "csv.attributeValueNotString": { columnName: "dept" },
  "csv.attributeValueInvalid": { columnName: "dept", cause: localized("operator.plain", { text: "inner" }) },
  "policy.empty": {},
  "policy.notJson": {},
  "policy.urlDecodeFailed": {},
  "policy.notObject": {},
  "policy.statementNotObject": { index: 0 },
  "policy.badEffect": { index: 0 },
  "changeRequest.invalidTransition": { from: "applied", to: "draft" },
  "csvParse.afterQuote": {},
  "csvParse.unclosedQuote": {},
  "csvParse.moreErrors": { rest: 10 },
  "csvParse.empty": { header: "userName" },
  "csvParse.tooManyRows": { max: 500, actual: 501 },
  "csvParse.missingUserNameColumn": { header: "userName" },
  "csvParse.unknownColumn": { name: "dept" },
  "csvParse.noUsers": {},
  "csvParse.columnCountMismatch": { header: 2, actual: 3 },
  "csvParse.userNameEmpty": {},
  "csvParse.userNameInvalid": { userName: "bad name" },
  "csvParse.duplicateUserName": { name: "alice", firstLine: 2 },
  "request.bodyNotJson": { detail: "Unexpected token" },
  "request.bodyNotObject": {},
  "request.fieldRequired": { field: "name" },
  "request.fieldNotBoolean": { field: "checked" },
  "request.fieldEmptyList": { field: "ids" },
  "request.fieldEmptyElement": { field: "ids" },
  "request.fieldNotStringArray": { field: "ids" },
  "request.fieldNotLineList": { field: "userNames" },
  "request.userNamesRequired": {},
  "matrix.roleNotLinked": { roleName: "DeployProd" },
  "matrix.userNotInPool": { userArn: "arn:aws:iam::123456789012:user/x" },
  "changeRequest.createdFromInvalid": { value: "yesterday" },
  "pool.usersSpecifyOne": {},
  "pool.arnQueryRequiredDeleteUser": {},
  "pool.arnQueryRequiredUser": {},
  "role.arnQueryRequiredEdit": {},
  "role.colorInvalid": {},
  "role.updateFieldsRequired": {},
  "role.arnQueryRequiredDelete": {},
  "role.descriptionInvalidType": {},
  "role.displayNameInvalidType": {},
  "role.notRegistered": { roleArn: "arn:aws:iam::111122223333:role/sample" },
  "role.alreadyRegistered": { roleArn: "arn:aws:iam::111122223333:role/sample" },
  "pool.notFound": { poolId: "sample-pool" },
  "pool.userNotFound": { userArn: "arn:aws:iam::111122223333:user/sample" },
  "changeRequest.notFound": { changeRequestId: "cr-sample" },
  "changeRequest.stateUpdateRefused": { changeRequestId: "cr-sample" },
  "storage.operationFailed": { operation: "GetItem(Sample)", detail: "sample detail" },
  "storage.roleLockIncomplete": {},
  "storage.roleOrderPartial": {},
  "storage.roleRegisterPartial": {},
  "storage.roleDeletePartial": { roleName: "SampleRole" },
  "role.deleteBlocked": { roleName: "SampleRole", status: "draft" },
  "user.deleteBlocked": { userName: "sample.user", roleNames: ["RoleA", "RoleB"], changeRequestIds: ["cr-1", "cr-2"] },
  "role.displayNameTaken": { displayName: "Sample name" },
  "role.orderUnregistered": { roleArns: ["arn:aws:iam::111122223333:role/a", "arn:aws:iam::111122223333:role/b"] },
  "changeRequest.noRoles": {},
  "changeRequest.applyingByOther": {},
  "changeRequest.discardRefused": { status: "applied" },
  "iam.deployAccountUnknown": { roleArn: "arn:aws:iam::111122223333:role/sample" },
  "iam.assumeRoleFailed": { accountId: "111122223333", assumeRoleName: "SampleReader", code: "AccessDenied", detail: "sample detail" },
  "iam.emptyPolicy": {},
  "iam.awsMessage": { operation: "iam:GetRole", detail: "sample detail" },
  "iam.awsMessageForRole": { accountId: "111122223333", roleName: "SampleRole", operation: "iam:GetRole", detail: "sample detail" },
  "iam.invalidPrincipalUser": { userArn: "arn:aws:iam::111122223333:user/sample", detail: "sample detail" },
  "role.notFoundInAws": { roleName: "SampleRole", accountId: "111122223333" },
  "role.selfRoleRejected": { roleName: "rolust-apply-exec", accountId: "111122223333", managedTagKey: "rolust:managed" },
  "role.tagMissing": { roleName: "SampleRole", managedTagKey: "rolust:managed", managedTagValue: "true", targetAccountId: "111122223333" },
  "role.tagValueMismatch": { roleName: "SampleRole", managedTagKey: "rolust:managed", actual: "false", managedTagValue: "true", targetAccountId: null },
  "role.tagReadDeniedCrossAccount": { roleName: "SampleRole", accountId: "111122223333", errorCode: "AccessDenied", readerRoleName: "SampleReader" },
  "role.tagReadDeniedLocal": { roleName: "SampleRole", errorCode: "AccessDenied", roleArn: "arn:aws:iam::111122223333:role/SampleRole" },
  "import.roleNotInAws": { roleName: "SampleRole", accountId: "111122223333", errorCode: "NoSuchEntity" },
  "import.readDenied": { roleName: "SampleRole", accountId: "111122223333", errorCode: "AccessDenied", managedTagKey: "rolust:managed", managedTagValue: "true" },
  "import.readThrottled": { roleName: "SampleRole", accountId: "111122223333", errorCode: "Throttling" },
  "import.readFailed": { roleName: "SampleRole", accountId: "111122223333", errorCode: "ServiceFailure", cause: localized("operator.plain", { text: "inner" }) },
  "allowedAccounts.empty": {},
  "allowedAccounts.invalidValues": { invalid: ["1234", "abc"] },
  "allowedAccounts.notAllowed": { accountId: "999900001111", parameterName: "/sample/allowed" },
  "allowedAccounts.paramMissing": { name: "/sample/allowed", code: "ParameterNotFound" },
  "allowedAccounts.accessDenied": { name: "/sample/allowed", code: "AccessDeniedException" },
  "allowedAccounts.throttled": { name: "/sample/allowed", code: "ThrottlingException" },
  "allowedAccounts.readFailed": { name: "/sample/allowed", code: "InternalServerError", detail: "sample detail" },
  "apply.updated": { added: 2, removed: 1 },
  "apply.alreadyApplied": {},
  "apply.updateFailed": {},
  "apply.crashed": {},
  "apply.invalidState": { status: "applied" },
  "apply.notFound": {},
  "apply.inProgressByOther": {},
  "apply.lockNotHeld": {},
  "apply.lockReleaseFailed": { cause: localized("common.rawDetail", { detail: "sample detail" }) },
  "apply.baselineFailed": { count: 3 },
  "driftRepair.adopted": { added: 2, removed: 1 },
  "driftRepair.cellFailed": { userArn: "arn:aws:iam::111122223333:user/a", detail: "boom" },
  "diff.readFailed": {},
  "changeRequest.saveFailed": { detail: "sample detail" },
  "changeRequest.lockReleaseFailed": { cause: localized("common.rawDetail", { detail: "sample detail" }) },
};

const JAPANESE = /[぀-ヿ一-鿿]/;

describe("カタログの検査", () => {
  const ids = Object.keys(SAMPLE_PARAMS) as ErrorMessageId[];

  it("ja・en の両方が、全 ID を持つ", () => {
    for (const id of ids) {
      expect(Object.hasOwn(errorMessagesJa, id), `ja に ${id} が無い`).toBe(true);
      expect(Object.hasOwn(errorMessagesEn, id), `en に ${id} が無い`).toBe(true);
    }
    expect(Object.keys(errorMessagesJa).sort()).toEqual([...ids].sort());
    expect(Object.keys(errorMessagesEn).sort()).toEqual([...ids].sort());
  });

  it.each(ids)("%s は、ja・en とも空でない文に描画でき、en に日本語が残らない", (id) => {
    const message = localized(id, SAMPLE_PARAMS[id]);
    const ja = renderMessage("ja", message);
    const en = renderMessage("en", message);
    expect(ja.length).toBeGreaterThan(0);
    expect(en.length).toBeGreaterThan(0);
    expect(en, `en の ${id} に日本語が残っている`).not.toMatch(JAPANESE);
  });
});

describe("renderMessage / tryRenderMessage", () => {
  it("operator.plain は、言語に依らず text をそのまま出す", () => {
    const message = plainMessage("起動時の設定が不正です");
    expect(renderMessage("ja", message)).toBe("起動時の設定が不正です");
    expect(renderMessage("en", message)).toBe("起動時の設定が不正です");
  });

  it("未知の ID は、tryRenderMessage が null、renderMessage が例外（新しい API の ID を古い SPA が受けた場合）", () => {
    const unknown = { id: "does.not.exist", params: {} } as unknown as LocalizedMessage;
    expect(tryRenderMessage("ja", unknown)).toBeNull();
    expect(tryRenderMessage("en", unknown)).toBeNull();
    expect(() => renderMessage("en", unknown)).toThrow();
  });

  it("継承したプロパティ名の ID（toString など）を未知として扱う", () => {
    const hostile = { id: "toString", params: {} } as unknown as LocalizedMessage;
    expect(tryRenderMessage("ja", hostile)).toBeNull();
  });

  it("params が壊れていても、tryRenderMessage は例外を投げず null を返す", () => {
    const broken = { id: "operator.plain" } as unknown as LocalizedMessage;
    expect(tryRenderMessage("ja", broken)).toBeNull();
  });

  it("message が壊れていても（null・undefined・id が文字列でない）、tryRenderMessage は例外を投げず null を返す", () => {
    for (const bad of [null, undefined, {}, { id: 123 }, "text", 42]) {
      expect(tryRenderMessage("ja", bad as unknown as LocalizedMessage)).toBeNull();
      expect(tryRenderMessage("en", bad as unknown as LocalizedMessage)).toBeNull();
    }
    expect(() => renderMessage("ja", null as unknown as LocalizedMessage)).toThrow();
  });

  it("描画結果が文字列でないとき（params.text が数値）、tryRenderMessage は null を返す", () => {
    const bad = { id: "operator.plain", params: { text: 123 } } as unknown as LocalizedMessage;
    expect(tryRenderMessage("ja", bad)).toBeNull();
    expect(tryRenderMessage("en", bad)).toBeNull();
    expect(() => renderMessage("ja", bad)).toThrow();
  });

  it("入れ子の文の描画が失敗したら、空文字で埋めず、外側の文ごと失敗する（tryRenderMessage は null、renderMessage は例外）", () => {
    const unknownInner = { id: "does.not.exist", params: {} } as unknown as LocalizedMessage;
    const outer = localized("csv.rowError", { position: 1, cause: unknownInner });
    expect(tryRenderMessage("ja", outer)).toBeNull();
    expect(tryRenderMessage("en", outer)).toBeNull();
    expect(() => renderMessage("ja", outer)).toThrow();
    expect(() => renderMessage("en", outer)).toThrow();
  });
});

describe("storage.operationFailed（Issue #94）", () => {
  it("detail が null のとき、ja は「原因不明」、en は unknown cause になる", () => {
    const message = localized("storage.operationFailed", { operation: "PutItem(IamRole)", detail: null });
    expect(renderMessage("ja", message)).toBe("DynamoDB の PutItem(IamRole) に失敗しました: 原因不明");
    expect(renderMessage("en", message)).toBe("DynamoDB PutItem(IamRole) failed: unknown cause");
  });

  it("detail があるとき、そのまま出す", () => {
    const message = localized("storage.operationFailed", { operation: "PutItem(IamRole)", detail: "Rate exceeded" });
    expect(renderMessage("ja", message)).toBe("DynamoDB の PutItem(IamRole) に失敗しました: Rate exceeded");
    expect(renderMessage("en", message)).toBe("DynamoDB PutItem(IamRole) failed: Rate exceeded");
  });
});

describe("role.deleteBlocked（Issue #94）", () => {
  it("ja は状態を日本語（下書き・失敗）で出す", () => {
    expect(renderMessage("ja", localized("role.deleteBlocked", { roleName: "R", status: "draft" }))).toBe(
      "R を削除できません。未反映の申請（下書き）があります。申請履歴で反映するか破棄してください。",
    );
    expect(renderMessage("ja", localized("role.deleteBlocked", { roleName: "R", status: "failed" }))).toBe(
      "R を削除できません。未反映の申請（失敗）があります。申請履歴で反映するか破棄してください。",
    );
  });
});

describe("iam.awsMessage / allowedAccounts.readFailed / iam.assumeRoleFailed（Issue #94）", () => {
  it("detail が null のとき、ja・en とも定型文を出す", () => {
    const aws = localized("iam.awsMessage", { operation: "iam:GetRole", detail: null });
    expect(renderMessage("ja", aws)).toBe("iam:GetRole に失敗しました");
    expect(renderMessage("en", aws)).toBe("iam:GetRole failed");

    const forRole = localized("iam.awsMessageForRole", {
      accountId: "111122223333",
      roleName: "r",
      operation: "iam:GetRole",
      detail: null,
    });
    expect(renderMessage("ja", forRole)).toBe("アカウント 111122223333 のロール「r」: iam:GetRole に失敗しました");
    expect(renderMessage("en", forRole)).toBe('Role "r" in account 111122223333: iam:GetRole failed');

    const read = localized("allowedAccounts.readFailed", { name: "/p", code: "X", detail: null });
    expect(renderMessage("ja", read)).toBe("許可するアカウント ID の一覧（SSM パラメータ /p）を読み取れませんでした（X）: 原因不明");
    expect(renderMessage("en", read)).toBe(
      "Could not read the list of allowed account IDs (SSM parameter /p) (X): unknown cause",
    );

    const assume = localized("iam.assumeRoleFailed", { accountId: "1", assumeRoleName: "R", code: "C", detail: null });
    expect(renderMessage("ja", assume)).toContain("（AWS のメッセージ: 詳細なし）");
    expect(renderMessage("en", assume)).toContain("(AWS message: no details)");
  });

  it("iam.invalidPrincipalUser は、ユーザの ARN・直し方・AWS の原文を、ja・en とも含む（Issue #208）", () => {
    const arn = "arn:aws:iam::111122223333:user/ghost";
    const raw = `Invalid principal in policy: "AWS":"${arn}"`;
    const message = localized("iam.invalidPrincipalUser", { userArn: arn, detail: raw });

    const ja = renderMessage("ja", message);
    expect(ja).toContain(arn);
    expect(ja).toContain("IAM に存在しない");
    expect(ja).toContain("IAM にこのユーザを作成してから、この申請を再反映");
    // 実測（2026-11-02）: 作成の直後は、同じ ARN が `Invalid principal` で拒否され、約 10 秒後に通る。
    expect(ja).toContain("作成の直後は、IAM が受け付けるまで 10 秒ほどかかることがあります");
    expect(ja).toContain("申請履歴でこの申請を破棄し、Rolust のユーザプールからこのユーザを削除してから、申請を作り直");
    expect(ja).toContain(`（AWS のメッセージ: ${raw}）`);

    const en = renderMessage("en", message);
    expect(en).toContain(arn);
    expect(en).toContain("does not exist in IAM");
    expect(en).toContain("Create the user in IAM, then re-apply this request.");
    expect(en).toContain("Right after you create it, IAM may take about 10 seconds to accept the user (the apply fails the same way until then).");
    expect(en).toContain("discard this request in the request history, delete the user from Rolust's user pool, and create the request again");
    expect(en).toContain(`(AWS message: ${raw})`);
    expect(en).not.toMatch(/[぀-ヿ㐀-鿿]/);
  });

  it("role.tagMissing は、targetAccountId が null なら where が空、非 null なら付く", () => {
    const params = { roleName: "R", managedTagKey: "k", managedTagValue: "v" };
    const local = renderMessage("en", localized("role.tagMissing", { ...params, targetAccountId: null }));
    const cross = renderMessage("en", localized("role.tagMissing", { ...params, targetAccountId: "111122223333" }));
    expect(local).toContain("register again: aws iam tag-role --role-name R --tags Key=k,Value=v");
    expect(cross).toContain(
      "register again (run it with the credentials of the target account 111122223333; running it with the credentials of another account would tag a role of the same name in that account, if one exists): aws iam tag-role",
    );
  });
});

describe("反映結果・警告の文言（Issue #94）", () => {
  it("ja は現行の文言と一字一句同じ", () => {
    expect(renderMessage("ja", localized("apply.updated", { added: 2, removed: 1 }))).toBe(
      "信頼ポリシーを更新しました（追加 2 / 削除 1）",
    );
    expect(renderMessage("ja", localized("apply.alreadyApplied", {}))).toBe("信頼ポリシーは既に申請どおりの状態でした");
    expect(renderMessage("ja", localized("apply.updateFailed", {}))).toBe("信頼ポリシーの更新に失敗しました");
    expect(renderMessage("ja", localized("apply.crashed", {}))).toBe("反映処理が異常終了しました");
    expect(renderMessage("ja", localized("apply.invalidState", { status: "applied" }))).toBe(
      "状態「applied」の申請は反映できません",
    );
    expect(renderMessage("ja", localized("apply.notFound", {}))).toBe("申請が見つかりません");
    expect(renderMessage("ja", localized("apply.inProgressByOther", {}))).toBe(
      "別の管理者がこの申請を反映中です。しばらくしてから申請履歴で状態を確かめてください。",
    );
    expect(renderMessage("ja", localized("apply.lockNotHeld", {}))).toBe(
      "この申請はロールロックを保持していませんでした（別の申請が保持しています）",
    );
    expect(renderMessage("ja", localized("apply.baselineFailed", { count: 3 }))).toBe(
      "信頼ポリシーは更新されましたが、マトリクスの反映済み状態を 3 件更新できませんでした",
    );
    expect(renderMessage("ja", localized("diff.readFailed", {}))).toBe("現在の信頼ポリシーを読み取れませんでした");
  });

  it("saveFailed の detail が null のとき、ja は申請を保存できませんでした、en は Could not save the request", () => {
    expect(renderMessage("ja", localized("changeRequest.saveFailed", { detail: "boom" }))).toBe("boom");
    expect(renderMessage("ja", localized("changeRequest.saveFailed", { detail: null }))).toBe("申請を保存できませんでした");
    expect(renderMessage("en", localized("changeRequest.saveFailed", { detail: null }))).toBe("Could not save the request");
  });

  it("ロック解放の失敗は入れ子の cause を描画する。ja は現行の文、cause が null なら定型文、en は cause を英語で描画する", () => {
    const cause = localized("storage.operationFailed", { operation: "DeleteItem(RoleLock)", detail: null });
    const inner = renderMessage("ja", cause);
    expect(renderMessage("ja", localized("apply.lockReleaseFailed", { cause }))).toBe(
      `反映は成功しましたが、ロールロックを解放できませんでした（${inner}）。解放されるまでこのロールの新しい申請は作成できません。`,
    );
    expect(renderMessage("ja", localized("apply.lockReleaseFailed", { cause: null }))).toBe(
      "反映は成功しましたが、ロールロックを解放できませんでした（ロールロックを解放できませんでした）。解放されるまでこのロールの新しい申請は作成できません。",
    );
    expect(renderMessage("ja", localized("changeRequest.lockReleaseFailed", { cause }))).toBe(
      `ロールロックを解放できませんでした（${inner}）。解放されるまでこのロールの新しい申請は作成できません。`,
    );
    const innerEn = renderMessage("en", cause);
    expect(renderMessage("en", localized("apply.lockReleaseFailed", { cause }))).toBe(
      `The apply succeeded, but the role lock could not be released (${innerEn}). Until it is released, no new request can be created for this role.`,
    );
    expect(renderMessage("en", localized("apply.lockReleaseFailed", { cause: null }))).toBe(
      "The apply succeeded, but the role lock could not be released (unknown cause). Until it is released, no new request can be created for this role.",
    );
    expect(renderMessage("en", localized("changeRequest.lockReleaseFailed", { cause }))).toBe(
      `The role lock could not be released (${innerEn}). Until it is released, no new request can be created for this role.`,
    );
    expect(renderMessage("en", localized("changeRequest.lockReleaseFailed", { cause: null }))).toBe(
      "The role lock could not be released (unknown cause). Until it is released, no new request can be created for this role.",
    );
    expect(innerEn).not.toMatch(JAPANESE);
  });

  it("en の apply.updated は件数を含む", () => {
    expect(renderMessage("en", localized("apply.updated", { added: 2, removed: 1 }))).toBe(
      "Updated the trust policy (added 2 / removed 1)",
    );
  });
});
