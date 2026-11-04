import { describe, expect, it } from "vitest";
import { localized } from "@rolust/core";

import { ApiClientError } from "../api-client.js";
import { describeError, localizeMessage } from "./describe.js";
import { en } from "./messages/en.js";
import { ja } from "./messages/ja.js";

describe("localizeMessage", () => {
  it("localized があれば、選んだ言語で描画する", () => {
    const message = localized("route.notFound", { method: "GET", path: "/x" });
    expect(localizeMessage("en", "GET /x に対応する API がありません", message)).toBe(
      "No API matches GET /x",
    );
    expect(localizeMessage("ja", "ignored", message)).toBe("GET /x に対応する API がありません");
  });

  it("localized が無い（旧 API）ときは message をそのまま返す", () => {
    expect(localizeMessage("en", "旧 API の文言", undefined)).toBe("旧 API の文言");
    expect(localizeMessage("en", "旧 API の文言", null)).toBe("旧 API の文言");
  });

  it("知らない ID（新しい API）のときも message に戻る", () => {
    const unknown = { id: "future.id", params: {} } as never;
    expect(localizeMessage("en", "サーバの文言", unknown)).toBe("サーバの文言");
  });
});

describe("describeError", () => {
  it("localized があれば、選んだ言語で描画する", () => {
    const error = new ApiClientError(404, {
      code: "NotFound",
      message: "IAM ロールが登録されていません: arn:x",
      localized: localized("role.notRegistered", { roleArn: "arn:x" }),
    });
    expect(describeError("en", en, error)).toBe("The IAM role is not registered: arn:x");
    expect(describeError("ja", ja, error)).toBe("IAM ロールが登録されていません: arn:x");
  });

  it("ネットワーク失敗は、言語別の定型文に原因を添える", () => {
    const error = new ApiClientError(0, { code: "NetworkError", retryable: true }, { detail: "TypeError: Failed to fetch" });
    expect(describeError("en", en, error)).toContain("TypeError: Failed to fetch");
    expect(describeError("en", en, error)).not.toMatch(/[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/);
  });

  it("サーバが message を返さなかったときは、HTTP ステータス入りの定型文", () => {
    const error = new ApiClientError(502, {});
    expect(describeError("en", en, error)).toContain("502");
  });

  it("localized の無い 5xx（旧 API）は、言語別の定型文", () => {
    const error = new ApiClientError(500, { code: "InternalError", message: "サーバ内部でエラーが発生しました" });
    expect(describeError("en", en, error)).toBe(en.error.server);
  });

  it("localized の無い 4xx（旧 API）は、サーバの message をそのまま出す", () => {
    const error = new ApiClientError(400, { code: "ValidationError", message: "旧 API の文言" });
    expect(describeError("en", en, error)).toBe("旧 API の文言");
  });
});
