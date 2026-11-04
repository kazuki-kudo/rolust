import { TrustPolicyParseError } from "./errors.js";
import { localized } from "./messages/types.js";

/**
 * 信頼ポリシー（`AssumeRolePolicyDocument`）のパースと直列化。
 *
 * `iam:GetRole` が返す `Role.AssumeRolePolicyDocument` は URL エンコードされた JSON
 * である（AWS SDK for JavaScript v3 はデコードしない）。ただし将来デコード済みで
 * 渡ってくる可能性に備え、両方を受け付ける。
 *
 * requirements.md「信頼ポリシーの扱い」のとおり、Rolust はこの文書を保持しない。
 * 反映のたびに AWS から読み、凍結入力との差分を算出する。
 */

/** Principal のキー種別。 */
export type PrincipalKind = "AWS" | "Service" | "Federated" | "CanonicalUser";

export const PRINCIPAL_KINDS: readonly PrincipalKind[] = [
  "AWS",
  "Service",
  "Federated",
  "CanonicalUser",
];

/** `Principal` / `NotPrincipal` のブロック。 */
export type PrincipalBlock = {
  [K in PrincipalKind]?: string | string[];
};

/** `Principal` は `"*"`（誰でも）かブロックのいずれか。 */
export type PrincipalValue = "*" | PrincipalBlock;

export interface TrustPolicyStatement {
  Sid?: string;
  Effect: "Allow" | "Deny";
  Principal?: PrincipalValue;
  NotPrincipal?: PrincipalValue;
  Action?: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
  /** 未知のキーも落とさずに保持する（FR-5.1 の保全方式）。 */
  [key: string]: unknown;
}

export interface TrustPolicyDocument {
  Version: string;
  Id?: string;
  Statement: TrustPolicyStatement[];
  /** 未知のトップレベルキーも保持する。 */
  [key: string]: unknown;
}

export const DEFAULT_POLICY_VERSION = "2012-10-17";

/**
 * `AssumeRolePolicyDocument` をパースする。
 *
 * @param raw URL エンコード済み JSON、または生の JSON 文字列
 * @throws {TrustPolicyParseError} デコード・パース・構造検証のいずれかに失敗した場合
 */
export function parseTrustPolicy(raw: string): TrustPolicyDocument {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new TrustPolicyParseError(localized("policy.empty", {}));
  }

  const decoded = decodeIfNeeded(raw.trim());

  let parsed: unknown;
  try {
    parsed = JSON.parse(decoded);
  } catch (cause) {
    throw new TrustPolicyParseError(localized("policy.notJson", {}), { cause });
  }

  return validateDocument(parsed);
}

/** 信頼ポリシーを `iam:UpdateAssumeRolePolicy` に渡せる JSON 文字列にする。 */
export function serializeTrustPolicy(document: TrustPolicyDocument): string {
  return JSON.stringify(document);
}

/** 文書を深くコピーする。マージは常にコピーに対して行い、入力を破壊しない。 */
export function cloneTrustPolicy(document: TrustPolicyDocument): TrustPolicyDocument {
  return JSON.parse(JSON.stringify(document)) as TrustPolicyDocument;
}

/** 空の信頼ポリシー（Statement なし）。テストと、読み取り結果が空の場合の既定値に使う。 */
export function emptyTrustPolicy(): TrustPolicyDocument {
  return { Version: DEFAULT_POLICY_VERSION, Statement: [] };
}

/** `Principal` の値を配列として読む（文字列単体・配列・未定義を吸収する）。 */
export function readPrincipalList(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? [...value] : [value];
}

/** Statement の `Action` に指定のアクションが含まれるか。`*` / `sts:*` も真とする。 */
export function statementAllowsAction(
  statement: TrustPolicyStatement,
  action: string,
): boolean {
  const actions = readPrincipalList(statement.Action);
  if (actions.length === 0) return false;
  const target = action.toLowerCase();
  return actions.some((candidate) => {
    const normalized = candidate.toLowerCase();
    if (normalized === "*") return true;
    if (normalized === target) return true;
    if (normalized.endsWith(":*")) {
      return target.startsWith(normalized.slice(0, -1));
    }
    return false;
  });
}

function decodeIfNeeded(raw: string): string {
  // デコード済みの JSON は `{` で始まる。URL エンコード済みなら `%7B` で始まる。
  if (raw.startsWith("{")) return raw;
  try {
    return decodeURIComponent(raw);
  } catch (cause) {
    throw new TrustPolicyParseError(localized("policy.urlDecodeFailed", {}), { cause });
  }
}

function validateDocument(parsed: unknown): TrustPolicyDocument {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TrustPolicyParseError(localized("policy.notObject", {}));
  }

  const candidate = parsed as Record<string, unknown>;
  const rawStatement = candidate.Statement;

  // IAM は Statement の単体オブジェクトを許す。配列へ正規化する。
  const statements =
    rawStatement === undefined
      ? []
      : Array.isArray(rawStatement)
        ? rawStatement
        : [rawStatement];

  const validated = statements.map((statement, index) => {
    if (typeof statement !== "object" || statement === null || Array.isArray(statement)) {
      throw new TrustPolicyParseError(localized("policy.statementNotObject", { index }));
    }
    const effect = (statement as Record<string, unknown>).Effect;
    if (effect !== "Allow" && effect !== "Deny") {
      throw new TrustPolicyParseError(localized("policy.badEffect", { index }));
    }
    return statement as TrustPolicyStatement;
  });

  const version =
    typeof candidate.Version === "string" ? candidate.Version : DEFAULT_POLICY_VERSION;

  return { ...candidate, Version: version, Statement: validated };
}
