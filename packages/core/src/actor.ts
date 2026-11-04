import type { Actor } from "./types.js";

/** 実行者の各項目の最大長。ヘッダー・ストレージの肥大を防ぐ。 */
export const ACTOR_FIELD_MAX_LENGTH = 256;

function isBoundedString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= ACTOR_FIELD_MAX_LENGTH
  );
}

/**
 * `x-rolust-actor` を復号した値を `Actor` として検証する（Issue #120）。不正なら null。
 *
 * 余分な属性は捨てる。`sub` が無いときは、`sub` のキーを作らない（DynamoDB は undefined の値を受けない）。
 */
export function parseActor(value: unknown): Actor | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const { name, sub } = value as Record<string, unknown>;
  if (!isBoundedString(name)) return null;
  if (sub === undefined) return { name };
  if (!isBoundedString(sub)) return null;
  return { name, sub };
}
