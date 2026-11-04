import type { Actor, ChangeRequestKind, ChangeRequestStatus, ExcludedRole } from "@rolust/core";
import { parseRoleArn, parseUserArn } from "@rolust/core";

import type { Messages } from "./i18n/messages/ja.js";

/**
 * 画面表示の文言。
 *
 * `design-system-mapping.md` § Naming Conventions のとおり、UI 上の日本語表示と
 * コード上の英語識別子の対応を 1 対 1 に保つ。ここが唯一の変換点である。
 */

/** 状態語（`draft` など）を選んだ言語で返す。 */
export function statusLabel(t: Messages, status: ChangeRequestStatus): string {
  return t.status[status];
}

/** 申請の種別の語（Issue #172）。通常の申請（undefined）は null。 */
export function kindLabel(t: Messages, kind: ChangeRequestKind | undefined): string | null {
  return kind === undefined ? null : t.kind[kind];
}

/** Cloudscape の `StatusIndicator` の type（design-system-mapping.md FR-7.5）。 */
export const STATUS_INDICATOR_TYPE: Record<
  ChangeRequestStatus,
  "warning" | "success" | "error" | "stopped"
> = {
  draft: "warning",
  applied: "success",
  failed: "error",
  discarded: "stopped",
};

/** 申請の作成から除外したロールの理由を、選んだ言語で返す。 */
export function exclusionReasonLabel(t: Messages, reason: ExcludedRole["reason"]): string {
  return t.exclusion[reason];
}

/** ARN からロール名を取り出す。壊れた ARN でも画面を落とさない。 */
export function roleNameOf(roleArn: string): string {
  try {
    return parseRoleArn(roleArn).roleName;
  } catch {
    return roleArn;
  }
}

/** ARN からユーザ名を取り出す。壊れた ARN でも画面を落とさない。 */
export function userNameOf(userArn: string): string {
  try {
    return parseUserArn(userArn).userName;
  } catch {
    return userArn;
  }
}

/** ISO 8601 を「2026-07-31 10:04」形式にする。 */
export function formatTimestamp(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** 実行者の表示。`sub` は出さない（読めない ID は履歴の役に立たない）。実行者なしは「—」（Issue #120）。 */
export function actorLabel(actor: Actor | null): string {
  return actor ? actor.name : "—";
}

/**
 * 申請 ID の短縮表示（Issue #145）。`cr-` を含む先頭 9 文字。目視の目印で、操作（URL・API）は全文を使う。
 * 短縮したときは、後ろに「…」を付ける（Issue #148）。表示だけで、コピーする値や検索には関わらない。
 */
export function shortRequestId(changeRequestId: string): string {
  return changeRequestId.length > 9 ? `${changeRequestId.slice(0, 9)}…` : changeRequestId;
}
