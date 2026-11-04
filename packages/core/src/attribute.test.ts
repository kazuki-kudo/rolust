import { describe, expect, it } from "vitest";

import {
  ATTRIBUTE_COLUMN_MAX_COUNT,
  ATTRIBUTE_COLUMN_NAME_MAX_LENGTH,
  ATTRIBUTE_VALUE_MAX_LENGTH,
  normalizeAttributeValue,
  normalizeColumnInputs,
  normalizeColumnName,
  normalizeUserAttributes,
  pruneAttributes,
  readColumnInputs,
} from "./attribute.js";
import { ValidationError } from "./errors.js";
import { localized } from "./messages/index.js";

const NAME = { columnId: "c-name", name: "名前" };
const ROLE = { columnId: "c-role", name: "役割" };

function counter(): () => string {
  let n = 0;
  return () => `new-${n++}`;
}

describe("列名の正規化（D-7）", () => {
  it("前後の空白を除く（全角空白を含む）", () => {
    expect(normalizeColumnName("  名前　")).toBe("名前");
  });

  it("空・空白だけは拒否する", () => {
    expect(() => normalizeColumnName("   ")).toThrow(ValidationError);
  });

  it("改行・タブなどの制御文字は拒否する", () => {
    expect(() => normalizeColumnName("名\n前")).toThrow(ValidationError);
    expect(() => normalizeColumnName("名\t前")).toThrow(ValidationError);
  });

  it("見える文字が無い名前（ゼロ幅空白だけ）は拒否する", () => {
    expect(() => normalizeColumnName("​​")).toThrow(ValidationError);
  });

  it("32 文字までは受け付け、33 文字は拒否する（コードポイントで数える）", () => {
    expect(normalizeColumnName("あ".repeat(32))).toBe("あ".repeat(32));
    expect(() => normalizeColumnName("あ".repeat(33))).toThrow(ValidationError);
    expect(normalizeColumnName("😀".repeat(32))).toBe("😀".repeat(32));
  });

  it("違反は field が name の ValidationError", () => {
    expect(() => normalizeColumnName("")).toThrow(expect.objectContaining({ field: "name" }));
  });
});

describe("値の正規化（D-8）", () => {
  it("前後の空白を除く", () => {
    expect(normalizeAttributeValue("  森 彩花 ")).toBe("森 彩花");
  });

  it("空・空白だけは未設定（null）にする", () => {
    expect(normalizeAttributeValue("")).toBeNull();
    expect(normalizeAttributeValue("  　 ")).toBeNull();
  });

  it("制御文字・ゼロ幅空白だけの値・129 文字は拒否する", () => {
    expect(() => normalizeAttributeValue("a\nb")).toThrow(ValidationError);
    expect(() => normalizeAttributeValue("​")).toThrow(ValidationError);
    expect(() => normalizeAttributeValue("a".repeat(129))).toThrow(ValidationError);
    expect(normalizeAttributeValue("a".repeat(128))).toBe("a".repeat(128));
  });
});

describe("列定義の入力の形（readColumnInputs）", () => {
  it("columnId の有無を保ったまま読む", () => {
    expect(readColumnInputs([{ columnId: "c-name", name: "名前" }, { name: "部署" }])).toEqual([
      { columnId: "c-name", name: "名前" },
      { name: "部署" },
    ]);
  });

  it("配列でない・要素がオブジェクトでない・name が文字列でない・columnId が文字列でないものは拒否する", () => {
    expect(() => readColumnInputs("x")).toThrow(ValidationError);
    expect(() => readColumnInputs([1])).toThrow(ValidationError);
    expect(() => readColumnInputs([{ name: 1 }])).toThrow(ValidationError);
    expect(() => readColumnInputs([{ columnId: 1, name: "a" }])).toThrow(ValidationError);
  });
});

describe("列定義の正規化（D-4・D-9）", () => {
  it("columnId の無い列に新しい ID を振り、ある列は ID と順序を保つ", () => {
    const result = normalizeColumnInputs(
      [{ columnId: "c-name", name: " 名前 " }, { name: "部署" }],
      [NAME],
      counter(),
    );
    expect(result).toEqual([NAME, { columnId: "new-0", name: "部署" }]);
  });

  it("名前だけを変えても columnId は変わらない（Review Focus 1）", () => {
    const result = normalizeColumnInputs([{ columnId: "c-name", name: "氏名" }], [NAME], counter());
    expect(result).toEqual([{ columnId: "c-name", name: "氏名" }]);
  });

  it("削除して同じ名前で作り直した列は、削除した列と違う columnId になる（Review Focus 2）", () => {
    const result = normalizeColumnInputs([{ name: "名前" }], [NAME], counter());
    expect(result[0]?.columnId).not.toBe(NAME.columnId);
  });

  it("11 列目は拒否し、10 列は受け付ける（Review Focus 4）", () => {
    const names = (count: number) => Array.from({ length: count }, (_, index) => ({ name: `列${index}` }));
    expect(normalizeColumnInputs(names(ATTRIBUTE_COLUMN_MAX_COUNT), [], counter())).toHaveLength(10);
    expect(() => normalizeColumnInputs(names(ATTRIBUTE_COLUMN_MAX_COUNT + 1), [], counter())).toThrow(
      ValidationError,
    );
  });

  it("空の配列（すべて削除）を受け付ける", () => {
    expect(normalizeColumnInputs([], [NAME], counter())).toEqual([]);
  });

  it("列名の重複は、空白を除いた後の完全一致で拒否する", () => {
    expect(() => normalizeColumnInputs([{ name: "名前" }, { name: " 名前 " }], [], counter())).toThrow(
      ValidationError,
    );
  });

  it("存在しない columnId、同じ columnId の重複は拒否する", () => {
    expect(() => normalizeColumnInputs([{ columnId: "ghost", name: "a" }], [NAME], counter())).toThrow(
      ValidationError,
    );
    expect(() =>
      normalizeColumnInputs(
        [
          { columnId: "c-name", name: "a" },
          { columnId: "c-name", name: "b" },
        ],
        [NAME],
        counter(),
      ),
    ).toThrow(ValidationError);
  });

  it("列名の規則違反は拒否する", () => {
    expect(() => normalizeColumnInputs([{ name: "​" }], [], counter())).toThrow(ValidationError);
  });
});

describe("ユーザの属性の正規化", () => {
  it("定義にある列の値を正規化し、空の値は落とす", () => {
    expect(normalizeUserAttributes({ "c-name": " 森 ", "c-role": "  " }, [NAME, ROLE])).toEqual({
      "c-name": "森",
    });
  });

  it("定義に無い columnId は拒否する（Review Focus 3）", () => {
    expect(() => normalizeUserAttributes({ ghost: "x" }, [NAME])).toThrow(ValidationError);
  });

  it("オブジェクトでない・値が文字列でないものは拒否する", () => {
    expect(() => normalizeUserAttributes(null, [NAME])).toThrow(ValidationError);
    expect(() => normalizeUserAttributes([], [NAME])).toThrow(ValidationError);
    expect(() => normalizeUserAttributes({ "c-name": 1 }, [NAME])).toThrow(ValidationError);
  });

  it("値の規則違反は拒否する", () => {
    expect(() => normalizeUserAttributes({ "c-name": "a\nb" }, [NAME])).toThrow(ValidationError);
  });
});

describe("pruneAttributes（D-6）", () => {
  it("定義に無い columnId の値を落とす", () => {
    expect(pruneAttributes({ "c-name": "森", ghost: "古い値" }, [NAME])).toEqual({ "c-name": "森" });
  });

  it("属性を持たない（undefined）既存アイテムは空のオブジェクトにする（Review Focus 5）", () => {
    expect(pruneAttributes(undefined, [NAME])).toEqual({});
  });

  it("列が 0 件なら空のオブジェクト", () => {
    expect(pruneAttributes({ "c-name": "森" }, [])).toEqual({});
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
  it("列名の長さ超過は attribute.nameTooLong と max を持ち、日本語の message は従来どおり", () => {
    const error = caught(() => normalizeColumnName("a".repeat(ATTRIBUTE_COLUMN_NAME_MAX_LENGTH + 1)));
    expect(error.field).toBe("name");
    expect(error.localized).toEqual(
      localized("attribute.nameTooLong", { max: ATTRIBUTE_COLUMN_NAME_MAX_LENGTH }),
    );
    expect(error.message).toBe(`列名は ${ATTRIBUTE_COLUMN_NAME_MAX_LENGTH} 文字以内で入力してください`);
  });

  it("列名の空・制御文字・見える文字が無い", () => {
    const required = caught(() => normalizeColumnName(" "));
    expect(required.localized).toEqual(localized("attribute.nameRequired", {}));
    expect(required.message).toBe("列名を入力してください");
    const control = caught(() => normalizeColumnName("a\nb"));
    expect(control.localized).toEqual(localized("attribute.nameControlChar", {}));
    expect(control.message).toBe("列名に制御文字（改行・タブなど）は使えません");
    const invisible = caught(() => normalizeColumnName("\u200b"));
    expect(invisible.localized).toEqual(localized("attribute.nameNotVisible", {}));
    expect(invisible.message).toBe("列名に見える文字がありません");
  });

  it("値の規則違反", () => {
    const control = caught(() => normalizeAttributeValue("a\nb"));
    expect(control.field).toBe("attributes");
    expect(control.localized).toEqual(localized("attribute.valueControlChar", {}));
    expect(control.message).toBe("値に制御文字（改行・タブなど）は使えません");
    const invisible = caught(() => normalizeAttributeValue("\u200b"));
    expect(invisible.localized).toEqual(localized("attribute.valueNotVisible", {}));
    expect(invisible.message).toBe("値に見える文字がありません");
    const tooLong = caught(() => normalizeAttributeValue("a".repeat(ATTRIBUTE_VALUE_MAX_LENGTH + 1)));
    expect(tooLong.localized).toEqual(localized("attribute.valueTooLong", { max: ATTRIBUTE_VALUE_MAX_LENGTH }));
    expect(tooLong.message).toBe(`値は ${ATTRIBUTE_VALUE_MAX_LENGTH} 文字以内で入力してください`);
  });

  it("列定義の入力の形", () => {
    const notArray = caught(() => readColumnInputs("x"));
    expect(notArray.field).toBe("columns");
    expect(notArray.localized).toEqual(localized("attribute.columnsNotArray", {}));
    expect(notArray.message).toBe("columns は配列で指定してください");
    const notObject = caught(() => readColumnInputs([1]));
    expect(notObject.localized).toEqual(localized("attribute.columnNotObject", {}));
    expect(notObject.message).toBe("columns の要素はオブジェクトで指定してください");
    const nameNotString = caught(() => readColumnInputs([{ name: 1 }]));
    expect(nameNotString.localized).toEqual(localized("attribute.columnNameNotString", {}));
    expect(nameNotString.message).toBe("列名は文字列で指定してください");
    const idNotString = caught(() => readColumnInputs([{ name: "a", columnId: 1 }]));
    expect(idNotString.localized).toEqual(localized("attribute.columnIdNotString", {}));
    expect(idNotString.message).toBe("columnId は文字列で指定してください");
  });

  it("列定義の保存の規則", () => {
    const tooMany = Array.from({ length: ATTRIBUTE_COLUMN_MAX_COUNT + 1 }, (_, i) => ({ name: `n${i}` }));
    const many = caught(() => normalizeColumnInputs(tooMany, [], counter()));
    expect(many.localized).toEqual(localized("attribute.tooManyColumns", { max: ATTRIBUTE_COLUMN_MAX_COUNT }));
    expect(many.message).toBe(`属性列は ${ATTRIBUTE_COLUMN_MAX_COUNT} 列までです`);

    const dupName = caught(() => normalizeColumnInputs([{ name: "a" }, { name: "a" }], [], counter()));
    expect(dupName.localized).toEqual(localized("attribute.duplicateColumnName", { name: "a" }));
    expect(dupName.message).toBe("列名「a」が重複しています");

    const unknown = caught(() => normalizeColumnInputs([{ columnId: "zzz", name: "a" }], [NAME], counter()));
    expect(unknown.localized).toEqual(localized("attribute.unknownColumn", { columnId: "zzz" }));
    expect(unknown.message).toBe("存在しない属性列です: zzz");

    const dupId = caught(() =>
      normalizeColumnInputs(
        [
          { columnId: NAME.columnId, name: "a" },
          { columnId: NAME.columnId, name: "b" },
        ],
        [NAME],
        counter(),
      ),
    );
    expect(dupId.localized).toEqual(localized("attribute.duplicateColumnId", { columnId: NAME.columnId }));
    expect(dupId.message).toBe(`属性列の ID が重複しています: ${NAME.columnId}`);
  });

  it("ユーザの属性の入力", () => {
    const notObject = caught(() => normalizeUserAttributes("x", [NAME]));
    expect(notObject.field).toBe("attributes");
    expect(notObject.localized).toEqual(localized("attribute.attributesNotObject", {}));
    expect(notObject.message).toBe("attributes はオブジェクトで指定してください");

    const unknown = caught(() => normalizeUserAttributes({ zzz: "x" }, [NAME]));
    expect(unknown.localized).toEqual(localized("attribute.unknownColumn", { columnId: "zzz" }));
    expect(unknown.message).toBe("存在しない属性列です: zzz");

    const notString = caught(() => normalizeUserAttributes({ [NAME.columnId]: 1 }, [NAME]));
    expect(notString.localized).toEqual(localized("attribute.valueNotString", {}));
    expect(notString.message).toBe("値は文字列で指定してください");
  });
});
