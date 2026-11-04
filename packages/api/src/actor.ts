import type { Actor } from "@rolust/core";
import { parseActor, parseGroups } from "@rolust/core";

/**
 * 実行者のヘッダー（Issue #120）。CloudFront の Lambda@Edge（`packages/edge-auth/src/actor.ts`）が、認証を通した
 * リクエストにだけ付ける。ビューアが送った値は Lambda@Edge が除去するので、ここで読む値は CloudFront 経由なら
 * 信頼してよい。API Gateway の直 URL は API キーで塞がれている（FR-6.3）。
 */
export const ACTOR_HEADER = "x-rolust-actor";

/** ヘッダーの値を探す。無い・空は undefined。 */
function findRaw(
  headers: Record<string, string | undefined> | null | undefined,
): string | undefined {
  if (!headers) return undefined;
  const name = Object.keys(headers).find((key) => key.toLowerCase() === ACTOR_HEADER);
  const raw = name === undefined ? undefined : headers[name];
  return raw === undefined || raw === "" ? undefined : raw;
}

/** base64url の JSON を復号する。復号できない・オブジェクトでなければ undefined。 */
function decode(raw: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // JSON として解釈できない。
  }
  return undefined;
}

/**
 * ヘッダーから Cognito のグループ名を読む（Issue #141）。権限の判定に使う。
 * ヘッダーが無い・不正なら null（呼び出し側が「権限なし」にする）。groups が無い有効なヘッダーは空配列。
 * 警告は出さない（不正の警告は `readActor` が出す。同じリクエストで二重に出さない）。
 */
export function readGroups(
  headers: Record<string, string | undefined> | null | undefined,
): string[] | null {
  const raw = findRaw(headers);
  if (raw === undefined) return null;
  const value = decode(raw);
  return value === undefined ? null : parseGroups(value.groups);
}

/**
 * ヘッダーから実行者を読む。無い → null（警告なし。CloudFront を通らないローカル開発・統合テストの通常経路）。
 * あるが不正 → null と `console.warn`（握り潰さない。値は秘密でない保証が無いのでログに出さない）。
 * 実行者なしは既存の申請と同じ有効な状態なので、処理は止めない。
 */
export function readActor(
  headers: Record<string, string | undefined> | null | undefined,
): Actor | null {
  const raw = findRaw(headers);
  if (raw === undefined) return null;

  // 実行者として検証する（余分な属性の `groups` は `parseActor` が捨てる）。
  const actor = parseActor(decode(raw));
  if (actor) return actor;
  console.warn(`[rolust] ${ACTOR_HEADER} を解釈できませんでした。実行者なしで記録します`);
  return null;
}
