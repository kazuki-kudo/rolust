import { ValidationError } from "./errors.js";
import { localized } from "./messages/types.js";

/**
 * ARN の導出とパース（FR-1.2 / Data Model 補足）。
 *
 * A-2 の前提により、IAM パス付きのユーザ／ロールは poc の対象外とする。
 * パースはパス付き ARN を受け取っても壊れないよう最終セグメントを名前として扱うが、
 * 導出（build*）はパスなし形式のみを生成する。
 */

/** AWS アカウント ID: 12 桁の数字ちょうど。 */
export const ACCOUNT_ID_PATTERN = /^\d{12}$/;

/** IAM のユーザ名／ロール名: 英数字と `+=,.@_-`、1〜64 文字（interaction-spec.md § 入力検証）。 */
export const IAM_NAME_PATTERN = /^[A-Za-z0-9+=,.@_-]{1,64}$/;

const USER_ARN_PATTERN = /^arn:(aws[a-z-]*):iam::(\d{12}):user\/(.+)$/;
const ROLE_ARN_PATTERN = /^arn:(aws[a-z-]*):iam::(\d{12}):role\/(.+)$/;
const ROOT_ARN_PATTERN = /^arn:(aws[a-z-]*):iam::(\d{12}):root$/;

export interface ParsedUserArn {
  partition: string;
  accountId: string;
  userName: string;
}

export interface ParsedRoleArn {
  partition: string;
  accountId: string;
  roleName: string;
}

/** アカウント ID を検証する。不正なら ValidationError を投げる（fail fast）。 */
export function assertAccountId(value: string, field = "accountId"): string {
  if (!ACCOUNT_ID_PATTERN.test(value)) {
    throw new ValidationError(localized("arn.accountIdFormat", {}), field);
  }
  return value;
}

/** IAM のユーザ名／ロール名を検証する。 */
export function assertIamName(value: string, field: string): string {
  if (!IAM_NAME_PATTERN.test(value)) {
    throw new ValidationError(localized("arn.nameFormat", { field, value }), field);
  }
  return value;
}

/**
 * IAM ユーザの ARN を導出する（FR-1.2）。
 *
 * @returns `arn:aws:iam::<accountId>:user/<userName>`
 */
export function buildUserArn(accountId: string, userName: string): string {
  assertAccountId(accountId);
  assertIamName(userName, "userName");
  return `arn:aws:iam::${accountId}:user/${userName}`;
}

/**
 * IAM ロールの ARN を導出する（Data Model 補足。FR-1.2 と同じ導出規則）。
 *
 * @returns `arn:aws:iam::<accountId>:role/<roleName>`
 */
export function buildRoleArn(accountId: string, roleName: string): string {
  assertAccountId(accountId);
  assertIamName(roleName, "roleName");
  return `arn:aws:iam::${accountId}:role/${roleName}`;
}

/** IAM ユーザ ARN を分解する。形式が違えば ValidationError。 */
export function parseUserArn(arn: string): ParsedUserArn {
  const matched = USER_ARN_PATTERN.exec(arn);
  if (!matched) {
    throw new ValidationError(localized("arn.notUserArn", { arn }), "arn");
  }
  const [, partition, accountId, path] = matched;
  return {
    partition: partition as string,
    accountId: accountId as string,
    userName: lastSegment(path as string),
  };
}

/** IAM ロール ARN を分解する。形式が違えば ValidationError。 */
export function parseRoleArn(arn: string): ParsedRoleArn {
  const matched = ROLE_ARN_PATTERN.exec(arn);
  if (!matched) {
    throw new ValidationError(localized("arn.notRoleArn", { arn }), "arn");
  }
  const [, partition, accountId, path] = matched;
  return {
    partition: partition as string,
    accountId: accountId as string,
    roleName: lastSegment(path as string),
  };
}

export function isUserArn(value: string): boolean {
  return USER_ARN_PATTERN.test(value);
}

export function isRoleArn(value: string): boolean {
  return ROLE_ARN_PATTERN.test(value);
}

export function isAccountRootArn(value: string): boolean {
  return ROOT_ARN_PATTERN.test(value);
}

const PATHLESS_AWS_USER_ARN_PATTERN = /^arn:aws:iam::\d{12}:user\/([^/]+)$/;

/**
 * パスなしの IAM ユーザの ARN（partition が `aws`）か（Issue #80）。
 *
 * 信頼ポリシーから IamUser として取り込める ARN の判定に使う。A-2 の前提により、Rolust が
 * IamUser として登録できるのは `buildUserArn` の書式（`arn:aws:iam::<12桁>:user/<名前>`）だけで、
 * パス付きのユーザ（`user/team/name`）や `aws` 以外の partition は対象外である。
 */
export function isPathlessUserArn(value: string): boolean {
  const matched = PATHLESS_AWS_USER_ARN_PATTERN.exec(value);
  return matched !== null && IAM_NAME_PATTERN.test(matched[1] as string);
}

/**
 * 信頼ポリシーの `Principal.AWS` に現れる値を比較可能な形へ正規化する。
 *
 * AWS は裸のアカウント ID（`123456789012`）を `arn:aws:iam::123456789012:root` と
 * 同一に扱い、保存時に後者へ書き換える。突き合わせでこの 2 形式が別物になると、
 * 同じ principal を二重に「管理外」と報告してしまうため、ここで揃える。
 */
export function normalizeAwsPrincipal(value: string): string {
  const trimmed = value.trim();
  if (ACCOUNT_ID_PATTERN.test(trimmed)) {
    return `arn:aws:iam::${trimmed}:root`;
  }
  return trimmed;
}

function lastSegment(path: string): string {
  const segments = path.split("/");
  return segments[segments.length - 1] as string;
}
