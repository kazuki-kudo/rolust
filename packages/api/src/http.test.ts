import type { APIGatewayProxyEvent } from "aws-lambda";
import { ValidationError, localized } from "@rolust/core";
import { describe, expect, it } from "vitest";

import {
  createHandler,
  readStringArray,
  readUserNameList,
  requireBoolean,
  requireObjectBody,
  requireString,
  requireStringArray,
} from "./http.js";

/**
 * リクエスト検証の文言は ID と引数で返す（Issue #94）。ja の描画は現行の文言と一字一句同じ。
 */

function thrown(run: () => unknown): ValidationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error("ValidationError が投げられなかった");
}

describe("本文の読み取り（readBody）", () => {
  function post(body: string): APIGatewayProxyEvent {
    return {
      httpMethod: "POST", path: "/api/t", headers: {}, multiValueHeaders: {},
      queryStringParameters: null, multiValueQueryStringParameters: null, pathParameters: null,
      stageVariables: null, body, isBase64Encoded: false, resource: "/{proxy+}",
      requestContext: { accountId: "555566667777" } as APIGatewayProxyEvent["requestContext"],
    };
  }

  it("本文が JSON でないとき request.bodyNotJson と detail を持つ", async () => {
    const handler = createHandler([
      { method: "POST", pattern: "/t", requires: "none", handler: async () => ({ statusCode: 200, body: null }) },
    ]);
    const response = await handler(post("{not json"));
    const body = JSON.parse(response.body) as { message: string; field?: string; localized?: { id: string; params: { detail: string } } };

    expect(response.statusCode).toBe(400);
    expect(body.field).toBe("body");
    expect(body.localized?.id).toBe("request.bodyNotJson");
    expect(body.localized?.params.detail).toMatch(/SyntaxError/);
    expect(body.message).toMatch(/^リクエスト本文が JSON として解釈できません: /);
  });
});

describe("request.*", () => {
  it("request.bodyNotObject", () => {
    for (const body of [null, [], "x", 1]) {
      const error = thrown(() => requireObjectBody(body));
      expect(error.field).toBe("body");
      expect(error.localized).toEqual(localized("request.bodyNotObject", {}));
      expect(error.message).toBe("リクエスト本文が JSON オブジェクトではありません");
    }
  });

  it("request.fieldRequired", () => {
    const error = thrown(() => requireString({ name: " " }, "name"));
    expect(error.field).toBe("name");
    expect(error.localized).toEqual(localized("request.fieldRequired", { field: "name" }));
    expect(error.message).toBe("name は必須です");
  });

  it("request.fieldNotBoolean", () => {
    const error = thrown(() => requireBoolean({ checked: "yes" }, "checked"));
    expect(error.field).toBe("checked");
    expect(error.localized).toEqual(localized("request.fieldNotBoolean", { field: "checked" }));
    expect(error.message).toBe("checked は true / false で指定してください");
  });

  it("request.fieldEmptyList", () => {
    for (const body of [{ ids: [] }, { ids: "a" }, {}]) {
      const error = thrown(() => requireStringArray(body, "ids"));
      expect(error.field).toBe("ids");
      expect(error.localized).toEqual(localized("request.fieldEmptyList", { field: "ids" }));
      expect(error.message).toBe("ids には 1 件以上を指定してください");
    }
  });

  it("request.fieldEmptyElement（requireStringArray と readStringArray）", () => {
    const required = thrown(() => requireStringArray({ ids: ["a", " "] }, "ids"));
    expect(required.localized).toEqual(localized("request.fieldEmptyElement", { field: "ids" }));
    expect(required.message).toBe("ids に空の要素が含まれています");

    const read = thrown(() => readStringArray({ ids: ["a", 1] }, "ids"));
    expect(read.field).toBe("ids");
    expect(read.localized).toEqual(localized("request.fieldEmptyElement", { field: "ids" }));
    expect(read.message).toBe("ids に空の要素が含まれています");
  });

  it("request.fieldNotStringArray", () => {
    const error = thrown(() => readStringArray({ ids: "a" }, "ids"));
    expect(error.field).toBe("ids");
    expect(error.localized).toEqual(localized("request.fieldNotStringArray", { field: "ids" }));
    expect(error.message).toBe("ids は文字列の配列で指定してください");
  });

  it("request.fieldNotLineList", () => {
    const error = thrown(() => readUserNameList({ userNames: 1 }));
    expect(error.field).toBe("userNames");
    expect(error.localized).toEqual(localized("request.fieldNotLineList", { field: "userNames" }));
    expect(error.message).toBe("userNames は改行区切りの文字列または文字列配列で指定してください");
  });

  it("request.userNamesRequired", () => {
    const error = thrown(() => readUserNameList({ userNames: "  \n " }));
    expect(error.field).toBe("userNames");
    expect(error.localized).toEqual(localized("request.userNamesRequired", {}));
    expect(error.message).toBe("IAM ユーザ名を 1 件以上入力してください");
  });
});
