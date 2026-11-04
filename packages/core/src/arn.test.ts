import { describe, expect, it } from "vitest";

import {
  assertAccountId,
  assertIamName,
  buildRoleArn,
  buildUserArn,
  isPathlessUserArn,
  normalizeAwsPrincipal,
  parseRoleArn,
  parseUserArn,
} from "./arn.js";
import { ValidationError } from "./errors.js";
import { localized } from "./messages/index.js";

describe("ARN の導出とパース（FR-1.2 / Data Model 補足）", () => {
  it("FR-1.2: IAM ユーザの ARN が arn:aws:iam::<accountId>:user/<userName> と完全一致する", () => {
    expect(buildUserArn("111122223333", "ayaka.mori")).toBe(
      "arn:aws:iam::111122223333:user/ayaka.mori",
    );
  });

  it("IamRole の ARN が arn:aws:iam::<accountId>:role/<roleName> と完全一致する", () => {
    expect(buildRoleArn("555566667777", "DeployProd")).toBe(
      "arn:aws:iam::555566667777:role/DeployProd",
    );
  });

  it("導出した ARN を元のアカウント ID と名前へ戻せる", () => {
    expect(parseUserArn(buildUserArn("444455556666", "dana.okafor"))).toEqual({
      partition: "aws",
      accountId: "444455556666",
      userName: "dana.okafor",
    });
    expect(parseRoleArn(buildRoleArn("888899990000", "DataPlatformAdmin"))).toEqual({
      partition: "aws",
      accountId: "888899990000",
      roleName: "DataPlatformAdmin",
    });
  });

  it("エッジケース: 12 桁でないアカウント ID を拒否する（AWS へ問い合わせずに境界で弾く / C-4）", () => {
    expect(() => buildUserArn("1234", "ayaka.mori")).toThrow(ValidationError);
    expect(() => buildUserArn("1111222233334", "ayaka.mori")).toThrow(ValidationError);
    expect(() => buildUserArn("11112222333a", "ayaka.mori")).toThrow(
      /12 桁の数字/,
    );
  });

  it("エッジケース: IAM の命名規則に反するユーザ名・ロール名を拒否する", () => {
    expect(() => buildUserArn("111122223333", "ayaka mori")).toThrow(ValidationError);
    expect(() => buildUserArn("111122223333", "")).toThrow(ValidationError);
    expect(() => buildRoleArn("111122223333", "a".repeat(65))).toThrow(ValidationError);
  });

  it("エッジケース: ロール ARN として渡された文字列がユーザ ARN のパースで拒否される", () => {
    expect(() => parseUserArn("arn:aws:iam::111122223333:role/DeployProd")).toThrow(
      ValidationError,
    );
  });

  it("裸のアカウント ID を root ARN へ正規化する（AWS 側の保存形式に揃える）", () => {
    expect(normalizeAwsPrincipal("999900001111")).toBe(
      "arn:aws:iam::999900001111:root",
    );
    expect(normalizeAwsPrincipal("arn:aws:iam::999900001111:root")).toBe(
      "arn:aws:iam::999900001111:root",
    );
    expect(normalizeAwsPrincipal("  ec2.amazonaws.com  ")).toBe("ec2.amazonaws.com");
  });
});

describe("isPathlessUserArn（Issue #80。信頼ポリシーから取り込める IAM ユーザの ARN）", () => {
  it.each([
    ["arn:aws:iam::111122223333:user/ayaka.mori", true],
    // IAM の名前に使える記号（+=,.@_-）を含んでも取り込める。
    ["arn:aws:iam::111122223333:user/test1@example.com", true],
    ["arn:aws:iam::111122223333:user/a+b=c,d.e@f_g-h", true],
    // A-2: パス付きのユーザは IamUser として登録できない。
    ["arn:aws:iam::111122223333:user/team/ayaka.mori", false],
    // aws 以外の partition は対象外。
    ["arn:aws-cn:iam::111122223333:user/ayaka.mori", false],
    ["arn:aws-us-gov:iam::111122223333:user/ayaka.mori", false],
    // アカウント ID は 12 桁の数字。
    ["arn:aws:iam::1111:user/ayaka.mori", false],
    // ユーザ以外。
    ["arn:aws:iam::111122223333:role/DeployProd", false],
    ["arn:aws:iam::111122223333:root", false],
    // 削除された IAM ユーザは、信頼ポリシーに一意 ID（AIDA…）として残る。
    ["AIDAEXAMPLEUNIQUEID", false],
    ["*", false],
    // 名前は 1〜64 文字で、空白などを含まない。
    [`arn:aws:iam::111122223333:user/${"a".repeat(64)}`, true],
    [`arn:aws:iam::111122223333:user/${"a".repeat(65)}`, false],
    ["arn:aws:iam::111122223333:user/", false],
    ["arn:aws:iam::111122223333:user/ayaka mori", false],
  ])("%s → %s", (value, expected) => {
    expect(isPathlessUserArn(value)).toBe(expected);
  });
});

function caught(fn: () => unknown): ValidationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error("例外を期待したが投げられなかった");
}

describe("localized（Issue #94）", () => {
  it("アカウント ID の書式", () => {
    const error = caught(() => assertAccountId("abc"));
    expect(error.localized).toEqual(localized("arn.accountIdFormat", {}));
    expect(error.message).toBe("AWS アカウント ID は 12 桁の数字です");
  });

  it("名前の書式は、生の値を持つ（JSON 化はカタログ）", () => {
    const error = caught(() => assertIamName("bad name", "userName"));
    expect(error.field).toBe("userName");
    expect(error.localized).toEqual(localized("arn.nameFormat", { field: "userName", value: "bad name" }));
    expect(error.message).toBe('userName は英数字と +=,.@_- のみ、1〜64 文字です: "bad name"');
  });

  it("ユーザ ARN・ロール ARN の書式", () => {
    const user = caught(() => parseUserArn("nope"));
    expect(user.field).toBe("arn");
    expect(user.localized).toEqual(localized("arn.notUserArn", { arn: "nope" }));
    expect(user.message).toBe("IAM ユーザの ARN ではありません: nope");
    const role = caught(() => parseRoleArn("nope"));
    expect(role.field).toBe("arn");
    expect(role.localized).toEqual(localized("arn.notRoleArn", { arn: "nope" }));
    expect(role.message).toBe("IAM ロールの ARN ではありません: nope");
  });
});
