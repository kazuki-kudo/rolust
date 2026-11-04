import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Link from "@cloudscape-design/components/link";
import type { ExcludedRole } from "@rolust/core";

import { useT } from "../i18n/index.js";
import { exclusionReasonLabel, roleNameOf } from "../labels.js";

/**
 * ExclusionBanner — FR-4.6 により申請対象から除外されたロールを、
 * 件数・理由・解除方法とともに提示する警告帯。
 *
 * 除外を列ヘッダの状態チップと警告帯の 2 箇所で伝えるのは、片方だけでは
 * 横スクロールで列が視界外に出たとき（チップのみ）または列との対応が取れないとき
 * （帯のみ）に伝達が切れるためである（mockups.md 画面 3 の設計判断）。
 *
 * a11y: `role="status"` / `aria-live="polite"`。除外はページ表示時点で確定しており
 * 割り込みを要する緊急性はない。`(!)` 記号は Alert が担い、意味は本文テキストが運ぶ（M-3.5）。
 */

export interface ExclusionBannerProps {
  /** 除外されたロール。`no-changes` は帯に出さない（列自体が選択不可で自明なため）。 */
  excluded: ExcludedRole[];
  /** 変更のあるロールがすべて除外されたか。文面を変える。 */
  allExcluded?: boolean;
  onNavigateToRequest?: (changeRequestId: string) => void;
}

export function ExclusionBanner({
  excluded,
  allExcluded = false,
  onNavigateToRequest,
}: ExclusionBannerProps): React.JSX.Element | null {
  const t = useT();
  const blocking = excluded.filter(
    (entry) => entry.reason === "draft" || entry.reason === "failed",
  );

  // hidden 状態: 除外 0 件
  if (blocking.length === 0) return null;

  const heading = allExcluded
    ? t.matrix.exclusionBanner.allExcluded
    : t.matrix.exclusionBanner.excluded(blocking.length);

  return (
    <div data-testid="exclusion-banner" role="status" aria-live="polite">
      <Alert type="warning" header={heading} statusIconAriaLabel={t.matrix.warningAriaLabel}>
        <Box variant="p">{t.matrix.exclusionBanner.body}</Box>
        <ul data-testid="exclusion-banner-list">
          {blocking.map((entry) => (
            <li key={entry.roleArn} data-testid={`exclusion-item-${entry.roleArn}`}>
              <strong>{roleNameOf(entry.roleArn)}</strong>
              {" — "}
              {entry.changeRequestId && onNavigateToRequest ? (
                <Link
                  data-testid={`exclusion-link-${entry.roleArn}`}
                  href={`/history?highlight=${encodeURIComponent(entry.changeRequestId)}`}
                  onFollow={(event) => {
                    event.preventDefault();
                    onNavigateToRequest(entry.changeRequestId as string);
                  }}
                >
                  {exclusionReasonLabel(t, entry.reason)}
                </Link>
              ) : (
                exclusionReasonLabel(t, entry.reason)
              )}
            </li>
          ))}
        </ul>
      </Alert>
    </div>
  );
}
