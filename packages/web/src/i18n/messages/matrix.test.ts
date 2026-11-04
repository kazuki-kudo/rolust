import { describe, expect, it } from "vitest";

import { en } from "./en.js";
import { ja } from "./ja.js";

/** 画面 3 のカタログのうち、数や有無で文が変わるもの（Issue #94）。日本語は移行前の画面の文言と同じ。 */
describe("画面 3 のカタログ", () => {
  it("ツールバーの件数: 変更の有無と、英語の単数・複数", () => {
    expect(ja.matrix.selectionSummary(1, 0, 0)).toBe("1 件の IAMロールを選択中 · 0 件の IAMロールを除外 · 変更はありません");
    expect(ja.matrix.selectionSummary(2, 1, 5)).toBe("2 件の IAMロールを選択中 · 1 件の IAMロールを除外 · 変更 5 件");
    expect(en.matrix.selectionSummary(1, 0, 0)).toBe("1 IAM role selected · 0 IAM roles excluded · No changes");
    expect(en.matrix.selectionSummary(2, 1, 1)).toBe("2 IAM roles selected · 1 IAM role excluded · 1 change");
  });

  it("取り消しの完了通知: 対象外の件数は 0 件なら添えない", () => {
    expect(ja.matrix.revertedNotice(3, 0)).toBe("3 件の変更を取り消しました");
    expect(ja.matrix.revertedNotice(3, 2)).toBe("3 件の変更を取り消しました（未反映の申請があるため 2 件の IAMロールは対象外でした）");
    expect(ja.matrix.nothingToRevertNotice(1)).toBe("取り消せる変更はありませんでした（未反映の申請があるため 1 件の IAMロールは対象外でした）");
    expect(en.matrix.revertedNotice(1, 0)).toBe("Reverted 1 change");
    expect(en.matrix.revertedNotice(2, 1)).toBe(
      "Reverted 2 changes (1 IAM role was excluded because it has an unapplied request)",
    );
    expect(en.matrix.nothingToRevertNotice(2)).toBe(
      "There were no changes to revert (2 IAM roles were excluded because they have unapplied requests)",
    );
  });

  it("保存失敗の文: 英語は、理由が句点で終わっても句点が重ならない（日本語は従来どおり）", () => {
    expect(en.matrix.saveFailed("R", "The IAM role is not registered")).toBe(
      "Could not save the assignment (R): The IAM role is not registered. Try checking the box again.",
    );
    expect(en.matrix.saveFailed("R", "Conflict.")).toBe(
      "Could not save the assignment (R): Conflict. Try checking the box again.",
    );
    expect(en.matrix.saveFailed("R", "競合しました。")).toBe(
      "Could not save the assignment (R): 競合しました. Try checking the box again.",
    );
    expect(ja.matrix.saveFailed("R", "競合しました")).toBe("割り当てを保存できませんでした（R）: 競合しました。再度チェックしてください。");
  });

  it("非表示の列の要約: 変更ありの列数は 0 件なら添えない", () => {
    expect(ja.matrix.hiddenColumns.summary(2, 0)).toBe("非表示 2 列");
    expect(ja.matrix.hiddenColumns.summary(2, 1)).toBe("非表示 2 列（変更あり 1 列）");
    expect(en.matrix.hiddenColumns.summary(1, 0)).toBe("1 hidden column");
    expect(en.matrix.hiddenColumns.summary(2, 1)).toBe("2 hidden columns (1 with changes)");
  });

  it("列ヘッダのバッジの語は、日本語・英語ともすべて埋まっている", () => {
    for (const messages of [ja, en]) {
      expect(Object.values(messages.matrixGrid.filterLabel).every((label) => label !== "")).toBe(true);
      expect(messages.matrixGrid.badge.filter(messages.matrixGrid.filterLabel.changed)).not.toBe("");
    }
    expect(ja.matrixGrid.badge.filter(ja.matrixGrid.filterLabel.checked)).toBe("絞り込み: チェックあり");
    expect(ja.matrixGrid.includeLabel(2)).toBe("申請に含める（変更 2）");
    expect(en.matrixGrid.includeLabel(1)).toBe("Include in request (1 change)");
    expect(en.matrixGrid.includeLabel(2)).toBe("Include in request (2 changes)");
    expect(en.matrixGrid.badge.filter(en.matrixGrid.filterLabel.checked)).toBe("Filter: Checked");
  });

  it("英語に日本語が混じらない", () => {
    const strings: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === "string") strings.push(value);
      else if (typeof value === "function") {
        const render = value as (...a: unknown[]) => string;
        // 引数が文字列の関数（理由の文など）は、数では呼べない。
        try {
          strings.push(render(1, 1, 1));
        } catch {
          strings.push(render("x", "x", "x"));
        }
      }
      else if (typeof value === "object" && value !== null) Object.values(value).forEach(collect);
    };
    collect(en.matrix);
    collect(en.matrixGrid);
    expect(strings.filter((text) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(text))).toEqual([]);
  });
});
