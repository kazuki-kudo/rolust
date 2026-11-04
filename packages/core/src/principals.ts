import { normalizeAwsPrincipal } from "./arn.js";
import type {
  PrincipalKind,
  PrincipalValue,
  TrustPolicyDocument,
  TrustPolicyStatement,
} from "./trust-policy.js";
import { PRINCIPAL_KINDS, readPrincipalList } from "./trust-policy.js";

/**
 * Statement 群から principal を抽出する。
 *
 * `Principal` のみを対象とし、`NotPrincipal` は扱わない。`NotPrincipal` は
 * 「この principal 以外」を表す否定形であり、「信頼ポリシーに含まれる principal」
 * （FR-4.2）の列挙対象にはならない。Rolust は `NotPrincipal` を書き込まず、
 * 既存の記述はマージで一切変更しない。
 */

/** ワイルドカード（`Principal: "*"`）を表す擬似的な種別。 */
export type PrincipalRefKind = PrincipalKind | "Wildcard";

export interface PrincipalRef {
  kind: PrincipalRefKind;
  /** 正規化済みの値。`AWS` 種別は裸のアカウント ID を root ARN へ揃えてある。 */
  value: string;
  /** 元の文書における Statement の位置。 */
  statementIndex: number;
  sid: string | null;
  effect: "Allow" | "Deny";
}

/** 文書中のすべての principal を、出現順に列挙する。 */
export function listPrincipals(document: TrustPolicyDocument): PrincipalRef[] {
  const refs: PrincipalRef[] = [];

  document.Statement.forEach((statement, statementIndex) => {
    for (const ref of principalsOfStatement(statement, statementIndex)) {
      refs.push(ref);
    }
  });

  return refs;
}

/** 1 つの Statement の principal を列挙する。 */
export function principalsOfStatement(
  statement: TrustPolicyStatement,
  statementIndex: number,
): PrincipalRef[] {
  const principal: PrincipalValue | undefined = statement.Principal;
  if (principal === undefined) return [];

  const sid = typeof statement.Sid === "string" ? statement.Sid : null;
  const effect = statement.Effect;

  if (principal === "*") {
    return [{ kind: "Wildcard", value: "*", statementIndex, sid, effect }];
  }

  const refs: PrincipalRef[] = [];
  for (const kind of PRINCIPAL_KINDS) {
    for (const raw of readPrincipalList(principal[kind])) {
      refs.push({
        kind,
        value: kind === "AWS" ? normalizeAwsPrincipal(raw) : raw.trim(),
        statementIndex,
        sid,
        effect,
      });
    }
  }
  return refs;
}

/**
 * `Effect: Allow` の Statement に現れる `AWS` 種別の principal 値の集合。
 *
 * 「その ARN は現在この信頼ポリシーで信頼されているか」の判定に使う。
 * Deny を除くのは、Deny に列挙された ARN は信頼されていないためである。
 */
export function allowedAwsPrincipalSet(document: TrustPolicyDocument): Set<string> {
  const set = new Set<string>();
  for (const ref of listPrincipals(document)) {
    if (ref.effect === "Allow" && ref.kind === "AWS") {
      set.add(ref.value);
    }
  }
  return set;
}

/** 指定の ARN が Allow 側の principal として存在するか。 */
export function hasAllowedAwsPrincipal(
  document: TrustPolicyDocument,
  arn: string,
): boolean {
  return allowedAwsPrincipalSet(document).has(normalizeAwsPrincipal(arn));
}
