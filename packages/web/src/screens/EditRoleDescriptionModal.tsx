import { useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { IamRole, Locale } from "@rolust/core";
import {
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_DISPLAY_NAME_MAX_LENGTH,
  ValidationError,
  normalizeRoleDescription,
  normalizeRoleDisplayName,
} from "@rolust/core";

import { api } from "../api-client.js";
import type { ApiClientError } from "../api-client.js";
import { GuardedModal } from "../components/GuardedModal.js";
import { toApiError } from "../hooks/useAsync.js";
import { describeError, localizeMessage, useLocale, useT } from "../i18n/index.js";

/**
 * ロールの表示名と説明を編集するモーダル（Issue #21・#150）。ほかの編集モーダルと同じ形。
 *
 * 変えた項目だけを `PATCH /roles?arn=` で保存する。初期値は一覧で取得済みの値を使い、
 * 読み込みはしない。
 */

export interface EditRoleDescriptionModalProps {
  /** 表示名・説明を変えるロール（一覧で取得済みの値）。`null` なら閉じている。 */
  role: { arn: string; roleName: string; displayName: string | null; description: string | null } | null;
  onDismiss: () => void;
  onSaved: (role: IamRole) => void;
}

/** 入力の検証。`ValidationError` の `localized` を選んだ言語で描画する（無ければ日本語の `message`）。 */
function validateDescription(locale: Locale, value: string): string | null {
  try {
    normalizeRoleDescription(value);
    return null;
  } catch (error) {
    if (error instanceof ValidationError) return localizeMessage(locale, error.message, error.localized);
    throw error;
  }
}

function validateDisplayName(locale: Locale, value: string): string | null {
  try {
    normalizeRoleDisplayName(value);
    return null;
  } catch (error) {
    if (error instanceof ValidationError) return localizeMessage(locale, error.message, error.localized);
    throw error;
  }
}

export function EditRoleDescriptionModal({
  role,
  onDismiss,
  onSaved,
}: EditRoleDescriptionModalProps): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const arn = role?.arn ?? null;
  const initialDisplayName = role?.displayName ?? "";
  const initialDescription = role?.description ?? "";

  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [displayNameTouched, setDisplayNameTouched] = useState(false);
  const [description, setDescription] = useState(initialDescription);
  const [descriptionTouched, setDescriptionTouched] = useState(false);
  // API のエラーのまま持ち、描画のたびに選んだ言語で文にする。
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);
  // PATCH の 409 は表示名の重複だけ（説明に重複は無い）。表示名の欄の下に出す。
  const [displayNameConflict, setDisplayNameConflict] = useState<ApiClientError | null>(null);
  const [saving, setSaving] = useState(false);

  // 開くたびに一覧の値へそろえ、前に開いたときの入力とエラーを残さない。`useEffect` だと
  // 効果が走るまでの最初の描画が古い値のまま出る（ほかの編集モーダルと同じ形。Issue #67）。
  // レンダー中に検知してその場で書き換え、ちらつく描画そのものを起こさない。
  const [renderedFor, setRenderedFor] = useState(arn);
  if (renderedFor !== arn) {
    setRenderedFor(arn);
    setDisplayName(initialDisplayName);
    setDisplayNameTouched(false);
    setDescription(initialDescription);
    setDescriptionTouched(false);
    setSubmitError(null);
    setDisplayNameConflict(null);
  }

  const displayNameError = validateDisplayName(locale, displayName);
  const descriptionError = validateDescription(locale, description);
  // GI-4: 開いたときから変わっていれば「入力がある」。
  const dirty = role !== null && (displayName !== initialDisplayName || description !== initialDescription);

  const close = (): void => {
    setSubmitError(null);
    setDisplayNameConflict(null);
    onDismiss();
  };

  const submit = async (): Promise<void> => {
    if (!role) return;
    setDisplayNameTouched(true);
    setDescriptionTouched(true);
    if (displayNameError || descriptionError) return;

    // 変えた項目だけを送る。どちらも変わらなければ通信せずに閉じる。
    const nextDisplayName = normalizeRoleDisplayName(displayName);
    const nextDescription = normalizeRoleDescription(description);
    const fields: { displayName?: string | null; description?: string | null } = {};
    if (nextDisplayName !== role.displayName) fields.displayName = nextDisplayName;
    if (nextDescription !== role.description) fields.description = nextDescription;
    if (Object.keys(fields).length === 0) {
      close();
      return;
    }

    setSaving(true);
    setSubmitError(null);
    setDisplayNameConflict(null);
    try {
      const result = await api.updateRoleFields(role.arn, fields);
      onSaved(result.role);
    } catch (cause) {
      // モーダルは閉じず、入力を保持する（ほかの編集モーダルと同じ方針）。
      const apiError = toApiError(cause);
      if (apiError.status === 409) setDisplayNameConflict(apiError);
      else setSubmitError(apiError);
    } finally {
      setSaving(false);
    }
  };

  return (
    <GuardedModal
      visible={role !== null}
      header={t.roles.editDescription.header}
      testId="edit-role-description-modal"
      dirty={dirty}
      onClose={close}
      footer={(requestClose) => (
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button data-testid="edit-role-description-cancel" onClick={requestClose}>
              {t.roles.cancel}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              loadingText={t.roles.saving}
              data-testid="edit-role-description-submit"
              onClick={() => void submit()}
            >
              {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
              {saving ? t.roles.saving : t.roles.save}
            </Button>
          </SpaceBetween>
        </Box>
      )}
    >
      {role ? (
        <Form errorText={submitError === null ? undefined : describeError(locale, t, submitError)}>
          <SpaceBetween size="l">
            <FormField label={t.roles.editDescription.roleNameLabel}>
              <Box variant="code" data-testid="edit-role-description-role-name">
                {role.roleName}
              </Box>
            </FormField>

            <FormField
              label={t.roles.editDescription.displayNameLabel}
              description={t.roles.editDescription.displayNameDescription(ROLE_DISPLAY_NAME_MAX_LENGTH)}
              errorText={
                (displayNameTouched ? displayNameError : null) ??
                (displayNameConflict === null ? undefined : describeError(locale, t, displayNameConflict))
              }
            >
              <Input
                data-testid="edit-role-display-name-input"
                value={displayName}
                onChange={(event) => {
                  setDisplayName(event.detail.value);
                  setDisplayNameConflict(null);
                }}
                onBlur={() => setDisplayNameTouched(true)}
              />
            </FormField>

            <FormField
              label={t.roles.editDescription.descriptionLabel}
              description={t.roles.editDescription.optionalMax(ROLE_DESCRIPTION_MAX_LENGTH)}
              errorText={descriptionTouched ? (descriptionError ?? undefined) : undefined}
            >
              <Input
                data-testid="edit-role-description-input"
                value={description}
                onChange={(event) => setDescription(event.detail.value)}
                onBlur={() => setDescriptionTouched(true)}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      ) : null}
    </GuardedModal>
  );
}
