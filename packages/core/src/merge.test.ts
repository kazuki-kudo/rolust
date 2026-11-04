import { describe, expect, it } from "vitest";

import { recordApplyOutcome } from "./change-request.js";
import { assertFrozenInput, mergeTrustPolicy } from "./merge.js";
import { allowedAwsPrincipalSet } from "./principals.js";
import { ValidationError } from "./errors.js";
import { localized } from "./messages/index.js";
import type { TrustPolicyDocument, TrustPolicyStatement } from "./trust-policy.js";
import type { ChangeRequest } from "./types.js";

const ROLE_ARN = "arn:aws:iam::555566667777:role/DeployProd";
const A = "arn:aws:iam::111122223333:user/ayaka.mori";
const B = "arn:aws:iam::111122223333:user/kenji.sato";
const C = "arn:aws:iam::444455556666:user/dana.okafor";
const X = "arn:aws:iam::999900001111:root";

function draft(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    changeRequestId: "cr-0001",
    poolId: "platform-team",
    roleArn: ROLE_ARN,
    addUserArns: [],
    removeUserArns: [],
    status: "draft",
    createdAt: "2026-07-31T10:04:00.000Z",
    createdBy: null,
    appliedAt: null,
    appliedBy: null,
    result: null,
    ...overrides,
  };
}

describe("保全方式マージ — FR-5.1 の受け入れ基準（Given/When/Then）", () => {
  /**
   * Given  対象 IAM ロールの信頼ポリシーに、Rolust 未登録の principal X が含まれている
   *   And  当該ロールの下書き ChangeRequest には、追加ユーザとして A のみが凍結されている
   * When   管理者が当該 ChangeRequest の反映を指示する
   * Then   更新後の信頼ポリシーには A と X の両方が含まれる
   *   And  X に関する記述（Condition を含む Statement 全体）は更新前と等価である
   *   And  当該 ChangeRequest の状態が「反映済み」になり、反映時刻が記録される
   */
  it("シナリオ 1: 管理外 principal X を保全したまま A を追加する", () => {
    const statementOfX = {
      Sid: "ExternalPartner",
      Effect: "Allow" as const,
      Principal: { AWS: X },
      Action: "sts:AssumeRole",
      Condition: { StringEquals: { "sts:ExternalId": "partner-2026" } },
    };
    const current: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [statementOfX],
    };
    const changeRequest = draft({ addUserArns: [A] });

    const result = mergeTrustPolicy(current, {
      roleArn: ROLE_ARN,
      addUserArns: changeRequest.addUserArns,
      removeUserArns: changeRequest.removeUserArns,
    });

    // Then 更新後の信頼ポリシーには A と X の両方が含まれる
    const principals = allowedAwsPrincipalSet(result.document);
    expect(principals.has(A)).toBe(true);
    expect(principals.has(X)).toBe(true);

    // And X に関する記述（Condition を含む Statement 全体）は更新前と等価である
    expect(result.document.Statement[0]).toEqual(statementOfX);
    expect(result.preserved.map((principal) => principal.value)).toContain(X);

    // And 当該 ChangeRequest の状態が「反映済み」になり、反映時刻が記録される
    const applied = recordApplyOutcome(
      changeRequest,
      { ok: true, message: "信頼ポリシーを更新しました", errorCode: null },
      "2026-07-31T10:07:00.000Z",
      null,
    );
    expect(applied.status).toBe("applied");
    expect(applied.appliedAt).toBe("2026-07-31T10:07:00.000Z");
  });

  /**
   * Given  対象 IAM ロールの信頼ポリシーにユーザ B が含まれている
   *   And  当該ロールの下書き ChangeRequest には、削除ユーザとして B が凍結されている（B は Rolust 管理下）
   * When   管理者が当該 ChangeRequest の反映を指示する
   * Then   更新後の信頼ポリシーから B が削除されている
   */
  it("シナリオ 2: 凍結入力で削除指定された B が信頼ポリシーから消える", () => {
    const current: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RolustManagedPrincipals",
          Effect: "Allow",
          Principal: { AWS: [A, B] },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const result = mergeTrustPolicy(current, {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [B],
    });

    expect(allowedAwsPrincipalSet(result.document).has(B)).toBe(false);
    expect(allowedAwsPrincipalSet(result.document).has(A)).toBe(true);
    expect(result.removed).toEqual([B]);
  });

  /**
   * Given  下書き ChangeRequest の作成後に、管理者が同じ IamRole のマトリクスでユーザ C をチェックした
   *   And  当該 ChangeRequest には C が含まれていない
   * When   管理者が当該 ChangeRequest の反映を指示する
   * Then   更新後の信頼ポリシーに C は含まれない
   *   And  ChangeRequest の記録内容と実際に反映された内容が一致する
   */
  it("シナリオ 3: 凍結後にチェックされた C は反映されない（FR-5.2）", () => {
    const current: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [],
    };
    const changeRequest = draft({ addUserArns: [A] });

    // 凍結後にマトリクスで C をチェックした ＝ Assignment は変わったが凍結入力は不変
    const result = mergeTrustPolicy(current, {
      roleArn: changeRequest.roleArn,
      addUserArns: changeRequest.addUserArns,
      removeUserArns: changeRequest.removeUserArns,
    });

    expect(allowedAwsPrincipalSet(result.document).has(C)).toBe(false);
    // ChangeRequest の記録内容（addUserArns）と実際に反映された内容（added）が一致する
    expect(result.added).toEqual(changeRequest.addUserArns);
  });
});

describe("保全方式マージ — Q5=A（凍結入力を優先する）", () => {
  it("削除済み IamUser の ARN でも、凍結入力に含まれていれば追加/削除される", () => {
    // B は申請作成後に UserPool から削除された（Q4=B の連鎖削除）。
    // 現在の IamUser 集合に B はいないが、凍結入力が名指ししている以上そのとおり適用する。
    const current: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RolustManagedPrincipals",
          Effect: "Allow",
          Principal: { AWS: [B] },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const result = mergeTrustPolicy(current, {
      roleArn: ROLE_ARN,
      addUserArns: [C],
      removeUserArns: [B],
    });

    expect(result.removed).toEqual([B]);
    expect(result.added).toEqual([C]);
    expect(allowedAwsPrincipalSet(result.document).has(B)).toBe(false);
    expect(allowedAwsPrincipalSet(result.document).has(C)).toBe(true);
  });

  it("保全の基準集合は凍結入力である — 凍結入力に現れない principal は全件 preserved に載る", () => {
    const current: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { AWS: [A, B, X], Service: "ec2.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const result = mergeTrustPolicy(current, {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [B],
    });

    const preserved = result.preserved.map((principal) => principal.value);
    expect(preserved).toContain(A);
    expect(preserved).toContain(X);
    expect(preserved).toContain("ec2.amazonaws.com");
    expect(preserved).not.toContain(B);
  });
});

describe("保全方式マージ — エッジケース", () => {
  it("Deny Statement の principal は削除対象でも取り除かない（拒否の解除を起こさない）", () => {
    const denyStatement = {
      Sid: "AlwaysDeny",
      Effect: "Deny" as const,
      Principal: { AWS: [B] },
      Action: "sts:AssumeRole",
    };
    const current: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [denyStatement],
    };

    const result = mergeTrustPolicy(current, {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [B],
    });

    expect(result.document.Statement[0]).toEqual(denyStatement);
    expect(result.removed).toEqual([]);
    expect(result.changed).toBe(false);
  });

  it("Condition つき Statement に相乗りせず、専用 Statement を新設して追加する", () => {
    const conditional = {
      Sid: "MfaOnly",
      Effect: "Allow" as const,
      Principal: { AWS: [X] },
      Action: "sts:AssumeRole",
      Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" } },
    };
    const current: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [conditional],
    };

    const result = mergeTrustPolicy(current, {
      roleArn: ROLE_ARN,
      addUserArns: [A],
      removeUserArns: [],
    });

    expect(result.document.Statement[0]).toEqual(conditional);
    expect(result.document.Statement).toHaveLength(2);
    expect(result.document.Statement[1]?.Sid).toBe("RolustManagedPrincipals");
  });

  it("削除により principal が空になった Statement は落とす（MalformedPolicyDocument を作らない）", () => {
    const current: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "OnlyB",
          Effect: "Allow",
          Principal: { AWS: B },
          Action: "sts:AssumeRole",
        },
        {
          Sid: "Service",
          Effect: "Allow",
          Principal: { Service: "ec2.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const result = mergeTrustPolicy(current, {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [B],
    });

    expect(result.document.Statement).toHaveLength(1);
    expect(result.document.Statement[0]?.Sid).toBe("Service");
  });

  it("既に存在する principal は二重に追加せず、文書も変化しない", () => {
    const current: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RolustManagedPrincipals",
          Effect: "Allow",
          Principal: { AWS: [A] },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const result = mergeTrustPolicy(current, {
      roleArn: ROLE_ARN,
      addUserArns: [A],
      removeUserArns: [],
    });

    expect(result.added).toEqual([]);
    expect(result.alreadyPresent).toEqual([A]);
    expect(result.changed).toBe(false);
    expect(result.document).toEqual(current);
  });

  it("入力の文書を破壊しない（マージは常にコピーに対して行う）", () => {
    const current: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RolustManagedPrincipals",
          Effect: "Allow",
          Principal: { AWS: [B] },
          Action: "sts:AssumeRole",
        },
      ],
    };
    const snapshot = structuredClone(current);

    mergeTrustPolicy(current, { roleArn: ROLE_ARN, addUserArns: [A], removeUserArns: [B] });

    expect(current).toEqual(snapshot);
  });
});

/**
 * 規則 5 — IAM の信頼ポリシーは「空」を表現できない。
 *
 * `Statement: []` は `MalformedPolicyDocument` で拒否されるため、マージ結果が
 * 空になる経路をそのまま `iam:UpdateAssumeRolePolicy` へ渡すと反映が失敗する。
 * 到達条件は「管理下の principal だけで構成されたロールから最後の 1 件を削除する」で、
 * これは Rolust が完全に管理しているロールそのものである。
 */
/**
 * IAM はポリシー内の `Sid` の一意性を要求する。採用できない形の `RolustManagedPrincipals` が
 * 手で書かれていると、2 つ目を作った文書は `MalformedPolicyDocument` で拒否され、そのロールは
 * 人が信頼ポリシーを直すまで反映できなくなる。原因は AWS のエラー文からは読み取れない。
 * 重複を作らず、読める理由で拒否する（規則 3 の補足。Issue #194）。
 */
describe("保全方式マージ — 同じ Sid を重複させない（規則 3 の補足。Issue #194）", () => {
  const ROLUST_SID = "RolustManagedPrincipals";

  function mergeWith(statement: TrustPolicyStatement): () => unknown {
    return () =>
      mergeTrustPolicy(
        { Version: "2012-10-17", Statement: [statement] },
        { roleArn: ROLE_ARN, addUserArns: [A], removeUserArns: [] },
      );
  }

  it("Condition つきの同名 Sid があるときは、2 つ目を作らず拒否する", () => {
    expect(mergeWith({
      Sid: ROLUST_SID,
      Effect: "Allow",
      Principal: { AWS: [X] },
      Action: "sts:AssumeRole",
      Condition: { Bool: { "aws:MultiFactorAuthPresent": "true" } },
    })).toThrow(ValidationError);
  });

  it("Deny の同名 Sid があるときも拒否する", () => {
    expect(mergeWith({
      Sid: ROLUST_SID,
      Effect: "Deny",
      Principal: { AWS: [X] },
      Action: "sts:AssumeRole",
    })).toThrow(ValidationError);
  });

  it("sts:AssumeRole を許さない同名 Sid があるときも拒否する", () => {
    expect(mergeWith({
      Sid: ROLUST_SID,
      Effect: "Allow",
      Principal: { AWS: [X] },
      Action: "sts:TagSession",
    })).toThrow(ValidationError);
  });

  it("拒否の理由は Sid を含み、何が起きているかを示す", () => {
    let caught: unknown;
    try {
      mergeWith({ Sid: ROLUST_SID, Effect: "Deny", Principal: { AWS: [X] }, Action: "sts:AssumeRole" })();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ValidationError);
    expect((caught as ValidationError).localized).toEqual(localized("merge.sidConflict", { sid: ROLUST_SID }));
  });

  it("採用できる形（Allow・Condition なし・AssumeRole）なら、従来どおり相乗りする", () => {
    const result = mergeTrustPolicy(
      {
        Version: "2012-10-17",
        Statement: [{ Sid: ROLUST_SID, Effect: "Allow", Principal: { AWS: [B] }, Action: "sts:AssumeRole" }],
      },
      { roleArn: ROLE_ARN, addUserArns: [A], removeUserArns: [] },
    );

    expect(result.document.Statement).toHaveLength(1);
    expect(result.document.Statement[0]?.Principal).toEqual({ AWS: [B, A] });
  });
});

describe("保全方式マージ — 空の信頼ポリシーを作らない（規則 5）", () => {
  const onlyManaged: TrustPolicyDocument = {
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "RolustManagedPrincipals",
        Effect: "Allow",
        Principal: { AWS: [B] },
        Action: "sts:AssumeRole",
      },
    ],
  };

  it("最後の管理下 principal を削除しても Statement が 0 件にならない", () => {
    const result = mergeTrustPolicy(onlyManaged, {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [B],
    });

    expect(result.removed).toEqual([B]);
    expect(allowedAwsPrincipalSet(result.document).has(B)).toBe(false);
    // IAM が受け付ける最小の形（Statement 1 件以上）を保つ
    expect(result.document.Statement.length).toBeGreaterThan(0);
    expect(result.placeholderInjected).toBe(true);
  });

  it("注入するプレースホルダは Allow + 恒久的に偽の条件であり、誰も引き受けられない", () => {
    const result = mergeTrustPolicy(onlyManaged, {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [B],
    });

    const placeholder = result.document.Statement.find(
      (statement) => statement.Sid === "RolustPlaceholder",
    );

    expect(placeholder).toBeDefined();
    // Deny にしてはならない — 明示的 Deny は後から追加する Allow に勝ち、
    // ロールが恒久的に引き受け不能になる。
    expect(placeholder?.Effect).toBe("Allow");
    expect(placeholder?.Condition).toEqual({
      DateLessThan: { "aws:CurrentTime": "1970-01-01T00:00:00Z" },
    });
    // principal は実在が保証されるアカウント root（対象ロールと同じアカウント）
    expect(placeholder?.Principal).toEqual({ AWS: "arn:aws:iam::555566667777:root" });
  });

  it("管理外 principal が残る場合はプレースホルダを注入しない", () => {
    const withUnmanaged: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RolustManagedPrincipals",
          Effect: "Allow",
          Principal: { AWS: [B] },
          Action: "sts:AssumeRole",
        },
        {
          Sid: "ExternalPartner",
          Effect: "Allow",
          Principal: { AWS: X },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const result = mergeTrustPolicy(withUnmanaged, {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [B],
    });

    expect(result.placeholderInjected).toBe(false);
    expect(
      result.document.Statement.some((statement) => statement.Sid === "RolustPlaceholder"),
    ).toBe(false);
    expect(allowedAwsPrincipalSet(result.document).has(X)).toBe(true);
  });

  it("追加がある限りプレースホルダは注入されない", () => {
    const result = mergeTrustPolicy(onlyManaged, {
      roleArn: ROLE_ARN,
      addUserArns: [A],
      removeUserArns: [B],
    });

    expect(result.placeholderInjected).toBe(false);
    expect(allowedAwsPrincipalSet(result.document).has(A)).toBe(true);
  });

  it("注入したプレースホルダは保全した principal（preserved）に数えない", () => {
    const result = mergeTrustPolicy(onlyManaged, {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [B],
    });

    expect(result.placeholderInjected).toBe(true);
    expect(result.preserved).toEqual([]);
  });
});

/**
 * 規則 6 — プレースホルダは追加の時点で取り除く（Issue #16）。
 *
 * プレースホルダは「Rolust 管理下の principal が 1 件も無い」ことを表す。追加が 1 件でも
 * 反映されればその状態は終わるため、残しておくと Rolust 管理下の Statement と並び、
 * プレースホルダの root が差分画面で管理外 principal として警告され続ける。
 */
describe("保全方式マージ — プレースホルダを追加時に取り除く（規則 6）", () => {
  const PLACEHOLDER: TrustPolicyStatement = {
    Sid: "RolustPlaceholder",
    Effect: "Allow",
    Principal: { AWS: "arn:aws:iam::555566667777:root" },
    Action: "sts:AssumeRole",
    Condition: { DateLessThan: { "aws:CurrentTime": "1970-01-01T00:00:00Z" } },
  };

  const placeholderOnly: TrustPolicyDocument = {
    Version: "2012-10-17",
    Statement: [structuredClone(PLACEHOLDER)],
  };

  it("プレースホルダだけのロールに追加すると、プレースホルダが消え Rolust 専用 Statement だけになる", () => {
    const result = mergeTrustPolicy(placeholderOnly, {
      roleArn: ROLE_ARN,
      addUserArns: [A],
      removeUserArns: [],
    });

    expect(result.document.Statement).toEqual([
      {
        Sid: "RolustManagedPrincipals",
        Effect: "Allow",
        Principal: { AWS: [A] },
        Action: "sts:AssumeRole",
      },
    ]);
    expect(result.placeholderRemoved).toBe(true);
    expect(result.placeholderInjected).toBe(false);
    expect(result.changed).toBe(true);
  });

  it("削除だけの反映ではプレースホルダを残す", () => {
    const withPlaceholder: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        structuredClone(PLACEHOLDER),
        {
          Sid: "ExternalPartner",
          Effect: "Allow",
          Principal: { AWS: [X, B] },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const result = mergeTrustPolicy(withPlaceholder, {
      roleArn: ROLE_ARN,
      addUserArns: [],
      removeUserArns: [B],
    });

    expect(result.removed).toEqual([B]);
    expect(result.placeholderRemoved).toBe(false);
    expect(result.document.Statement[0]).toEqual(PLACEHOLDER);
  });

  it("追加対象がすべて既に存在する（文書が変化しない）ときはプレースホルダを残す", () => {
    const withPlaceholder: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        structuredClone(PLACEHOLDER),
        {
          Sid: "ExternalPartner",
          Effect: "Allow",
          Principal: { AWS: [A] },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const result = mergeTrustPolicy(withPlaceholder, {
      roleArn: ROLE_ARN,
      addUserArns: [A],
      removeUserArns: [],
    });

    expect(result.alreadyPresent).toEqual([A]);
    expect(result.changed).toBe(false);
    expect(result.placeholderRemoved).toBe(false);
    expect(result.document).toEqual(withPlaceholder);
  });

  it("識別は Sid だけで行う — 中身が手で書き換えられたプレースホルダも取り除く", () => {
    const edited: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RolustPlaceholder",
          Effect: "Allow",
          Principal: { AWS: X, Service: "ec2.amazonaws.com" },
          Action: "sts:AssumeRole",
        },
      ],
    };

    const result = mergeTrustPolicy(edited, {
      roleArn: ROLE_ARN,
      addUserArns: [A],
      removeUserArns: [],
    });

    expect(result.placeholderRemoved).toBe(true);
    expect(result.document.Statement.map((statement) => statement.Sid)).toEqual([
      "RolustManagedPrincipals",
    ]);
  });

  it("管理外の Statement は保全したまま、プレースホルダだけを取り除く", () => {
    const external: TrustPolicyStatement = {
      Sid: "ExternalPartner",
      Effect: "Allow",
      Principal: { AWS: X },
      Action: "sts:AssumeRole",
      Condition: { StringEquals: { "sts:ExternalId": "abc" } },
    };
    const withPlaceholder: TrustPolicyDocument = {
      Version: "2012-10-17",
      Statement: [structuredClone(PLACEHOLDER), structuredClone(external)],
    };

    const result = mergeTrustPolicy(withPlaceholder, {
      roleArn: ROLE_ARN,
      addUserArns: [A],
      removeUserArns: [],
    });

    expect(result.placeholderRemoved).toBe(true);
    expect(result.document.Statement[0]).toEqual(external);
    expect(result.preserved.map((principal) => principal.value)).toEqual([X]);
  });
});

describe("localized（Issue #94）", () => {
  it("凍結入力の追加と削除の衝突は merge.frozenConflict を持つ", () => {
    try {
      assertFrozenInput({ roleArn: ROLE_ARN, addUserArns: [A], removeUserArns: [A] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      const validation = error as ValidationError;
      expect(validation.field).toBe("frozenInput");
      expect(validation.localized).toEqual(localized("merge.frozenConflict", { arn: A }));
      expect(validation.message).toBe(`凍結入力の追加と削除に同じ principal が含まれています: ${A}`);
    }
  });
});
