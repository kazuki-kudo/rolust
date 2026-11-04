import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHandler } from "../http.js";
import { TEST_POOL_ID, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { adoptDrift, restoreDrift } from "../services/drift-repair-service.js";
import { diffRoutes } from "./apply.js";

// 修復の本体は drift-repair-service.test.ts が確かめる。ここでは経路の配線（roleArn・now・actor・deployAccountId の受け渡し）だけを見る。
vi.mock("../services/drift-repair-service.js", () => ({
  restoreDrift: vi.fn(),
  adoptDrift: vi.fn(),
}));

/**
 * `GET /drift`（FR-4.9）の経路。権限（`view`）と、応答の形。
 * 乖離の算出そのものは `drift-service.test.ts` が確かめる。権限の規則は `route-permissions.test.ts` も全ルートに対して検査する。
 */

function event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: "GET", path: "/api/drift", headers: {}, multiValueHeaders: {},
    queryStringParameters: null, multiValueQueryStringParameters: null, pathParameters: null,
    stageVariables: null, body: null, isBase64Encoded: false, resource: "/drift",
    requestContext: { accountId: "555566667777" } as APIGatewayProxyEvent["requestContext"],
    ...overrides,
  };
}

beforeEach(() => {
  setupDdbMock();
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "ROLE" } }).resolves({ Items: [] });
  ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": `POOL#${TEST_POOL_ID}` } }).resolves({ Items: [] });
});

describe("GET /drift（FR-4.9）", () => {
  it("ロールが 0 件なら 200 で、checkedAt と空の roles を返す（IAM を呼ばない）", async () => {
    const response = await createHandler(diffRoutes)(event());

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { checkedAt: string; roles: unknown[] };
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    expect(body.roles).toEqual([]);
  });

  it("diffRoutes に GET /drift があり、必要権限は view", () => {
    const route = diffRoutes.find((entry) => entry.method === "GET" && entry.pattern === "/drift");

    expect(route?.requires).toBe("view");
  });
});

describe("POST /drift/restore・/drift/adopt（FR-4.10・FR-4.11）", () => {
  const ROLE_ARN = "arn:aws:iam::555566667777:role/target";
  const RESPONSE = { outcome: "no-drift", changeRequest: null, exclusion: null, failures: [] };
  const services = { "/drift/restore": restoreDrift, "/drift/adopt": adoptDrift } as const;
  // { "name": "alice", "sub": "user-1" } の base64url
  const ACTOR_HEADER_VALUE = Buffer.from(JSON.stringify({ name: "alice", sub: "user-1" })).toString("base64url");

  beforeEach(() => {
    vi.mocked(restoreDrift).mockReset().mockResolvedValue(RESPONSE as never);
    vi.mocked(adoptDrift).mockReset().mockResolvedValue(RESPONSE as never);
  });

  it.each(["/drift/restore", "/drift/adopt"])("%s は diffRoutes にあり、必要権限は edit", (pattern) => {
    const route = diffRoutes.find((entry) => entry.method === "POST" && entry.pattern === pattern);

    expect(route?.requires).toBe("edit");
  });

  it.each(["/drift/restore", "/drift/adopt"] as const)("%s は roleArn が無いと 400（修復の処理も DynamoDB も呼ばない）", async (pattern) => {
    const response = await createHandler(diffRoutes)(
      event({ httpMethod: "POST", path: `/api${pattern}`, resource: pattern, body: JSON.stringify({}) }),
    );

    expect(response.statusCode).toBe(400);
    expect(services[pattern]).not.toHaveBeenCalled();
    expect(ddbMock.calls()).toHaveLength(0);
  });

  it.each(["/drift/restore", "/drift/adopt"] as const)("%s は roleArn が文字列でない・本文が無いと 400", async (pattern) => {
    for (const body of [JSON.stringify({ roleArn: 1 }), JSON.stringify({ roleArn: "  " }), null]) {
      const response = await createHandler(diffRoutes)(
        event({ httpMethod: "POST", path: `/api${pattern}`, resource: pattern, body }),
      );

      expect(response.statusCode).toBe(400);
    }
    expect(services[pattern]).not.toHaveBeenCalled();
  });

  it.each(["/drift/restore", "/drift/adopt"] as const)("%s は roleArn・実行者・デプロイ先アカウントを渡し、結果を 200 で返す", async (pattern) => {
    const response = await createHandler(diffRoutes)(
      event({
        httpMethod: "POST", path: `/api${pattern}`, resource: pattern,
        headers: { "x-rolust-actor": ACTOR_HEADER_VALUE },
        body: JSON.stringify({ roleArn: ROLE_ARN }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(RESPONSE);
    const service = services[pattern];
    expect(service).toHaveBeenCalledTimes(1);
    const [roleArn, now, actor, deployAccountId] = vi.mocked(service).mock.calls[0] as unknown as [string, string, unknown, string | null];
    expect(roleArn).toBe(ROLE_ARN);
    expect(Number.isNaN(Date.parse(now))).toBe(false);
    expect(actor).toEqual({ name: "alice", sub: "user-1" });
    expect(deployAccountId).toBe("555566667777");
  });
});
