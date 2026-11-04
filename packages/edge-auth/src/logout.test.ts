import type { CloudFrontRequest } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OidcConfig } from "./auth-config.js";
import { LOGOUT_PATH, buildLogoutResponse } from "./logout.js";
import { CLIENT_ID, ISSUER } from "./testing/tokens.js";

const LOGOUT_ENDPOINT = "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/logout";

const CONFIG: OidcConfig = {
  issuer: ISSUER,
  clientId: CLIENT_ID,
  authorizationEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/authorize",
  tokenEndpoint: "https://rolust-1.auth.ap-northeast-1.amazoncognito.com/oauth2/token",
  jwksUri: `${ISSUER}/.well-known/jwks.json`,
  logoutEndpoint: LOGOUT_ENDPOINT,
};

function request(host?: string): CloudFrontRequest {
  return {
    clientIp: "203.0.113.1",
    headers: host === undefined ? {} : { host: [{ key: "Host", value: host }] },
    method: "GET",
    querystring: "",
    uri: LOGOUT_PATH,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("/logout の応答（Issue #160）", () => {
  it("Cognito の /logout へ 302 し、client_id と logout_uri（https://<Host>/）を付ける", () => {
    const response = buildLogoutResponse(request("rolust.example.com"), CONFIG);

    expect(response.status).toBe("302");
    const location = new URL(response.headers?.location?.[0]?.value ?? "");
    expect(`${location.origin}${location.pathname}`).toBe(LOGOUT_ENDPOINT);
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(location.searchParams.get("logout_uri")).toBe("https://rolust.example.com/");
  });

  it("ID トークンの Cookie を Max-Age=0 で消す（__Host-rolust-id。Path=/・Secure・HttpOnly を保つ）", () => {
    const response = buildLogoutResponse(request("rolust.example.com"), CONFIG);
    const cookies = (response.headers?.["set-cookie"] ?? []).map((entry) => entry.value);

    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toBe("__Host-rolust-id=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax");
  });

  it("応答を Cache-Control: no-store にする", () => {
    const response = buildLogoutResponse(request("rolust.example.com"), CONFIG);

    expect(response.headers?.["cache-control"]?.[0]?.value).toBe("no-store");
  });

  it("Host が無ければ 403 にし、壊れた logout_uri を返さない（Review Focus 1）", () => {
    expect(buildLogoutResponse(request(), CONFIG).status).toBe("403");
  });

  it("logoutEndpoint が無ければ 503 にし、ログに残す（Review Focus 3）", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const withoutEndpoint: OidcConfig = { ...CONFIG, logoutEndpoint: undefined };

    expect(buildLogoutResponse(request("rolust.example.com"), withoutEndpoint).status).toBe("503");
    expect(spy).toHaveBeenCalled();
  });
});
