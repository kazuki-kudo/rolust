import type { ButtonProps } from "@cloudscape-design/components/button";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { PermissionButton } from "../components/PermissionButton.js";
import type { DriftRepair } from "../hooks/useDriftRepair.js";
import { describeError, localizeMessage, useLocale, useT } from "../i18n/index.js";

/**
 * 乖離の詳細モーダルの 2 操作（Issue #172。FR-4.10・FR-4.11）。乖離のあるロールだけに出す。
 *
 * - 「IAM を記録に合わせる（申請を作成）」: 下書きの申請を作り、画面 4 へ遷移する。
 * - 「記録を IAM に合わせる」: 確認を経て、記録（Assignment）を IAM の現状に更新する。AWS は書き換えない。
 *
 * 状態と実行は `useDriftRepair`（確認は `DriftDetailModal` が本文の警告とフッターに出す。2 枚目のモーダルにしない（GI-10））。
 * どちらも `edit` が要る（D-7。無ければ無効にして理由を出す。GI-13）。実行中は 2 つとも無効にする。
 * 乖離の再計算はサーバが行うので、画面の確認結果は使わない（D-5）。
 */
export interface DriftRepairActionsProps {
  /** 状態と実行は `useDriftRepair`。確認はここには含めない。 */
  repair: DriftRepair;
  /** 確認から戻るときにフォーカスを返す先（「記録を IAM に合わせる」）。 */
  adoptRef: React.Ref<ButtonProps.Ref>;
}

export function DriftRepairActions({ repair, adoptRef }: DriftRepairActionsProps): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const m = t.roles.drift.repair;
  const { busy, notice, error, failures, confirming, run, openConfirm } = repair;
  // 実行中・確認中は 2 つとも押せない（確認を飛ばして restore を走らせない）。
  const blocked = busy !== null || confirming;

  return (
    <SpaceBetween size="s">
      {error !== null && (
        <Alert type="error" header={m.errorHeader} statusIconAriaLabel={t.roles.errorAriaLabel} data-testid="drift-repair-error">
          {describeError(locale, t, error)} ({t.error.codeLabel}: <code>{error.code}</code>)
        </Alert>
      )}
      {notice !== null && (
        <Alert type="info" statusIconAriaLabel={t.roles.drift.infoAriaLabel} data-testid="drift-repair-notice">
          {notice}
        </Alert>
      )}
      {failures.length > 0 && (
        <Alert type="warning" header={m.partialHeader} statusIconAriaLabel={t.roles.warningAriaLabel} data-testid="drift-repair-partial">
          <SpaceBetween size="xs">
            <ul style={{ margin: 0, paddingInlineStart: 20 }}>
              {failures.map((failure) => (
                <li key={failure.userArn}>
                  <code>{failure.userArn}</code>: {localizeMessage(locale, failure.message, failure.localized)}
                </li>
              ))}
            </ul>
            <Box variant="p">{m.partialBody}</Box>
          </SpaceBetween>
        </Alert>
      )}
      <SpaceBetween size="xxs">
        <PermissionButton
          need="edit"
          data-testid="drift-restore"
          loading={busy === "restore"}
          loadingText={m.restore.running}
          disabled={blocked}
          onClick={() => void run("restore")}
        >
          {m.restore.button}
        </PermissionButton>
        <Box variant="small" color="text-body-secondary">
          {m.restore.hint}
        </Box>
      </SpaceBetween>
      <SpaceBetween size="xxs">
        <PermissionButton
          need="edit"
          ref={adoptRef}
          data-testid="drift-adopt"
          loading={busy === "adopt"}
          loadingText={m.adopt.running}
          disabled={blocked}
          onClick={openConfirm}
        >
          {m.adopt.button}
        </PermissionButton>
        <Box variant="small" color="text-body-secondary">
          {m.adopt.hint}
        </Box>
      </SpaceBetween>
    </SpaceBetween>
  );
}
