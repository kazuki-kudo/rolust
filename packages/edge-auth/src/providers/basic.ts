import { timingSafeEqual } from "node:crypto";

import type { CloudFrontResultResponse } from "aws-lambda";

import { setActor } from "../actor.js";
import { serviceUnavailable } from "../responses.js";
import type { AuthProvider } from "./types.js";

const REALM = "Rolust";

/** 長さの違いで早期に false を返さない比較。総当たり時のタイミング差を減らす。 */
function safeEquals(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  if (leftBytes.length !== rightBytes.length) {
    // 長さが違えば内容も違う。ダミー比較を挟んで早期リターンの差を均す。
    timingSafeEqual(leftBytes, leftBytes);
    return false;
  }
  return timingSafeEqual(leftBytes, rightBytes);
}

/** `Basic <base64>` から、最初のコロンの前（ユーザ名）を取り出す。取れなければ null。 */
function basicUserName(authorization: string): string | null {
  const [scheme, encoded] = authorization.split(" ");
  if (scheme?.toLowerCase() !== "basic" || !encoded) return null;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon > 0 ? decoded.slice(0, colon) : null;
}

function unauthorized(): CloudFrontResultResponse {
  return {
    status: "401",
    statusDescription: "Unauthorized",
    headers: {
      "www-authenticate": [
        { key: "WWW-Authenticate", value: `Basic realm="${REALM}", charset="UTF-8"` },
      ],
      "cache-control": [{ key: "Cache-Control", value: "no-store" }],
    },
    body: "Unauthorized",
  };
}

/**
 * Basic 認証（FR-6.1、`auth_mode = "basic"`）。単一の資格情報。
 *
 * 資格情報を取得できない場合は**通さない**（fail closed）。通してしまうと、設定不備がそのまま
 * 管理画面の開放になり、`iam-policy-design-note.md` 4 節の帰結（任意ロールの信頼ポリシー改変）に直結する。
 */
export function createBasicProvider(getExpectedAuthorization: () => Promise<string>): AuthProvider {
  return async (request) => {
    const provided = request.headers.authorization?.[0]?.value;
    if (!provided) {
      return unauthorized();
    }

    let expected: string;
    try {
      expected = await getExpectedAuthorization();
    } catch (error) {
      // 握り潰さず記録する。認証を素通りさせない。
      console.error("[rolust-edge-auth] 資格情報を取得できませんでした", error);
      return serviceUnavailable();
    }

    if (!safeEquals(provided, expected)) {
      return unauthorized();
    }
    // 実行者の記録（Issue #120）。パスワードは扱わず、ユーザ名だけを渡す。取れなければ付けない（API が null で受ける）。
    const name = basicUserName(provided);
    if (name !== null) setActor(request, { name });
    return request;
  };
}
