import { useEffect, useRef, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import type { ButtonProps } from "@cloudscape-design/components/button";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { useT } from "../i18n/index.js";

/**
 * GI-4 の「入力があるモーダルを閉じるときは破棄を確認する」を実装した `Modal` のラッパ。
 *
 * `interaction-spec.md` § FR-7.1「モーダルの Escape・背景クリック・×・キャンセル」: 「モーダルの Escape — 入力が空なら閉じる。入力があれば
 * 『入力内容を破棄しますか』を確認する」。Keyboard Map も「モーダル / Escape / 閉じる
 * （入力があれば破棄確認）」と定める。
 *
 * ## GI-10（モーダルは入れ子にしない）をどう守るか
 *
 * 確認を 2 枚目の `Modal` として重ねない。**同じモーダルの中で状態を切り替える**。
 * 具体的には、本文の先頭に確認の `Alert` を差し込み、フッターを確認用のボタン 2 つに
 * 差し替える。ダイアログは常に 1 枚である。
 *
 * ## フォーカスをどう守るか
 *
 * `interaction-spec.md` の Focus-management 要件と、`project.md` の
 * 「非同期処理中にインタラクティブ要素を別要素へ差し替えない」（Checkbox→Spinner の学習）
 * に従い、**`children`（フォーム本体）はアンマウントしない**。確認中も DOM に残る。
 * これにより:
 *
 * - Escape を押した時点でフォーカスを持っていた入力欄が DOM から消えない
 * - 「編集に戻る」で、そのフォーカス位置へそのまま戻せる
 * - 入力値も保持される（親の state だけでなく DOM も維持される）
 *
 * 差し替わるのはフッターだけである。フッターのボタンにフォーカスがあった状態
 * （「キャンセル」から入った場合）に備え、確認へ切り替えた直後に「編集に戻る」へ
 * 明示的にフォーカスを移す。どの経路でもフォーカスはダイアログの外へ出ない。
 *
 * ## 確認中の Escape
 *
 * 確認表示のまま Escape を押したら「編集に戻る」と同じ扱いにする。Escape は
 * 破壊的な確定に使わない。
 */

export interface GuardedModalProps {
  visible: boolean;
  header: React.ReactNode;
  /**
   * 入力が初期値から変化しているか。
   *
   * `true` のとき、閉じる操作（Escape / 背景クリック / × / フッターのキャンセル）に
   * 破棄確認を挟む。`false` なら従来どおり即座に閉じる。
   */
  dirty: boolean;
  /** 破棄が確定したときに呼ぶ。フォームの reset と `visible` の解除を行う。 */
  onClose: () => void;
  /**
   * フッター。引数の `requestClose` を「キャンセル」に繋ぐと GI-4 の確認を通る。
   * 送信ボタンなど、閉じる以外のアクションはそのまま置いてよい。
   */
  footer: (requestClose: () => void) => React.ReactNode;
  children: React.ReactNode;
  /** モーダル本体の `data-testid`。確認表示の要素は接尾辞付きで派生させる。 */
  testId: string;
  /** 確認の本文。既定は汎用の文言。 */
  confirmText?: string;
}

export function GuardedModal({
  visible,
  header,
  dirty,
  onClose,
  footer,
  children,
  testId,
  confirmText,
}: GuardedModalProps): React.JSX.Element {
  const t = useT();
  const [confirming, setConfirming] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const backButtonRef = useRef<ButtonProps.Ref>(null);
  // 確認へ切り替える直前にフォーカスを持っていた要素。「編集に戻る」で返す先。
  const returnFocusRef = useRef<HTMLElement | null>(null);

  // 閉じたら確認表示を畳む。次に開いたとき確認から始まってはいけない。
  useEffect(() => {
    if (!visible) setConfirming(false);
  }, [visible]);

  // 確認へ切り替えた直後、フォーカスをダイアログ内の安全な位置へ移す。
  // 既定は「編集に戻る」— Enter の連打が破棄を確定させないようにするため。
  useEffect(() => {
    if (confirming) backButtonRef.current?.focus();
  }, [confirming]);

  const requestClose = (): void => {
    if (!dirty) {
      onClose();
      return;
    }
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement ? active : null;
    setConfirming(true);
  };

  const backToEdit = (): void => {
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    setConfirming(false);
    // `children` はアンマウントされていないので、入力欄なら必ず生きている。
    // フッターのボタンから入った場合だけ消えているため、本文コンテナへ退避する。
    if (target?.isConnected) target.focus();
    else bodyRef.current?.focus();
  };

  const discard = (): void => {
    setConfirming(false);
    returnFocusRef.current = null;
    onClose();
  };

  const confirmFooter = (
    <Box float="right">
      <SpaceBetween direction="horizontal" size="xs">
        <Button
          ref={backButtonRef}
          data-testid={`${testId}-back-to-edit`}
          onClick={backToEdit}
        >
          {t.common.guardedModal.backToEdit}
        </Button>
        <Button
          variant="primary"
          data-testid={`${testId}-discard-confirm`}
          onClick={discard}
        >
          {t.common.guardedModal.discard}
        </Button>
      </SpaceBetween>
    </Box>
  );

  return (
    <Modal
      visible={visible}
      header={header}
      data-testid={testId}
      onDismiss={() => (confirming ? backToEdit() : requestClose())}
      footer={confirming ? confirmFooter : footer(requestClose)}
    >
      {/*
        `tabIndex={-1}` は Tab の停止点を増やさない（プログラムからのみフォーカスできる）。
        フォーカスの退避先が必要なのは、フッターのボタンから確認へ入った場合だけである。
        フォーカスリングは打ち消さない（`outline: none` を置き換えなしで使わない）。
      */}
      <div ref={bodyRef} tabIndex={-1}>
        <SpaceBetween size="m">
          {confirming && (
            <Alert
              type="warning"
              statusIconAriaLabel={t.common.guardedModal.warningAriaLabel}
              header={t.common.guardedModal.discardHeader}
              data-testid={`${testId}-discard-alert`}
            >
              {confirmText ?? t.common.guardedModal.defaultConfirmText}
            </Alert>
          )}
          {children}
        </SpaceBetween>
      </div>
    </Modal>
  );
}
