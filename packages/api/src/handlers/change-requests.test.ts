import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { APIGatewayProxyEvent } from "aws-lambda";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createHandler } from "../http.js";
import { TEST_POOL_ID, ddbMock, setupDdbMock } from "../testing/ddb-mock.js";
import { changeRequestRoutes } from "./change-requests.js";

const NOW = "2026-09-25T00:00:00.000Z";

function event(overrides: Partial<APIGatewayProxyEvent> = {}): APIGatewayProxyEvent {
  return {
    httpMethod: "GET", path: "/api/change-requests", headers: {}, multiValueHeaders: {},
    queryStringParameters: null, multiValueQueryStringParameters: null, pathParameters: null,
    stageVariables: null, body: null, isBase64Encoded: false, resource: "/{proxy+}",
    requestContext: { accountId: "555566667777" } as APIGatewayProxyEvent["requestContext"],
    ...overrides,
  };
}

beforeEach(() => {
  setupDdbMock();
});

describe("GET /change-requests（画面 5。Issue #108 でプール名の添付をやめた）", () => {
  it("申請の一覧を返し、poolNames は返さない。プールの一覧（GSI1）も読まない", async () => {
    ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "CR" } }).resolves({ Items: [] });

    const response = await createHandler(changeRequestRoutes)(event());
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(response.statusCode).toBe(200);
    expect(body).toEqual({ changeRequests: [] });
    expect(ddbMock.commandCalls(QueryCommand).some((call) => call.args[0].input.IndexName === "gsi1")).toBe(false);
  });
});

describe("GET /change-requests?createdFrom（Issue #116）", () => {
  function crItem(id: string, status: string, createdAt: string) {
    return {
      pk: "CR",
      sk: `CR#${id}`,
      itemType: "ChangeRequest",
      changeRequestId: id,
      poolId: TEST_POOL_ID,
      roleArn: "arn:aws:iam::555566667777:role/DeployProd",
      addUserArns: [],
      removeUserArns: [],
      status,
      createdAt,
      appliedAt: null,
      result: null,
    };
  }

  const items = [
    crItem("cr-old-applied", "applied", "2026-06-01T00:00:00.000Z"),
    crItem("cr-old-discarded", "discarded", "2026-06-02T00:00:00.000Z"),
    crItem("cr-old-draft", "draft", "2026-06-03T00:00:00.000Z"),
    crItem("cr-old-failed", "failed", "2026-06-04T00:00:00.000Z"),
    crItem("cr-edge-applied", "applied", "2026-07-06T00:00:00.000Z"),
    crItem("cr-new-applied", "applied", "2026-09-01T00:00:00.000Z"),
  ];

  async function get(query: Record<string, string> | null) {
    ddbMock.on(QueryCommand, { ExpressionAttributeValues: { ":pk": "CR" } }).resolves({ Items: items });
    const response = await createHandler(changeRequestRoutes)(
      event({ queryStringParameters: query }),
    );
    const body = JSON.parse(response.body) as { changeRequests?: { changeRequestId: string }[] };
    return { statusCode: response.statusCode, ids: body.changeRequests?.map((r) => r.changeRequestId) };
  }

  it("createdFrom が無ければ全件を返す", async () => {
    const { statusCode, ids } = await get(null);

    expect(statusCode).toBe(200);
    expect(ids).toHaveLength(6);
  });

  it("空文字は未指定として扱い、全件を返す", async () => {
    const { statusCode, ids } = await get({ createdFrom: "" });

    expect(statusCode).toBe(200);
    expect(ids).toHaveLength(6);
  });

  it("applied・discarded は createdFrom 以降（同時刻を含む）だけ返し、draft・failed は期間外でも返す", async () => {
    const { ids } = await get({ createdFrom: "2026-07-06T00:00:00.000Z" });

    // 作成日の降順。cr-old-applied・cr-old-discarded は除かれ、cr-edge-applied（同時刻）は残る。
    expect(ids).toEqual(["cr-new-applied", "cr-edge-applied", "cr-old-failed", "cr-old-draft"]);
  });

  it("タイムゾーン付きの値も UTC に直して比べる", async () => {
    // 2026-07-06T09:00:00+09:00 は 2026-07-06T00:00:00.000Z と同じ時刻。
    const { ids } = await get({ createdFrom: "2026-07-06T09:00:00+09:00" });

    expect(ids).toContain("cr-edge-applied");
    expect(ids).not.toContain("cr-old-applied");
  });

  it.each(["yesterday", "2026-13-45T00:00:00Z", "2026-07-06"])(
    "解釈できない createdFrom（%s）は 400 を返し、黙って全件を返さない",
    async (createdFrom) => {
      const { statusCode, ids } = await get({ createdFrom });

      expect(statusCode).toBe(400);
      expect(ids).toBeUndefined();
    },
  );
});

describe("POST /change-requests（Issue #108）", () => {
  it("本文の poolId を受けず、固定プールで作る。本文に poolId が混ざっていても無視する", async () => {
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(QueryCommand).resolves({ Items: [] });
    // 固定プールの META だけがある。ロールは未登録。
    ddbMock.on(GetCommand).callsFake((input: { Key?: { pk?: string } }) =>
      input.Key?.pk === `POOL#${TEST_POOL_ID}`
        ? { Item: { pk: `POOL#${TEST_POOL_ID}`, sk: "META", itemType: "UserPool", poolId: TEST_POOL_ID, createdAt: NOW } }
        : {},
    );

    const response = await createHandler(changeRequestRoutes)(
      event({
        httpMethod: "POST",
        body: JSON.stringify({ poolId: "retired-team", roleArns: ["arn:aws:iam::555566667777:role/DeployProd"] }),
      }),
    );

    // ロールが未登録のため除外され、申請は作られない。割り当ては固定プールから読む。
    expect(response.statusCode).toBe(201);
    const queriedPools = ddbMock
      .commandCalls(QueryCommand)
      .map((call) => String(call.args[0].input.ExpressionAttributeValues?.[":pk"]));
    expect(queriedPools).toContain(`POOL#${TEST_POOL_ID}`);
    expect(queriedPools).not.toContain("POOL#retired-team");
  });
});

describe("実行者の記録（Issue #120）", () => {
  const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
  const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";

  function stubOneAssignment(): void {
    ddbMock.on(PutCommand).resolves({});
    ddbMock.on(QueryCommand).callsFake((input: { ExpressionAttributeValues?: Record<string, string> }) => {
      const prefix = input.ExpressionAttributeValues?.[":prefix"];
      if (prefix === "ASSIGN#") {
        return {
          Items: [{ pk: `POOL#${TEST_POOL_ID}`, sk: `ASSIGN#${AYAKA}#${DEPLOY}`, itemType: "Assignment", poolId: TEST_POOL_ID, userArn: AYAKA, roleArn: DEPLOY, checked: true, reflected: false, updatedAt: NOW }],
        };
      }
      if (prefix === "ROLE#") {
        return { Items: [{ pk: `POOL#${TEST_POOL_ID}`, sk: `ROLE#${DEPLOY}`, itemType: "PoolRoleLink", poolId: TEST_POOL_ID, roleArn: DEPLOY, createdAt: NOW }] };
      }
      return { Items: [] };
    });
    ddbMock.on(GetCommand).callsFake((input: { Key?: { pk?: string; sk?: string } }) => {
      if (input.Key?.pk === `POOL#${TEST_POOL_ID}`) {
        return { Item: { pk: `POOL#${TEST_POOL_ID}`, sk: "META", itemType: "UserPool", poolId: TEST_POOL_ID, createdAt: NOW } };
      }
      if (input.Key?.pk === "ROLE") {
        return { Item: { pk: "ROLE", sk: `ROLE#${DEPLOY}`, itemType: "IamRole", accountId: "555566667777", roleName: "DeployProd", arn: DEPLOY, createdAt: NOW } };
      }
      return {};
    });
  }

  function createdItem(): Record<string, unknown> | undefined {
    return ddbMock
      .commandCalls(PutCommand)
      .map((call) => call.args[0].input.Item as Record<string, unknown>)
      .find((item) => item.pk === "CR");
  }

  const body = JSON.stringify({ roleArns: [DEPLOY] });

  it("x-rolust-actor のユーザを作成者として保存する（日本語のユーザ名を含む）", async () => {
    stubOneAssignment();
    const actor = Buffer.from(JSON.stringify({ name: "田中", sub: "user-1" }), "utf8").toString("base64url");

    const response = await createHandler(changeRequestRoutes)(
      event({ httpMethod: "POST", body, headers: { "X-Rolust-Actor": actor } }),
    );

    expect(response.statusCode).toBe(201);
    expect(createdItem()?.createdBy).toEqual({ name: "田中", sub: "user-1" });
  });

  it("ヘッダーが無ければ、作成者なしで作る（201）", async () => {
    stubOneAssignment();

    const response = await createHandler(changeRequestRoutes)(event({ httpMethod: "POST", body }));

    expect(response.statusCode).toBe(201);
    expect(createdItem()?.createdBy).toBeNull();
  });

  it("ヘッダーが不正でも 500 にせず、作成者なしで作る", async () => {
    stubOneAssignment();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await createHandler(changeRequestRoutes)(
      event({ httpMethod: "POST", body, headers: { "x-rolust-actor": "%%%" } }),
    );

    expect(response.statusCode).toBe(201);
    expect(createdItem()?.createdBy).toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("応答の localized（Issue #94）", () => {
  type ErrorBody = { message: string; field?: string; localized?: { id: string; params: unknown } };

  it("解釈できない createdFrom は changeRequest.createdFromInvalid と value を返す", async () => {
    const response = await createHandler(changeRequestRoutes)(
      event({ queryStringParameters: { createdFrom: "yesterday" } }),
    );
    const body = JSON.parse(response.body) as ErrorBody;

    expect(response.statusCode).toBe(400);
    expect(body.field).toBe("createdFrom");
    expect(body.localized).toEqual({ id: "changeRequest.createdFromInvalid", params: { value: "yesterday" } });
    expect(body.message).toBe("createdFrom は ISO 8601 の日時で指定してください: yesterday");
  });

  it("roleArns に IAM ロールの ARN でない値があれば arn.notRoleArn", async () => {
    ddbMock.on(GetCommand).resolves({
      Item: { pk: `POOL#${TEST_POOL_ID}`, sk: "META", itemType: "UserPool", poolId: TEST_POOL_ID, createdAt: NOW },
    });
    const response = await createHandler(changeRequestRoutes)(
      event({ httpMethod: "POST", body: JSON.stringify({ roleArns: ["nope"] }) }),
    );
    const body = JSON.parse(response.body) as ErrorBody;

    expect(response.statusCode).toBe(400);
    expect(body.field).toBe("roleArns");
    expect(body.localized).toEqual({ id: "arn.notRoleArn", params: { arn: "nope" } });
    expect(body.message).toBe("IAM ロールの ARN ではありません: nope");
  });
});
