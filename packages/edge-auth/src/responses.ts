import type { CloudFrontResultResponse } from "aws-lambda";

/** 許可リストに無い IP への応答。許可リストの情報は一切含めない。 */
export function forbidden(): CloudFrontResultResponse {
  return {
    status: "403",
    statusDescription: "Forbidden",
    headers: { "cache-control": [{ key: "Cache-Control", value: "no-store" }] },
    body: "Forbidden",
  };
}

export function serviceUnavailable(): CloudFrontResultResponse {
  return {
    status: "503",
    statusDescription: "Service Unavailable",
    headers: { "cache-control": [{ key: "Cache-Control", value: "no-store" }] },
    body: "Authentication is temporarily unavailable",
  };
}

/**
 * `/api/*` の未認証への応答。`WWW-Authenticate` を付けない（ブラウザの Basic 認証のダイアログを出さない）。
 * リダイレクトしない（fetch が別オリジンへ飛ばされて CORS で壊れるため）。
 */
export function unauthorizedJson(): CloudFrontResultResponse {
  return {
    status: "401",
    statusDescription: "Unauthorized",
    headers: {
      "content-type": [{ key: "Content-Type", value: "application/json" }],
      "cache-control": [{ key: "Cache-Control", value: "no-store" }],
    },
    body: JSON.stringify({ message: "Unauthorized" }),
  };
}
