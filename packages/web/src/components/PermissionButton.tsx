import Button, { type ButtonProps } from "@cloudscape-design/components/button";
import { permits, type Permission } from "@rolust/core";

import { useT, type Messages } from "../i18n/index.js";
import { usePermission } from "../permission.js";

/**
 * 権限が足りないときの理由。足りていれば null。
 * 画面は操作を隠さず、無効にして理由を出す（Issue #141。何を頼めば使えるようになるかが分かる）。
 */
export function permissionBlock(have: Permission, need: "edit" | "apply", t: Messages): string | null {
  return permits(have, need) ? null : permissionDeniedReason(t, need);
}

/** 権限が足りないときの理由の文（足りているかは見ない）。 */
export function permissionDeniedReason(t: Messages, need: "view" | "edit" | "apply"): string {
  return t.permission.required(need);
}

export type PermissionButtonProps = ButtonProps & {
  /** この操作に要る権限。足りなければ無効にして、理由を出す。 */
  need: "edit" | "apply";
  /** フォーカスを移すための ref（React 19 は ref を props として受ける。`Button` へそのまま渡す）。 */
  ref?: React.Ref<ButtonProps.Ref>;
};

/**
 * 権限を見て無効にする `Button`。操作の入口（モーダルを開く・保存する・反映する）に使う。
 * モーダルの中のキャンセル・確定は、入口が無効なら開けないので、これにしなくてよい。
 */
export function PermissionButton({
  need,
  disabled,
  disabledReason,
  ...rest
}: PermissionButtonProps): React.JSX.Element {
  const t = useT();
  const block = permissionBlock(usePermission(), need, t);
  return (
    <Button
      {...rest}
      disabled={disabled === true || block !== null}
      disabledReason={block ?? disabledReason}
    />
  );
}
