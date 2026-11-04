import { describe, expect, it } from "vitest";

import {
  assertTransition,
  canTransition,
  discard,
  isDiscardable,
  isUnreflected,
  recordApplyOutcome,
} from "./change-request.js";
import { InvalidStateTransitionError } from "./errors.js";
import { localized } from "./messages/index.js";
import type { ChangeRequest } from "./types.js";

function changeRequest(overrides: Partial<ChangeRequest> = {}): ChangeRequest {
  return {
    changeRequestId: "cr-0142",
    poolId: "platform-team",
    roleArn: "arn:aws:iam::555566667777:role/DeployProd",
    addUserArns: ["arn:aws:iam::111122223333:user/ayaka.mori"],
    removeUserArns: [],
    status: "draft",
    createdAt: "2026-07-30T14:02:00.000Z",
    createdBy: null,
    appliedAt: null,
    appliedBy: null,
    result: null,
    ...overrides,
  };
}

describe("ChangeRequest の状態遷移（FR-5.5 / FR-5.6 / FR-4.8）", () => {
  it("FR-5.5: 反映成功で「反映済み」へ、結果と時刻を保持する", () => {
    const applied = recordApplyOutcome(
      changeRequest(),
      { ok: true, message: "信頼ポリシーを更新しました", errorCode: null },
      "2026-07-31T10:07:00.000Z",
      null,
    );

    expect(applied.status).toBe("applied");
    expect(applied.appliedAt).toBe("2026-07-31T10:07:00.000Z");
    expect(applied.result?.ok).toBe(true);
  });

  it("FR-5.5: 反映失敗で「失敗」へ、AWS のエラーコードを保持する", () => {
    const failed = recordApplyOutcome(
      changeRequest(),
      {
        ok: false,
        message: "iam:UpdateAssumeRolePolicy が拒否されました",
        errorCode: "AccessDenied",
      },
      "2026-07-31T10:07:00.000Z",
      null,
    );

    expect(failed.status).toBe("failed");
    expect(failed.result?.errorCode).toBe("AccessDenied");
  });

  it("FR-5.6: 失敗状態から凍結入力を変えずに再反映でき、成功すれば「反映済み」になる", () => {
    const failed = recordApplyOutcome(
      changeRequest(),
      { ok: false, message: "拒否されました", errorCode: "AccessDenied" },
      "2026-07-31T10:07:00.000Z",
      null,
    );

    const retried = recordApplyOutcome(
      failed,
      { ok: true, message: "信頼ポリシーを更新しました", errorCode: null },
      "2026-07-31T11:00:00.000Z",
      null,
    );

    expect(retried.status).toBe("applied");
    // 凍結入力は再反映を通じて一切変化しない
    expect(retried.addUserArns).toEqual(changeRequest().addUserArns);
    expect(retried.removeUserArns).toEqual(changeRequest().removeUserArns);
  });

  it("反映の成功・失敗のどちらでも、反映者（appliedBy）を記録する（Issue #120）", () => {
    const alice = { name: "alice", sub: "user-1" };
    const applied = recordApplyOutcome(changeRequest(), { ok: true, message: "ok", errorCode: null }, "2026-08-01T00:00:00.000Z", alice);
    const failed = recordApplyOutcome(changeRequest(), { ok: false, message: "ng", errorCode: "AccessDenied" }, "2026-08-01T00:00:00.000Z", alice);

    expect(applied.appliedBy).toEqual(alice);
    expect(failed.appliedBy).toEqual(alice);
  });

  it("再反映は反映者を最新の実行者に更新し、作成者は変えない", () => {
    const creator = { name: "alice" };
    const first = recordApplyOutcome(
      { ...changeRequest(), createdBy: creator },
      { ok: false, message: "ng", errorCode: "AccessDenied" },
      "2026-08-01T00:00:00.000Z",
      { name: "bob" },
    );
    const retried = recordApplyOutcome(first, { ok: true, message: "ok", errorCode: null }, "2026-08-02T00:00:00.000Z", { name: "carol" });

    expect(retried.appliedBy).toEqual({ name: "carol" });
    expect(retried.createdBy).toEqual(creator);
  });

  it("実行者が分からない反映（null）は appliedBy を null にする", () => {
    const applied = recordApplyOutcome(changeRequest(), { ok: true, message: "ok", errorCode: null }, "2026-08-01T00:00:00.000Z", null);

    expect(applied.appliedBy).toBeNull();
  });

  it("FR-4.8: 破棄しても削除せず、状態「破棄」で残る", () => {
    const discarded = discard(changeRequest());

    expect(discarded.status).toBe("discarded");
    expect(discarded.changeRequestId).toBe("cr-0142");
    expect(discarded.addUserArns).toEqual(changeRequest().addUserArns);
  });

  it("エッジケース: 反映済みの申請を再度反映しようとすると例外になる（終端状態）", () => {
    const applied = recordApplyOutcome(
      changeRequest(),
      { ok: true, message: "ok", errorCode: null },
      "2026-07-31T10:07:00.000Z",
      null,
    );

    expect(() =>
      recordApplyOutcome(applied, { ok: true, message: "ok", errorCode: null }, "2026-08-01T00:00:00.000Z", null),
    ).toThrow(InvalidStateTransitionError);
  });

  it("エッジケース: 破棄済みの申請は再度破棄できない", () => {
    expect(() => discard(discard(changeRequest()))).toThrow(InvalidStateTransitionError);
    expect(isDiscardable("discarded")).toBe(false);
    expect(isDiscardable("applied")).toBe(false);
  });

  it("FR-4.6 / Q26: 未反映は「下書き」または「失敗」の 2 状態", () => {
    expect(isUnreflected("draft")).toBe(true);
    expect(isUnreflected("failed")).toBe(true);
    expect(isUnreflected("applied")).toBe(false);
    expect(isUnreflected("discarded")).toBe(false);
    expect(canTransition("failed", "failed")).toBe(true);
  });
});

describe("localized（Issue #94）", () => {
  it("許されない遷移は changeRequest.invalidTransition を持つ", () => {
    try {
      assertTransition("applied", "draft");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidStateTransitionError);
      const transition = error as InvalidStateTransitionError;
      expect(transition.localized).toEqual(
        localized("changeRequest.invalidTransition", { from: "applied", to: "draft" }),
      );
      expect(transition.message).toBe("ChangeRequest の状態を applied から draft へ遷移できません");
    }
  });
});
