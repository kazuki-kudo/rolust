import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { ValidationError, localized, renderMessage } from "@rolust/core";
import type { LocalizedMessage } from "@rolust/core";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConfigurationError } from "../errors.js";
import {
  AllowedAccountsUnavailableError,
  assertAccountAllowed,
  getAllowedAccountIds,
  loadAllowedAccountsParameterName,
  parseAllowedAccountIds,
  resetAllowedAccountsCache,
} from "./allowed-accounts.js";

/**
 * 許可する AWS アカウント ID のリスト（Issue #139）。SSM パラメータに、カンマ区切りで置く。
 *
 * 読めない・空・不正なときは、許可リストなしとして通さない（fail closed）。
 */

const ssmMock = mockClient(SSMClient);
const NAME = "/rolust/allowed-account-ids";
const ENV = { AWS_REGION: "ap-northeast-1", ROLUST_ALLOWED_ACCOUNT_IDS_PARAMETER: NAME } as NodeJS.ProcessEnv;

beforeEach(() => {
  ssmMock.reset();
  resetAllowedAccountsCache();
});

afterEach(() => {
  resetAllowedAccountsCache();
});

describe("parseAllowedAccountIds", () => {
  it("カンマ区切りを、空白を除いて集合にする", () => {
    expect(parseAllowedAccountIds("111122223333, 444455556666 ,111122223333")).toEqual(
      new Set(["111122223333", "444455556666"]),
    );
  });

  it("空・空白だけ・空の要素は拒否する（許可リストが空のまま通さない）", () => {
    expect(() => parseAllowedAccountIds("")).toThrow(AllowedAccountsUnavailableError);
    expect(() => parseAllowedAccountIds("  ")).toThrow(AllowedAccountsUnavailableError);
    expect(() => parseAllowedAccountIds("111122223333,,444455556666")).toThrow(AllowedAccountsUnavailableError);
  });

  it("12 桁でない要素が 1 つでもあれば、全体を拒否する。文言に不正な値を含める", () => {
    expect(() => parseAllowedAccountIds("111122223333,1234")).toThrow(/1234/);
    expect(() => parseAllowedAccountIds("*")).toThrow(AllowedAccountsUnavailableError);
  });
});

describe("loadAllowedAccountsParameterName", () => {
  it("環境変数から読む", () => {
    expect(loadAllowedAccountsParameterName(ENV)).toBe(NAME);
  });

  it("未設定なら ConfigurationError（許可リストを読む先が無いので、登録を通さない）", () => {
    expect(() => loadAllowedAccountsParameterName({})).toThrow(ConfigurationError);
    expect(() => loadAllowedAccountsParameterName({ ROLUST_ALLOWED_ACCOUNT_IDS_PARAMETER: "  " })).toThrow(
      ConfigurationError,
    );
  });
});

describe("getAllowedAccountIds", () => {
  it("SSM のパラメータを読み、集合で返す", async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "111122223333,444455556666" } });

    const allowed = await getAllowedAccountIds(ENV);

    expect(allowed).toEqual(new Set(["111122223333", "444455556666"]));
    expect(ssmMock.commandCalls(GetParameterCommand)[0]?.args[0].input).toEqual({ Name: NAME });
  });

  it("5 分は読み直さない。過ぎたら読み直す", async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "111122223333" } });
    const t0 = 1_000_000;

    await getAllowedAccountIds(ENV, t0);
    await getAllowedAccountIds(ENV, t0 + 299_000);
    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(1);

    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "444455556666" } });
    const refreshed = await getAllowedAccountIds(ENV, t0 + 301_000);
    expect(ssmMock.commandCalls(GetParameterCommand)).toHaveLength(2);
    expect(refreshed).toEqual(new Set(["444455556666"]));
  });

  it("パラメータが無い（ParameterNotFound）と、AllowedAccountsUnavailableError。作り方を文言に含める", async () => {
    ssmMock.on(GetParameterCommand).rejects(Object.assign(new Error("nf"), { name: "ParameterNotFound" }));

    await expect(getAllowedAccountIds(ENV)).rejects.toThrow(AllowedAccountsUnavailableError);
    await expect(getAllowedAccountIds(ENV)).rejects.toThrow(NAME);
  });

  it("権限が無い（AccessDeniedException）と、権限の確認を促す", async () => {
    ssmMock.on(GetParameterCommand).rejects(Object.assign(new Error("denied"), { name: "AccessDeniedException" }));

    await expect(getAllowedAccountIds(ENV)).rejects.toThrow(/ssm:GetParameter/);
  });

  it("スロットリングは再試行できるエラーにする", async () => {
    ssmMock.on(GetParameterCommand).rejects(Object.assign(new Error("slow"), { name: "ThrottlingException" }));

    await expect(getAllowedAccountIds(ENV)).rejects.toMatchObject({ retryable: true, statusCode: 502 });
  });

  it("値が不正なら、AllowedAccountsUnavailableError。失敗はキャッシュしない", async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "oops" } });
    await expect(getAllowedAccountIds(ENV)).rejects.toThrow(AllowedAccountsUnavailableError);

    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "111122223333" } });
    await expect(getAllowedAccountIds(ENV)).resolves.toEqual(new Set(["111122223333"]));
  });
});

describe("assertAccountAllowed", () => {
  it("許可リストにあるアカウントは通す", async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "111122223333" } });

    await expect(assertAccountAllowed("111122223333", ENV)).resolves.toBeUndefined();
  });

  it("許可リストに無いアカウントは、何が・なぜ・どう直すかを含む ValidationError（field = accountId）", async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "111122223333" } });

    const error = await assertAccountAllowed("999900001111", ENV).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).field).toBe("accountId");
    expect((error as ValidationError).message).toContain("999900001111");
    expect((error as ValidationError).message).toContain(NAME);
  });
});

describe("応答の localized（Issue #94）", () => {
  async function readFailure(error: Error): Promise<AllowedAccountsUnavailableError> {
    ssmMock.on(GetParameterCommand).rejects(error);
    return (await getAllowedAccountIds(ENV).catch((e: unknown) => e)) as AllowedAccountsUnavailableError;
  }

  it("空の一覧は allowedAccounts.empty", () => {
    const error = (() => {
      try {
        parseAllowedAccountIds("111122223333,,444455556666");
      } catch (e) {
        return e as AllowedAccountsUnavailableError;
      }
      throw new Error("投げられなかった");
    })();

    expect(error.localized).toEqual(localized("allowedAccounts.empty", {}));
    expect(error.message).toBe(
      "許可するアカウント ID の一覧が空、または空の要素を含んでいます。" +
        "12 桁のアカウント ID をカンマ区切りで置いてください（例: 111122223333,444455556666）。",
    );
  });

  it("12 桁でない値は allowedAccounts.invalidValues に、不正な値の配列を持たせる", () => {
    const error = (() => {
      try {
        parseAllowedAccountIds("111122223333,1234, abc");
      } catch (e) {
        return e as AllowedAccountsUnavailableError;
      }
      throw new Error("投げられなかった");
    })();

    expect(error.localized).toEqual(localized("allowedAccounts.invalidValues", { invalid: ["1234", "abc"] }));
    expect(error.message).toBe(
      "許可するアカウント ID の一覧に、12 桁の数字でない値があります: 1234, abc。" +
        "12 桁のアカウント ID をカンマ区切りで置いてください。",
    );
  });

  it("ParameterNotFound は allowedAccounts.paramMissing", async () => {
    const error = await readFailure(Object.assign(new Error("nf"), { name: "ParameterNotFound" }));

    expect(error.localized).toEqual(localized("allowedAccounts.paramMissing", { name: NAME, code: "ParameterNotFound" }));
    expect(error.message).toBe(
      `許可するアカウント ID の一覧（SSM パラメータ ${NAME}）を読み取れませんでした（ParameterNotFound）。` +
        "パラメータがありません。terraform apply が最新か確認してください（infra/lambda.tf の allowed_account_ids）。",
    );
  });

  it("AccessDeniedException は allowedAccounts.accessDenied", async () => {
    const error = await readFailure(Object.assign(new Error("denied"), { name: "AccessDeniedException" }));

    expect(error.localized).toEqual(
      localized("allowedAccounts.accessDenied", { name: NAME, code: "AccessDeniedException" }),
    );
    expect(error.message).toBe(
      `許可するアカウント ID の一覧（SSM パラメータ ${NAME}）を読み取れませんでした（AccessDeniedException）。` +
        "CRUD Lambda の実行ロールに ssm:GetParameter が付いていない可能性があります" +
        "（infra/lambda.tf の crud_ssm_allowed_accounts。terraform apply が最新か確認してください）。",
    );
  });

  it("ThrottlingException・TooManyUpdates は allowedAccounts.throttled（再試行可）", async () => {
    for (const code of ["ThrottlingException", "TooManyUpdates"]) {
      const error = await readFailure(Object.assign(new Error("slow"), { name: code }));

      expect(error.retryable).toBe(true);
      expect(error.localized).toEqual(localized("allowedAccounts.throttled", { name: NAME, code }));
      expect(error.message).toBe(
        `許可するアカウント ID の一覧（SSM パラメータ ${NAME}）を読み取れませんでした（${code}）。` +
          "しばらくしてから、もう一度試してください。",
      );
    }
  });

  it("それ以外は allowedAccounts.readFailed に AWS の文を入れる。空なら detail は null で、ja は原因不明、en は unknown cause", async () => {
    const withDetail = await readFailure(Object.assign(new Error("boom"), { name: "InternalServerError" }));
    expect(withDetail.localized).toEqual(
      localized("allowedAccounts.readFailed", { name: NAME, code: "InternalServerError", detail: "boom" }),
    );
    expect(withDetail.message).toBe(
      `許可するアカウント ID の一覧（SSM パラメータ ${NAME}）を読み取れませんでした（InternalServerError）: boom`,
    );

    const empty = await readFailure(Object.assign(new Error(""), { name: "InternalServerError" }));
    expect(empty.localized).toEqual(
      localized("allowedAccounts.readFailed", { name: NAME, code: "InternalServerError", detail: null }),
    );
    expect(empty.message).toBe(
      `許可するアカウント ID の一覧（SSM パラメータ ${NAME}）を読み取れませんでした（InternalServerError）: 原因不明`,
    );
    expect(renderMessage("en", empty.localized as LocalizedMessage)).toContain("unknown cause");
  });

  it("許可リストに無いアカウントは allowedAccounts.notAllowed（ValidationError。field は accountId）", async () => {
    ssmMock.on(GetParameterCommand).resolves({ Parameter: { Value: "111122223333" } });

    const error = (await assertAccountAllowed("999900001111", ENV).catch((e: unknown) => e)) as ValidationError;

    expect(error.localized).toEqual(
      localized("allowedAccounts.notAllowed", { accountId: "999900001111", parameterName: NAME }),
    );
    expect(error.message).toBe(
      "AWS アカウント 999900001111 は、登録を許可されていません。" +
        `許可するアカウント ID の一覧（SSM パラメータ ${NAME}）に追加してから、もう一度登録してください。`,
    );
  });
});
