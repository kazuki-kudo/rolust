import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Checkbox from "@cloudscape-design/components/checkbox";
import Container from "@cloudscape-design/components/container";
import Header from "@cloudscape-design/components/header";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import type { ApplyReport, DiffView, UnmanagedPrincipal } from "@rolust/core";

import { localizeMessage, useLocale, useT, type Locale, type Messages } from "../i18n/index.js";
import { formatTimestamp, roleNameOf, statusLabel } from "../labels.js";
import { RequestLink } from "./RequestLink.js";

/**
 * PolicyDiffPanel — 1 件の ChangeRequest について、追加/削除されるプリンシパル と
 * 管理外 principal の警告を提示するカード（`interaction-spec.md` § PolicyDiffPanel）。
 *
 * 設計上の要点（`mockups.md` 画面 4）:
 * - **ARN は全文表示し、省略しない**。差分確認は「何が信頼ポリシーに入り、何が出るか」を
 *   最終確認する場であり、末尾が切れると別ユーザとの取り違えが起きる。
 *   等幅フォント + `overflow-wrap: anywhere` で折り返して全文を見せる。
 * - **管理外 principal の警告はカード内・末尾**。差分を読んだ直後に「ただしこれらは触らない」を
 *   読ませる順序にする。ページ最上部の集約帯にすると、どのロールの話かが失われる。
 * - **警告は反映を妨げない**（FR-4.2 / Q22）。チェックボックスを disabled にせず、
 *   「了解しました」の確認も要求しない。disabled にするのは信頼ポリシーの**読み取り**に
 *   失敗した場合だけであり、これは警告ではなく差分を描画できないという別の事由である。
 */

export interface PolicyDiffPanelProps {
  /** 差分の算出結果。`diff === null` かつ `readError !== null` なら読み取り失敗。 */
  view: DiffView;
  /** 反映対象に含めるか。 */
  selected: boolean;
  onToggle: (next: boolean) => void;
  /** 反映実行中（カード全体を操作不可にする）。 */
  applying?: boolean;
  /** 反映結果。未反映なら null。 */
  report?: ApplyReport | null;
  /** 失敗時の再反映（FR-5.6）。凍結入力は変えない。 */
  onRetry?: () => void;
}

/**
 * このカードを反映対象に選べるか。
 *
 * **管理外 principal の有無は関与しない**（FR-4.2 / Q22: 警告は表示のみで反映を妨げない）。
 * 選べないのは信頼ポリシーを読み取れなかった場合だけである。
 * 画面側の「選択した n 件を反映」ボタンの活性判定もこの関数を使う。
 */
export function isSelectableForApply(view: DiffView): boolean {
  return view.readError === null && view.diff !== null;
}

const arnStyle: React.CSSProperties = {
  fontFamily: "var(--font-family-monospace, monospace)",
  // ARN は空白を含まないため、明示しないと折り返されず横スクロールになる。
  overflowWrap: "anywhere",
};

export function PolicyDiffPanel({
  view,
  selected,
  onToggle,
  applying = false,
  report = null,
  onRetry,
}: PolicyDiffPanelProps): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const { changeRequest, diff, unmanaged, readError } = view;
  const roleName = roleNameOf(changeRequest.roleArn);
  const testId = `diff-card-${changeRequest.changeRequestId}`;

  return (
    <section aria-label={t.diff.panel.sectionAria(roleName)} data-testid={testId}>
      <Container
        header={
          <Header
            variant="h3"
            description={
              <SpaceBetween size="xxs">
                <span style={arnStyle} data-testid={`${testId}-arn`}>
                  {changeRequest.roleArn}
                </span>
                {/* 反映する人へ渡す（Issue #141）。 */}
                <RequestLink changeRequestId={changeRequest.changeRequestId} />
                {/* IAM を記録に合わせる申請であることを示す（Issue #172）。adopt は IAM を書き換えないのでここには来ない。 */}
                {changeRequest.kind === "restore" && (
                  <Box variant="small" data-testid={`${testId}-kind`}>
                    {t.kind.restoreNote}
                  </Box>
                )}
              </SpaceBetween>
            }
            actions={renderHeaderActions({
              t,
              testId,
              roleName,
              selected,
              onToggle,
              applying,
              report,
              selectable: isSelectableForApply(view),
            })}
          >
            {roleName}
          </Header>
        }
      >
        <SpaceBetween size="m">
          {report ? (
            renderResult(t, locale, testId, report, onRetry, applying)
          ) : readError ? (
            <div data-testid={`${testId}-read-error`}>
              <Alert
                type="error"
                header={t.diff.panel.readErrorHeader}
                statusIconAriaLabel={t.diff.errorAriaLabel}
              >
                <Box variant="p">
                  {localizeMessage(locale, readError.message, readError.localized)}
                </Box>
                <Box variant="small">
                  {t.error.codeLabel}: <code>{readError.errorCode}</code>
                </Box>
              </Alert>
            </div>
          ) : diff ? (
            <>
              <PrincipalList
                testId={`${testId}-added`}
                heading={t.diff.panel.addedHeading}
                marker="+"
                markerLabel={t.diff.panel.addedMarker}
                arns={diff.added}
              />
              <PrincipalList
                testId={`${testId}-removed`}
                heading={t.diff.panel.removedHeading}
                marker="−"
                markerLabel={t.diff.panel.removedMarker}
                arns={diff.removed}
              />
              {/* プレースホルダは Rolust 自身の Statement で管理外警告に出ないため、ここで示す（Issue #16）。 */}
              {diff.placeholderRemoved && (
                <Box variant="small" data-testid={`${testId}-placeholder-removed`}>
                  {t.diff.panel.placeholderRemoved}
                </Box>
              )}
              {diff.placeholderInjected && (
                <Box variant="small" data-testid={`${testId}-placeholder-injected`}>
                  {t.diff.panel.placeholderInjected}
                </Box>
              )}
              {diff.alreadyPresent.length + diff.alreadyAbsent.length > 0 && (
                <Box variant="small" data-testid={`${testId}-noop`}>
                  {t.diff.panel.noop(
                    diff.alreadyPresent.length + diff.alreadyAbsent.length,
                    diff.alreadyPresent.length,
                    diff.alreadyAbsent.length,
                  )}
                </Box>
              )}
              {/* 管理外 principal の警告はカード内の末尾に置く（FR-4.2）。 */}
              <UnmanagedWarning testId={testId} unmanaged={unmanaged} />
            </>
          ) : (
            <div data-testid={`${testId}-loading`}>
              <Spinner /> {t.diff.loadingPolicy}
            </div>
          )}
        </SpaceBetween>
      </Container>
    </section>
  );
}

function renderHeaderActions(options: {
  t: Messages;
  testId: string;
  roleName: string;
  selected: boolean;
  onToggle: (next: boolean) => void;
  applying: boolean;
  report: ApplyReport | null;
  selectable: boolean;
}): React.JSX.Element {
  const { t, testId, roleName, selected, onToggle, applying, report, selectable } = options;

  if (report) {
    return (
      <span data-testid={`${testId}-status`}>
        <StatusIndicator type={report.ok ? "success" : "error"}>
          {statusLabel(t, report.ok ? "applied" : "failed")} {formatTimestamp(report.appliedAt)}
        </StatusIndicator>
      </span>
    );
  }

  if (applying) {
    return (
      <span data-testid={`${testId}-applying`}>
        <Spinner /> {t.diff.panel.applying}
      </span>
    );
  }

  return (
    <Checkbox
      data-testid={`${testId}-select`}
      checked={selected}
      disabled={!selectable}
      ariaLabel={t.diff.panel.includeAria(roleName)}
      onChange={(event) => onToggle(event.detail.checked)}
    >
      {t.diff.panel.include}
    </Checkbox>
  );
}

/** 反映結果（FR-5.5 / GI-6: AWS のエラーコードをそのまま出す）。 */
function renderResult(
  t: Messages,
  locale: Locale,
  testId: string,
  report: ApplyReport,
  onRetry: (() => void) | undefined,
  applying: boolean,
): React.JSX.Element {
  const message = localizeMessage(locale, report.message, report.localized);
  // localizedWarnings は warnings と同じ並び・同じ長さのときだけ使う。旧い応答（無い）や食い違いは warnings をそのまま出す。
  const localizedWarnings =
    report.localizedWarnings?.length === report.warnings.length ? report.localizedWarnings : undefined;

  return (
    <div data-testid={`${testId}-result`} role="status" aria-live="polite">
      <SpaceBetween size="s">
        <Box variant="p">{message}</Box>

        {report.added.length + report.removed.length > 0 && (
          <Box variant="small" data-testid={`${testId}-result-counts`}>
            {t.diff.result.counts(report.added.length, report.removed.length)}
          </Box>
        )}

        {report.warnings.map((warning, index) => (
          <Box key={index} variant="small" data-testid={`${testId}-result-warning-${index}`}>
            {localizeMessage(locale, warning, localizedWarnings?.[index])}
          </Box>
        ))}

        {!report.ok && (
          <Alert
            type="error"
            header={t.diff.result.failedHeader}
            statusIconAriaLabel={t.diff.errorAriaLabel}
          >
            <Box variant="p">
              <code>{report.errorCode ?? "UnknownError"}</code>: {message}
            </Box>
            {onRetry && (
              <Button
                data-testid={`${testId}-retry`}
                loading={applying}
                onClick={onRetry}
              >
                {t.diff.result.retry}
              </Button>
            )}
          </Alert>
        )}
      </SpaceBetween>
    </div>
  );
}

function PrincipalList({
  testId,
  heading,
  marker,
  markerLabel,
  arns,
}: {
  testId: string;
  heading: string;
  marker: "+" | "−";
  markerLabel: string;
  arns: string[];
}): React.JSX.Element {
  const t = useT();
  return (
    <div data-testid={testId}>
      <Box variant="h4">{heading}</Box>
      {arns.length === 0 ? (
        <Box variant="small">{t.diff.panel.none}</Box>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {arns.map((arn) => (
            <li key={arn} style={arnStyle} data-testid={`${testId}-${arn}`}>
              <span aria-hidden="true">{marker}</span>
              {/* 記号は装飾ではないため、視覚的に隠したテキストで意味を運ぶ（M-3.4）。 */}
              <span style={visuallyHidden}>{markerLabel}</span> {arn}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * 管理外 principal の警告（FR-4.2）。
 *
 * 文面は「**起きないこと**」を明示する。管理者が恐れるのは意図しない削除であり、
 * それが起きないと言い切るのが正しい伝達である（`interaction-spec.md`）。
 */
function UnmanagedWarning({
  testId,
  unmanaged,
}: {
  testId: string;
  unmanaged: UnmanagedPrincipal[];
}): React.JSX.Element | null {
  const t = useT();
  if (unmanaged.length === 0) return null;

  return (
    <div data-testid={`${testId}-unmanaged`}>
      <Alert
        type="warning"
        statusIconAriaLabel={t.diff.warningAriaLabel}
        header={t.diff.panel.unmanagedHeader(unmanaged.length)}
      >
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {unmanaged.map((principal, index) => (
            <li
              key={`${principal.kind}:${principal.value}:${index}`}
              style={arnStyle}
              data-testid={`${testId}-unmanaged-${index}`}
            >
              {principal.value}
              <Box variant="small" display="inline">
                {" "}
                {t.diff.panel.unmanagedDetail(principal.kind, principal.effect === "Deny")}
              </Box>
            </li>
          ))}
        </ul>
      </Alert>
    </div>
  );
}

const visuallyHidden: React.CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};
