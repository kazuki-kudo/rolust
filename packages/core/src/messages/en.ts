import type { ErrorCatalog } from "./types.js";

/** 英語のカタログ。用語は `docs/development.md` の「英語表記の用語対応」に従う。 */
export const errorMessagesEn: ErrorCatalog = {
  "operator.plain": ({ text }) => text,
  "auth.forbidden": ({ need }) => `This action requires the "${need}" permission`,
  "route.notFound": ({ method, path }) => `No API matches ${method} ${path}`,
  "server.internal": () => "An internal server error occurred",
  "common.rawDetail": ({ detail }) => detail,
  "arn.accountIdFormat": () => "An AWS account ID must be 12 digits",
  "arn.nameFormat": ({ field, value }) =>
    `${field} may contain only letters, digits and +=,.@_- (1 to 64 characters): ${JSON.stringify(value)}`,
  "arn.notUserArn": ({ arn }) => `Not an IAM user ARN: ${arn}`,
  "arn.notRoleArn": ({ arn }) => `Not an IAM role ARN: ${arn}`,
  "merge.frozenConflict": ({ arn }) => `The frozen input lists the same principal in both additions and removals: ${arn}`,
  "merge.sidConflict": ({ sid }) =>
    `The trust policy already has a statement with the Sid "${sid}" that Rolust uses, in a form Rolust cannot write to. ` +
    "IAM does not allow two statements with the same Sid, so this cannot be applied. " +
    "Rename that statement's Sid, or make it an Allow of sts:AssumeRole without a condition, and apply again.",
  "attribute.nameRequired": () => "Enter a column name",
  "attribute.nameControlChar": () => "Column names cannot contain control characters (line breaks, tabs, etc.)",
  "attribute.nameNotVisible": () => "The column name has no visible characters",
  "attribute.nameTooLong": ({ max }) => `Column names must be ${max} characters or fewer`,
  "attribute.valueControlChar": () => "Values cannot contain control characters (line breaks, tabs, etc.)",
  "attribute.valueNotVisible": () => "The value has no visible characters",
  "attribute.valueTooLong": ({ max }) => `Values must be ${max} characters or fewer`,
  "attribute.columnsNotArray": () => "columns must be an array",
  "attribute.columnNotObject": () => "Each element of columns must be an object",
  "attribute.columnNameNotString": () => "The column name must be a string",
  "attribute.columnIdNotString": () => "columnId must be a string",
  "attribute.tooManyColumns": ({ max }) => `A pool can have at most ${max} attribute columns`,
  "attribute.duplicateColumnName": ({ name }) => `The column name "${name}" is duplicated`,
  "attribute.unknownColumn": ({ columnId }) => `Unknown attribute column: ${columnId}`,
  "attribute.duplicateColumnId": ({ columnId }) => `The attribute column ID is duplicated: ${columnId}`,
  "attribute.attributesNotObject": () => "attributes must be an object",
  "attribute.valueNotString": () => "The value must be a string",
  "role.descriptionControlChar": () => "The description cannot contain control characters (line breaks, tabs, etc.)",
  "role.descriptionNotVisible": () => "The description has no visible characters",
  "role.descriptionTooLong": ({ max }) => `The description must be ${max} characters or fewer`,
  "role.displayNameControlChar": () => "The display name cannot contain control characters (line breaks, tabs, etc.)",
  "role.displayNameNotVisible": () => "The display name has no visible characters",
  "role.displayNameTooLong": ({ max }) => `The display name must be ${max} characters or fewer`,
  "csv.usersNotArray": () => "users must be an array",
  "csv.usersEmpty": () => "Specify at least one user to register",
  "csv.tooManyUsers": ({ max }) => `You can register at most ${max} users at a time`,
  "csv.rowError": ({ position, cause }, render) => `Row ${position}: ${render(cause)}`,
  "csv.userNotObject": () => "Each user must be an object",
  "csv.userNameNotString": () => "userName must be a string",
  "csv.userNameInvalidChars": ({ userName }) => `The user name contains characters that are not allowed: ${JSON.stringify(userName)}`,
  "csv.duplicateUserName": ({ name }) => `The user name "${name}" is duplicated`,
  "csv.unknownAttributeColumn": ({ columnName }) => `The attribute column "${columnName}" does not exist in this pool`,
  "csv.attributeValueNotString": ({ columnName }) => `${columnName}: the value must be a string`,
  "csv.attributeValueInvalid": ({ columnName, cause }, render) => `${columnName}: ${render(cause)}`,
  "policy.empty": () => "The trust policy document is empty",
  "policy.notJson": () => "The trust policy document cannot be parsed as JSON",
  "policy.urlDecodeFailed": () => "The trust policy document cannot be URL-decoded",
  "policy.notObject": () => "The trust policy document is not an object",
  "policy.statementNotObject": ({ index }) => `Statement[${index}] is not an object`,
  "policy.badEffect": ({ index }) => `Statement[${index}].Effect is neither Allow nor Deny`,
  "changeRequest.invalidTransition": ({ from, to }) => `A request cannot move from ${from} to ${to}`,
  "csvParse.afterQuote": () => "Unexpected characters after a quoted value (only a comma or a line break is allowed)",
  "csvParse.unclosedQuote": () => "A quote is not closed",
  "csvParse.moreErrors": ({ rest }) => `and ${rest} more ${rest === 1 ? "error" : "errors"}`,
  "csvParse.empty": ({ header }) => `The CSV is empty. The first line must be a header (${header},…).`,
  "csvParse.tooManyRows": ({ max, actual }) =>
    `You can register at most ${max} rows at a time (there are ${actual}). Split them into smaller batches.`,
  "csvParse.missingUserNameColumn": ({ header }) => `The header has no "${header}" column`,
  "csvParse.unknownColumn": ({ name }) =>
    `The column "${name}" is not an attribute column of this pool (create it first with "Edit attribute columns")`,
  "csvParse.noUsers": () => "There are no user rows to register",
  "csvParse.columnCountMismatch": ({ header, actual }) =>
    `The number of columns does not match (${header} in the header, ${actual} in this row)`,
  "csvParse.userNameEmpty": () => "The user name is empty",
  "csvParse.userNameInvalid": ({ userName }) =>
    `The user name contains characters that are not allowed (letters, digits and +=,.@_- only, 1 to 64 characters): ${userName}`,
  "csvParse.duplicateUserName": ({ name, firstLine }) =>
    `The user name "${name}" duplicates the one on line ${firstLine}`,
  "request.bodyNotJson": ({ detail }) => `The request body cannot be parsed as JSON: ${detail}`,
  "request.bodyNotObject": () => "The request body is not a JSON object",
  "request.fieldRequired": ({ field }) => `${field} is required`,
  "request.fieldNotBoolean": ({ field }) => `${field} must be true or false`,
  "request.fieldEmptyList": ({ field }) => `${field} must contain at least one item`,
  "request.fieldEmptyElement": ({ field }) => `${field} contains an empty element`,
  "request.fieldNotStringArray": ({ field }) => `${field} must be an array of strings`,
  "request.fieldNotLineList": ({ field }) => `${field} must be a newline-separated string or an array of strings`,
  "request.userNamesRequired": () => "Enter at least one IAM user name",
  "matrix.roleNotLinked": ({ roleName }) =>
    `The IAM role ${roleName} is not linked to the user pool. ` +
    "Delete the IAM role on the IAM roles screen and register it again (registering links the role and imports its trust policy).",
  "matrix.userNotInPool": ({ userArn }) =>
    `The IAM user ${userArn} is not registered in the user pool. ` +
    "Register it on the IAM users screen before changing assignments (registration checks that the account is allowed).",
  "changeRequest.createdFromInvalid": ({ value }) => `createdFrom must be an ISO 8601 date-time: ${value}`,
  "pool.usersSpecifyOne": () => "Specify either userNames or users, not both",
  "pool.arnQueryRequiredDeleteUser": () => "Specify the ARN of the IAM user to delete in the arn query parameter",
  "pool.arnQueryRequiredUser": () => "Specify the ARN of the target IAM user in the arn query parameter",
  "role.arnQueryRequiredEdit": () => "Specify the ARN of the IAM role to edit in the arn query parameter",
  "role.colorInvalid": () => "color must be a palette ID or null",
  "role.updateFieldsRequired": () => "Specify at least one of displayName, description and color",
  "role.arnQueryRequiredDelete": () => "Specify the ARN of the IAM role to delete in the arn query parameter",
  "role.descriptionInvalidType": () => "description must be a string or null",
  "role.displayNameInvalidType": () => "displayName must be a string or null",
  "role.notRegistered": ({ roleArn }) => `The IAM role is not registered: ${roleArn}`,
  "role.alreadyRegistered": ({ roleArn }) => `This IAM role is already registered: ${roleArn}`,
  "pool.notFound": ({ poolId }) => `User pool not found: ${poolId}`,
  "pool.userNotFound": ({ userArn }) => `IAM user not found: ${userArn}`,
  "changeRequest.notFound": ({ changeRequestId }) => `Request not found: ${changeRequestId}`,
  "changeRequest.stateUpdateRefused": ({ changeRequestId }) =>
    "The request status could not be updated (another administrator's operation was committed first, " +
    `or the right to apply expired): ${changeRequestId}`,
  "storage.operationFailed": ({ operation, detail }) =>
    `DynamoDB ${operation} failed: ${detail ?? "unknown cause"}`,
  "storage.roleLockIncomplete": () =>
    "Could not finish reading the roles' unapplied requests (locks). Wait a moment and try again.",
  "storage.roleOrderPartial": () =>
    "The role order may have been saved only partially. Reload the latest state and save again if needed.",
  "storage.roleRegisterPartial": () =>
    "Registering the IAM role failed partway. The role is not registered. " +
    "Registering again will resume from where it stopped.",
  "storage.roleDeletePartial": ({ roleName }) =>
    `Deleting ${roleName} failed partway. The role is still registered. Deleting again will finish the cleanup.`,
  "role.deleteBlocked": ({ roleName, status }) =>
    `${roleName} cannot be deleted. It has an unapplied request (${status}). ` +
    "Apply or discard it on the request history screen.",
  "user.deleteBlocked": ({ userName, roleNames, changeRequestIds }) => {
    const reasons: string[] = [];
    if (roleNames.length > 0) {
      reasons.push(
        `It has assignments already applied to the trust policy (${roleNames.join(", ")}). ` +
          "Deleting the user would leave them in the trust policy, invisible in the matrix. " +
          "Uncheck them in the matrix, create a request and apply it, then delete the user. ",
      );
    }
    if (changeRequestIds.length > 0) {
      reasons.push(
        `It is included in unapplied requests (${changeRequestIds.join(", ")}). ` +
          "Apply them, or discard them on the request history screen, then delete the user.",
      );
    }
    return `${userName} cannot be deleted. ${reasons.join("")}`.trimEnd();
  },
  "role.displayNameTaken": ({ displayName }) => `The display name "${displayName}" is used by another role`,
  "role.orderUnregistered": ({ roleArns }) => `Unregistered IAM roles cannot be ordered: ${roleArns.join(", ")}`,
  "changeRequest.noRoles": () => "No roles were specified for the request",
  "changeRequest.applyingByOther": () => "Another administrator is applying this request. Wait a moment and try again.",
  "changeRequest.discardRefused": ({ status }) =>
    `A request with status "${status}" cannot be discarded (only drafts and failed requests can be)`,
  "iam.deployAccountUnknown": ({ roleArn }) =>
    "The AWS account ID of the deployment could not be determined, so IAM was not called. " +
    `Without it, Rolust cannot tell whether the role ${roleArn} belongs to the same account as Rolust or to another one, ` +
    "and so cannot decide which credentials to use " +
    "(calling a role in another account with the deployment account's credentials could affect a role of the same name). " +
    "Call the API through API Gateway (requestContext.accountId is required for this check).",
  "iam.assumeRoleFailed": ({ accountId, assumeRoleName, code, detail }) =>
    `Could not assume the role ${assumeRoleName} in account ${accountId} (${code}). ` +
    "The role may not exist in the target account, or its trust policy does not allow the execution role of Rolust's Lambda. " +
    "After fixing the role or its trust policy, IAM may take a few minutes to reflect the change " +
    "(about 7 minutes in measurements; Rolust does not remember failures, so retrying after waiting works without a restart). " +
    'Create it by following docs/guide/cross-account.md. ' +
    `(AWS message: ${detail ?? "no details"})`,
  "iam.emptyPolicy": () => "IAM did not return a trust policy document",
  "iam.awsMessage": ({ operation, detail }) => detail ?? `${operation} failed`,
  "iam.awsMessageForRole": ({ accountId, roleName, operation, detail }) =>
    `Role "${roleName}" in account ${accountId}: ${detail ?? `${operation} failed`}`,
  "iam.invalidPrincipalUser": ({ userArn, detail }) =>
    `The IAM user ${userArn} does not exist in IAM, so the trust policy could not be updated (nothing was changed on the AWS side). ` +
    "Create the user in IAM, then re-apply this request. " +
    "Right after you create it, IAM may take about 10 seconds to accept the user (the apply fails the same way until then). " +
    "If you do not need this user, discard this request in the request history, delete the user from Rolust's user pool, and create the request again. " +
    `(AWS message: ${detail})`,
  "role.notFoundInAws": ({ roleName, accountId }) =>
    `The IAM role "${roleName}" does not exist in account ${accountId}. ` +
    "Rolust reads a role's tags at registration to decide whether it is managed, so a role that does not exist cannot be registered. " +
    "Check the role name and account ID, or create the role first.",
  "role.selfRoleRejected": ({ roleName, accountId, managedTagKey }) =>
    `The IAM role "${roleName}" (account ${accountId}) is one of Rolust's own execution roles, so it cannot be registered as a managed role. ` +
    "If Rolust could rewrite its own trust policy, it could widen its own permissions, " +
    "so the apply IAM policy (DenySelfEscalation) explicitly denies iam:UpdateAssumeRolePolicy on this role. " +
    "Registering it would always fail at apply time. " +
    "If the managed tag is attached, remove it with the following command: " +
    `aws iam untag-role --role-name ${roleName} --tag-keys ${managedTagKey}`,
  "role.tagMissing": ({ roleName, managedTagKey, managedTagValue, targetAccountId }) =>
    `The IAM role "${roleName}" does not have the managed tag "${managedTagKey}". ` +
    `Rolust's apply Lambda has iam:GetRole / iam:UpdateAssumeRolePolicy only on roles whose ${managedTagKey} is "${managedTagValue}", ` +
    "so registering it as is would end in AccessDenied at apply time. " +
    `Add the tag with the following command and register again${whereToRun(targetAccountId)}: ` +
    `aws iam tag-role --role-name ${roleName} --tags Key=${managedTagKey},Value=${managedTagValue}`,
  "role.tagValueMismatch": ({ roleName, managedTagKey, actual, managedTagValue, targetAccountId }) =>
    `The value of the tag "${managedTagKey}" on the IAM role "${roleName}" is "${actual}", ` +
    `which does not match the managed value "${managedTagValue}". ` +
    "The IAM policy requires an exact match (StringEquals), so registering it as is would end in AccessDenied at apply time. " +
    `Rewrite the value with the following command${whereToRun(targetAccountId)}: ` +
    `aws iam tag-role --role-name ${roleName} --tags Key=${managedTagKey},Value=${managedTagValue}`,
  "role.tagReadDeniedCrossAccount": ({ roleName, accountId, errorCode, readerRoleName }) =>
    `Could not read the tags of the IAM role "${roleName}" (account ${accountId}) (${errorCode}). ` +
    "This is not an input error but missing permission on the target account side. " +
    `Check that ${readerRoleName} in the target account allows iam:ListRoleTags (see docs/guide/cross-account.md).`,
  "role.tagReadDeniedLocal": ({ roleName, errorCode, roleArn }) =>
    `Could not read the tags of the IAM role "${roleName}" (${errorCode}). ` +
    "This is not an input error but missing permission on the deployment side. " +
    `The CRUD Lambda's execution role needs iam:ListRoleTags on ${roleArn} (crud_iam_read_tags in infra/lambda.tf). ` +
    "Check that terraform apply is up to date.",
  "import.roleNotInAws": ({ roleName, accountId, errorCode }) =>
    `The IAM role "${roleName}" (account ${accountId}) does not exist in AWS (${errorCode}). ` +
    "The role may have been deleted. Check the registration on the IAM roles screen.",
  "import.readDenied": ({ roleName, accountId, errorCode, managedTagKey, managedTagValue }) =>
    `${importReadHead(roleName, accountId, errorCode)}. ` +
    `The role may lack the managed tag (${managedTagKey}=${managedTagValue}), ` +
    "or the CRUD Lambda's execution role may lack iam:GetRole " +
    "(crud_iam_read_trust in infra/lambda.tf; check that terraform apply is up to date). " +
    "For a role in another account, the Reader role of the target account may also lack iam:GetRole " +
    '(see docs/guide/cross-account.md).',
  "import.readThrottled": ({ roleName, accountId, errorCode }) =>
    `${importReadHead(roleName, accountId, errorCode)}. Wait a moment and save again.`,
  "import.readFailed": ({ roleName, accountId, errorCode, cause }, render) =>
    `${importReadHead(roleName, accountId, errorCode)}: ${render(cause)}`,
  "allowedAccounts.empty": () =>
    "The list of allowed account IDs is empty or contains an empty element. " +
    "Put 12-digit account IDs separated by commas (for example 111122223333,444455556666).",
  "allowedAccounts.invalidValues": ({ invalid }) =>
    `The list of allowed account IDs contains values that are not 12 digits: ${invalid.join(", ")}. ` +
    "Put 12-digit account IDs separated by commas.",
  "allowedAccounts.notAllowed": ({ accountId, parameterName }) =>
    `Registration is not allowed for AWS account ${accountId}. ` +
    `Add it to the list of allowed account IDs (SSM parameter ${parameterName}), then register again.`,
  "allowedAccounts.paramMissing": ({ name, code }) =>
    `${allowedAccountsReadHead(name, code)}. The parameter does not exist. ` +
    "Check that terraform apply is up to date (allowed_account_ids in infra/lambda.tf).",
  "allowedAccounts.accessDenied": ({ name, code }) =>
    `${allowedAccountsReadHead(name, code)}. ` +
    "The CRUD Lambda's execution role may lack ssm:GetParameter (crud_ssm_allowed_accounts in infra/lambda.tf). " +
    "Check that terraform apply is up to date.",
  "allowedAccounts.throttled": ({ name, code }) =>
    `${allowedAccountsReadHead(name, code)}. Wait a moment and try again.`,
  "allowedAccounts.readFailed": ({ name, code, detail }) =>
    `${allowedAccountsReadHead(name, code)}: ${detail ?? "unknown cause"}`,
  "apply.updated": ({ added, removed }) => `Updated the trust policy (added ${added} / removed ${removed})`,
  "apply.alreadyApplied": () => "The trust policy was already in the requested state",
  "apply.updateFailed": () => "Failed to update the trust policy",
  "apply.crashed": () => "The apply process terminated abnormally",
  "apply.invalidState": ({ status }) => `A request with status "${status}" cannot be applied`,
  "apply.notFound": () => "Request not found",
  "apply.inProgressByOther": () =>
    "Another administrator is applying this request. Wait a moment, then check its status in the request history.",
  "apply.lockNotHeld": () => "This request did not hold the role lock (another request holds it)",
  "apply.lockReleaseFailed": ({ cause }, render) =>
    `The apply succeeded, but the role lock could not be released (${cause ? render(cause) : "unknown cause"}). ` +
    "Until it is released, no new request can be created for this role.",
  "apply.baselineFailed": ({ count }) =>
    `The trust policy was updated, but ${count} applied states in the matrix could not be updated`,
  "driftRepair.adopted": ({ added, removed }) =>
    `Aligned the records with the current trust policy (adopted ${added} / dropped ${removed}). AWS was not modified`,
  "driftRepair.cellFailed": ({ userArn, detail }) => `Could not update the record for ${userArn}${detail ? `: ${detail}` : ""}`,
  "diff.readFailed": () => "Could not read the current trust policy",
  "changeRequest.saveFailed": ({ detail }) => detail ?? "Could not save the request",
  "changeRequest.lockReleaseFailed": ({ cause }, render) =>
    `The role lock could not be released (${cause ? render(cause) : "unknown cause"}). ` +
    "Until it is released, no new request can be created for this role.",
};

/** Tag a role of another account with that account's credentials (a role of the same name in the deployment account would be tagged otherwise). */
function whereToRun(targetAccountId: string | null): string {
  return targetAccountId === null
    ? ""
    : ` (run it with the credentials of the target account ${targetAccountId}; ` +
        "running it with the credentials of another account would tag a role of the same name in that account, if one exists)";
}

function importReadHead(roleName: string, accountId: string, errorCode: string): string {
  return `Could not read the trust policy of the IAM role "${roleName}" (account ${accountId}) (${errorCode})`;
}

function allowedAccountsReadHead(name: string, code: string): string {
  return `Could not read the list of allowed account IDs (SSM parameter ${name}) (${code})`;
}
