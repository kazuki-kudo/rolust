import { describe, expect, it } from "vitest";

import { computeTrustPolicyDiff } from "./diff.js";
import { ValidationError } from "./errors.js";
import type { TrustPolicyDocument } from "./trust-policy.js";

const ROLE_ARN = "arn:aws:iam::555566667777:role/DeployProd";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const TOMAS = "arn:aws:iam::444455556666:user/tomas.ruiz";
const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";

function policyWith(principals: string[]): TrustPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "Existing",
        Effect: "Allow",
        Principal: { AWS: principals },
        Action: "sts:AssumeRole",
      },
    ],
  };
}

describe("差分算出（FR-4.1）", () => {
  it("FR-4.1: 追加される principal と削除される principal が ARN 単位で列挙される", () => {
    const diff = computeTrustPolicyDiff(policyWith([TOMAS]), {
      roleArn: ROLE_ARN,
      addUserArns: [AYAKA],
      removeUserArns: [TOMAS],
    });

    expect(diff.added).toEqual([AYAKA]);
    expect(diff.removed).toEqual([TOMAS]);
    expect(diff.changed).toBe(true);
  });

  it("エッジケース: 既に存在する principal は「追加される」に数えない", () => {
    const diff = computeTrustPolicyDiff(policyWith([AYAKA]), {
      roleArn: ROLE_ARN,
      addUserArns: [AYAKA],
      removeUserArns: [],
    });

    expect(diff.added).toEqual([]);
    expect(diff.alreadyPresent).toEqual([AYAKA]);
    expect(diff.changed).toBe(false);
  });

  it("エッジケース: 存在しない principal は「削除される」に数えない", () => {
    const diff = computeTrustPolicyDiff(policyWith([AYAKA]), {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [KENJI],
    });

    expect(diff.removed).toEqual([]);
    expect(diff.alreadyAbsent).toEqual([KENJI]);
    expect(diff.changed).toBe(false);
  });

  it("エッジケース: Deny 側にしか現れない principal は「存在する」と扱わない", () => {
    const denyOnly: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "Blocked",
          Effect: "Deny",
          Principal: { AWS: [KENJI] },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const diff = computeTrustPolicyDiff(denyOnly, {
      roleArn: ROLE_ARN,
      addUserArns: [KENJI],
      removeUserArns: [],
    });

    expect(diff.added).toEqual([KENJI]);
  });

  it("削除される principal は凍結入力の順に並ぶ（文書中の出現順ではない）", () => {
    const diff = computeTrustPolicyDiff(policyWith([KENJI, TOMAS]), {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [TOMAS, KENJI],
    });

    expect(diff.removed).toEqual([TOMAS, KENJI]);
  });

  it("エッジケース: 追加と削除に同じ principal を含む壊れた凍結入力を fail fast する", () => {
    expect(() =>
      computeTrustPolicyDiff(policyWith([]), {
        roleArn: ROLE_ARN,
        addUserArns: [AYAKA],
        removeUserArns: [AYAKA],
      }),
    ).toThrow(ValidationError);
  });
});

/**
 * プレースホルダの削除・挿入を差分として示す（Issue #16）。
 *
 * どちらも反映（`mergeTrustPolicy`）が決めることであり、差分はその結果と一致しなければ
 * ならない。挿入は「Statement が 0 件になるか」で決まるため、マージしてみないと分からない。
 */
describe("差分算出 — プレースホルダの削除・挿入（Issue #16）", () => {
  const placeholderOnly: TrustPolicyDocument = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "RolustPlaceholder",
        Effect: "Allow",
        Principal: { AWS: "arn:aws:iam::555566667777:root" },
        Action: "sts:AssumeRole",
        Condition: { DateLessThan: { "aws:CurrentTime": "1970-01-01T00:00:00Z" } },
      },
    ],
  };

  it("プレースホルダのあるロールに追加すると、プレースホルダの削除を示す", () => {
    const diff = computeTrustPolicyDiff(placeholderOnly, {
      roleArn: ROLE_ARN,
      addUserArns: [AYAKA],
      removeUserArns: [],
    });

    expect(diff.added).toEqual([AYAKA]);
    expect(diff.placeholderRemoved).toBe(true);
    expect(diff.placeholderInjected).toBe(false);
  });

  it("最後の管理下 principal を削除すると、プレースホルダの挿入を示す", () => {
    const diff = computeTrustPolicyDiff(policyWith([TOMAS]), {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [TOMAS],
    });

    expect(diff.removed).toEqual([TOMAS]);
    expect(diff.placeholderInjected).toBe(true);
    expect(diff.placeholderRemoved).toBe(false);
  });

  it("プレースホルダが関わらない差分では、どちらも示さない", () => {
    const diff = computeTrustPolicyDiff(policyWith([TOMAS]), {
      roleArn: ROLE_ARN,
      addUserArns: [AYAKA],
      removeUserArns: [TOMAS],
    });

    expect(diff.placeholderRemoved).toBe(false);
    expect(diff.placeholderInjected).toBe(false);
  });
});
