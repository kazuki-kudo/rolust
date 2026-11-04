import { GetCallerIdentityCommand, STSClient } from "@aws-sdk/client-sts";
import { mockClient } from "aws-sdk-client-mock";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  PLACEHOLDER_ACCOUNT,
  assertCallerAccount,
  loadIntegrationEnv,
  withProfile,
} from "./support.js";

const stsMock = mockClient(STSClient);

const NAMES = [
  "ROLUST_INTEGRATION_DEPLOY_PROFILE",
  "ROLUST_INTEGRATION_DEPLOY_ACCOUNT",
  "ROLUST_INTEGRATION_TARGET1_PROFILE",
  "ROLUST_INTEGRATION_TARGET1_ACCOUNT",
] as const;

const VALID = {
  ROLUST_INTEGRATION_DEPLOY_PROFILE: "deploy-p",
  ROLUST_INTEGRATION_DEPLOY_ACCOUNT: "111122223333",
  ROLUST_INTEGRATION_TARGET1_PROFILE: "target-p",
  ROLUST_INTEGRATION_TARGET1_ACCOUNT: "444455556666",
};

describe("loadIntegrationEnv", () => {
  it("run が偽なら環境を見ずに仮の値を返す（スキップ時に定数が計算できる）", () => {
    const loaded = loadIntegrationEnv(NAMES, false, {});

    expect(loaded.ROLUST_INTEGRATION_DEPLOY_ACCOUNT).toBe(PLACEHOLDER_ACCOUNT);
    expect(loaded.ROLUST_INTEGRATION_TARGET1_ACCOUNT).toBe(PLACEHOLDER_ACCOUNT);
    expect(loaded.ROLUST_INTEGRATION_DEPLOY_PROFILE).toBe("skipped");
  });

  it("全部そろっていれば値を返す", () => {
    expect(loadIntegrationEnv(NAMES, true, VALID)).toEqual(VALID);
  });

  it("未設定の変数を、1 つずつではなく全部列挙して失敗する", () => {
    expect(() =>
      loadIntegrationEnv(NAMES, true, { ROLUST_INTEGRATION_DEPLOY_PROFILE: "deploy-p" }),
    ).toThrow(
      /ROLUST_INTEGRATION_DEPLOY_ACCOUNT, ROLUST_INTEGRATION_TARGET1_PROFILE, ROLUST_INTEGRATION_TARGET1_ACCOUNT/,
    );
  });

  it("案内として .local/rolust.env.example を示す", () => {
    expect(() => loadIntegrationEnv(NAMES, true, {})).toThrow(/\.local\/rolust\.env\.example/);
  });

  it("空文字・空白だけの変数は未設定として扱う（KEY= のまま source した場合）", () => {
    expect(() =>
      loadIntegrationEnv(NAMES, true, { ...VALID, ROLUST_INTEGRATION_DEPLOY_PROFILE: "   " }),
    ).toThrow(/ROLUST_INTEGRATION_DEPLOY_PROFILE/);
    expect(() =>
      loadIntegrationEnv(NAMES, true, { ...VALID, ROLUST_INTEGRATION_TARGET1_ACCOUNT: "" }),
    ).toThrow(/ROLUST_INTEGRATION_TARGET1_ACCOUNT/);
  });

  it("前後の空白は除いて返す", () => {
    const loaded = loadIntegrationEnv(NAMES, true, {
      ...VALID,
      ROLUST_INTEGRATION_DEPLOY_ACCOUNT: " 111122223333 ",
    });

    expect(loaded.ROLUST_INTEGRATION_DEPLOY_ACCOUNT).toBe("111122223333");
  });

  it("アカウント ID が 12 桁の数字でなければ、値を出さずに変数名だけ示して失敗する", () => {
    expect(() =>
      loadIntegrationEnv(NAMES, true, { ...VALID, ROLUST_INTEGRATION_DEPLOY_ACCOUNT: "12345" }),
    ).toThrow(/ROLUST_INTEGRATION_DEPLOY_ACCOUNT/);
    try {
      loadIntegrationEnv(NAMES, true, { ...VALID, ROLUST_INTEGRATION_DEPLOY_ACCOUNT: "12345" });
    } catch (error) {
      expect(String(error)).not.toContain("12345");
    }
  });

  it("DEPLOY と TARGET1 に同じアカウント ID を渡したら失敗する", () => {
    expect(() =>
      loadIntegrationEnv(NAMES, true, {
        ...VALID,
        ROLUST_INTEGRATION_TARGET1_ACCOUNT: "111122223333",
      }),
    ).toThrow(/同じアカウント ID/);
  });
});

describe("withProfile", () => {
  const saved = process.env.AWS_PROFILE;
  afterEach(() => {
    if (saved === undefined) delete process.env.AWS_PROFILE;
    else process.env.AWS_PROFILE = saved;
  });

  it("実行中だけ AWS_PROFILE を差し替え、終わったら元の値へ戻す", async () => {
    process.env.AWS_PROFILE = "before";

    const seen = await withProfile("during", async () => process.env.AWS_PROFILE);

    expect(seen).toBe("during");
    expect(process.env.AWS_PROFILE).toBe("before");
  });

  it("元が未設定なら、終わったら未設定に戻す", async () => {
    delete process.env.AWS_PROFILE;

    await withProfile("during", async () => undefined);

    expect(process.env.AWS_PROFILE).toBeUndefined();
  });

  it("処理が失敗しても戻す", async () => {
    process.env.AWS_PROFILE = "before";

    await expect(
      withProfile("during", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(process.env.AWS_PROFILE).toBe("before");
  });
});

describe("assertCallerAccount", () => {
  beforeEach(() => stsMock.reset());

  it("プロファイルのアカウントが期待と一致すれば通る（そのプロファイルで STS を呼ぶ）", async () => {
    let profileSeen: string | undefined;
    stsMock.on(GetCallerIdentityCommand).callsFake(async () => {
      profileSeen = process.env.AWS_PROFILE;
      return { Account: "111122223333" };
    });

    await expect(assertCallerAccount("deploy-p", "111122223333")).resolves.toBeUndefined();

    expect(profileSeen).toBe("deploy-p");
  });

  it("一致しなければ、プロファイル名と末尾 4 桁だけを示して失敗する（全桁は出さない）", async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({ Account: "999900004444" });

    const failure = await assertCallerAccount("deploy-p", "111122223333").then(
      () => undefined,
      (error: unknown) => String(error),
    );

    expect(failure).toContain("deploy-p");
    expect(failure).toContain("4444");
    expect(failure).toContain("3333");
    expect(failure).not.toContain("999900004444");
    expect(failure).not.toContain("111122223333");
  });

  it("STS が失敗したら握りつぶさず、プロファイル名つきで失敗する（SSO の失効など）", async () => {
    stsMock.on(GetCallerIdentityCommand).rejects(new Error("expired token"));

    await expect(assertCallerAccount("deploy-p", "111122223333")).rejects.toThrow(
      /deploy-p.*expired token/s,
    );
  });

  it("Account が返らなければ失敗する", async () => {
    stsMock.on(GetCallerIdentityCommand).resolves({});

    await expect(assertCallerAccount("deploy-p", "111122223333")).rejects.toThrow(/一致しません/);
  });
});
