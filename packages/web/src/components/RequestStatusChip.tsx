import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { ChangeRequestStatus } from "@rolust/core";

import { useT } from "../i18n/index.js";
import { STATUS_INDICATOR_TYPE, formatTimestamp, statusLabel } from "../labels.js";

/**
 * RequestStatusChip — ChangeRequest の状態を色と**語**で示すチップ。
 *
 * a11y M-3.6: 状態は色のみで示されず、状態語がテキストとして存在する。
 * 誤読の帰結が AWS 上の権限の誤設定であるため Must に置かれている。
 *
 * 実装区分: Cloudscape `StatusIndicator` のラッパ（Component Inventory）。
 */

export interface RequestStatusChipProps {
  state: ChangeRequestStatus;
  /** 併記する時刻（作成時刻または反映時刻）。 */
  timestamp?: string | null;
  /** true のとき該当申請へのリンクになる。 */
  interactive?: boolean;
  onFollow?: () => void;
  testId?: string;
}

export function RequestStatusChip({
  state,
  timestamp = null,
  interactive = false,
  onFollow,
  testId = "request-status-chip",
}: RequestStatusChipProps): React.JSX.Element {
  const t = useT();
  const label = statusLabel(t, state);
  const suffix = timestamp ? ` ${formatTimestamp(timestamp)}` : "";

  const indicator = (
    <StatusIndicator type={STATUS_INDICATOR_TYPE[state]}>
      {label}
      {suffix}
    </StatusIndicator>
  );

  if (!interactive) {
    return (
      <span data-testid={testId} data-state={state}>
        {indicator}
      </span>
    );
  }

  return (
    <button
      type="button"
      data-testid={testId}
      data-state={state}
      onClick={onFollow}
      style={{
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
        font: "inherit",
      }}
    >
      {indicator}
    </button>
  );
}
