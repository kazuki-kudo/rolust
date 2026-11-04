import { useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Tiles from "@cloudscape-design/components/tiles";
import type { IamRole, RoleColorId } from "@rolust/core";
import { ROLE_COLORS, isRoleColorId } from "@rolust/core";

import { api } from "../api-client.js";
import type { ApiClientError } from "../api-client.js";
import { ColorSwatch } from "../components/ColorSwatch.js";
import { GuardedModal } from "../components/GuardedModal.js";
import { toApiError } from "../hooks/useAsync.js";
import { describeError, useLocale, useT } from "../i18n/index.js";

/**
 * ロールの背景色を編集するモーダル（FR-2.5。Issue #100）。`EditRoleDescriptionModal` と同じ形。
 * 固定パレットの 8 色と「なし」から選び、`PATCH /roles?arn=` で色だけを保存する。
 */

export interface EditRoleColorModalProps {
  /** 色を変えるロール（一覧で取得済みの値）。`null` なら閉じている。 */
  role: { arn: string; roleName: string; color: RoleColorId | null } | null;
  onDismiss: () => void;
  onSaved: (role: IamRole) => void;
}

const NONE = "none";

export function EditRoleColorModal({ role, onDismiss, onSaved }: EditRoleColorModalProps): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const arn = role?.arn ?? null;
  const initial = role?.color ?? NONE;

  const [value, setValue] = useState<string>(initial);
  // API のエラーのまま持ち、描画のたびに選んだ言語で文にする。
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);
  const [saving, setSaving] = useState(false);

  // 開くたびに一覧の値へそろえる（`EditRoleDescriptionModal` と同じ。レンダー中に検知して書き換える）。
  const [renderedFor, setRenderedFor] = useState(arn);
  if (renderedFor !== arn) {
    setRenderedFor(arn);
    setValue(initial);
    setSubmitError(null);
  }

  const changed = value !== initial;

  const close = (): void => {
    setSubmitError(null);
    onDismiss();
  };

  const submit = async (): Promise<void> => {
    if (!role || !changed) return;
    setSaving(true);
    setSubmitError(null);
    try {
      const result = await api.updateRoleColor(role.arn, isRoleColorId(value) ? value : null);
      onSaved(result.role);
    } catch (cause) {
      setSubmitError(toApiError(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <GuardedModal
      visible={role !== null}
      header={t.roles.editColor.header}
      testId="edit-role-color-modal"
      dirty={role !== null && changed}
      onClose={close}
      footer={(requestClose) => (
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button data-testid="edit-role-color-cancel" onClick={requestClose}>
              {t.roles.cancel}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              loadingText={t.roles.saving}
              disabled={!changed}
              data-testid="edit-role-color-submit"
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
            <FormField label={t.roles.editColor.roleNameLabel}>
              <Box variant="code" data-testid="edit-role-color-role-name">
                {role.roleName}
              </Box>
            </FormField>
            <FormField
              label={t.roles.editColor.label}
              description={t.roles.editColor.description}
            >
              <Tiles
                data-testid="edit-role-color-tiles"
                value={value}
                onChange={({ detail }) => setValue(detail.value)}
                columns={3}
                ariaLabel={t.roles.editColor.label}
                items={[
                  { value: NONE, label: t.roles.editColor.none },
                  ...ROLE_COLORS.map((color) => ({
                    value: color.id,
                    label: (
                      <span>
                        <ColorSwatch background={color.background} />
                        {t.roles.editColor.names[color.id]}
                      </span>
                    ),
                  })),
                ]}
              />
            </FormField>
          </SpaceBetween>
        </Form>
      ) : null}
    </GuardedModal>
  );
}
