import type { APIGatewayProxyEvent } from "aws-lambda";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createHandler } from "../http.js";
import { meRoutes } from "./me.js";

function event(headers: Record<string, string>): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    path: "/api/me",
    headers,
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    body: null,
    isBase64Encoded: false,
    resource: "/{proxy+}",
    requestContext: { accountId: "555566667777" } as APIGatewayProxyEvent["requestContext"],
  };
}

function actorHeader(value: unknown): Record<string, string> {
  return { "X-Rolust-Actor": Buffer.from(JSON.stringify(value), "utf8").toString("base64url") };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /me（Issue #141）", () => {
  it("cognito: グループの権限と実行者を返す（groups は実行者に含めない）", async () => {
    vi.stubEnv("ROLUST_AUTH_MODE", "cognito");

    const response = await createHandler(meRoutes)(
      event(actorHeader({ name: "alice", sub: "user-1", groups: ["editor"] })),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({
      permission: "edit",
      actor: { name: "alice", sub: "user-1" },
      authMode: "cognito",
    });
  });

  it("cognito: ヘッダーが無くても 200 で、権限なしを返す（画面が理由を出せるように）", async () => {
    vi.stubEnv("ROLUST_AUTH_MODE", "cognito");

    const response = await createHandler(meRoutes)(event({}));

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ permission: "none", actor: null, authMode: "cognito" });
  });

  it("cognito: 未知のグループだけなら none", async () => {
    vi.stubEnv("ROLUST_AUTH_MODE", "cognito");

    const response = await createHandler(meRoutes)(event(actorHeader({ name: "bob", groups: ["admins"] })));

    expect(JSON.parse(response.body)).toEqual({ permission: "none", actor: { name: "bob" }, authMode: "cognito" });
  });

  it("basic: 全権限", async () => {
    vi.stubEnv("ROLUST_AUTH_MODE", "basic");

    const response = await createHandler(meRoutes)(event(actorHeader({ name: "admin" })));

    expect(JSON.parse(response.body)).toEqual({ permission: "apply", actor: { name: "admin" }, authMode: "basic" });
  });
});
