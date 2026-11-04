import type { APIGatewayProxyEvent } from "aws-lambda";
import { ValidationError, plainMessage } from "@rolust/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AllowedAccounts from "../aws/allowed-accounts.js";
import { AllowedAccountsUnavailableError, assertAccountAllowed } from "../aws/allowed-accounts.js";
import { ConflictError } from "../errors.js";
import { createHandler } from "../http.js";
import type * as PoolRepository from "../repository/pool.js";
import { deletePoolUser } from "../services/user-delete-service.js";
import { addUserRows, listUsers } from "../repository/pool.js";
import { listRoleLinks } from "../repository/pool-role-link.js";
import { savePoolAttributeColumns } from "../services/attribute-columns-service.js";
import { saveUserAttributes } from "../services/user-attributes-service.js";
import { poolRoutes } from "./pool.js";

// 許可リストの SSM 読み取りは、実 AWS を呼ばず差し替える。既定は全許可（個別のテストで拒否に切り替える）。
vi.mock("../aws/allowed-accounts.js", async (importOriginal) => ({
  ...(await importOriginal<typeof AllowedAccounts>()),
  assertAccountAllowed: vi.fn(async () => undefined),
}));

vi.mock("../services/user-delete-service.js", () => ({
  deletePoolUser: vi.fn(async () => 2),
}));


vi.mock("../services/attribute-columns-service.js", () => ({
  savePoolAttributeColumns: vi.fn(async () => ({ columns: [{ columnId: "c1", name: "名前" }] })),
}));

vi.mock("../services/user-attributes-service.js", () => ({
  saveUserAttributes: vi.fn(async () => ({ user: { arn: "arn:aws:iam::111122223333:user/ayaka.mori", attributes: {} } })),
}));

vi.mock("../repository/pool-role-link.js", () => ({
  listRoleLinks: vi.fn(async () => []),
}));

vi.mock("../repository/pool.js", async (importOriginal) => ({
  ...(await importOriginal<typeof PoolRepository>()),
  ensurePool: vi.fn(async () => ({
    poolId: "platform-team",
    createdAt: "",
    attributeColumns: [{ columnId: "c1", name: "所属" }],
  })),
  listUsers: vi.fn(async () => []),
  addUserRows: vi.fn(async (poolId: string, accountId: string, rows: { userName: string; attributes: Record<string, string> }[], now: string) =>
    rows.map((row) => ({
      created: true,
      user: {
        poolId,
        accountId,
        userName: row.userName,
        arn: `arn:aws:iam::${accountId}:user/${row.userName}`,
        attributes: row.attributes,
        createdAt: now,
      },
    })),
  ),
}));

function event(overrides: Partial<APIGatewayProxyEvent>): APIGatewayProxyEvent {
  return {
    httpMethod: "GET", path: "/api/pool", headers: {}, multiValueHeaders: {},
    queryStringParameters: null, multiValueQueryStringParameters: null, pathParameters: null,
    stageVariables: null, body: null, isBase64Encoded: false, resource: "/{proxy+}",
    requestContext: { accountId: "555566667777" } as APIGatewayProxyEvent["requestContext"],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(deletePoolUser).mockClear();
  vi.mocked(savePoolAttributeColumns).mockClear();
  vi.mocked(saveUserAttributes).mockClear();
  vi.mocked(addUserRows).mockClear();
  vi.mocked(assertAccountAllowed).mockClear();
});

describe("ロールの紐づけのルートは廃止した（Issue #135）", () => {
  it.each([
    ["GET", "/api/pool/roles"],
    ["PUT", "/api/pool/roles"],
    ["GET", "/api/pool/settings"],
    ["PUT", "/api/pool/settings"],
  ])("%s %s は 404 になる", async (httpMethod, path) => {
    const response = await createHandler(poolRoutes)(
      event({ httpMethod, path, body: httpMethod === "GET" ? null : JSON.stringify({ roleArns: [] }) }),
    );
    expect(response.statusCode).toBe(404);
  });
});

describe("IAM ユーザの削除のルート（FR-1.5 / Issue #44）", () => {
  const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
  const deleteEvent = () =>
    event({
      httpMethod: "DELETE",
      path: "/api/pool/users",
      queryStringParameters: { arn: AYAKA },
    });

  it("削除できない理由の判定を通すサービスへ渡し、連鎖削除の件数を返す", async () => {
    const response = await createHandler(poolRoutes)(deleteEvent());

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(deletePoolUser)).toHaveBeenCalledWith("platform-team", AYAKA);
    expect(JSON.parse(response.body)).toEqual({ arn: AYAKA, removedAssignments: 2 });
  });

  it("サービスの拒否を 409 で返す", async () => {
    vi.mocked(deletePoolUser).mockRejectedValueOnce(new ConflictError(plainMessage("ayaka.mori を削除できません。")));

    const response = await createHandler(poolRoutes)(deleteEvent());

    expect(response.statusCode).toBe(409);
    expect(response.body).toContain("ayaka.mori を削除できません。");
  });
});

describe("ユーザプールのルート（FR-7.1 / Issue #108）", () => {
  it("GET /pool は固定プールのユーザと、紐づくロールの件数 linkedRoleCount を返す", async () => {
    vi.mocked(listRoleLinks).mockResolvedValueOnce([
      "arn:aws:iam::555566667777:role/DeployProd",
      "arn:aws:iam::555566667777:role/ReadOnlyAudit",
    ]);

    const response = await createHandler(poolRoutes)(event({ path: "/api/pool" }));

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body) as { pool: { poolId: string; linkedRoleCount: number; users: unknown[] } };
    expect(body.pool).toMatchObject({ poolId: "platform-team", linkedRoleCount: 2, users: [] });
    expect(vi.mocked(listRoleLinks)).toHaveBeenCalledWith("platform-team");
  });

  it.each([
    ["GET", "/api/pools"],
    ["POST", "/api/pools"],
    ["DELETE", "/api/pools/platform-team"],
    ["PUT", "/api/pools/platform-team/display-name"],
    ["GET", "/api/pools/platform-team/roles"],
  ])("旧い経路 %s %s は 404 になる", async (httpMethod, path) => {
    const response = await createHandler(poolRoutes)(event({ httpMethod, path, body: httpMethod === "GET" ? null : "{}" }));
    expect(response.statusCode).toBe(404);
  });
});

describe("属性列のルート（Issue #61）", () => {
  const ARN = "arn:aws:iam::111122223333:user/ayaka.mori";

  it("PUT /attribute-columns は columns をそのままサービスへ渡す", async () => {
    const columns = [{ columnId: "c1", name: "名前" }, { name: "役割" }];
    const response = await createHandler(poolRoutes)(
      event({ httpMethod: "PUT", path: "/api/pool/attribute-columns", body: JSON.stringify({ columns }) }),
    );

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(savePoolAttributeColumns)).toHaveBeenCalledWith("platform-team", columns);
  });

  it("PUT /users/attributes は arn クエリと attributes をサービスへ渡す", async () => {
    const response = await createHandler(poolRoutes)(
      event({
        httpMethod: "PUT",
        path: "/api/pool/users/attributes",
        queryStringParameters: { arn: ARN },
        body: JSON.stringify({ attributes: { c1: "森" } }),
      }),
    );

    expect(response.statusCode).toBe(200);
    expect(vi.mocked(saveUserAttributes)).toHaveBeenCalledWith("platform-team", ARN, { c1: "森" });
  });

  it("PUT /users/attributes は arn が無い・ユーザの ARN でないと 400 で、サービスを呼ばない", async () => {
    for (const queryStringParameters of [null, { arn: "not-an-arn" }]) {
      const response = await createHandler(poolRoutes)(
        event({
          httpMethod: "PUT",
          path: "/api/pool/users/attributes",
          queryStringParameters,
          body: JSON.stringify({ attributes: {} }),
        }),
      );
      expect(response.statusCode).toBe(400);
    }
    expect(vi.mocked(saveUserAttributes)).not.toHaveBeenCalled();
  });

  it("GET /pool は属性列を返し、定義に無い columnId の値を落とす（Review Focus 3）", async () => {
    vi.mocked(listUsers).mockResolvedValueOnce([
      { poolId: "platform-team", accountId: "111122223333", userName: "ayaka.mori", arn: ARN, attributes: { c1: "森", ghost: "古い値" }, createdAt: "" },
    ]);

    const response = await createHandler(poolRoutes)(event({ path: "/api/pool" }));

    const body = JSON.parse(response.body) as { pool: { attributeColumns: unknown; users: { attributes: unknown }[] } };
    expect(body.pool.attributeColumns).toEqual([{ columnId: "c1", name: "所属" }]);
    expect(body.pool.users[0]?.attributes).toEqual({ c1: "森" });
  });
});

describe("IAM ユーザの登録のルート（FR-1.4 / Issue #98）", () => {
  const post = (payload: unknown) =>
    createHandler(poolRoutes)(
      event({ httpMethod: "POST", path: "/api/pool/users", body: JSON.stringify(payload) }),
    );
  const ACCOUNT = "111122223333";

  it("userNames 形式は従来どおり。属性なしの行として登録し、件数を返す", async () => {
    const response = await post({ accountId: ACCOUNT, userNames: ["ayaka.mori", "kenji.sato"] });

    expect(response.statusCode).toBe(201);
    expect(vi.mocked(addUserRows).mock.calls[0]?.[2]).toEqual([
      { userName: "ayaka.mori", attributes: {} },
      { userName: "kenji.sato", attributes: {} },
    ]);
    expect(JSON.parse(response.body)).toMatchObject({ createdCount: 2, skippedCount: 0 });
  });

  it("users 形式は、列名を columnId に解決して登録する", async () => {
    const response = await post({
      accountId: ACCOUNT,
      users: [{ userName: "ayaka.mori", attributes: { 所属: "開発" } }, { userName: "kenji.sato" }],
    });

    expect(response.statusCode).toBe(201);
    expect(vi.mocked(addUserRows).mock.calls[0]?.[2]).toEqual([
      { userName: "ayaka.mori", attributes: { c1: "開発" } },
      { userName: "kenji.sato", attributes: {} },
    ]);
    const body = JSON.parse(response.body) as { users: { attributes: Record<string, string> }[] };
    expect(body.users[0]?.attributes).toEqual({ c1: "開発" });
  });

  it("登録済みの行は skippedCount に数える", async () => {
    vi.mocked(addUserRows).mockResolvedValueOnce([
      { created: false, user: { poolId: "platform-team", accountId: ACCOUNT, userName: "ayaka.mori", arn: `arn:aws:iam::${ACCOUNT}:user/ayaka.mori`, attributes: { c1: "森" }, createdAt: "2026-01-01T00:00:00.000Z" } },
      { created: true, user: { poolId: "platform-team", accountId: ACCOUNT, userName: "kenji.sato", arn: `arn:aws:iam::${ACCOUNT}:user/kenji.sato`, attributes: {}, createdAt: "2026-10-04T00:00:00.000Z" } },
    ]);

    const response = await post({ accountId: ACCOUNT, users: [{ userName: "ayaka.mori" }, { userName: "kenji.sato" }] });

    expect(JSON.parse(response.body)).toMatchObject({ createdCount: 1, skippedCount: 1 });
  });

  it("許可リストに無いアカウントは 400。何も書かない（Issue #139）", async () => {
    vi.mocked(assertAccountAllowed).mockRejectedValueOnce(
      new ValidationError(plainMessage("AWS アカウント 999900001111 は、登録を許可されていません。"), "accountId"),
    );

    const response = await post({ accountId: "999900001111", userNames: ["ayaka.mori"] });

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({ field: "accountId" });
    expect(vi.mocked(assertAccountAllowed)).toHaveBeenCalledWith("999900001111");
    expect(vi.mocked(addUserRows)).not.toHaveBeenCalled();
  });

  it("CSV 形式（users）でも、許可リストに無いアカウントは書かずに拒否する（Issue #139）", async () => {
    vi.mocked(assertAccountAllowed).mockRejectedValueOnce(
      new ValidationError(plainMessage("AWS アカウント 999900001111 は、登録を許可されていません。"), "accountId"),
    );

    const response = await post({ accountId: "999900001111", users: [{ userName: "ayaka.mori" }] });

    expect(response.statusCode).toBe(400);
    expect(vi.mocked(addUserRows)).not.toHaveBeenCalled();
  });

  it("許可リストを読めないときは 502 で拒否する（fail closed。Issue #139）", async () => {
    vi.mocked(assertAccountAllowed).mockRejectedValueOnce(
      new AllowedAccountsUnavailableError(plainMessage("許可するアカウント ID の一覧を読み取れませんでした（ParameterNotFound）")),
    );

    const response = await post({ accountId: ACCOUNT, userNames: ["ayaka.mori"] });

    expect(response.statusCode).toBe(502);
    expect(JSON.parse(response.body)).toMatchObject({ code: "AllowedAccountsUnavailable" });
    expect(vi.mocked(addUserRows)).not.toHaveBeenCalled();
  });

  it("users と userNames の両方、またはどちらも無い本文は 400。何も書かない", async () => {
    const both = await post({ accountId: ACCOUNT, userNames: ["a"], users: [{ userName: "a" }] });
    const neither = await post({ accountId: ACCOUNT });

    expect([both.statusCode, neither.statusCode]).toEqual([400, 400]);
    expect(vi.mocked(addUserRows)).not.toHaveBeenCalled();
  });

  it("未知の列名・重複・書式の誤り・値の規則違反は 400。何も書かない", async () => {
    const payloads = [
      { accountId: ACCOUNT, users: [{ userName: "a", attributes: { 部署: "x" } }] },
      { accountId: ACCOUNT, users: [{ userName: "a" }, { userName: "a" }] },
      { accountId: ACCOUNT, users: [{ userName: "bad name" }] },
      { accountId: ACCOUNT, users: [{ userName: "a", attributes: { 所属: "あ".repeat(129) } }] },
      { accountId: "1234", users: [{ userName: "a" }] },
    ];
    for (const payload of payloads) {
      expect((await post(payload)).statusCode).toBe(400);
    }
    expect(vi.mocked(addUserRows)).not.toHaveBeenCalled();
  });
});

describe("応答の localized（Issue #94）", () => {
  type ErrorBody = { message: string; field?: string; localized?: { id: string; params: unknown } };
  const call = async (httpMethod: string, path: string, init: Partial<APIGatewayProxyEvent> = {}) => {
    const response = await createHandler(poolRoutes)(event({ httpMethod, path, ...init }));
    return { statusCode: response.statusCode, body: JSON.parse(response.body) as ErrorBody };
  };

  it("userNames と users の両方（または無し）なら pool.usersSpecifyOne", async () => {
    const { statusCode, body } = await call("POST", "/api/pool/users", {
      body: JSON.stringify({ accountId: "111122223333" }),
    });

    expect(statusCode).toBe(400);
    expect(body.field).toBe("users");
    expect(body.localized).toEqual({ id: "pool.usersSpecifyOne", params: {} });
    expect(body.message).toBe("userNames と users のどちらか一方を指定してください");
  });

  it("DELETE /pool/users で arn が無ければ pool.arnQueryRequiredDeleteUser", async () => {
    const { statusCode, body } = await call("DELETE", "/api/pool/users");

    expect(statusCode).toBe(400);
    expect(body.field).toBe("arn");
    expect(body.localized).toEqual({ id: "pool.arnQueryRequiredDeleteUser", params: {} });
    expect(body.message).toBe("削除対象の IAM ユーザ ARN を arn クエリで指定してください");
  });

  it("PUT /pool/users/attributes で arn が無ければ pool.arnQueryRequiredUser", async () => {
    const { statusCode, body } = await call("PUT", "/api/pool/users/attributes", { body: JSON.stringify({}) });

    expect(statusCode).toBe(400);
    expect(body.field).toBe("arn");
    expect(body.localized).toEqual({ id: "pool.arnQueryRequiredUser", params: {} });
    expect(body.message).toBe("対象の IAM ユーザ ARN を arn クエリで指定してください");
  });
});
