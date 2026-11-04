import { describe, expect, it } from "vitest";

import { CSV_IMPORT_MAX_ROWS, formatUserCsvHeader, normalizeImportUsers, parseUserCsv } from "./user-csv.js";
import { ValidationError } from "./errors.js";
import { localized, type LocalizedMessage } from "./messages/index.js";
import type { UserCsvError } from "./user-csv.js";

const COLUMNS = ["所属", "役割"];

function errorsOf(text: string, columns: readonly string[] = COLUMNS): UserCsvError[] {
  const result = parseUserCsv(text, columns);
  if (result.ok) throw new Error("エラーを期待したが成功した");
  return result.errors;
}

describe("parseUserCsv: 正常系", () => {
  it("ヘッダの列名で属性列に対応づける。空の値は含めない", () => {
    const result = parseUserCsv(
      "ユーザ名,所属,役割\nayaka.mori,開発,リーダー\nkenji.sato,運用,\n",
      COLUMNS,
    );

    expect(result).toEqual({
      ok: true,
      rows: [
        { userName: "ayaka.mori", attributes: { 所属: "開発", 役割: "リーダー" } },
        { userName: "kenji.sato", attributes: { 所属: "運用" } },
      ],
    });
  });

  it("列の順序は自由で、属性列は一部だけでもよい", () => {
    const result = parseUserCsv("役割,ユーザ名\nリーダー,ayaka.mori", COLUMNS);

    expect(result).toEqual({
      ok: true,
      rows: [{ userName: "ayaka.mori", attributes: { 役割: "リーダー" } }],
    });
  });

  it("属性列が 0 件のプールでは、ユーザ名だけの CSV を受け付ける", () => {
    const result = parseUserCsv("ユーザ名\nayaka.mori\nkenji.sato", []);

    expect(result).toEqual({
      ok: true,
      rows: [
        { userName: "ayaka.mori", attributes: {} },
        { userName: "kenji.sato", attributes: {} },
      ],
    });
  });

  it("BOM・CRLF・末尾の空行・空行・全角空白の前後を扱う", () => {
    const text = "\uFEFFユーザ名,所属\r\n\r\n　ayaka.mori　,　開発　\r\n,\r\n\r\n";

    expect(parseUserCsv(text, COLUMNS)).toEqual({
      ok: true,
      rows: [{ userName: "ayaka.mori", attributes: { 所属: "開発" } }],
    });
  });

  it("引用符で囲んだ値は、カンマと二重引用符を含められる", () => {
    const text = 'ユーザ名,所属\nayaka.mori,"開発,第一"\nkenji.sato,"""運用"""';

    expect(parseUserCsv(text, COLUMNS)).toEqual({
      ok: true,
      rows: [
        { userName: "ayaka.mori", attributes: { 所属: "開発,第一" } },
        { userName: "kenji.sato", attributes: { 所属: '"運用"' } },
      ],
    });
  });
});

describe("parseUserCsv: 特殊な列名（最終レビュー）", () => {
  it("列名が __proto__ でも値を落とさない", () => {
    const result = parseUserCsv("ユーザ名,__proto__\nayaka.mori,値", ["__proto__"]);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const attributes = result.rows[0]?.attributes ?? {};
    expect(Object.keys(attributes)).toEqual(["__proto__"]);
    expect(Object.getOwnPropertyDescriptor(attributes, "__proto__")?.value).toBe("値");
  });
});

describe("formatUserCsvHeader（Issue #207）", () => {
  it("必須の列名に続けて、属性の項目名を登録順にカンマで並べる", () => {
    expect(formatUserCsvHeader(["所属", "役割"])).toBe("ユーザ名,所属,役割");
  });

  it("属性の項目が 0 件なら、必須の列名だけにする", () => {
    expect(formatUserCsvHeader([])).toBe("ユーザ名");
  });

  it("カンマ・二重引用符を含む名前は引用符で囲み、二重引用符は重ねる", () => {
    expect(formatUserCsvHeader(["部署,課", 'a"b', "普通"])).toBe('ユーザ名,"部署,課","a""b",普通');
  });

  it("改行を含む名前も引用符で囲む（項目名は改行を許さないが、CSV としては壊さない）", () => {
    expect(formatUserCsvHeader(["a\nb", "c\r\nd"])).toBe('ユーザ名,"a\nb","c\r\nd"');
  });

  it("特殊な名前を含むヘッダは、parseUserCsv が元の名前に戻して受け付ける（往復）", () => {
    const names = ["部署,課", 'a"b', '"始まり', "終わり\"", ",", "普通"];
    const header = formatUserCsvHeader(names);

    const result = parseUserCsv(`${header}\nayaka.mori,1,2,3,4,5,6`, names);

    expect(result).toEqual({
      ok: true,
      rows: [
        {
          userName: "ayaka.mori",
          attributes: { "部署,課": "1", 'a"b': "2", '"始まり': "3", '終わり"': "4", ",": "5", 普通: "6" },
        },
      ],
    });
  });

  it("ヘッダだけの CSV は、属性名が正しく読めたうえで「ユーザが 1 行も無い」だけが残る", () => {
    const names = ["部署,課", 'a"b'];

    const result = parseUserCsv(formatUserCsvHeader(names), names);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.line).toBeNull();
    expect(result.errors[0]?.localized.id).toBe("csvParse.noUsers");
  });
});

describe("parseUserCsv: 全体のエラー", () => {
  it("空の入力・空白だけの入力・ヘッダだけの入力は、全体のエラーにする", () => {
    for (const text of ["", "  \n\n", "ユーザ名,所属\n"]) {
      const errors = errorsOf(text);
      expect(errors).toHaveLength(1);
      expect(errors[0]?.line).toBeNull();
    }
    expect(errorsOf("")[0]?.message).toContain("ヘッダ");
    expect(errorsOf("ユーザ名,所属\n")[0]?.message).toContain("行がありません");
  });

  it("行数の上限を超えたら、行ごとの検証の前に全体のエラー 1 件だけを返す", () => {
    const rows = Array.from({ length: CSV_IMPORT_MAX_ROWS + 1 }, (_, i) => `user${i}`);
    const errors = errorsOf(`ユーザ名\n${rows.join("\n")}`, []);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: null });
    expect(errors[0]?.message).toContain(String(CSV_IMPORT_MAX_ROWS));
  });

  it("ちょうど上限の行数は受け付ける", () => {
    const rows = Array.from({ length: CSV_IMPORT_MAX_ROWS }, (_, i) => `user${i}`);

    expect(parseUserCsv(`ユーザ名\n${rows.join("\n")}`, []).ok).toBe(true);
  });

  it("引用符が閉じていなければ、始まった行を指して拒否する", () => {
    const errors = errorsOf('ユーザ名,所属\nayaka.mori,"開発\nkenji.sato,運用');

    expect(errors).toMatchObject([{ line: 2, message: "引用符が閉じていません" }]);
  });

  it("引用符で囲んだ値の後にカンマ・改行以外があれば拒否する", () => {
    const errors = errorsOf('ユーザ名,所属\nayaka.mori,"開発"x');

    expect(errors[0]?.line).toBe(2);
    expect(errors[0]?.message).toContain("引用符");
  });
});

describe("parseUserCsv: ヘッダのエラー", () => {
  it("「ユーザ名」列が無ければ、ヘッダのエラーだけを返す（行の検証へ進まない）", () => {
    const errors = errorsOf("所属,役割\n開発,リーダー");

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ line: 1 });
    expect(errors[0]?.message).toContain("ユーザ名");
  });

  it("プールに無い列名は拒否する（列は作らない）", () => {
    const errors = errorsOf("ユーザ名,部署\nayaka.mori,開発");

    expect(errors).toHaveLength(1);
    expect(errors[0]?.line).toBe(1);
    expect(errors[0]?.message).toContain("部署");
    expect(errors[0]?.message).toContain("属性列");
  });

  it("列名の重複を拒否する（ユーザ名の重複も）", () => {
    expect(errorsOf("ユーザ名,所属,所属\nayaka.mori,a,b")[0]?.message).toContain("重複");
    expect(errorsOf("ユーザ名,ユーザ名\nayaka.mori,a")[0]?.message).toContain("重複");
  });

  it("空の列名は拒否する", () => {
    expect(errorsOf("ユーザ名,\nayaka.mori,a")[0]?.line).toBe(1);
  });
});

describe("parseUserCsv: 行のエラー", () => {
  it("ユーザ名が空・書式の誤りの行を、行番号つきで返す（空行を挟んでも元の行番号）", () => {
    const text = "ユーザ名,所属\n\n,開発\nayaka mori,開発\nkenji.sato,運用";
    const errors = errorsOf(text);

    expect(errors.map((e) => e.line)).toEqual([3, 4]);
    expect(errors[0]?.message).toContain("ユーザ名");
    expect(errors[1]?.message).toContain("ayaka mori");
  });

  it("列の数がヘッダと合わない行を拒否する", () => {
    const errors = errorsOf("ユーザ名,所属\n\nayaka.mori,開発,余分\nkenji.sato");

    expect(errors.map((e) => e.line)).toEqual([3, 4]);
    expect(errors[0]?.message).toContain("列の数");
  });

  it("同じユーザ名が複数行にあれば、2 行目以降を拒否する", () => {
    const errors = errorsOf("ユーザ名,所属\nayaka.mori,a\nkenji.sato,b\nayaka.mori,c");

    expect(errors).toMatchObject([{ line: 4, message: "ユーザ名「ayaka.mori」が 2 行目と重複しています" }]);
  });

  it("属性値の規則違反（128 文字超・引用符の中の改行）を、列名つきで拒否する", () => {
    const long = "あ".repeat(129);
    const errors = errorsOf(`ユーザ名,所属,役割\nayaka.mori,${long},x\nkenji.sato,"a\nb",y`);

    expect(errors.map((e) => e.line)).toEqual([2, 3]);
    expect(errors[0]?.message).toContain("所属");
    expect(errors[0]?.message).toContain("128");
    expect(errors[1]?.message).toContain("制御文字");
  });

  it("引用符の中の改行を挟んでも、後続の行番号は物理行を指す", () => {
    const errors = errorsOf('ユーザ名,所属\nayaka.mori,"a\nb"\nbad name,x');

    expect(errors.map((e) => e.line)).toEqual([2, 4]);
  });

  it("エラーは 50 件で打ち切り、最後に「ほか n 件」を足す", () => {
    const rows = Array.from({ length: 60 }, () => "bad name");
    const errors = errorsOf(`ユーザ名\n${rows.join("\n")}`, []);

    expect(errors).toHaveLength(51);
    expect(errors[50]).toMatchObject({ line: null, message: "ほか 10 件のエラーがあります" });
  });
});

describe("normalizeImportUsers（サーバーの再検証）", () => {
  const columns = [
    { columnId: "c1", name: "所属" },
    { columnId: "c2", name: "役割" },
  ];

  it("列名を columnId に解決し、空の値を落とす。attributes は省略できる", () => {
    const rows = normalizeImportUsers(
      [
        { userName: "ayaka.mori", attributes: { 所属: " 開発 ", 役割: "" } },
        { userName: "kenji.sato" },
      ],
      columns,
    );

    expect(rows).toEqual([
      { userName: "ayaka.mori", attributes: { c1: "開発" } },
      { userName: "kenji.sato", attributes: {} },
    ]);
  });

  const reject = (raw: unknown): ValidationError => {
    try {
      normalizeImportUsers(raw, columns);
    } catch (cause) {
      if (cause instanceof ValidationError) return cause;
      throw cause;
    }
    throw new Error("拒否を期待したが成功した");
  };

  it("配列でない・空・上限超過を拒否する", () => {
    expect(reject("x").field).toBe("users");
    expect(reject([]).field).toBe("users");
    const many = Array.from({ length: CSV_IMPORT_MAX_ROWS + 1 }, (_, i) => ({ userName: `u${i}` }));
    expect(reject(many).message).toContain(String(CSV_IMPORT_MAX_ROWS));
  });

  it("要素がオブジェクトでない・userName が文字列でない・attributes がオブジェクトでないを拒否する", () => {
    expect(reject([null]).field).toBe("users");
    expect(reject([{ userName: 1 }]).field).toBe("users");
    expect(reject([{ userName: "a", attributes: [] }]).field).toBe("users");
    expect(reject([{ userName: "a", attributes: { 所属: 1 } }]).field).toBe("users");
  });

  it("ユーザ名の書式の誤りと重複を、何件目かつきで拒否する", () => {
    expect(reject([{ userName: "a" }, { userName: "bad name" }]).message).toContain("2 件目");
    expect(reject([{ userName: "a" }, { userName: "a" }]).message).toContain("重複");
  });

  it("プールに無い列名と、値の規則違反を拒否する", () => {
    expect(reject([{ userName: "a", attributes: { 部署: "x" } }]).message).toContain("部署");
    expect(reject([{ userName: "a", attributes: { 所属: "あ".repeat(129) } }]).message).toContain("1 件目");
  });
});

describe("localized（Issue #94）", () => {
  const columns = [{ columnId: "c1", name: "部署" }];

  function caught(raw: unknown): ValidationError {
    try {
      normalizeImportUsers(raw, columns);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      return error as ValidationError;
    }
    throw new Error("例外を期待したが投げられなかった");
  }

  it("全体の形", () => {
    const notArray = caught("x");
    expect(notArray.field).toBe("users");
    expect(notArray.localized).toEqual(localized("csv.usersNotArray", {}));
    expect(notArray.message).toBe("users は配列で指定してください");
    const empty = caught([]);
    expect(empty.localized).toEqual(localized("csv.usersEmpty", {}));
    expect(empty.message).toBe("登録するユーザを 1 件以上指定してください");
    const tooMany = caught(Array.from({ length: CSV_IMPORT_MAX_ROWS + 1 }, () => ({ userName: "a" })));
    expect(tooMany.localized).toEqual(localized("csv.tooManyUsers", { max: CSV_IMPORT_MAX_ROWS }));
    expect(tooMany.message).toBe(`1 回に登録できるのは ${CSV_IMPORT_MAX_ROWS} 件までです`);
  });

  it("行のエラーは csv.rowError が原因を入れ子で持つ", () => {
    const cases: [unknown[], LocalizedMessage, string][] = [
      [[1], localized("csv.userNotObject", {}), "ユーザはオブジェクトで指定してください"],
      [[{ userName: 1 }], localized("csv.userNameNotString", {}), "userName は文字列で指定してください"],
      [
        [{ userName: "bad name" }],
        localized("csv.userNameInvalidChars", { userName: "bad name" }),
        'ユーザ名に使えない文字が含まれています: "bad name"',
      ],
      [
        [{ userName: "a" }, { userName: " a " }],
        localized("csv.duplicateUserName", { name: "a" }),
        "ユーザ名「a」が重複しています",
      ],
      [
        [{ userName: "a", attributes: "x" }],
        localized("attribute.attributesNotObject", {}),
        "attributes はオブジェクトで指定してください",
      ],
      [
        [{ userName: "a", attributes: { 不明: "x" } }],
        localized("csv.unknownAttributeColumn", { columnName: "不明" }),
        "属性列「不明」はこのプールにありません",
      ],
      [
        [{ userName: "a", attributes: { 部署: 1 } }],
        localized("csv.attributeValueNotString", { columnName: "部署" }),
        "部署: 値は文字列で指定してください",
      ],
    ];
    for (const [raw, cause, message] of cases) {
      const position = raw.length;
      const error = caught(raw);
      expect(error.field).toBe("users");
      expect(error.localized).toEqual(localized("csv.rowError", { position, cause }));
      expect(error.message).toBe(`${position} 件目: ${message}`);
    }
  });

  it("属性値の検証エラーを、csv.rowError が入れ子で持つ（日本語の描画は従来と同じ）", () => {
    const error = caught([{ userName: "alice", attributes: { 部署: "a\nb" } }]);
    expect(error.localized).toEqual(
      localized("csv.rowError", {
        position: 1,
        cause: localized("csv.attributeValueInvalid", {
          columnName: "部署",
          cause: localized("attribute.valueControlChar", {}),
        }),
      }),
    );
    expect(error.message).toBe("1 件目: 部署: 値に制御文字（改行・タブなど）は使えません");
  });
});

describe("parseUserCsv の localized（Issue #94）", () => {
  /** 1 件のエラーの localized と、従来と同じ日本語の message を確かめる。 */
  function expectError(
    error: UserCsvError | undefined,
    line: number | null,
    expected: LocalizedMessage,
    message: string,
  ): void {
    expect(error).toBeDefined();
    expect(error?.line).toBe(line);
    expect(error?.localized).toEqual(expected);
    expect(error?.message).toBe(message);
  }

  it("引用符の構文エラー", () => {
    expectError(
      errorsOf('ユーザ名,所属\nayaka.mori,"開発"x')[0],
      2,
      localized("csvParse.afterQuote", {}),
      "引用符で囲んだ値の後に、カンマか改行以外の文字があります",
    );
    expectError(
      errorsOf('ユーザ名,所属\nayaka.mori,"開発\nkenji.sato,運用')[0],
      2,
      localized("csvParse.unclosedQuote", {}),
      "引用符が閉じていません",
    );
  });

  it("全体のエラー", () => {
    expectError(
      errorsOf("")[0],
      null,
      localized("csvParse.empty", { header: "ユーザ名" }),
      "CSV が空です。1 行目にヘッダ（ユーザ名,…）が必要です",
    );
    const rows = Array.from({ length: CSV_IMPORT_MAX_ROWS + 1 }, (_, i) => `user${i}`);
    expectError(
      errorsOf(`ユーザ名\n${rows.join("\n")}`, [])[0],
      null,
      localized("csvParse.tooManyRows", { max: CSV_IMPORT_MAX_ROWS, actual: CSV_IMPORT_MAX_ROWS + 1 }),
      `1 回に登録できるのは ${CSV_IMPORT_MAX_ROWS} 行までです（${CSV_IMPORT_MAX_ROWS + 1} 行あります）。分けて登録してください`,
    );
    expectError(
      errorsOf("ユーザ名,所属\n")[0],
      null,
      localized("csvParse.noUsers", {}),
      "登録するユーザの行がありません",
    );
  });

  it("ヘッダのエラー", () => {
    expectError(
      errorsOf("所属,役割\n開発,リーダー")[0],
      1,
      localized("csvParse.missingUserNameColumn", { header: "ユーザ名" }),
      "ヘッダに「ユーザ名」列がありません",
    );
    expectError(
      errorsOf("ユーザ名,所属,所属\nayaka.mori,a,b")[0],
      1,
      localized("attribute.duplicateColumnName", { name: "所属" }),
      "列名「所属」が重複しています",
    );
    expectError(
      errorsOf("ユーザ名,部署\nayaka.mori,開発")[0],
      1,
      localized("csvParse.unknownColumn", { name: "部署" }),
      "列名「部署」はこのプールの属性列にありません（属性列は「属性列を編集」で先に作ります）",
    );
  });

  it("行のエラー", () => {
    expectError(
      errorsOf("ユーザ名,所属\nayaka.mori,開発,余分")[0],
      2,
      localized("csvParse.columnCountMismatch", { header: 2, actual: 3 }),
      "列の数が合いません（ヘッダ 2 列、この行 3 列）",
    );
    expectError(
      errorsOf("ユーザ名,所属\n,開発")[0],
      2,
      localized("csvParse.userNameEmpty", {}),
      "ユーザ名が空です",
    );
    expectError(
      errorsOf("ユーザ名,所属\nayaka mori,開発")[0],
      2,
      localized("csvParse.userNameInvalid", { userName: "ayaka mori" }),
      "ユーザ名に使えない文字が含まれています（英数字と +=,.@_- のみ、1〜64 文字）: ayaka mori",
    );
    expectError(
      errorsOf("ユーザ名,所属\nayaka.mori,a\nkenji.sato,b\nayaka.mori,c")[0],
      4,
      localized("csvParse.duplicateUserName", { name: "ayaka.mori", firstLine: 2 }),
      "ユーザ名「ayaka.mori」が 2 行目と重複しています",
    );
  });

  it("属性値の規則違反は csv.attributeValueInvalid が原因を入れ子で持つ", () => {
    const errors = errorsOf(`ユーザ名,所属,役割\nayaka.mori,${"あ".repeat(129)},x\nkenji.sato,"a\nb",y`);
    expectError(
      errors[0],
      2,
      localized("csv.attributeValueInvalid", {
        columnName: "所属",
        cause: localized("attribute.valueTooLong", { max: 128 }),
      }),
      "所属: 値は 128 文字以内で入力してください",
    );
    expectError(
      errors[1],
      3,
      localized("csv.attributeValueInvalid", {
        columnName: "所属",
        cause: localized("attribute.valueControlChar", {}),
      }),
      "所属: 値に制御文字（改行・タブなど）は使えません",
    );
  });

  it("エラーが 50 件を超えたら、最後に csvParse.moreErrors を足す", () => {
    const rows = Array.from({ length: 60 }, () => "bad name");
    const errors = errorsOf(`ユーザ名\n${rows.join("\n")}`, []);
    expect(errors).toHaveLength(51);
    expectError(errors[50], null, localized("csvParse.moreErrors", { rest: 10 }), "ほか 10 件のエラーがあります");
  });

  it("どの localized.params にも undefined を含めない", () => {
    const rows = Array.from({ length: 60 }, () => "bad name");
    for (const error of errorsOf(`ユーザ名\n${rows.join("\n")}`, [])) {
      expect(Object.values(error.localized.params)).not.toContain(undefined);
    }
  });
});
