import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import SpaceBetween from "@cloudscape-design/components/space-between";

import { useT } from "../i18n/index.js";

/**
 * 「記録を IAM に合わせる」の確認（Issue #172。FR-4.11・D-11・GI-4）。
 *
 * 詳細モーダルの本文の先頭に差し込む警告で、2 枚目のモーダルにはしない（GI-10: モーダルは入れ子にしない。
 * `GuardedModal` と同じく、同じモーダルの中で状態を切り替える）。確認のボタン（キャンセル・実行）はフッターに置く
 * （`DriftDetailModal`）。
 *
 * 取り込む・外すユーザの ARN 全文と、「そのユーザの未反映の編集は上書きされる」「AWS は書き換えない」を出す。
 */
export interface AdoptConfirmPanelProps {
  roleName: string;
  /** 記録に取り込む（IAM にいて記録にいない）ユーザの ARN。 */
  adopt: string[];
  /** 記録から外す（記録にいて IAM にいない）ユーザの ARN。 */
  drop: string[];
}

export function AdoptConfirmPanel({ roleName, adopt, drop }: AdoptConfirmPanelProps): React.JSX.Element {
  const t = useT();
  const m = t.roles.drift.repair.confirm;
  return (
    <Alert
      type="warning"
      header={m.header(roleName)}
      statusIconAriaLabel={t.roles.warningAriaLabel}
      data-testid="drift-adopt-confirm"
    >
      <SpaceBetween size="m">
        <Box variant="p">{m.body}</Box>
        <ArnBlock testId="drift-adopt-list-adopt" heading={m.adoptHeading} items={adopt} />
        <ArnBlock testId="drift-adopt-list-drop" heading={m.dropHeading} items={drop} />
        <Box variant="p">{m.overwriteWarning}</Box>
      </SpaceBetween>
    </Alert>
  );
}

function ArnBlock({
  testId,
  heading,
  items,
}: {
  testId: string;
  heading: string;
  items: string[];
}): React.JSX.Element | null {
  if (items.length === 0) return null;
  return (
    <div data-testid={testId}>
      <SpaceBetween size="xxs">
        <Box variant="strong">{heading}</Box>
        <ul style={{ margin: 0, paddingInlineStart: 20 }}>
          {items.map((arn) => (
            <li key={arn}>
              <code>{arn}</code>
            </li>
          ))}
        </ul>
      </SpaceBetween>
    </div>
  );
}
