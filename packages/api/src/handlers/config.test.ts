import { GetCommand, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { ConfigResponse } from "@rolust/core";
import { beforeEach, describe, expect, it } from "vitest";

import { ConfigurationError } from "../errors.js";
import type { RequestContext, Route } from "../http.js";
import {
  TEST_MANAGED_TAG_KEY,
  TEST_MANAGED_TAG_VALUE,
  ddbMock,
  setupDdbMock,
} from "../testing/ddb-mock.js";
import { configRoutes } from "./config.js";

/**
 * `GET /config`（質問 9 = A / 質問 10 = A）。
 *
 * 画面 2 の登録モーダルが「対象ロールにはこのタグが必要」という**要件**を示すための経路。
 * 固定するのは、設定された値をそのまま返すこと、この経路が DynamoDB を触らないこと、
 * 設定不備を握り潰さないことである。
 */

function findConfigRoute(): Route {
  const route = configRoutes.find(
    (entry) => entry.method === "GET" && entry.pattern === "/config",
  );
  if (!route) throw new Error("GET /config のルートが見つかりません");
  return route;
}

const configRoute = findConfigRoute();

function getConfig(): Promise<{ statusCode: number; body: unknown }> {
  const context: RequestContext = {
    method: "GET",
    path: "/config",
    params: {},
    query: {},
    body: null,
    deployAccountId: null,
    actor: null, permission: "apply",
  };
  return configRoute.handler(context);
}

beforeEach(() => {
  setupDdbMock();
});

describe("GET /config", () => {
  it("設定された管理対象タグのキーと値を返す", async () => {
    const result = await getConfig();

    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual<ConfigResponse>({
      managedTagKey: TEST_MANAGED_TAG_KEY,
      managedTagValue: TEST_MANAGED_TAG_VALUE,
    });
  });

  it("値は加工せずそのまま返す（IAM は StringEquals で完全一致を要求する）", async () => {
    process.env.ROLUST_MANAGED_TAG_KEY = "Owner";
    process.env.ROLUST_MANAGED_TAG_VALUE = "Platform Team";

    const result = await getConfig();

    expect(result.body).toEqual<ConfigResponse>({
      managedTagKey: "Owner",
      managedTagValue: "Platform Team",
    });
  });

  it("DynamoDB を一切呼ばない（純粋な設定の読み出し）", async () => {
    await getConfig();

    expect(ddbMock.commandCalls(GetCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(QueryCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(PutCommand)).toHaveLength(0);
  });

  it("タグのキーが未設定なら握り潰さず落とす", async () => {
    // 空の設定を 200 で返すと、画面は要件を表示できないまま登録を促すことになる。
    delete process.env.ROLUST_MANAGED_TAG_KEY;

    await expect(getConfig()).rejects.toThrow(ConfigurationError);
  });

  it("タグの値が未設定なら握り潰さず落とす", async () => {
    delete process.env.ROLUST_MANAGED_TAG_VALUE;

    await expect(getConfig()).rejects.toThrow(ConfigurationError);
  });

  it("設定不備（ROLUST_STATE_TABLE_NAME 未設定）も握り潰さず落とす", async () => {
    delete process.env.ROLUST_STATE_TABLE_NAME;

    await expect(getConfig()).rejects.toThrow(ConfigurationError);
  });
});
