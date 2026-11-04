import { describe, expect, it } from "vitest";

import { en, ja } from "./i18n/index.js";
import { exclusionReasonLabel, kindLabel, shortRequestId, statusLabel } from "./labels.js";

describe("shortRequestId（Issue #145 / FR-7.5）", () => {
  it("`cr-` を含む先頭 9 文字に、短縮した印の「…」を付ける（Issue #148）", () => {
    expect(shortRequestId("cr-ccb630aa-1111-4222-8333-444455556666")).toBe("cr-ccb630…");
  });

  it("短縮していない ID（9 文字以下）には「…」を付けず、そのまま返す", () => {
    expect(shortRequestId("cr-0142")).toBe("cr-0142");
    expect(shortRequestId("cr-ccb630")).toBe("cr-ccb630");
  });
});

describe("statusLabel（Issue #94）", () => {
  it("日本語・英語の状態語を返す", () => {
    expect(statusLabel(ja, "draft")).toBe("下書き");
    expect(statusLabel(ja, "applied")).toBe("反映済み");
    expect(statusLabel(ja, "failed")).toBe("失敗");
    expect(statusLabel(ja, "discarded")).toBe("破棄");
    expect(statusLabel(en, "draft")).toBe("Draft");
    expect(statusLabel(en, "applied")).toBe("Applied");
    expect(statusLabel(en, "failed")).toBe("Failed");
    expect(statusLabel(en, "discarded")).toBe("Discarded");
  });
});

describe("kindLabel（Issue #172）", () => {
  it("通常（undefined）は null、restore・adopt は選んだ言語の語", () => {
    expect(kindLabel(ja, undefined)).toBeNull();
    expect(kindLabel(ja, "restore")).toBe("乖離の修復（IAM を記録に合わせる）");
    expect(kindLabel(ja, "adopt")).toBe("記録の取り込み（AWS は書き換えていません）");
    expect(kindLabel(en, undefined)).toBeNull();
    expect(kindLabel(en, "restore")).toBe(en.kind.restore);
    expect(kindLabel(en, "adopt")).toBe(en.kind.adopt);
    expect(en.kind.restore).not.toBe(ja.kind.restore);
  });
});

describe("exclusionReasonLabel（Issue #94）", () => {
  it("日本語・英語の除外の理由を返す", () => {
    expect(exclusionReasonLabel(ja, "draft")).toBe("下書きの申請が 1 件あります");
    expect(exclusionReasonLabel(ja, "no-changes")).toBe("変更がありません");
    expect(exclusionReasonLabel(en, "draft")).toBe("There is 1 draft request");
    expect(exclusionReasonLabel(en, "failed")).toBe("There is 1 failed request");
    expect(exclusionReasonLabel(en, "no-changes")).toBe("There are no changes");
    expect(exclusionReasonLabel(en, "not-registered")).toBe("This IAM role is not registered");
  });
});
