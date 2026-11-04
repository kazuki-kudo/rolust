import Box from "@cloudscape-design/components/box";
import FormField from "@cloudscape-design/components/form-field";
import Textarea from "@cloudscape-design/components/textarea";
import { CSV_IMPORT_MAX_ROWS, CSV_USER_NAME_HEADER } from "@rolust/core";

import { useT } from "../i18n/index.js";

/** CSV の入力欄に出すエラー 1 件。`text` は選んだ言語で描画済みの文。`line` は文の前に「n 行目: 」を添える行番号（全体のエラーは null）。 */
export interface CsvFieldError {
  line: number | null;
  text: string;
}

/**
 * CSV の入力欄（Issue #98）。形式の説明と、行番号つきのエラー一覧を持つ。
 * 検証は呼び出し側が `parseUserCsv` で行い、結果をここへ渡す。
 */
export function UserCsvFields({
  idPrefix,
  value,
  onChange,
  onBlur,
  attributeColumnNames,
  errors,
  showErrors,
}: {
  idPrefix: string;
  value: string;
  onChange: (next: string) => void;
  onBlur: () => void;
  attributeColumnNames: readonly string[];
  errors: CsvFieldError[];
  showErrors: boolean;
}): React.JSX.Element {
  const t = useT();
  // ヘッダ行は入力欄の初期値に入っている（Issue #207）ので、説明にはデータ行の例だけを出す。
  const example = ["ayaka.mori", ...attributeColumnNames.map((_, index) => t.pool.csv.exampleValue(index + 1))].join(",");

  return (
    <FormField
      label={t.pool.csv.label}
      description={
        <span data-testid={`${idPrefix}-csv-help`}>
          {t.pool.csv.help(CSV_USER_NAME_HEADER, CSV_IMPORT_MAX_ROWS)}
          <Box display="block">{t.pool.csv.exampleLead}</Box>
          <Box variant="code" display="block">
            {example}
          </Box>
        </span>
      }
      errorText={
        showErrors && errors.length > 0 ? (
          <ul aria-live="polite" data-testid={`${idPrefix}-csv-errors`} style={{ margin: 0, paddingLeft: "1.25rem" }}>
            {errors.map((error, index) => (
              <li key={index}>{error.line === null ? error.text : `${t.pool.csv.line(error.line)}${error.text}`}</li>
            ))}
          </ul>
        ) : undefined
      }
    >
      <Textarea
        data-testid={`${idPrefix}-csv`}
        value={value}
        rows={8}
        spellcheck={false}
        onChange={(event) => onChange(event.detail.value)}
        onBlur={onBlur}
      />
    </FormField>
  );
}
