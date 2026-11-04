import { useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { RevertAssignmentsResponse } from "@rolust/core";

import { api, type ApiClientError } from "../api-client.js";
import { GuardedModal } from "../components/GuardedModal.js";
import { toApiError } from "../hooks/useAsync.js";
import { describeError, useLocale, useT } from "../i18n/index.js";

/**
 * 画面 3 の「変更を取り消す」の確認（FR-7.3 / Issue #88）。
 *
 * 交点セルの未反映の変更（`+`／`−`）を、反映済みの状態に戻す。AWS には書き込まず、ChangeRequest も作らない
 * （FR-3.2）。変更が失われる破壊的な操作なので確認を挟む（GI-4）。入力欄は無いので `dirty` は常に false。
 *
 * 件数は画面が持っているマトリクスから数えた見込みで、実際の対象はサーバが取り消しの時点で
 * ロックを読み直して決める（画面を開いた後に下書きが作られた・破棄された場合に追従するため）。
 */
export function RevertChangesModal({
  open,
  changeCount,
  roleCount,
  excludedRoleCount,
  onClose,
  onDone,
}: {
  /** 開いているか。 */
  open: boolean;
  /** 取り消せる変更の見込み件数（ロックの無い列の交点）。 */
  changeCount: number;
  /** 上の変更を含むロールの数。 */
  roleCount: number;
  /** 未反映の申請があるため対象外になる、変更のあるロールの数。 */
  excludedRoleCount: number;
  onClose: () => void;
  /** API が応答したとき（一部の失敗を含む）。呼び出し側がモーダルを閉じ、読み直しと通知を行う。 */
  onDone: (result: RevertAssignmentsResponse) => void;
}): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const [reverting, setReverting] = useState(false);
  const [error, setError] = useState<ApiClientError | null>(null);

  const close = (): void => {
    setError(null);
    onClose();
  };

  const handleRevert = async (): Promise<void> => {
    setReverting(true);
    setError(null);
    try {
      onDone(await api.revertAssignments());
    } catch (cause) {
      // モーダルは閉じない。閉じると失敗した事実が行方不明になる。
      setError(toApiError(cause));
    } finally {
      setReverting(false);
    }
  };

  return (
    <GuardedModal
      visible={open}
      header={t.matrix.revertModal.header}
      testId="revert-changes-modal"
      dirty={false}
      onClose={close}
      footer={(requestClose) => (
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button data-testid="revert-changes-cancel" onClick={requestClose}>
              {t.matrix.revertModal.cancel}
            </Button>
            <Button
              variant="primary"
              loading={reverting}
              loadingText={t.matrix.revertModal.confirming}
              data-testid="revert-changes-confirm"
              onClick={() => void handleRevert()}
            >
              {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
              {reverting ? t.matrix.revertModal.confirming : t.matrix.revertModal.confirm}
            </Button>
          </SpaceBetween>
        </Box>
      )}
    >
      <SpaceBetween size="s">
        <Alert type="warning" statusIconAriaLabel={t.matrix.warningAriaLabel}>
          <Box variant="p">{t.matrix.revertModal.body(changeCount, roleCount)}</Box>
          <Box variant="p">{t.matrix.revertModal.noEffect}</Box>
          {excludedRoleCount > 0 && (
            <Box variant="p">{t.matrix.revertModal.excluded(excludedRoleCount)}</Box>
          )}
        </Alert>
        {error && (
          <Alert type="error" statusIconAriaLabel={t.error.statusIconAriaLabel} data-testid="revert-changes-error">
            {describeError(locale, t, error)}
          </Alert>
        )}
      </SpaceBetween>
    </GuardedModal>
  );
}
