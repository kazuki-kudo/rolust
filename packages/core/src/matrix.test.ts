import { describe, expect, it } from "vitest";

import { buildFrozenInput, changedRoleArns, countChangesByRole, isEmptyInput } from "./matrix.js";
import type { Assignment } from "./types.js";

const POOL = "platform-team";
const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AUDIT = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const TOMAS = "arn:aws:iam::444455556666:user/tomas.ruiz";
const LIN = "arn:aws:iam::111122223333:user/lin.zhao";

function assignment(
  userArn: string,
  roleArn: string,
  checked: boolean,
  reflected: boolean,
): Assignment {
  return {
    poolId: POOL,
    userArn,
    roleArn,
    checked,
    reflected,
    updatedAt: "2026-07-31T09:00:00.000Z",
  };
}

describe("マトリクスから凍結入力を組み立てる（FR-4.4 / FR-4.5）", () => {
  const assignments = [
    assignment(AYAKA, DEPLOY, true, false), // 追加される
    assignment(TOMAS, DEPLOY, false, true), // 削除される
    assignment(LIN, DEPLOY, true, true), // 変更なし
    assignment(LIN, AUDIT, true, false), // 別ロールの変更
  ];

  it("チェックと baseline の差から追加/削除リストを導出する", () => {
    expect(buildFrozenInput(DEPLOY, assignments)).toEqual({
      roleArn: DEPLOY,
      addUserArns: [AYAKA],
      removeUserArns: [TOMAS],
    });
  });

  it("列ヘッダの変更件数はロール単位の差分件数である（props ではなく導出値）", () => {
    const counts = countChangesByRole(assignments);

    expect(counts.get(DEPLOY)).toBe(2);
    expect(counts.get(AUDIT)).toBe(1);
    expect(changedRoleArns(assignments).sort()).toEqual([DEPLOY, AUDIT].sort());
  });

  it("エッジケース: 変更のないロールは空の凍結入力になり、申請対象にならない", () => {
    const unchanged = [assignment(LIN, DEPLOY, true, true)];

    const input = buildFrozenInput(DEPLOY, unchanged);

    expect(isEmptyInput(input)).toBe(true);
    expect(countChangesByRole(unchanged).size).toBe(0);
  });

  it("エッジケース: 他ロールの Assignment を凍結入力へ混ぜない", () => {
    expect(buildFrozenInput(AUDIT, assignments)).toEqual({
      roleArn: AUDIT,
      addUserArns: [LIN],
      removeUserArns: [],
    });
  });

  it("エッジケース: Assignment が 0 件でも例外にならず空入力を返す", () => {
    expect(isEmptyInput(buildFrozenInput(DEPLOY, []))).toBe(true);
  });
});
