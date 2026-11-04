import { IAM_NAME_PATTERN, assertIamName } from "./arn.js";
import { normalizeAttributeValue } from "./attribute.js";
import { ValidationError } from "./errors.js";
import { renderMessage } from "./messages/render.js";
import { localized, type LocalizedMessage } from "./messages/types.js";
import type { AttributeColumn } from "./types.js";

/**
 * IAM ユーザの CSV 一括登録（Issue #98。spec 2026-10-04-user-csv-import-design.md）。
 *
 * クライアントが行番号つきのエラーを即時に出すための解析と検証。サーバーは同じ規則で
 * `normalizeImportUsers`（Task 2）が再検証する。AWS にもデータストアにも触れない。
 */

/** 1 回に登録できる行数（ヘッダを除く）。D-8。 */
export const CSV_IMPORT_MAX_ROWS = 500;
/** ユーザ名の列の見出し。 */
export const CSV_USER_NAME_HEADER = "ユーザ名";
/** 返すエラーの上限。超えた分は「ほか n 件」にまとめる。 */
export const CSV_MAX_REPORTED_ERRORS = 50;

export interface UserCsvRow {
  userName: string;
  /** 列名 → 値。空の値は含めない。 */
  attributes: Record<string, string>;
}

export interface UserCsvError {
  /** レコードが始まる物理行（1 始まり）。全体のエラーは null。 */
  line: number | null;
  /** 日本語の文（`renderMessage("ja", localized)`）。`localized` を知らない呼び出し元のための後方互換。 */
  message: string;
  /** 言語に依らない ID と引数。ブラウザが言語に合わせて描画する（Issue #94）。 */
  localized: LocalizedMessage;
}

function csvError(line: number | null, message: LocalizedMessage): UserCsvError {
  return { line, message: renderMessage("ja", message), localized: message };
}

export type UserCsvResult =
  | { ok: true; rows: UserCsvRow[] }
  | { ok: false; errors: UserCsvError[] };

interface CsvRecord {
  line: number;
  fields: string[];
}

/** RFC 4180 のレコード分割。引用符・`""`・引用符の中の改行を解釈する。BOM は除く。 */
function splitRecords(source: string): { records: CsvRecord[]; error: UserCsvError | null } {
  const text = source.startsWith("\uFEFF") ? source.slice(1) : source;
  const records: CsvRecord[] = [];
  let fields: string[] = [];
  let field = "";
  let inQuotes = false;
  /** 現在の欄が引用符で始まった（閉じた後を含む）。 */
  let quoted = false;
  let line = 1;
  let recordLine = 1;

  const endField = (): void => {
    fields.push(field);
    field = "";
    quoted = false;
  };
  const endRecord = (): void => {
    endField();
    records.push({ line: recordLine, fields });
    fields = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (char === "\n") line += 1;
        field += char;
      }
      continue;
    }
    if (char === '"' && field === "" && !quoted) {
      inQuotes = true;
      quoted = true;
      continue;
    }
    if (quoted && char !== "," && char !== "\n" && char !== "\r") {
      return {
        records,
        error: csvError(line, localized("csvParse.afterQuote", {})),
      };
    }
    if (char === ",") {
      endField();
      continue;
    }
    if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      endRecord();
      line += 1;
      recordLine = line;
      continue;
    }
    field += char;
  }
  if (inQuotes) {
    return { records, error: csvError(recordLine, localized("csvParse.unclosedQuote", {})) };
  }
  if (field !== "" || fields.length > 0 || quoted) endRecord();
  return { records, error: null };
}

function fail(errors: UserCsvError[]): UserCsvResult {
  if (errors.length <= CSV_MAX_REPORTED_ERRORS) return { ok: false, errors };
  const rest = errors.length - CSV_MAX_REPORTED_ERRORS;
  return {
    ok: false,
    errors: [
      ...errors.slice(0, CSV_MAX_REPORTED_ERRORS),
      csvError(null, localized("csvParse.moreErrors", { rest })),
    ],
  };
}

/** CSV の 1 欄にする。カンマ・二重引用符・改行を含むときだけ引用符で囲み、二重引用符は重ねる（RFC 4180）。 */
function toCsvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * 入力欄の初期値にするヘッダ行（Issue #207）。必須の列名に、プールの属性の項目名を順に並べる。
 * 項目名にカンマ・引用符があっても `parseUserCsv` が元の名前に戻せるよう、`splitRecords` と同じ規則で囲む。
 */
export function formatUserCsvHeader(attributeColumnNames: readonly string[]): string {
  return [CSV_USER_NAME_HEADER, ...attributeColumnNames].map(toCsvField).join(",");
}

/**
 * CSV を解析し、ユーザ名と属性の行に検証する（spec 3.1）。
 *
 * 1 つでも不正があれば `ok: false`（D-5）。ヘッダが不正なときは、列の対応が信頼できないので
 * ヘッダのエラーだけを返す。
 */
export function parseUserCsv(text: string, attributeColumnNames: readonly string[]): UserCsvResult {
  const { records: all, error } = splitRecords(text);
  if (error) return fail([error]);

  // すべての欄が空の行（空行・`,,`）は無視する。行番号は元のまま。
  const records = all.filter((record) => record.fields.some((field) => field.trim() !== ""));
  const [header, ...body] = records;
  if (!header) {
    return fail([csvError(null, localized("csvParse.empty", { header: CSV_USER_NAME_HEADER }))]);
  }
  if (body.length > CSV_IMPORT_MAX_ROWS) {
    return fail([
      csvError(null, localized("csvParse.tooManyRows", { max: CSV_IMPORT_MAX_ROWS, actual: body.length })),
    ]);
  }

  const names = header.fields.map((field) => field.trim());
  const userIndex = names.indexOf(CSV_USER_NAME_HEADER);
  const headerErrors: UserCsvError[] = [];
  if (userIndex < 0) {
    headerErrors.push(
      csvError(header.line, localized("csvParse.missingUserNameColumn", { header: CSV_USER_NAME_HEADER })),
    );
  }
  const seen = new Set<string>();
  names.forEach((name, index) => {
    if (seen.has(name)) {
      headerErrors.push(csvError(header.line, localized("attribute.duplicateColumnName", { name })));
    }
    seen.add(name);
    if (index !== userIndex && name !== CSV_USER_NAME_HEADER && !attributeColumnNames.includes(name)) {
      headerErrors.push(csvError(header.line, localized("csvParse.unknownColumn", { name })));
    }
  });
  if (headerErrors.length > 0) return fail(headerErrors);

  if (body.length === 0) {
    return fail([csvError(null, localized("csvParse.noUsers", {}))]);
  }

  const errors: UserCsvError[] = [];
  const rows: UserCsvRow[] = [];
  const firstLineOf = new Map<string, number>();

  for (const record of body) {
    if (record.fields.length !== names.length) {
      errors.push(
        csvError(
          record.line,
          localized("csvParse.columnCountMismatch", { header: names.length, actual: record.fields.length }),
        ),
      );
      continue;
    }
    const userName = (record.fields[userIndex] as string).trim();
    const rowErrors: UserCsvError[] = [];
    if (userName === "") {
      rowErrors.push(csvError(record.line, localized("csvParse.userNameEmpty", {})));
    } else if (!IAM_NAME_PATTERN.test(userName)) {
      rowErrors.push(csvError(record.line, localized("csvParse.userNameInvalid", { userName })));
    } else {
      const firstLine = firstLineOf.get(userName);
      if (firstLine !== undefined) {
        rowErrors.push(
          csvError(record.line, localized("csvParse.duplicateUserName", { name: userName, firstLine })),
        );
      } else {
        firstLineOf.set(userName, record.line);
      }
    }

    const attributes: Record<string, string> = {};
    names.forEach((name, index) => {
      if (index === userIndex) return;
      try {
        const value = normalizeAttributeValue(record.fields[index] as string);
        // `attributes[name] = …` だと、列名が `__proto__` のとき値が黙って落ちる。自前のプロパティとして定義する。
        if (value !== null) {
          Object.defineProperty(attributes, name, {
            value,
            enumerable: true,
            writable: true,
            configurable: true,
          });
        }
      } catch (cause) {
        if (!(cause instanceof ValidationError)) throw cause;
        rowErrors.push(
          csvError(
            record.line,
            localized("csv.attributeValueInvalid", {
              columnName: name,
              cause: cause.localized,
            }),
          ),
        );
      }
    });

    if (rowErrors.length > 0) errors.push(...rowErrors);
    else rows.push({ userName, attributes });
  }

  return errors.length > 0 ? fail(errors) : { ok: true, rows };
}

/** サーバーが検証した登録の 1 行。`attributes` は columnId → 値（空の値は含めない）。 */
export interface ImportUserRow {
  userName: string;
  attributes: Record<string, string>;
}

/**
 * リクエスト本文の `users`（属性は列名 → 値）を、保存する行（columnId → 値）に検証・正規化する。
 * `parseUserCsv` と同じ規則を境界で再検証する（D-9）。
 *
 * @throws ValidationError 配列でない・空・上限超過・形の誤り・ユーザ名の書式・重複・未知の列名・値の規則違反（`field: "users"`）
 */
export function normalizeImportUsers(
  raw: unknown,
  columns: readonly AttributeColumn[],
): ImportUserRow[] {
  if (!Array.isArray(raw)) {
    throw new ValidationError(localized("csv.usersNotArray", {}), "users");
  }
  if (raw.length === 0) {
    throw new ValidationError(localized("csv.usersEmpty", {}), "users");
  }
  if (raw.length > CSV_IMPORT_MAX_ROWS) {
    throw new ValidationError(localized("csv.tooManyUsers", { max: CSV_IMPORT_MAX_ROWS }), "users");
  }
  const idByName = new Map(columns.map((column) => [column.name, column.columnId] as const));
  const seen = new Set<string>();

  return raw.map((entry: unknown, index): ImportUserRow => {
    const fail = (cause: LocalizedMessage): never => {
      throw new ValidationError(localized("csv.rowError", { position: index + 1, cause }), "users");
    };
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      return fail(localized("csv.userNotObject", {}));
    }
    const { userName, attributes } = entry as Record<string, unknown>;
    if (typeof userName !== "string") return fail(localized("csv.userNameNotString", {}));
    const name = userName.trim();
    if (!IAM_NAME_PATTERN.test(name)) {
      return fail(localized("csv.userNameInvalidChars", { userName }));
    }
    assertIamName(name, "users");
    if (seen.has(name)) return fail(localized("csv.duplicateUserName", { name }));
    seen.add(name);

    const resolved: Record<string, string> = {};
    if (attributes !== undefined) {
      if (typeof attributes !== "object" || attributes === null || Array.isArray(attributes)) {
        return fail(localized("attribute.attributesNotObject", {}));
      }
      for (const [columnName, value] of Object.entries(attributes)) {
        const columnId = idByName.get(columnName);
        if (columnId === undefined) return fail(localized("csv.unknownAttributeColumn", { columnName }));
        if (typeof value !== "string") return fail(localized("csv.attributeValueNotString", { columnName }));
        try {
          const normalized = normalizeAttributeValue(value);
          if (normalized !== null) resolved[columnId] = normalized;
        } catch (cause) {
          if (!(cause instanceof ValidationError)) throw cause;
          return fail(
            localized("csv.attributeValueInvalid", {
              columnName,
              cause: cause.localized,
            }),
          );
        }
      }
    }
    return { userName: name, attributes: resolved };
  });
}
