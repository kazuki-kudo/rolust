import { describe, expect, it } from "vitest";

import { ConfigurationError } from "./errors.js";
import { loadAuthMode, loadConfig, loadSelfRoleArns, loadTargetRoleNames } from "./config.js";

/**
 * 実行時設定の読み取り（Step 18-A）。
 *
 * タグの 2 変数は**必須**である。接頭辞方式では空文字が「絞り込みなし」という
 * 定義済みの意味を持ったが、タグ方式に安全な既定値は無い。空を許すと
 * 「絞り込んでいるように見えて絞り込んでいない」状態になるため起動時に落とす。
 */

const complete: NodeJS.ProcessEnv = {
  ROLUST_STATE_TABLE_NAME: "rolust-state",
  ROLUST_CHANGE_REQUEST_TABLE_NAME: "rolust-change-requests",
  ROLUST_MANAGED_TAG_KEY: "rolust:managed",
  ROLUST_MANAGED_TAG_VALUE: "true",
  ROLUST_POOL_ID: "jump-account",
};

describe("loadConfig", () => {
  it("4 変数が揃っていれば読み取れる", () => {
    const config = loadConfig(complete);

    expect(config.stateTableName).toBe("rolust-state");
    expect(config.changeRequestTableName).toBe("rolust-change-requests");
    expect(config.managedTagKey).toBe("rolust:managed");
    expect(config.managedTagValue).toBe("true");
  });

  it("AWS_REGION は任意で、未設定なら undefined になる", () => {
    expect(loadConfig(complete).region).toBeUndefined();
    expect(loadConfig({ ...complete, AWS_REGION: "ap-northeast-1" }).region).toBe(
      "ap-northeast-1",
    );
  });

  it("前後の空白は落とす", () => {
    const config = loadConfig({
      ROLUST_STATE_TABLE_NAME: "  rolust-state  ",
      ROLUST_CHANGE_REQUEST_TABLE_NAME: "  rolust-change-requests  ",
      ROLUST_MANAGED_TAG_KEY: "  rolust:managed  ",
      ROLUST_MANAGED_TAG_VALUE: "  true  ",
      ROLUST_POOL_ID: "  jump-account  ",
    });

    expect(config.stateTableName).toBe("rolust-state");
    expect(config.changeRequestTableName).toBe("rolust-change-requests");
    expect(config.managedTagKey).toBe("rolust:managed");
    expect(config.managedTagValue).toBe("true");
  });

  it.each(["ROLUST_STATE_TABLE_NAME", "ROLUST_CHANGE_REQUEST_TABLE_NAME"])(
    "%s が無ければ落ちる",
    (name) => {
      const rest = { ...complete };
      delete rest[name];

      expect(() => loadConfig(rest)).toThrow(ConfigurationError);
      expect(() => loadConfig(rest)).toThrow(new RegExp(name));
    },
  );

  it("2 つのテーブル名が同じなら落ちる（状態と申請が 1 本に混ざる）", () => {
    expect(() =>
      loadConfig({ ...complete, ROLUST_CHANGE_REQUEST_TABLE_NAME: "rolust-state" }),
    ).toThrow(/別々のテーブル/);
  });

  it("廃止した ROLUST_TABLE_NAME が残っていれば落ちる（Issue #36。旧い設定のまま空のテーブルを見せない）", () => {
    expect(() => loadConfig({ ...complete, ROLUST_TABLE_NAME: "rolust" })).toThrow(
      /ROLUST_TABLE_NAME は廃止/,
    );
  });

  it("ROLUST_MANAGED_TAG_KEY が無ければ落ちる（タグ方式に安全な既定値は無い）", () => {
    const { ROLUST_MANAGED_TAG_KEY: _omitted, ...rest } = complete;

    expect(() => loadConfig(rest)).toThrow(ConfigurationError);
    expect(() => loadConfig(rest)).toThrow(/ROLUST_MANAGED_TAG_KEY/);
  });

  it("ROLUST_MANAGED_TAG_VALUE が無ければ落ちる", () => {
    const { ROLUST_MANAGED_TAG_VALUE: _omitted, ...rest } = complete;

    expect(() => loadConfig(rest)).toThrow(ConfigurationError);
    expect(() => loadConfig(rest)).toThrow(/ROLUST_MANAGED_TAG_VALUE/);
  });

  it("空文字は未設定と同じく落とす（絞り込みが素通りする状態を作らない）", () => {
    expect(() => loadConfig({ ...complete, ROLUST_MANAGED_TAG_KEY: "" })).toThrow(
      ConfigurationError,
    );
    expect(() => loadConfig({ ...complete, ROLUST_MANAGED_TAG_VALUE: "   " })).toThrow(
      ConfigurationError,
    );
    expect(() => loadConfig({ ...complete, ROLUST_STATE_TABLE_NAME: " " })).toThrow(
      ConfigurationError,
    );
  });
});

/**
 * クロスアカウントで引き受けるロールの名前（Issue #85）。
 *
 * `loadConfig` とは別に、別アカウントを引き受けるときだけ読む。Reader と Manager が同名だと、CRUD・Diff が
 * 更新用のロールを引き受けられる形になり、FR-3.2 の保証が外れるので、起動時ではなく読む時点で落とす。
 */
describe("loadTargetRoleNames", () => {
  const names: NodeJS.ProcessEnv = {
    ROLUST_TARGET_READER_ROLE_NAME: "RolustTrustPolicyReader",
    ROLUST_TARGET_MANAGER_ROLE_NAME: "RolustTrustPolicyManager",
  };

  it("2 変数が揃っていれば、Reader と Manager の名前を返す", () => {
    expect(loadTargetRoleNames(names)).toEqual({
      readerRoleName: "RolustTrustPolicyReader",
      managerRoleName: "RolustTrustPolicyManager",
    });
  });

  it("前後の空白は落とす", () => {
    expect(
      loadTargetRoleNames({
        ROLUST_TARGET_READER_ROLE_NAME: "  Reader  ",
        ROLUST_TARGET_MANAGER_ROLE_NAME: "  Manager  ",
      }),
    ).toEqual({ readerRoleName: "Reader", managerRoleName: "Manager" });
  });

  it.each(["ROLUST_TARGET_READER_ROLE_NAME", "ROLUST_TARGET_MANAGER_ROLE_NAME"])(
    "%s が無ければ、変数名を示して落ちる",
    (name) => {
      const rest = { ...names };
      delete rest[name];

      expect(() => loadTargetRoleNames(rest)).toThrow(ConfigurationError);
      expect(() => loadTargetRoleNames(rest)).toThrow(new RegExp(name));
    },
  );

  it("空文字は未設定と同じく落とす", () => {
    expect(() => loadTargetRoleNames({ ...names, ROLUST_TARGET_READER_ROLE_NAME: "   " })).toThrow(
      ConfigurationError,
    );
  });

  it.each(["Rolust*", "path/Reader", "Reader Role", "", "x".repeat(65)])(
    "IAM ロール名に使えない値「%s」は落とす（ワイルドカードとパスを許さない）",
    (value) => {
      expect(() => loadTargetRoleNames({ ...names, ROLUST_TARGET_MANAGER_ROLE_NAME: value })).toThrow(
        ConfigurationError,
      );
    },
  );

  it("Reader と Manager が同じ名前なら落ちる（CRUD・Diff が更新用のロールを引き受けられる形になる）", () => {
    expect(() =>
      loadTargetRoleNames({
        ROLUST_TARGET_READER_ROLE_NAME: "SameName",
        ROLUST_TARGET_MANAGER_ROLE_NAME: "SameName",
      }),
    ).toThrow(/別々の名前/);
  });

  it("loadConfig は、この 2 変数が無くても落ちない（別アカウントを使わない運用を止めない）", () => {
    expect(() => loadConfig(complete)).not.toThrow();
  });
});

/**
 * Rolust 自身の実行ロール（Issue #194 H-1）。
 *
 * `infra/main.tf` の `local.self_role_arns`（IAM ポリシーの `DenySelfEscalation` と同じ値）が
 * 環境変数 `ROLUST_SELF_ROLE_ARNS` として渡る。`loadConfig` とは別にし、ロールの登録だけが読む。
 * 未設定・書式不正は落とす（既定を「空（＝拒否しない）」にすると、設定の付け忘れが検査の素通りになる）。
 */
describe("loadSelfRoleArns", () => {
  const arns = {
    ROLUST_SELF_ROLE_ARNS:
      "arn:aws:iam::123456789012:role/rolust-crud-exec,arn:aws:iam::123456789012:role/rolust-apply-exec",
  };

  it("カンマ区切りの ARN を、アカウント ID とロール名に分解して返す", () => {
    expect(loadSelfRoleArns(arns)).toEqual([
      { accountId: "123456789012", roleName: "rolust-crud-exec" },
      { accountId: "123456789012", roleName: "rolust-apply-exec" },
    ]);
  });

  it("要素の前後の空白は落とす", () => {
    expect(
      loadSelfRoleArns({
        ROLUST_SELF_ROLE_ARNS: " arn:aws:iam::123456789012:role/rolust-crud-exec , ",
      }),
    ).toEqual([{ accountId: "123456789012", roleName: "rolust-crud-exec" }]);
  });

  it("aws 以外のパーティションも読める（照合はアカウント ID とロール名で行う）", () => {
    expect(loadSelfRoleArns({ ROLUST_SELF_ROLE_ARNS: "arn:aws-cn:iam::123456789012:role/rolust-crud-exec" })).toEqual([
      { accountId: "123456789012", roleName: "rolust-crud-exec" },
    ]);
  });

  it("未設定なら、変数名を示して落ちる", () => {
    expect(() => loadSelfRoleArns({})).toThrow(ConfigurationError);
    expect(() => loadSelfRoleArns({})).toThrow(/ROLUST_SELF_ROLE_ARNS/);
  });

  it("空文字・区切りだけは未設定と同じく落とす（1 件以上を要求する）", () => {
    expect(() => loadSelfRoleArns({ ROLUST_SELF_ROLE_ARNS: "   " })).toThrow(ConfigurationError);
    expect(() => loadSelfRoleArns({ ROLUST_SELF_ROLE_ARNS: ",,," })).toThrow(ConfigurationError);
  });

  it.each([
    "rolust-crud-exec",
    "arn:aws:iam::12345678901:role/rolust-crud-exec",
    "arn:aws:iam::123456789012:user/someone",
    "arn:aws:iam::123456789012:role/",
    "arn:aws:iam::123456789012:role/*",
  ])("IAM ロールの ARN でない値「%s」は落とす", (value) => {
    expect(() => loadSelfRoleArns({ ROLUST_SELF_ROLE_ARNS: value })).toThrow(ConfigurationError);
  });

  it("loadConfig は、この変数が無くても落ちない（登録以外の経路を止めない）", () => {
    expect(() => loadConfig(complete)).not.toThrow();
  });
});

describe("ROLUST_POOL_ID（Issue #108）", () => {
  it("固定プールの識別子を読む（前後の空白は除く）", () => {
    expect(loadConfig({ ...complete, ROLUST_POOL_ID: "  jump-account  " }).poolId).toBe("jump-account");
  });

  it("未設定なら起動時に落とす", () => {
    const rest = { ...complete };
    delete rest.ROLUST_POOL_ID;
    expect(() => loadConfig(rest)).toThrow(/ROLUST_POOL_ID/);
  });

  it.each(["", "   ", "a b", "プール", "a".repeat(65)])("書式違反（%j）は落とす", (value) => {
    expect(() => loadConfig({ ...complete, ROLUST_POOL_ID: value })).toThrow(ConfigurationError);
  });
});

describe("ROLUST_AUTH_MODE（Issue #141）", () => {
  it.each(["basic", "cognito"] as const)("%s を読む", (mode) => {
    expect(loadAuthMode({ ROLUST_AUTH_MODE: mode })).toBe(mode);
  });

  it.each([undefined, "", "   ", "Basic", "none", "oidc"])(
    "未設定・不正（%j）は落とす。全権限にも拒否にも倒さず、設定不備として止める",
    (value) => {
      const env: NodeJS.ProcessEnv = value === undefined ? {} : { ROLUST_AUTH_MODE: value };
      expect(() => loadAuthMode(env)).toThrow(ConfigurationError);
    },
  );
});
