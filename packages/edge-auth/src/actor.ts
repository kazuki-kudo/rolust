import type { CloudFrontRequest } from "aws-lambda";

import type { IdTokenClaims } from "./jwt.js";

/**
 * 実行者の記録（Issue #120）。認証を通したリクエストにだけ `x-rolust-actor` を付けて API へ渡す。
 *
 * 値は `{"name","sub?"}` の JSON を base64url にした ASCII 文字列。Cognito のユーザ名は Unicode になりえて、
 * HTTP ヘッダーに生では載せられない。API 側の `readActor`（`packages/api/src/actor.ts`）が復号する。
 * 形の契約は両方のテストの固定値で揃える。
 *
 * **ビューアが送った同名のヘッダーは、認証の方式によらず、プロバイダーを呼ぶ前に除去する**
 * （`index.ts` の `handler`）。付与と除去を一体にすると、付与しない経路（`basic` で名前を取れないとき）で
 * 偽装が素通りする。
 */

export const ACTOR_HEADER = "x-rolust-actor";

export interface Actor {
  name: string;
  sub?: string;
  /**
   * Cognito のグループ名（Issue #141）。API が権限を決めるのに読む。保存する実行者（`createdBy`・`appliedBy`）には
   * 入らない（API の `parseActor` が捨てる）。
   */
  groups?: string[];
}

export function encodeActor(actor: Actor): string {
  return Buffer.from(JSON.stringify(actor), "utf8").toString("base64url");
}

/** 既存の値（ビューアが送ったものを含む）を捨てて、1 本だけ付ける。 */
export function setActor(request: CloudFrontRequest, actor: Actor): void {
  request.headers[ACTOR_HEADER] = [{ key: "X-Rolust-Actor", value: encodeActor(actor) }];
}

/** ビューアが送った値を、複数本あっても全部消す。 */
export function stripActor(request: CloudFrontRequest): void {
  delete request.headers[ACTOR_HEADER];
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

/**
 * 検証済みの ID トークンから実行者を取り出す。`cognito:username` を `name` にし、無ければ `sub`。
 * どちらも無ければ null（Cognito はどちらも必ず入れるので、起きない想定。起きたら API が `null` と警告で受ける）。
 */
export function actorFromClaims(claims: IdTokenClaims): Actor | null {
  const username = claims["cognito:username"];
  const sub = claims.sub;
  const name = nonEmpty(username) ? username : nonEmpty(sub) ? sub : null;
  if (name === null) return null;
  const actor: Actor = nonEmpty(sub) ? { name, sub } : { name };
  const groups = claims["cognito:groups"];
  if (Array.isArray(groups)) {
    const names = groups.filter((group): group is string => typeof group === "string");
    if (names.length > 0) actor.groups = names;
  }
  return actor;
}
