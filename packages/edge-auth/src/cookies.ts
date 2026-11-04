import type { CloudFrontHeaders } from "aws-lambda";

/** リクエストの Cookie を読む。同名は最初のものを採る。`Map` を使うのは `__proto__` などの名前を安全に扱うため。 */
export function parseCookies(request: { headers: CloudFrontHeaders }): Map<string, string> {
  const result = new Map<string, string>();
  for (const header of request.headers.cookie ?? []) {
    for (const part of header.value.split(";")) {
      const index = part.indexOf("=");
      if (index <= 0) continue;
      const name = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (name !== "" && !result.has(name)) {
        result.set(name, value);
      }
    }
  }
  return result;
}

const ATTRIBUTES = "Path=/; Secure; HttpOnly; SameSite=Lax";

/**
 * `SameSite=Lax` は、Cognito からのトップレベルの GET のリダイレクト（`/callback`）で Cookie が届くために要る
 * （`Strict` だと一時値が届かない）。`__Host-` 接頭辞は Secure・Path=/・Domain 無しを要求する。
 */
export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  return `${name}=${value}; Max-Age=${maxAgeSeconds}; ${ATTRIBUTES}`;
}

export function clearCookie(name: string): string {
  return `${name}=; Max-Age=0; ${ATTRIBUTES}`;
}
