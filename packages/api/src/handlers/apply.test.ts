import type { APIGatewayProxyEvent } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHandler } from "../http.js";
import { applyChangeRequests } from "../services/apply-service.js";
import { computeDiffViews } from "../services/diff-service.js";
import { applyRoutes, diffRoutes } from "./apply.js";

/**
 * 差分確認・反映のルートが、デプロイ先のアカウント ID をサービスへ渡すことを固定する（Issue #27）。
 *
 * サービスは値が無い（null）と IAM を呼ばずに止める。ここで渡し忘れると、
 * すべての差分確認と反映が「デプロイ先が分からない」で失敗する。
 */

vi.mock("../services/diff-service.js", () => ({ computeDiffViews: vi.fn(async () => []) }));
vi.mock("../services/apply-service.js", () => ({ applyChangeRequests: vi.fn(async () => []) }));

const DEPLOY_ACCOUNT = "555566667777";

function event(overrides: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return {
    httpMethod: "GET",
    path: "/api/diff",
    headers: {},
    multiValueHeaders: {},
    queryStringParameters: null,
    multiValueQueryStringParameters: null,
    pathParameters: null,
    stageVariables: null,
    body: null,
    isBase64Encoded: false,
    resource: "/{proxy+}",
    requestContext: { accountId: DEPLOY_ACCOUNT } as APIGatewayProxyEvent["requestContext"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(computeDiffViews).mockClear();
  vi.mocked(applyChangeRequests).mockClear();
});

describe("デプロイ先のアカウント ID の受け渡し（Issue #27）", () => {
  it("差分確認は requestContext.accountId をサービスへ渡す", async () => {
    const response = await createHandler(diffRoutes)(
      event({ queryStringParameters: { ids: "cr-1,cr-2" } }),
    );

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(computeDiffViews).mock.calls).toEqual([[["cr-1", "cr-2"], DEPLOY_ACCOUNT]]);
  });

  it("反映は requestContext.accountId をサービスへ渡す", async () => {
    const response = await createHandler(applyRoutes)(
      event({
        httpMethod: "POST",
        path: "/api/apply",
        body: JSON.stringify({ changeRequestIds: ["cr-1"] }),
      }),
    );

    expect(response.statusCode).toBe(200);
    const [call] = vi.mocked(applyChangeRequests).mock.calls;
    expect(call?.[0]).toEqual(["cr-1"]);
    expect(call?.[2]).toBe(DEPLOY_ACCOUNT);
  });
});
