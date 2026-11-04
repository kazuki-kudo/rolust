import { describe, expect, it } from "vitest";

import type { TrustPolicyDocument } from "./trust-policy.js";
import { findUnmanagedPrincipals } from "./unmanaged.js";

const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
const EXTERNAL_ROOT = "arn:aws:iam::999900001111:root";

const POLICY: TrustPolicyDocument = {
  Version: "2012-10-17",
  Statement: [
    {
      Sid: "RolustManagedPrincipals",
      Effect: "Allow",
      Principal: { AWS: [AYAKA, KENJI] },
      Action: "sts:AssumeRole",
    },
    {
      Sid: "ExternalAndService",
      Effect: "Allow",
      Principal: { AWS: EXTERNAL_ROOT, Service: "ec2.amazonaws.com" },
      Action: "sts:AssumeRole",
      Condition: { StringEquals: { "sts:ExternalId": "abc" } },
    },
  ],
};

describe("管理外 principal の検出（FR-4.2）", () => {
  it("FR-4.2: 外部アカウント root とサービスプリンシパルが管理外として検出される", () => {
    const unmanaged = findUnmanagedPrincipals(POLICY, [AYAKA, KENJI]);

    expect(unmanaged.map((principal) => principal.value)).toEqual([
      EXTERNAL_ROOT,
      "ec2.amazonaws.com",
    ]);
    expect(unmanaged.map((principal) => principal.kind)).toEqual(["AWS", "Service"]);
  });

  it("基準集合が引数であること: 同じ文書でも基準集合が変われば結果が変わる（Q5=A の要）", () => {
    // 警告表示の経路 — 基準集合は反映時点の全 IamUser
    const forWarning = findUnmanagedPrincipals(POLICY, [AYAKA, KENJI]);
    // 反映処理の経路 — 基準集合は凍結入力（ここでは ayaka のみ）
    const forApply = findUnmanagedPrincipals(POLICY, [AYAKA]);

    expect(forWarning.map((principal) => principal.value)).not.toContain(KENJI);
    expect(forApply.map((principal) => principal.value)).toContain(KENJI);
  });

  it("エッジケース: 裸のアカウント ID の principal を root ARN として突き合わせる", () => {
    const policy: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: "999900001111" },
          Action: "sts:AssumeRole",
        },
      ],
    };

    expect(findUnmanagedPrincipals(policy, [EXTERNAL_ROOT])).toEqual([]);
    expect(findUnmanagedPrincipals(policy, [])[0]?.value).toBe(EXTERNAL_ROOT);
  });

  it("エッジケース: Principal: \"*\" を管理外として報告する（最も危険な状態を見逃さない）", () => {
    const policy: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: "*", Action: "sts:AssumeRole" }],
    };

    const unmanaged = findUnmanagedPrincipals(policy, [AYAKA]);

    expect(unmanaged).toHaveLength(1);
    expect(unmanaged[0]?.kind).toBe("Wildcard");
    expect(unmanaged[0]?.value).toBe("*");
  });

  it("Issue #16: Sid が RolustPlaceholder の Statement は Rolust 自身のものであり、管理外に数えない", () => {
    const policy: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RolustPlaceholder",
          Effect: "Allow",
          Principal: { AWS: "arn:aws:iam::555566667777:root" },
          Action: "sts:AssumeRole",
          Condition: { DateLessThan: { "aws:CurrentTime": "1970-01-01T00:00:00Z" } },
        },
        {
          Sid: "ExternalPartner",
          Effect: "Allow",
          Principal: { AWS: EXTERNAL_ROOT },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const unmanaged = findUnmanagedPrincipals(policy, [AYAKA]);

    // プレースホルダの root は警告に出さない。外部アカウントの root は従来どおり出す。
    expect(unmanaged.map((principal) => principal.value)).toEqual([EXTERNAL_ROOT]);
  });

  it("エッジケース: Statement が 0 件なら管理外 principal も 0 件", () => {
    expect(
      findUnmanagedPrincipals({ Version: "2012-10-17", Statement: [] }, [AYAKA]),
    ).toEqual([]);
  });
});
