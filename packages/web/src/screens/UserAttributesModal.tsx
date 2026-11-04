import { useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { AttributeColumn, IamUser, Locale } from "@rolust/core";
import { ATTRIBUTE_VALUE_MAX_LENGTH, ValidationError, normalizeAttributeValue } from "@rolust/core";

import { api } from "../api-client.js";
import type { ApiClientError } from "../api-client.js";
import { GuardedModal } from "../components/GuardedModal.js";
import { toApiError } from "../hooks/useAsync.js";
import { describeError, localizeMessage, useLocale, useT } from "../i18n/index.js";

/**
 * 属性を編集モーダル（Issue #61。画面 1）。
 *
 * 1 ユーザの属性を、列ごとの入力欄で編集する。空の値は未設定として保存しない
 * （`PUT /pool/users/attributes` が属性を丸ごと置き換える）。
 */

export interface UserAttributesModalProps {
  /** 編集するユーザと、そのプールの属性の項目（一覧で取得済みの値）。`null` なら閉じている。 */
  target: { user: IamUser; columns: AttributeColumn[] } | null;
  onDismiss: () => void;
  onSaved: (user: IamUser) => void;
}

function valueError(locale: Locale, value: string): string | null {
  try {
    normalizeAttributeValue(value);
    return null;
  } catch (error) {
    if (error instanceof ValidationError) return localizeMessage(locale, error.message, error.localized);
    throw error;
  }
}

function initialValues(target: UserAttributesModalProps["target"]): Record<string, string> {
  return Object.fromEntries(
    (target?.columns ?? []).map((column) => [column.columnId, target?.user.attributes[column.columnId] ?? ""]),
  );
}

export function UserAttributesModal({
  target,
  onDismiss,
  onSaved,
}: UserAttributesModalProps): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const targetKey = target ? target.user.arn : null;
  const initial = initialValues(target);

  const [values, setValues] = useState<Record<string, string>>(initial);
  const [touched, setTouched] = useState(false);
  // 失敗は API のエラーのまま持ち、描画のたびに選んだ言語で文にする（言語を切り替えても追随する）。
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);
  const [saving, setSaving] = useState(false);

  // 開くたび・別のユーザで開くたびに、一覧の値へそろえる（ほかの編集モーダルと同じ。Issue #67）。
  const [renderedFor, setRenderedFor] = useState(targetKey);
  if (renderedFor !== targetKey) {
    setRenderedFor(targetKey);
    setValues(initial);
    setTouched(false);
    setSubmitError(null);
  }

  const errors = Object.fromEntries(
    Object.entries(values).map(([columnId, value]) => [columnId, valueError(locale, value)]),
  );
  const hasError = Object.values(errors).some((error) => error !== null);
  // GI-4: 開いたときから変わっていれば「入力がある」。
  const dirty = target !== null && Object.keys(initial).some((columnId) => values[columnId] !== initial[columnId]);

  const close = (): void => {
    setSubmitError(null);
    onDismiss();
  };

  const submit = async (): Promise<void> => {
    if (!target) return;
    setTouched(true);
    if (hasError) return;

    // 空の値は送らない（未設定）。サーバも同じ規則で正規化する。
    const attributes = Object.fromEntries(
      Object.entries(values).flatMap(([columnId, value]) => {
        const normalized = normalizeAttributeValue(value);
        return normalized === null ? [] : [[columnId, normalized]];
      }),
    );

    setSaving(true);
    setSubmitError(null);
    try {
      const result = await api.saveUserAttributes(target.user.arn, attributes);
      onSaved(result.user);
    } catch (cause) {
      // モーダルは閉じず、入力を保持する。
      setSubmitError(toApiError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <GuardedModal
      visible={target !== null}
      header={t.pool.userAttributes.header}
      testId="user-attributes-modal"
      dirty={dirty}
      onClose={close}
      footer={(requestClose) => (
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button data-testid="user-attributes-cancel" onClick={requestClose}>
              {t.pool.cancel}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              loadingText={t.pool.saving}
              data-testid="user-attributes-submit"
              onClick={() => void submit()}
            >
              {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
              {saving ? t.pool.saving : t.pool.save}
            </Button>
          </SpaceBetween>
        </Box>
      )}
    >
      {target ? (
        <Form errorText={submitError === null ? undefined : describeError(locale, t, submitError)}>
          <SpaceBetween size="l">
            <FormField label={t.pool.userAttributes.userLabel}>
              <Box variant="code">{target.user.userName}</Box>
            </FormField>
            {target.columns.map((column) => (
              <FormField
                key={column.columnId}
                label={column.name}
                description={t.pool.userAttributes.valueDescription(ATTRIBUTE_VALUE_MAX_LENGTH)}
                errorText={touched ? (errors[column.columnId] ?? undefined) : undefined}
              >
                <Input
                  data-testid={`user-attribute-${column.columnId}`}
                  value={values[column.columnId] ?? ""}
                  onChange={(event) =>
                    setValues((current) => ({ ...current, [column.columnId]: event.detail.value }))
                  }
                  onBlur={() => setTouched(true)}
                />
              </FormField>
            ))}
          </SpaceBetween>
        </Form>
      ) : null}
    </GuardedModal>
  );
}
