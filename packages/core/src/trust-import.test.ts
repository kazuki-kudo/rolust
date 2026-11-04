import { describe, expect, it } from "vitest";

import { buildPlaceholderStatement } from "./placeholder.js";
import { importableUserArns } from "./trust-import.js";
import type { TrustPolicyDocument, TrustPolicyStatement } from "./trust-policy.js";

const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const DANA = "arn:aws:iam::444455556666:user/dana.okafor";

function doc(...statements: TrustPolicyStatement[]): TrustPolicyDocument {
  return { Version: "2012-10-17", Statement: statements };
}

function allow(principal: TrustPolicyStatement["Principal"], extra: Partial<TrustPolicyStatement> = {}): TrustPolicyStatement {
  return { Effect: "Allow", Principal: principal, Action: "sts:AssumeRole", ...extra };
}

describe("importableUserArns（Issue #80。紐づけ時に信頼ポリシーから取り込む IAM ユーザ）", () => {
  it("Allow の IAM ユーザを、重複なし・昇順で返す（文字列でも配列でも、複数の Statement にまたがっても）", () => {
    const policy = doc(
      allow({ AWS: [KENJI, AYAKA] }),
      allow({ AWS: AYAKA }),
    );

    expect(importableUserArns(policy)).toEqual([AYAKA, KENJI]);
  });

  it("別アカウントの IAM ユーザも取り込む（FR-1.4）", () => {
    expect(importableUserArns(doc(allow({ AWS: [DANA, AYAKA] })))).toEqual([AYAKA, DANA]);
  });

  it("Deny の principal は取り込まない（信頼されていない）", () => {
    const policy = doc(
      allow({ AWS: AYAKA }),
      { Effect: "Deny", Principal: { AWS: KENJI }, Action: "sts:AssumeRole" },
    );

    expect(importableUserArns(policy)).toEqual([AYAKA]);
  });

  it("パス付きのユーザ・aws 以外の partition・削除済みユーザの一意 ID・ロール・root・裸のアカウント ID・サービス・ワイルドカードは取り込まない", () => {
    const policy = doc(
      allow({
        AWS: [
          "arn:aws:iam::111122223333:user/team/ayaka.mori",
          "arn:aws-cn:iam::111122223333:user/ayaka.mori",
          "AIDAEXAMPLEUNIQUEID",
          "arn:aws:iam::111122223333:role/DeployProd",
          "arn:aws:iam::111122223333:root",
          "111122223333",
        ],
        Service: "ec2.amazonaws.com",
      }),
      allow("*"),
    );

    expect(importableUserArns(policy)).toEqual([]);
  });

  it("Condition 付きの Allow の IAM ユーザも取り込む（マージの『既に存在する』と同じ定義。D-6）", () => {
    const policy = doc(
      allow({ AWS: AYAKA }, { Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" } } }),
    );

    expect(importableUserArns(policy)).toEqual([AYAKA]);
  });

  it("プレースホルダ Statement（root だけ）からは何も取り込まない", () => {
    expect(importableUserArns(doc(buildPlaceholderStatement("111122223333")))).toEqual([]);
  });

  it("IAM の名前に使える記号を含むユーザ名を取り込む", () => {
    const user = "arn:aws:iam::111122223333:user/test1@example.com";
    expect(importableUserArns(doc(allow({ AWS: user })))).toEqual([user]);
  });

  it("Statement が無い文書・Principal の無い Statement は空", () => {
    expect(importableUserArns(doc())).toEqual([]);
    expect(importableUserArns(doc({ Effect: "Allow", Action: "sts:AssumeRole" }))).toEqual([]);
  });
});
