import { localized, ValidationError } from "@rolust/core";
import { describe, expect, it, vi } from "vitest";

import { ConfigurationError, ForbiddenError, RouteNotFoundError, awsErrorDetail, localizedOfError, toErrorResponse } from "./errors.js";

describe("toErrorResponse の localized（Issue #94）", () => {
  it("localized つきの ApiError は、本文に localized と日本語の message を載せる", () => {
    const { statusCode, body } = toErrorResponse(new ForbiddenError("apply"));
    expect(statusCode).toBe(403);
    expect(body.message).toBe("この操作には「反映」の権限が必要です");
    expect(body.localized).toEqual({ id: "auth.forbidden", params: { need: "apply" } });
  });

  it("localized つきの ValidationError は、field と localized を載せる", () => {
    const error = new ValidationError(localized("common.rawDetail", { detail: "boom" }), "name");
    const { statusCode, body } = toErrorResponse(error);
    expect(statusCode).toBe(400);
    expect(body).toMatchObject({
      code: "ValidationError",
      message: "boom",
      field: "name",
      localized: { id: "common.rawDetail", params: { detail: "boom" } },
    });
  });

  it("ConfigurationError は、message に設定不備の日本語を残し、SPA 向けの localized には server.internal を載せ、ログに残す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { statusCode, body } = toErrorResponse(new ConfigurationError("環境変数 ROLUST_TABLE が設定されていません"));
    expect(statusCode).toBe(500);
    expect(body.code).toBe("ConfigurationError");
    expect(body.message).toBe("環境変数 ROLUST_TABLE が設定されていません");
    expect(body.localized).toEqual({ id: "server.internal", params: {} });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("素の Error は 500 と server.internal を返し、ログに残す", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { statusCode, body } = toErrorResponse(new Error("secret internals"));
    expect(statusCode).toBe(500);
    expect(body.message).toBe("サーバ内部でエラーが発生しました");
    expect(body.localized).toEqual({ id: "server.internal", params: {} });
    expect(JSON.stringify(body)).not.toContain("secret internals");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("RouteNotFoundError は route.notFound を持つ", () => {
    const { body } = toErrorResponse(new RouteNotFoundError("GET", "/x"));
    expect(body.message).toBe("GET /x に対応する API がありません");
    expect(body.localized).toEqual({ id: "route.notFound", params: { method: "GET", path: "/x" } });
  });
});

describe("localizedOfError / awsErrorDetail（Issue #94）", () => {
  const fallback = localized("server.internal", {});

  it("localized を運ぶ例外（RolustError・IamOperationError 相当）は、その localized を返す", () => {
    const carried = localized("auth.forbidden", { need: "edit" });
    expect(localizedOfError(new ForbiddenError("edit"), fallback)).toEqual(carried);
    const duck = Object.assign(new Error("ja text"), { localized: carried });
    expect(localizedOfError(duck, fallback)).toEqual(carried);
  });

  it("localized を運ばない Error は common.rawDetail、Error でないものは fallback", () => {
    expect(localizedOfError(new Error("見つかりません"), fallback)).toEqual(
      localized("common.rawDetail", { detail: "見つかりません" }),
    );
    expect(localizedOfError(new Error("plain"), fallback)).toEqual(localized("common.rawDetail", { detail: "plain" }));
    expect(localizedOfError("oops", fallback)).toBe(fallback);
    expect(localizedOfError(undefined, fallback)).toBe(fallback);
  });

  it("awsErrorDetail は、Error の message（空なら null）", () => {
    expect(awsErrorDetail(new Error("x"))).toBe("x");
    expect(awsErrorDetail(new Error(""))).toBeNull();
    expect(awsErrorDetail("x")).toBeNull();
  });
});
