import { describe, expect, it } from "vitest";

import { adoptChangesOf, computeTrustDrift, hasDrift, restoreInputOf } from "./drift.js";
import { ROLUST_PLACEHOLDER_SID } from "./placeholder.js";
import type { TrustPolicyDocument, TrustPolicyStatement } from "./trust-policy.js";

const ROLE_ARN = "arn:aws:iam::555566667777:role/DeployProd";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const TOMAS = "arn:aws:iam::444455556666:user/tomas.ruiz";
const OUTSIDER = "arn:aws:iam::999900001111:user/outsider";

function doc(...statements: TrustPolicyStatement[]): TrustPolicyDocument {
  return { Version: "2012-10-17", Statement: statements };
}

function allow(principals: string | string[], extra: Partial<TrustPolicyStatement> = {}): TrustPolicyStatement {
  return { Sid: "S1", Effect: "Allow", Principal: { AWS: principals }, Action: "sts:AssumeRole", ...extra };
}

const ALL = [AYAKA, KENJI, TOMAS];

describe("乖離の算出（FR-4.9）", () => {
  it("記録（reflected）と信頼ポリシーが一致すれば、足りない・余分とも空", () => {
    const drift = computeTrustDrift(doc(allow([AYAKA, OUTSIDER])), ROLE_ARN, ALL, [AYAKA]);

    expect(drift.missing).toEqual([]);
    expect(drift.extra).toEqual([]);
  });

  it("reflected なのに信頼ポリシーで許可されていない管理下のユーザは「足りない」", () => {
    const drift = computeTrustDrift(doc(allow(OUTSIDER)), ROLE_ARN, ALL, [AYAKA]);

    expect(drift.missing).toEqual([AYAKA]);
    expect(drift.extra).toEqual([]);
  });

  it("reflected でないのに信頼ポリシーで許可されている管理下のユーザは「余分」", () => {
    const drift = computeTrustDrift(doc(allow(KENJI)), ROLE_ARN, ALL, []);

    expect(drift.missing).toEqual([]);
    expect(drift.extra).toEqual([KENJI]);
  });

  it("足りないと余分が同時に出るとき、どちらも昇順", () => {
    const drift = computeTrustDrift(doc(allow([TOMAS, KENJI])), ROLE_ARN, ALL, [AYAKA]);

    expect(drift.missing).toEqual([AYAKA]);
    expect(drift.extra).toEqual([KENJI, TOMAS]);
  });

  it("管理外の principal（未登録ユーザ・サービス）は乖離に数えず、unmanaged に出す（D-7）", () => {
    const policy = doc(allow(OUTSIDER), {
      Sid: "Svc",
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    });
    const drift = computeTrustDrift(policy, ROLE_ARN, ALL, []);

    expect(drift.missing).toEqual([]);
    expect(drift.extra).toEqual([]);
    expect(drift.unmanaged.map((entry) => entry.value).sort()).toEqual([OUTSIDER, "lambda.amazonaws.com"]);
  });

  it("プレースホルダ Statement は乖離にも管理外にも数えない（D-8）", () => {
    const placeholder: TrustPolicyStatement = {
      Sid: ROLUST_PLACEHOLDER_SID,
      Effect: "Allow",
      Principal: { AWS: "arn:aws:iam::555566667777:root" },
      Action: "sts:AssumeRole",
    };
    const drift = computeTrustDrift(doc(placeholder), ROLE_ARN, ALL, []);

    expect(drift.missing).toEqual([]);
    expect(drift.extra).toEqual([]);
    expect(drift.unmanaged).toEqual([]);
  });

  it("全ユーザの集合に無い reflected の ARN（登録を消した孤児）は、足りないに混ざらない", () => {
    const ghost = "arn:aws:iam::111122223333:user/ghost";
    const drift = computeTrustDrift(doc(allow(OUTSIDER)), ROLE_ARN, ALL, [ghost]);

    expect(drift.missing).toEqual([]);
  });

  it("Deny だけに挙がる principal は、許可されていないので「足りない」", () => {
    const deny = allow(AYAKA, { Effect: "Deny" });
    const drift = computeTrustDrift(doc(deny), ROLE_ARN, ALL, [AYAKA]);

    expect(drift.missing).toEqual([AYAKA]);
  });

  it("条件つきで許可されているユーザも、許可されているので一致", () => {
    const conditional = allow(AYAKA, { Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" } } });
    const drift = computeTrustDrift(doc(conditional), ROLE_ARN, ALL, [AYAKA]);

    expect(drift.missing).toEqual([]);
    expect(drift.extra).toEqual([]);
  });

  it("Principal.AWS が配列でなく文字列でも同じに扱う", () => {
    const drift = computeTrustDrift(doc(allow(AYAKA)), ROLE_ARN, ALL, [AYAKA]);

    expect(drift.missing).toEqual([]);
  });

  it("ユーザが 0 人・reflected が 0 件でも例外を投げず、乖離は空", () => {
    const drift = computeTrustDrift(doc(allow(OUTSIDER)), ROLE_ARN, [], []);

    expect(drift.missing).toEqual([]);
    expect(drift.extra).toEqual([]);
  });

  it("roleArn をそのまま返す", () => {
    expect(computeTrustDrift(doc(allow(AYAKA)), ROLE_ARN, ALL, [AYAKA]).roleArn).toBe(ROLE_ARN);
  });
});

describe("乖離からの操作の入力（Issue #172）", () => {
  const drift = {
    roleArn: "arn:aws:iam::555566667777:role/R",
    missing: ["arn:aws:iam::111122223333:user/b", "arn:aws:iam::111122223333:user/a"],
    extra: ["arn:aws:iam::111122223333:user/c"],
    unmanaged: [{ kind: "Service", value: "lambda.amazonaws.com", statementIndex: 0, sid: null, effect: "Allow" }],
  } as const;

  it("restoreInputOf: 足りない → 追加、余分 → 削除。昇順。管理外は入らない", () => {
    expect(restoreInputOf({ ...drift, missing: [...drift.missing], extra: [...drift.extra], unmanaged: [...drift.unmanaged] })).toEqual({
      roleArn: drift.roleArn,
      addUserArns: ["arn:aws:iam::111122223333:user/a", "arn:aws:iam::111122223333:user/b"],
      removeUserArns: ["arn:aws:iam::111122223333:user/c"],
    });
  });

  it("adoptChangesOf: 余分は checked/reflected を真に、足りないは偽にする。昇順", () => {
    expect(adoptChangesOf({ ...drift, missing: [...drift.missing], extra: [...drift.extra], unmanaged: [...drift.unmanaged] })).toEqual({
      checkedTrue: ["arn:aws:iam::111122223333:user/c"],
      checkedFalse: ["arn:aws:iam::111122223333:user/a", "arn:aws:iam::111122223333:user/b"],
    });
  });

  it("hasDrift: missing か extra があれば真。管理外だけなら偽", () => {
    expect(hasDrift({ missing: [], extra: [] })).toBe(false);
    expect(hasDrift({ missing: ["x"], extra: [] })).toBe(true);
    expect(hasDrift({ missing: [], extra: ["x"] })).toBe(true);
  });
});
