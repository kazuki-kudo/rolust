import { describe, expect, it } from "vitest";

import { TrustPolicyParseError } from "./errors.js";
import { localized } from "./messages/index.js";
import { parseTrustPolicy, serializeTrustPolicy } from "./trust-policy.js";

const DOCUMENT = {
  Version: "2012-10-17",
  Statement: [
    {
      Effect: "Allow",
      Principal: { AWS: "arn:aws:iam::111122223333:user/ayaka.mori" },
      Action: "sts:AssumeRole",
    },
  ],
};

describe("信頼ポリシーのパースと直列化", () => {
  it("iam:GetRole が返す URL エンコード済み JSON をパースできる", () => {
    const encoded = encodeURIComponent(JSON.stringify(DOCUMENT));

    expect(parseTrustPolicy(encoded)).toEqual(DOCUMENT);
  });

  it("デコード済みの JSON もそのままパースできる（SDK の挙動差を吸収する）", () => {
    expect(parseTrustPolicy(JSON.stringify(DOCUMENT))).toEqual(DOCUMENT);
  });

  it("Statement の単体オブジェクトを配列へ正規化する（IAM が許す表記）", () => {
    const single = JSON.stringify({
      Version: "2012-10-17",
      Statement: DOCUMENT.Statement[0],
    });

    expect(parseTrustPolicy(single).Statement).toHaveLength(1);
  });

  it("エッジケース: 空文字列を握り潰さず TrustPolicyParseError にする", () => {
    expect(() => parseTrustPolicy("")).toThrow(TrustPolicyParseError);
    expect(() => parseTrustPolicy("   ")).toThrow(TrustPolicyParseError);
  });

  it("エッジケース: JSON として壊れた文書を TrustPolicyParseError にする", () => {
    expect(() => parseTrustPolicy("{ not json")).toThrow(TrustPolicyParseError);
  });

  it("エッジケース: Effect が Allow / Deny のいずれでもない Statement を拒否する", () => {
    const broken = JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Maybe", Principal: { AWS: "*" }, Action: "sts:AssumeRole" }],
    });

    expect(() => parseTrustPolicy(broken)).toThrow(/Effect/);
  });

  it("直列化した結果を再度パースすると同じ文書になる", () => {
    const parsed = parseTrustPolicy(encodeURIComponent(JSON.stringify(DOCUMENT)));

    expect(parseTrustPolicy(serializeTrustPolicy(parsed))).toEqual(parsed);
  });
});

describe("localized（Issue #94）", () => {
  function caught(raw: string): TrustPolicyParseError {
    try {
      parseTrustPolicy(raw);
    } catch (error) {
      expect(error).toBeInstanceOf(TrustPolicyParseError);
      return error as TrustPolicyParseError;
    }
    throw new Error("例外を期待したが投げられなかった");
  }

  it.each<[string, string, Record<string, unknown>, string]>([
    ["  ", "policy.empty", {}, "信頼ポリシー文書が空です"],
    ["{", "policy.notJson", {}, "信頼ポリシー文書を JSON として解釈できません"],
    ["%E0%A4%A", "policy.urlDecodeFailed", {}, "信頼ポリシー文書を URL デコードできません"],
    ["[]", "policy.notObject", {}, "信頼ポリシー文書がオブジェクトではありません"],
    ['{"Statement":[1]}', "policy.statementNotObject", { index: 0 }, "Statement[0] がオブジェクトではありません"],
    [
      '{"Statement":[{"Effect":"Allow"},{"Effect":"x"}]}',
      "policy.badEffect",
      { index: 1 },
      "Statement[1].Effect が Allow / Deny のいずれでもありません",
    ],
  ])("%j → %s", (raw, id, params, message) => {
    const error = caught(raw);
    expect(error.localized).toEqual({ id, params });
    expect(error.message).toBe(message);
  });

  it("文言を localized に替えても cause を保つ", () => {
    expect(caught("{").cause).toBeInstanceOf(SyntaxError);
    expect(caught("{").localized).toEqual(localized("policy.notJson", {}));
  });
});
