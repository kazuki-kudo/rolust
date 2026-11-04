import { useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { AttributeColumn, AttributeColumnInput, Locale } from "@rolust/core";
import { ATTRIBUTE_COLUMN_MAX_COUNT, ValidationError, normalizeColumnInputs } from "@rolust/core";

import { api } from "../api-client.js";
import type { ApiClientError } from "../api-client.js";
import { GuardedModal } from "../components/GuardedModal.js";
import { toApiError } from "../hooks/useAsync.js";
import { describeError, localizeMessage, useLocale, useT } from "../i18n/index.js";

/**
 * 属性の項目を編集モーダル（Issue #61。画面 1）。
 *
 * 列の追加・名前変更・削除を、列定義の全体として 1 回で保存する（`PUT /pool/attribute-columns`）。
 * `columnId` を持つ行は既存の列で、名前を変えても値は残る。`columnId` の無い行が新規の列。
 * 並べ替えは作らない（追加順）。
 */

export interface AttributeColumnsModalProps {
  /** 編集するプール（一覧で取得済みの値）。`null` なら閉じている。 */
  pool: { attributeColumns: AttributeColumn[] } | null;
  onDismiss: () => void;
  onSaved: (columns: AttributeColumn[]) => void;
}

/** 保存の前の検証。サーバと同じ規則（core）で、先頭の違反の文言を `locale` で返す。 */
function validate(locale: Locale, rows: AttributeColumnInput[], existing: AttributeColumn[]): string | null {
  let sequence = 0;
  try {
    normalizeColumnInputs(rows, existing, () => `new-${sequence++}`);
    return null;
  } catch (error) {
    if (error instanceof ValidationError) return localizeMessage(locale, error.message, error.localized);
    throw error;
  }
}

export function AttributeColumnsModal({
  pool,
  onDismiss,
  onSaved,
}: AttributeColumnsModalProps): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const existing = pool?.attributeColumns ?? [];
  const initialRows: AttributeColumnInput[] = existing.map((column) => ({ ...column }));

  const [rows, setRows] = useState<AttributeColumnInput[]>(initialRows);
  const [touched, setTouched] = useState(false);
  // 失敗は API のエラーのまま持ち、描画のたびに選んだ言語で文にする（言語を切り替えても追随する）。
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);
  const [saving, setSaving] = useState(false);

  // 開くたびに一覧の値へそろえる。レンダー中に検知してその場で書き換える（Issue #67）。
  // プールは 1 つなので、開いている（pool が非 null）かどうかで検知する（Issue #108）。
  const isOpen = pool !== null;
  const [renderedFor, setRenderedFor] = useState(isOpen);
  if (renderedFor !== isOpen) {
    setRenderedFor(isOpen);
    setRows(initialRows);
    setTouched(false);
    setSubmitError(null);
  }

  const validationError = validate(locale, rows, existing);
  // GI-4: 開いたときから変わっていれば「入力がある」。
  const dirty = pool !== null && JSON.stringify(rows) !== JSON.stringify(initialRows);
  const removed = existing.filter((column) => !rows.some((row) => row.columnId === column.columnId));

  const close = (): void => {
    setSubmitError(null);
    onDismiss();
  };

  const submit = async (): Promise<void> => {
    if (!pool) return;
    setTouched(true);
    if (validationError) return;

    setSaving(true);
    setSubmitError(null);
    try {
      const result = await api.saveAttributeColumns(rows);
      onSaved(result.columns);
    } catch (cause) {
      // モーダルは閉じず、入力を保持する。
      setSubmitError(toApiError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <GuardedModal
      visible={pool !== null}
      header={t.pool.attributeColumns.header}
      testId="attribute-columns-modal"
      dirty={dirty}
      onClose={close}
      footer={(requestClose) => (
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button data-testid="attribute-columns-cancel" onClick={requestClose}>
              {t.pool.cancel}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              loadingText={t.pool.saving}
              data-testid="attribute-columns-submit"
              onClick={() => void submit()}
            >
              {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
              {saving ? t.pool.saving : t.pool.save}
            </Button>
          </SpaceBetween>
        </Box>
      )}
    >
      {pool ? (
        <Form errorText={submitError === null ? undefined : describeError(locale, t, submitError)}>
          <SpaceBetween size="m">
            <FormField
              label={t.pool.attributeColumns.label}
              description={t.pool.attributeColumns.description(ATTRIBUTE_COLUMN_MAX_COUNT)}
              errorText={touched ? (validationError ?? undefined) : undefined}
            >
              <SpaceBetween size="xs">
                {rows.map((row, index) => (
                  <SpaceBetween key={row.columnId ?? `new-${index}`} direction="horizontal" size="xs">
                    <Input
                      data-testid={`attribute-column-name-${index}`}
                      ariaLabel={t.pool.attributeColumns.nameAria(index + 1)}
                      value={row.name}
                      onChange={(event) =>
                        setRows((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, name: event.detail.value } : item,
                          ),
                        )
                      }
                      onBlur={() => setTouched(true)}
                    />
                    <Button
                      variant="inline-link"
                      data-testid={`attribute-column-remove-${index}`}
                      ariaLabel={t.pool.attributeColumns.removeAria(index + 1, row.name)}
                      onClick={() => setRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                    >
                      {t.pool.attributeColumns.remove}
                    </Button>
                  </SpaceBetween>
                ))}
                <Button
                  data-testid="attribute-columns-add"
                  disabled={rows.length >= ATTRIBUTE_COLUMN_MAX_COUNT}
                  onClick={() => setRows((current) => [...current, { name: "" }])}
                >
                  {t.pool.attributeColumns.add}
                </Button>
              </SpaceBetween>
            </FormField>

            {removed.length > 0 && (
              <Alert type="warning" statusIconAriaLabel={t.pool.warningAriaLabel} data-testid="attribute-columns-delete-warning">
                {t.pool.attributeColumns.removedWarning(removed.map((column) => column.name))}
              </Alert>
            )}
          </SpaceBetween>
        </Form>
      ) : null}
    </GuardedModal>
  );
}
