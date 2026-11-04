import { describe, expect, it } from "vitest";

import { ValidationError } from "./errors.js";
import { localized } from "./messages/index.js";
import {
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_DISPLAY_NAME_MAX_LENGTH,
  normalizeRoleDescription,
  normalizeRoleDisplayName,
} from "./role.js";

describe("normalizeRoleDescription（Issue #21）", () => {
  it.each<[string | null | undefined, string | null]>([
    [null, null],
    [undefined, null],
    ["", null],
    ["   ", null],
    ["　　", null],
    ["  本番デプロイ用  ", "本番デプロイ用"],
    ["a".repeat(256), "a".repeat(256)],
    ["あ".repeat(256), "あ".repeat(256)],
    ["𩸽".repeat(256), "𩸽".repeat(256)],
  ])("%j → %j", (input, expected) => {
    expect(normalizeRoleDescription(input)).toBe(expected);
  });

  it("257 文字は拒否し、field は description", () => {
    expect(() => normalizeRoleDescription("a".repeat(257))).toThrow(ValidationError);
    expect(() => normalizeRoleDescription("a".repeat(257))).toThrow(/256 文字以内/);
    try {
      normalizeRoleDescription("a".repeat(257));
    } catch (error) {
      expect((error as ValidationError).field).toBe("description");
    }
  });

  it("文字の間の制御文字（タブ・改行）は拒否する", () => {
    expect(() => normalizeRoleDescription("a\tb")).toThrow(/制御文字/);
    expect(() => normalizeRoleDescription("a\nb")).toThrow(/制御文字/);
  });

  it.each([
    ["DEL", "a\u007fb"],
    ["C1 の NEL（改行）", "a\u0085b"],
    ["LINE SEPARATOR", "a b"],
    ["PARAGRAPH SEPARATOR", "a b"],
  ])("%s は制御文字として拒否する", (_label, input) => {
    expect(() => normalizeRoleDescription(input)).toThrow(/制御文字/);
  });

  it.each([
    ["ゼロ幅空白", "​"],
    ["ゼロ幅空白と空白", " ​ ​ "],
  ])("%s だけの説明は拒否し、field は description", (_label, input) => {
    expect(() => normalizeRoleDescription(input)).toThrow(ValidationError);
    expect(() => normalizeRoleDescription(input)).toThrow("説明に見える文字がありません");
    try {
      normalizeRoleDescription(input);
    } catch (error) {
      expect((error as ValidationError).field).toBe("description");
    }
  });

  it("文字の間の書式文字（絵文字の ZWJ など）は通す", () => {
    expect(normalizeRoleDescription("👨‍💻 用")).toBe("👨‍💻 用");
  });
});

describe("normalizeRoleDisplayName（Issue #150）", () => {
  it("前後の空白を除いて返す", () => {
    expect(normalizeRoleDisplayName("  本番デプロイ  ")).toBe("本番デプロイ");
  });

  it.each<[string | null | undefined]>([[null], [undefined], [""], ["   "], ["　　"]])(
    "未設定（%j）は null にする",
    (value) => {
      expect(normalizeRoleDisplayName(value)).toBeNull();
    },
  );

  it("上限は 32 文字（日本語も 1 文字として数える）", () => {
    expect(ROLE_DISPLAY_NAME_MAX_LENGTH).toBe(32);
    const ok = "あ".repeat(32);
    expect(normalizeRoleDisplayName(ok)).toBe(ok);
    expect(() => normalizeRoleDisplayName("あ".repeat(33))).toThrow(ValidationError);
  });

  it("サロゲートペアの絵文字も 1 文字として数える", () => {
    expect(normalizeRoleDisplayName("😀".repeat(32))).toBe("😀".repeat(32));
    expect(() => normalizeRoleDisplayName("😀".repeat(33))).toThrow("表示名は 32 文字以内で入力してください");
  });

  it("見える文字が無い（ゼロ幅スペースだけ）名前は拒否する", () => {
    expect(() => normalizeRoleDisplayName("​​")).toThrow("表示名に見える文字がありません");
  });

  it("改行・タブなどの制御文字は拒否する", () => {
    expect(() => normalizeRoleDisplayName("A\tB")).toThrow("表示名に制御文字(改行・タブなど)は使えません");
  });

  it("エラーの入力項目名は displayName", () => {
    expect(() => normalizeRoleDisplayName("A\nB")).toThrow(ValidationError);
    try {
      normalizeRoleDisplayName("A\nB");
    } catch (error) {
      expect(error).toMatchObject({ field: "displayName" });
    }
  });
});

function caught(fn: () => unknown): ValidationError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationError);
    return error as ValidationError;
  }
  throw new Error("例外を期待したが投げられなかった");
}

describe("localized（Issue #94）", () => {
  it("説明の規則違反（半角括弧の文言は従来どおり）", () => {
    const control = caught(() => normalizeRoleDescription("a\nb"));
    expect(control.field).toBe("description");
    expect(control.localized).toEqual(localized("role.descriptionControlChar", {}));
    expect(control.message).toBe("説明に制御文字(改行・タブなど)は使えません");
    const invisible = caught(() => normalizeRoleDescription("\u200b"));
    expect(invisible.localized).toEqual(localized("role.descriptionNotVisible", {}));
    expect(invisible.message).toBe("説明に見える文字がありません");
    const tooLong = caught(() => normalizeRoleDescription("a".repeat(ROLE_DESCRIPTION_MAX_LENGTH + 1)));
    expect(tooLong.localized).toEqual(localized("role.descriptionTooLong", { max: ROLE_DESCRIPTION_MAX_LENGTH }));
    expect(tooLong.message).toBe(`説明は ${ROLE_DESCRIPTION_MAX_LENGTH} 文字以内で入力してください`);
  });

  it("表示名の規則違反", () => {
    const control = caught(() => normalizeRoleDisplayName("a\nb"));
    expect(control.field).toBe("displayName");
    expect(control.localized).toEqual(localized("role.displayNameControlChar", {}));
    expect(control.message).toBe("表示名に制御文字(改行・タブなど)は使えません");
    const invisible = caught(() => normalizeRoleDisplayName("\u200b"));
    expect(invisible.localized).toEqual(localized("role.displayNameNotVisible", {}));
    expect(invisible.message).toBe("表示名に見える文字がありません");
    const tooLong = caught(() => normalizeRoleDisplayName("a".repeat(ROLE_DISPLAY_NAME_MAX_LENGTH + 1)));
    expect(tooLong.localized).toEqual(localized("role.displayNameTooLong", { max: ROLE_DISPLAY_NAME_MAX_LENGTH }));
    expect(tooLong.message).toBe(`表示名は ${ROLE_DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください`);
  });
});
