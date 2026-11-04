import { useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { RoleView } from "@rolust/core";

import { api } from "../api-client.js";
import type { ApiClientError } from "../api-client.js";
import { GuardedModal } from "../components/GuardedModal.js";
import { toApiError } from "../hooks/useAsync.js";
import { describeError, useLocale, useT } from "../i18n/index.js";
import { statusLabel } from "../labels.js";
import { navigate } from "../router.js";
import { historyPath } from "../routes.js";

/**
 * 画面 2 の IAMロールの削除（FR-2.4 / Issue #22。spec `docs/superpowers/specs/2026-10-02-role-deletion-design.md`）。
 *
 * 未反映の申請が無いロールだけを削除できる（Issue #135 で、紐づきを理由にしないよう改めた。登録したロールは常に
 * 紐づいている）。行の「削除」は無効にせず、このモーダルで理由と直し方を示す（Issue #22 spec D-9。
 * 無効なボタンだけでは理由が分からない）。
 * 削除は Rolust の記録だけを消し、AWS 上の IAMロールと信頼ポリシーには触れない（spec D-2）。
 *
 * 入力欄を持たないので `dirty` は常に false（GI-4 の判断を経ていることを示すため `GuardedModal` を通す）。
 */
export function DeleteRoleModal({
  role,
  onClose,
  onDeleted,
}: {
  /** 対象のロール。null なら閉じている。 */
  role: RoleView | null;
  onClose: () => void;
  /** 削除に成功したとき。呼び出し側がモーダルを閉じ、通知と一覧の読み直しを行う。 */
  onDeleted: (role: RoleView) => void;
}): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const [deleting, setDeleting] = useState(false);
  // API のエラーのまま持ち、描画のたびに選んだ言語で文にする。
  const [error, setError] = useState<ApiClientError | null>(null);

  const unreflected = role?.unreflected ?? null;
  const blocked = unreflected !== null;

  const close = (): void => {
    setError(null);
    onClose();
  };

  /** 直し方のリンク。モーダルを閉じてから、その画面へ移る。 */
  const follow = (to: string) => (event: { preventDefault: () => void }) => {
    event.preventDefault();
    close();
    navigate(to);
  };

  const handleDelete = async (): Promise<void> => {
    if (!role) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteRole(role.arn);
      onDeleted(role);
    } catch (cause) {
      // モーダルは閉じない。閉じると失敗した事実が行方不明になる。
      setError(toApiError(cause));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <GuardedModal
      visible={role !== null}
      header={blocked ? t.roles.delete.blockedHeader : t.roles.delete.header}
      testId="delete-role-modal"
      dirty={false}
      onClose={close}
      footer={(requestClose) => (
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button data-testid="delete-role-cancel" onClick={requestClose}>
              {blocked ? t.roles.close : t.roles.cancel}
            </Button>
            {!blocked && (
              <Button
                variant="primary"
                loading={deleting}
                loadingText={t.roles.delete.unregistering}
                data-testid="delete-role-confirm"
                onClick={() => void handleDelete()}
              >
                {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
                {deleting
                  ? t.roles.delete.unregistering
                  : role && role.assignments.total > 0
                    ? t.roles.delete.confirmWithAssignments
                    : t.roles.unregister}
              </Button>
            )}
          </SpaceBetween>
        </Box>
      )}
    >
      {role &&
        (blocked ? (
          <Alert type="warning" statusIconAriaLabel={t.roles.warningAriaLabel} data-testid="delete-role-blockers">
            <SpaceBetween size="xs">
              <Box variant="p">
                <strong>{role.roleName}</strong> {t.roles.delete.blockedBody}
              </Box>
              {unreflected && (
                <Box variant="p">
                  {t.roles.delete.unreflectedRequest(statusLabel(t, unreflected.status))}{" "}
                  <Link
                    href={historyPath(unreflected.changeRequestId)}
                    data-testid="delete-role-to-history"
                    onFollow={follow(historyPath(unreflected.changeRequestId))}
                  >
                    {t.roles.delete.openHistory}
                  </Link>
                </Box>
              )}
            </SpaceBetween>
          </Alert>
        ) : (
          <SpaceBetween size="s">
            {role.assignments.total > 0 && (
              <Alert type="warning" statusIconAriaLabel={t.roles.warningAriaLabel} data-testid="delete-role-assignments">
                {t.roles.delete.assignmentsRemain(role.assignments.total, role.assignments.pending)}
              </Alert>
            )}
            <Alert type="warning" statusIconAriaLabel={t.roles.warningAriaLabel}>
              <Box variant="p">
                <strong>{role.roleName}</strong>
                {t.roles.delete.introBeforeArn}
                <code>{role.arn}</code>
                {t.roles.delete.introAfterArn}
              </Box>
              <Box variant="p">{t.roles.delete.notTouched}</Box>
              <Box variant="p">{t.roles.delete.historyKept}</Box>
            </Alert>
            {error && (
              <Alert type="error" statusIconAriaLabel={t.roles.errorAriaLabel} data-testid="delete-role-error">
                {describeError(locale, t, error)}
              </Alert>
            )}
          </SpaceBetween>
        ))}
    </GuardedModal>
  );
}
