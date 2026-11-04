import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import type { ButtonProps } from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { TrustDriftView } from "@rolust/core";
import { useEffect, useRef } from "react";

import { localizeMessage, useLocale, useT } from "../i18n/index.js";
import { useDriftRepair } from "../hooks/useDriftRepair.js";
import { AdoptConfirmPanel } from "./AdoptConfirmPanel.js";
import { DriftRepairActions } from "./DriftRepairActions.js";

/**
 * 乖離の詳細（FR-4.9。読み取り専用）。足りない・余分を ARN で列挙し、管理外の principal は参考として別枠に出す
 * （乖離に数えない。D-7）。読み取り失敗はエラーコードと文言を出す（GI-6）。入力を持たない確認なので、
 * 閉じる経路（Escape・背景クリック・×・「閉じる」）はすべて単に閉じる（GI-4 の破棄確認は要らない）。
 *
 * 乖離のあるロールには、直す 2 操作（Issue #172。`DriftRepairActions`）を本文の下に出す。読み取り失敗のロールには出さない
 * （乖離を算出できていない）。
 *
 * ## 「記録を IAM に合わせる」の確認（GI-10・GI-4）
 *
 * 確認は 2 枚目のモーダルにしない（モーダルは入れ子にしない）。同じモーダルの中で状態を切り替える（`GuardedModal` と同じ）:
 * 本文の先頭に確認の警告（`AdoptConfirmPanel`）を差し込み、フッターを [キャンセル / 記録を合わせる] に替える。本文は
 * アンマウントしない（起点のボタンがフォーカスを持つ位置に残る）。確認へ入ったらキャンセルへフォーカスを移し、
 * 戻ったら起点のボタンへ返す。確認中の Escape・×・背景クリックは確認だけを取り消す（親の `onDismiss` は呼ばない）。
 */
export interface DriftDetailModalProps {
  roleName: string;
  /** null なら閉じている。 */
  view: TrustDriftView | null;
  onDismiss: () => void;
  /** 記録を IAM に合わせた（adopt が全件成功した）。画面 2 が当該ロールの確認結果を「再確認が必要」にする（D-16）。 */
  onRepaired: (roleArn: string, count: number) => void;
}

export function DriftDetailModal({ roleName, view, onDismiss, onRepaired }: DriftDetailModalProps): React.JSX.Element | null {
  if (view === null) return null;
  // 閉じている間は状態（実行中・通知・エラー・確認）を持たない。ロールが替われば作り直す。
  return <DriftDetailOpen key={view.roleArn} roleName={roleName} view={view} onDismiss={onDismiss} onRepaired={onRepaired} />;
}

function DriftDetailOpen({
  roleName,
  view,
  onDismiss,
  onRepaired,
}: Omit<DriftDetailModalProps, "view"> & { view: TrustDriftView }): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const repair = useDriftRepair(view, onRepaired);
  const m = t.roles.drift.modal;
  const confirmText = t.roles.drift.repair.confirm;
  const hasDrift = view.readError === null && (view.missing.length > 0 || view.extra.length > 0);
  const confirming = repair.confirming;

  // フォーカス（GuardedModal と同じ方針）。確認へ入ったらキャンセルへ、戻ったら起点の「記録を IAM に合わせる」へ。
  // 本文はアンマウントしないので、起点のボタンは確認中も DOM に残る。
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const adoptRef = useRef<ButtonProps.Ref>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (wasConfirming.current) adoptRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  return (
    <Modal
      visible
      header={m.header(roleName)}
      data-testid="drift-detail-modal"
      // 確認中の Escape・×・背景クリックは、確認だけを取り消して詳細へ戻る（親へは伝えない）。
      onDismiss={confirming ? repair.closeConfirm : onDismiss}
      footer={
        confirming ? (
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                ref={cancelRef}
                data-testid="drift-adopt-cancel"
                disabled={repair.busy !== null}
                onClick={repair.closeConfirm}
              >
                {confirmText.cancel}
              </Button>
              {/* 記録を書き換える操作なので primary にしない（破壊的操作の規則）。 */}
              <Button
                data-testid="drift-adopt-confirm-run"
                loading={repair.busy === "adopt"}
                onClick={() => void repair.run("adopt")}
              >
                {confirmText.confirm}
              </Button>
            </SpaceBetween>
          </Box>
        ) : (
          <Box float="right">
            <Button variant="primary" data-testid="drift-detail-close" onClick={onDismiss}>
              {m.close}
            </Button>
          </Box>
        )
      }
    >
      {view.readError !== null ? (
        <div data-testid="drift-read-error">
          <SpaceBetween size="xs">
            <Box variant="strong">{m.readErrorHeading}</Box>
            <Box variant="p">{localizeMessage(locale, view.readError.message, view.readError.localized)}</Box>
            <Box variant="p">
              <code>{m.errorCode(view.readError.errorCode)}</code>
            </Box>
          </SpaceBetween>
        </div>
      ) : (
        <SpaceBetween size="m">
          {confirming && <AdoptConfirmPanel roleName={roleName} adopt={view.extra} drop={view.missing} />}
          <ArnList testId="drift-missing" heading={m.missingHeading} none={m.none} items={view.missing} />
          <ArnList testId="drift-extra" heading={m.extraHeading} none={m.none} items={view.extra} />
          <ArnList
            testId="drift-unmanaged"
            heading={m.unmanagedHeading}
            none={m.none}
            items={view.unmanaged.map(
              (principal) => `${principal.kind}: ${principal.value}${principal.effect === "Deny" ? m.denySuffix : ""}`,
            )}
          />
          {hasDrift && <DriftRepairActions repair={repair} adoptRef={adoptRef} />}
        </SpaceBetween>
      )}
    </Modal>
  );
}

function ArnList({
  testId,
  heading,
  none,
  items,
}: {
  testId: string;
  heading: string;
  none: string;
  items: string[];
}): React.JSX.Element {
  return (
    <div data-testid={testId}>
      <SpaceBetween size="xxs">
        <Box variant="strong">{heading}</Box>
        {items.length === 0 ? (
          <Box color="text-status-inactive">{none}</Box>
        ) : (
          <ul style={{ margin: 0, paddingInlineStart: 20 }}>
            {items.map((item) => (
              <li key={item}>
                <code>{item}</code>
              </li>
            ))}
          </ul>
        )}
      </SpaceBetween>
    </div>
  );
}
