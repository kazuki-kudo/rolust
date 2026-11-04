import type { APIGatewayProxyEvent } from "aws-lambda";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createHandler, type Route } from "./http.js";

/**
 * 権限の判定（Issue #141）。ルートのハンドラを呼ぶ前に、グループから決めた権限と
 * `Route.requires` を突き合わせ、足りなければ AWS・DynamoDB に触れずに 403 にする。
 */

function groupsHeader(groups: unknown, name = "alice"): Record<string, string> {
  const value = Buffer.from(JSON.stringify({ name, sub: "user-1", groups }), "utf8").toString("base64url");
  return { "X-Rolust-Actor": value };
}

function event(
  httpMethod: string,
  path: string,
  headers: Record<string, string> = {},
): APIGatewayProxyEvent {
  return {
    httpMethod,
    path,
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

const viewHandler = vi.fn(async () => ({ statusCode: 200, body: { ok: "view" } }));
const editHandler = vi.fn(async () => ({ statusCode: 200, body: { ok: "edit" } }));
const applyHandler = vi.fn(async () => ({ statusCode: 200, body: { ok: "apply" } }));
const anyoneHandler = vi.fn(async (context: { permission: string }) => ({
  statusCode: 200,
  body: { permission: context.permission },
}));

const routes: Route[] = [
  { method: "GET", pattern: "/t/view", requires: "view", handler: viewHandler },
  { method: "POST", pattern: "/t/edit", requires: "edit", handler: editHandler },
  // requires を書かないルートは、最も厳しい apply を要する。
  { method: "POST", pattern: "/t/apply", handler: applyHandler },
  { method: "GET", pattern: "/t/anyone", requires: "none", handler: anyoneHandler },
];

const handler = createHandler(routes);

beforeEach(() => {
  vi.stubEnv("ROLUST_AUTH_MODE", "cognito");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function status(method: string, path: string, headers?: Record<string, string>): Promise<number> {
  return (await handler(event(method, path, headers))).statusCode;
}

describe("cognito: グループから権限を決める", () => {
  it("viewer は参照だけ。書き込みと反映は 403 で、ハンドラを呼ばない", async () => {
    const headers = groupsHeader(["viewer"]);
    expect(await status("GET", "/api/t/view", headers)).toBe(200);
    expect(await status("POST", "/api/t/edit", headers)).toBe(403);
    expect(await status("POST", "/api/t/apply", headers)).toBe(403);
    expect(editHandler).not.toHaveBeenCalled();
    expect(applyHandler).not.toHaveBeenCalled();
  });

  it("403 の本文は code Forbidden で、足りない権限を名指しする", async () => {
    const response = await handler(event("POST", "/api/t/edit", groupsHeader(["viewer"])));
    const body = JSON.parse(response.body) as { code: string; message: string };
    expect(body.code).toBe("Forbidden");
    expect(body.message).toContain("「作成」");

    const apply = await handler(event("POST", "/api/t/apply", groupsHeader(["editor"])));
    expect((JSON.parse(apply.body) as { message: string }).message).toContain("「反映」");
  });

  it("editor は作成まで。反映は 403", async () => {
    const headers = groupsHeader(["editor"]);
    expect(await status("GET", "/api/t/view", headers)).toBe(200);
    expect(await status("POST", "/api/t/edit", headers)).toBe(200);
    expect(await status("POST", "/api/t/apply", headers)).toBe(403);
  });

  it("applier はすべて", async () => {
    const headers = groupsHeader(["applier"]);
    expect(await status("GET", "/api/t/view", headers)).toBe(200);
    expect(await status("POST", "/api/t/edit", headers)).toBe(200);
    expect(await status("POST", "/api/t/apply", headers)).toBe(200);
  });

  it("複数のグループは最上位が効く（viewer と applier）", async () => {
    expect(await status("POST", "/api/t/apply", groupsHeader(["viewer", "applier"]))).toBe(200);
  });

  it.each([
    ["groups が空", [] as unknown],
    ["未知のグループだけ", ["admins"]],
    ["プロトタイプのキー", ["__proto__", "constructor"]],
    ["groups が文字列", "applier"],
  ])("権限なし（%s）は、参照も含めてすべて 403", async (_label, groups) => {
    const headers = groupsHeader(groups);
    expect(await status("GET", "/api/t/view", headers)).toBe(403);
    expect(await status("POST", "/api/t/edit", headers)).toBe(403);
    expect(await status("POST", "/api/t/apply", headers)).toBe(403);
  });

  it.each([
    ["ヘッダー無し", {}],
    ["ヘッダーが不正", { "X-Rolust-Actor": "%%%" }],
    ["groups の無いヘッダー", { "X-Rolust-Actor": Buffer.from('{"name":"a"}').toString("base64url") }],
  ])("%s は権限なし（認証を通ったのに実行者が読めないのは異常で、通さない）", async (_label, headers) => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await status("GET", "/api/t/view", headers)).toBe(403);
    expect(viewHandler).not.toHaveBeenCalled();
  });
});

describe("requires: none（認証を通った人なら誰でも）", () => {
  it("権限なしでも通り、ハンドラには none が渡る", async () => {
    const response = await handler(event("GET", "/api/t/anyone"));
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ permission: "none" });
  });
});

describe("basic: 全権限", () => {
  beforeEach(() => {
    vi.stubEnv("ROLUST_AUTH_MODE", "basic");
  });

  it("ヘッダー無しですべて通り、権限は apply", async () => {
    expect(await status("POST", "/api/t/apply")).toBe(200);
    const response = await handler(event("GET", "/api/t/anyone"));
    expect(JSON.parse(response.body)).toEqual({ permission: "apply" });
  });

  it("viewer のヘッダーが来ても、グループを見ずに全権限", async () => {
    expect(await status("POST", "/api/t/apply", groupsHeader(["viewer"]))).toBe(200);
  });
});

describe("ROLUST_AUTH_MODE の不備", () => {
  it.each([undefined, "none", ""])("%j は 500（設定不備）で、全権限にしない。ハンドラも呼ばない", async (value) => {
    vi.stubEnv("ROLUST_AUTH_MODE", value as string);
    if (value === undefined) delete process.env.ROLUST_AUTH_MODE;
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await handler(event("GET", "/api/t/view", groupsHeader(["applier"])));

    expect(response.statusCode).toBe(500);
    expect(viewHandler).not.toHaveBeenCalled();
  });
});

describe("ルートが無いパス", () => {
  it("権限によらず 404（RouteNotFound）", async () => {
    expect(await status("GET", "/api/t/missing", groupsHeader(["viewer"]))).toBe(404);
    expect(await status("GET", "/api/t/missing")).toBe(404);
  });
});
