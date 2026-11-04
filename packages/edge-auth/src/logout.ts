import type { CloudFrontRequest, CloudFrontResultResponse } from "aws-lambda";

import type { OidcConfig } from "./auth-config.js";
import { clearCookie } from "./cookies.js";
import { forbidden, serviceUnavailable } from "./responses.js";
import { ID_COOKIE } from "./providers/oidc.js";

/** ログアウトの経路（Issue #160）。`auth_mode = "cognito"` のときだけ edge-auth が処理する。 */
export const LOGOUT_PATH = "/logout";

/**
 * `/logout` の応答（Issue #160）。ID トークンの Cookie を消し、Cognito の `/logout` へ送って Hosted UI のセッションも終える。
 *
 * 認証は要求しない。期限切れや改ざんの Cookie でも消せるように、Cookie の中身を読まない。
 * 戻り先（`logout_uri`）は `Host` から作る。Cognito はこの URL を登録と完全一致で検証する（`logout_urls`）。
 */
export function buildLogoutResponse(
  request: CloudFrontRequest,
  config: OidcConfig,
): CloudFrontResultResponse {
  const host = request.headers.host?.[0]?.value;
  if (!host) return forbidden();
  if (config.logoutEndpoint === undefined) {
    console.error("[rolust-edge-auth] ログアウトの接続先（logoutEndpoint）がありません");
    return serviceUnavailable();
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    logout_uri: `https://${host}/`,
  });
  return {
    status: "302",
    statusDescription: "Found",
    headers: {
      location: [{ key: "Location", value: `${config.logoutEndpoint}?${params.toString()}` }],
      "set-cookie": [{ key: "Set-Cookie", value: clearCookie(ID_COOKIE) }],
      "cache-control": [{ key: "Cache-Control", value: "no-store" }],
    },
  };
}
