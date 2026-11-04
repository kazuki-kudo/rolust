import { useCallback, useMemo, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import DateRangePicker, {
  type DateRangePickerProps,
} from "@cloudscape-design/components/date-range-picker";
import ExpandableSection from "@cloudscape-design/components/expandable-section";
import Flashbar from "@cloudscape-design/components/flashbar";
import FormField from "@cloudscape-design/components/form-field";
import { PageHeading } from "../components/PageHeading.js";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Select from "@cloudscape-design/components/select";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import type { ChangeRequest, ChangeRequestStatus } from "@rolust/core";
import { isDiscardable } from "@rolust/core";

import { api } from "../api-client.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { PermissionButton } from "../components/PermissionButton.js";
import { RequestStatusChip } from "../components/RequestStatusChip.js";
import {
  NO_CONDITIONS,
  type DateRange,
  createdFromParam,
  defaultCreatedRange,
  filterRequests,
  hasConditions,
  type StatusFilter,
} from "../history-filter.js";
import { describeError, localizeMessage, useLocale, useT, type Locale, type Messages } from "../i18n/index.js";
import { actorLabel, formatTimestamp, kindLabel, roleNameOf, shortRequestId, statusLabel } from "../labels.js";
import { toApiError, useAsync } from "../hooks/useAsync.js";
import { useAutoDismiss } from "../hooks/useAutoDismiss.js";
import { navigate } from "../router.js";
import { ROUTES, requestsPath } from "../routes.js";
import { RequestLink } from "../components/RequestLink.js";

/**
 * 画面 5 — FR-7.5 申請履歴。**破棄の唯一の起点**（Q27）。
 *
 * - **状態列を最左**に置く。管理者が最初に探すのは「今アクションが必要な申請」であり、
 *   それを決めるのは状態である。
 * - **操作列は状態によって出し分ける**。反映済み・破棄に破棄ボタンを出さない。
 *   無効なボタンを disabled で並べるのではなく**非表示**にする — 破棄済みの申請を
 *   再度破棄する操作は概念的に存在しない（FR-4.8）。
 * - **破棄は確認モーダルを挟む**。破棄によって当該ロールの FR-4.6 ロックが解けるという
 *   副作用があるため、モーダル本文にそれを明記する。
 * - 申請 ID の列は先頭 9 文字（`cr-` を含む）の短縮表示（短縮したら「…」を付ける）と、URL のコピーのアイコン（Issue #145・#148）。検索条件は前方一致。
 * - 作成者・反映者の列を持つ（Issue #120）。実行者なし（#120 より前の申請、未反映）は「—」。
 * - 絞り込みは状態・作成日・反映日の日付範囲・対象の IAMロール（`roleArn` の部分一致）・申請 ID（前方一致。Issue #145）の AND（Issue #109）。
 *   状態・反映日・対象の IAMロールは取得済みの申請を画面側で絞る。作成日の範囲は取得も絞り、始端を
 *   API の `createdFrom` に渡す（初期値は 3 か月前。下書き・失敗は範囲の対象外。Issue #116）。
 *   見出しの件数は絞り込みに連動させない（取得した申請の数）。ページングは置かない（NFR-1）。
 */

/**
 * 通知。文言は描画のときに選んだ言語で組み立てる（出ている通知も、言語を切り替えると追随する）。
 * 失敗の本文は `ApiClientError` のまま持ち、描画のときに `describeError` を通す。
 */
interface Notice {
  type: "success" | "warning" | "error";
  text: (t: Messages, locale: Locale) => string;
}

function filterOptions(t: Messages): { value: StatusFilter; label: string }[] {
  return [
    { value: "all", label: t.history.filter.all },
    { value: "draft", label: statusLabel(t, "draft") },
    { value: "failed", label: statusLabel(t, "failed") },
    { value: "applied", label: statusLabel(t, "applied") },
    { value: "discarded", label: statusLabel(t, "discarded") },
  ];
}

function dateRangeStrings(t: Messages): DateRangePickerProps.I18nStrings {
  const strings = t.history.dateRange;
  return {
    applyButtonLabel: strings.applyButtonLabel,
    cancelButtonLabel: strings.cancelButtonLabel,
    clearButtonLabel: strings.clearButtonLabel,
    startDateLabel: strings.startDateLabel,
    endDateLabel: strings.endDateLabel,
    startMonthLabel: strings.startMonthLabel,
    endMonthLabel: strings.endMonthLabel,
    todayAriaLabel: strings.todayAriaLabel,
    nextMonthAriaLabel: strings.nextMonthAriaLabel,
    previousMonthAriaLabel: strings.previousMonthAriaLabel,
    currentMonthAriaLabel: strings.currentMonthAriaLabel,
    nextYearAriaLabel: strings.nextYearAriaLabel,
    previousYearAriaLabel: strings.previousYearAriaLabel,
    errorIconAriaLabel: strings.errorIconAriaLabel,
    isoDatePlaceholder: strings.isoDatePlaceholder,
    slashedDatePlaceholder: strings.slashedDatePlaceholder,
    dateConstraintText: strings.dateConstraintText,
    slashedDateConstraintText: strings.slashedDateConstraintText,
    isoDateConstraintText: strings.isoDateConstraintText,
    renderSelectedAbsoluteRangeAriaLive: strings.selectedRangeAriaLive,
  };
}

/** dateOnly の値は `YYYY-MM-DD`。端が空なら、その端は無条件。 */
function toDateRange(value: DateRangePickerProps.AbsoluteValue | null): DateRange | null {
  return value ? { from: value.startDate || null, to: value.endDate || null } : null;
}

/** `DateRange` を `DateRangePicker` の値にする。終端が無ければ空文字（終端なし）。 */
function toRangeValue(range: DateRange): DateRangePickerProps.AbsoluteValue {
  return { type: "absolute", startDate: range.from ?? "", endDate: range.to ?? "" };
}

function isValidDateRangeIn(
  t: Messages,
): (value: DateRangePickerProps.Value | null) => DateRangePickerProps.ValidationResult {
  return (value) =>
    value && value.type === "absolute" && value.startDate > value.endDate
      ? { valid: false, errorMessage: t.history.filter.invalidRange }
      : { valid: true };
}

export function HistoryScreen({
  highlight,
}: {
  highlight: string | null;
}): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const h = t.history;
  // 言語が変わるまで同一性を保つ（Cloudscape の Select・DateRangePicker へ毎回新しい配列・関数を渡さない）。
  const statusOptions = useMemo(() => filterOptions(t), [t]);
  const rangeStrings = useMemo(() => dateRangeStrings(t), [t]);
  const isValidDateRange = useMemo(() => isValidDateRangeIn(t), [t]);
  // 作成日の範囲の初期値は今日から 3 か月前〜（Issue #116）。マウント時に 1 度だけ決める。
  const [defaultRange] = useState(() => toRangeValue(defaultCreatedRange(new Date())));
  const [range, setRange] = useState<DateRangePickerProps.AbsoluteValue | null>(defaultRange);
  // 始端が変わるたびに再取得する。範囲を空にすると createdFrom なし（全期間）になる。
  const createdFrom = createdFromParam(toDateRange(range));
  const load = useCallback(() => api.listChangeRequests({ createdFrom }), [createdFrom]);
  const { state, reload } = useAsync(load);

  const [filter, setFilter] = useState<StatusFilter>("all");
  const [appliedRange, setAppliedRange] = useState<DateRangePickerProps.AbsoluteValue | null>(null);
  const [role, setRole] = useState("");
  const [requestId, setRequestId] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(highlight ? [highlight] : []),
  );
  const [discardTarget, setDiscardTarget] = useState<ChangeRequest | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // GI-5: 成功通知だけ 5 秒で消す。警告（ロック解放失敗）とエラーは残す。
  useAutoDismiss(notice?.type === "success" ? notice : null, () => setNotice(null));

  // useMemo で包むのは、下流の useMemo の依存として同一性が安定している必要があるため。
  const all = useMemo(
    () => (state.status === "success" ? state.data.changeRequests : []),
    [state],
  );

  const counts = useMemo(() => {
    const tally: Record<ChangeRequestStatus, number> = {
      draft: 0,
      applied: 0,
      failed: 0,
      discarded: 0,
    };
    for (const request of all) tally[request.status] += 1;
    return tally;
  }, [all]);

  const conditions = useMemo(
    () => ({
      status: filter,
      range: toDateRange(range),
      appliedRange: toDateRange(appliedRange),
      role,
      requestId,
    }),
    [filter, range, appliedRange, role, requestId],
  );
  const filtered = hasConditions(conditions, toDateRange(defaultRange));
  const items = useMemo(() => filterRequests(all, conditions), [all, conditions]);

  const clearConditions = (): void => {
    setFilter(NO_CONDITIONS.status);
    setRange(defaultRange);
    setAppliedRange(null);
    setRole(NO_CONDITIONS.role);
    setRequestId(NO_CONDITIONS.requestId);
  };

  const toggleExpanded = (changeRequestId: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(changeRequestId)) next.delete(changeRequestId);
      else next.add(changeRequestId);
      return next;
    });
  };

  const runDiscard = async (): Promise<void> => {
    if (!discardTarget) return;
    setDiscarding(true);
    try {
      const result = await api.discardChangeRequest(discardTarget.changeRequestId);
      // 破棄は成功しているが FR-4.6 のロックが漏れた場合は警告として出す。
      // 「破棄しました」だけを出すと、新しい申請を作れない理由が利用者に分からない。
      const roleName = roleNameOf(discardTarget.roleArn);
      setNotice(
        result.lockWarning
          ? {
              type: "warning",
              text: (m, notedLocale) =>
                m.history.notices.discardedLockLeaked(
                  roleName,
                  localizeMessage(notedLocale, result.lockWarning ?? "", result.localizedLockWarning),
                ),
            }
          : {
              type: "success",
              text: (m) =>
                result.lockReleased
                  ? m.history.notices.discardedUnlocked(roleName)
                  : m.history.notices.discarded,
            },
      );
      setDiscardTarget(null);
      reload();
    } catch (cause) {
      const error = toApiError(cause);
      setNotice({
        type: "error",
        text: (m, noticeLocale) => m.history.notices.discardFailed(describeError(noticeLocale, m, error)),
      });
      setDiscardTarget(null);
      // **失敗しても必ず再取得する。** 失敗の理由が「破棄は確定したがその後で落ちた」
      // ケースを画面からは区別できない。古い行を出したままにすると、実際は破棄済みの
      // 申請に対して再開・再反映の導線を提示してしまう。
      reload();
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <ContentLayout
      header={
        <PageHeading
          title={h.title}
          counts={
            state.status === "success"
              ? h.counts(all.length, counts.draft, counts.failed, counts.applied, counts.discarded)
              : h.countsLoading
          }
        />
      }
    >
      <SpaceBetween size="l">
        {range?.startDate && (
          <Box variant="small" data-testid="history-range-note">
            {h.rangeNote(range.startDate)}
          </Box>
        )}
        {notice && (
          <Flashbar
            items={[
              {
                type: notice.type,
                content: notice.text(t, locale),
                dismissible: true,
                onDismiss: () => setNotice(null),
                id: "history-notice",
              },
            ]}
          />
        )}

        {state.status === "error" ? (
          <ErrorPanel
            header={h.loadErrorHeader}
            error={state.error}
            onRetry={reload}
            testId="history-error"
          />
        ) : (
          <Table<ChangeRequest>
            stickyHeader
            items={items}
            loading={state.status === "loading"}
            loadingText={h.loading}
            trackBy={(request) => request.changeRequestId}
            wrapLines
            data-testid="history-table"
            filter={
              <SpaceBetween size="s">
                <SpaceBetween direction="horizontal" size="m">
                  <FormField label={h.filter.statusLabel}>
                    <Select
                      data-testid="history-filter"
                      ariaLabel={h.filter.statusAria}
                      selectedOption={
                        statusOptions.find((option) => option.value === filter) ?? null
                      }
                      options={statusOptions}
                      onChange={(event) =>
                        setFilter((event.detail.selectedOption.value ?? "all") as StatusFilter)
                      }
                    />
                  </FormField>
                  <FormField label={h.filter.createdLabel}>
                    <DateRangePicker
                      data-testid="history-range"
                      ariaLabel={h.filter.createdAria}
                      value={range}
                      dateOnly
                      rangeSelectorMode="absolute-only"
                      relativeOptions={[]}
                      placeholder={h.filter.rangePlaceholder}
                      isValidRange={isValidDateRange}
                      onChange={({ detail }) =>
                        setRange(detail.value?.type === "absolute" ? detail.value : null)
                      }
                      i18nStrings={rangeStrings}
                    />
                  </FormField>
                  <FormField label={h.filter.appliedLabel}>
                    <DateRangePicker
                      data-testid="history-applied-range"
                      ariaLabel={h.filter.appliedAria}
                      value={appliedRange}
                      dateOnly
                      rangeSelectorMode="absolute-only"
                      relativeOptions={[]}
                      placeholder={h.filter.rangePlaceholder}
                      isValidRange={isValidDateRange}
                      onChange={({ detail }) =>
                        setAppliedRange(detail.value?.type === "absolute" ? detail.value : null)
                      }
                      i18nStrings={rangeStrings}
                    />
                  </FormField>
                  <FormField label={h.filter.roleLabel}>
                    <Input
                      data-testid="history-role"
                      ariaLabel={h.filter.roleAria}
                      type="search"
                      value={role}
                      placeholder={h.filter.rolePlaceholder}
                      onChange={(event) => setRole(event.detail.value)}
                    />
                  </FormField>
                  <FormField label={h.filter.requestIdLabel}>
                    <Input
                      data-testid="history-request-id"
                      ariaLabel={h.filter.requestIdAria}
                      type="search"
                      value={requestId}
                      placeholder="cr-ccb630"
                      onChange={(event) => setRequestId(event.detail.value)}
                    />
                  </FormField>
                </SpaceBetween>
                {filtered && state.status === "success" && (
                  <SpaceBetween direction="horizontal" size="s" alignItems="center">
                    <Box variant="small" data-testid="history-match-count">
                      {h.filter.matchCount(items.length, all.length)}
                    </Box>
                    <Button
                      variant="inline-link"
                      data-testid="history-clear-all"
                      onClick={clearConditions}
                    >
                      {h.filter.clearAll}
                    </Button>
                  </SpaceBetween>
                )}
              </SpaceBetween>
            }
            empty={
              <Box textAlign="center" padding="l" data-testid="history-empty">
                <SpaceBetween size="s">
                  <Box variant="strong">
                    {all.length === 0 ? h.empty.none : h.empty.noMatch}
                  </Box>
                  {all.length === 0 ? (
                    <Button
                      data-testid="history-empty-to-matrix"
                      onClick={() => navigate(ROUTES.matrix)}
                    >
                      {h.empty.toMatrix}
                    </Button>
                  ) : (
                    <Button
                      variant="inline-link"
                      data-testid="history-clear-filter"
                      onClick={clearConditions}
                    >
                      {h.empty.clearFilter}
                    </Button>
                  )}
                </SpaceBetween>
              </Box>
            }
            columnDefinitions={[
              {
                // 状態列は最左。この画面で最初に探すのは「今アクションが必要な申請」である。
                id: "status",
                header: h.columns.status,
                // バッジ（アイコン + 状態の語）が収まる幅。ロール名の列に幅を回す（Issue #128）。
                width: 130,
                // 列が増えても「反映済み」を折り返さない最小幅。収まらなければ表が横にスクロールする（Issue #145）。
                minWidth: 110,
                cell: (request) => {
                  const kind = kindLabel(t, request.kind);
                  const chip = (
                    <RequestStatusChip
                      state={request.status}
                      testId={`history-status-${request.changeRequestId}`}
                    />
                  );
                  // 種別のない通常の申請は、これまでと同じ DOM のままにする（Issue #172）。
                  if (kind === null) return chip;
                  return (
                    <SpaceBetween size="xxs">
                      {chip}
                      <Box variant="small" data-testid={`history-kind-${request.changeRequestId}`}>
                        {kind}
                      </Box>
                    </SpaceBetween>
                  );
                },
              },
              {
                id: "role",
                header: h.columns.role,
                // ロール名（最大 64 字）を折り返さずに読める最小幅。収まらなければテーブルが横にスクロールする（Issue #128）。
                minWidth: 380,
                cell: (request) => (
                  <ExpandableSection
                    variant="footer"
                    headerText={<span style={{ whiteSpace: "nowrap" }}>{roleNameOf(request.roleArn)}</span>}
                    expanded={expanded.has(request.changeRequestId)}
                    data-testid={`history-detail-${request.changeRequestId}`}
                    onChange={() => toggleExpanded(request.changeRequestId)}
                  >
                    <SpaceBetween size="xs">
                      <Box variant="small">
                        {h.detail.requestId}<code>{request.changeRequestId}</code>
                      </Box>
                      <Box variant="small">
                        {h.detail.roleArn}<code>{request.roleArn}</code>
                      </Box>
                      <ArnList heading={h.detail.addHeading} arns={request.addUserArns} />
                      <ArnList heading={h.detail.removeHeading} arns={request.removeUserArns} />
                      <Box variant="small">
                        {h.detail.appliedAt}{formatTimestamp(request.appliedAt)}
                      </Box>
                      {request.result && (
                        <Box variant="small">
                          {h.detail.result}<code>{request.result.errorCode ?? "OK"}</code>{" "}
                          {localizeMessage(locale, request.result.message, request.result.localized)}
                        </Box>
                      )}
                    </SpaceBetween>
                  </ExpandableSection>
                ),
              },
              {
                // 目視の目印（Issue #145）。全文は詳細の「申請 ID」と「URL をコピー」にある。
                id: "requestId",
                header: h.columns.requestId,
                // 短縮 ID（「…」付き）と、URL のコピーのアイコン（Issue #148）が収まる幅。
                width: 160,
                minWidth: 145,
                cell: (request) => (
                  <span style={{ whiteSpace: "nowrap" }}>
                    <code data-testid={`history-request-id-${request.changeRequestId}`}>
                      {shortRequestId(request.changeRequestId)}
                    </code>{" "}
                    <RequestLink changeRequestId={request.changeRequestId} showId={false} />
                  </span>
                ),
              },
              {
                id: "createdAt",
                header: h.columns.createdAt,
                width: 180,
                cell: (request) => formatTimestamp(request.createdAt),
              },
              {
                id: "appliedAt",
                header: h.columns.appliedAt,
                width: 180,
                cell: (request) => (
                  <span data-testid={`history-applied-at-${request.changeRequestId}`}>
                    {formatTimestamp(request.appliedAt)}
                  </span>
                ),
              },
              {
                id: "createdBy",
                header: h.columns.createdBy,
                width: 140,
                cell: (request) => (
                  <span data-testid={`history-created-by-${request.changeRequestId}`}>
                    {actorLabel(request.createdBy)}
                  </span>
                ),
              },
              {
                id: "appliedBy",
                header: h.columns.appliedBy,
                width: 140,
                cell: (request) => (
                  <span data-testid={`history-applied-by-${request.changeRequestId}`}>
                    {actorLabel(request.appliedBy)}
                  </span>
                ),
              },
              {
                id: "actions",
                header: h.columns.actions,
                width: 180,
                cell: (request) => (
                  <SpaceBetween direction="horizontal" size="xs">
                    {request.status === "draft" && (
                      <Button
                        variant="inline-link"
                        data-testid={`history-resume-${request.changeRequestId}`}
                        onClick={() => navigate(requestsPath([request.changeRequestId]))}
                      >
                        {h.actions.resume}
                      </Button>
                    )}
                    {request.status === "failed" && (
                      <Button
                        variant="inline-link"
                        data-testid={`history-reapply-${request.changeRequestId}`}
                        onClick={() => navigate(requestsPath([request.changeRequestId]))}
                      >
                        {h.actions.reapply}
                      </Button>
                    )}
                    {/* FR-4.8: 破棄できるのは下書きまたは失敗のみ。他は表示しない。 */}
                    {isDiscardable(request.status) && (
                      <PermissionButton need="edit"
                        variant="inline-link"
                        data-testid={`history-discard-${request.changeRequestId}`}
                        onClick={() => setDiscardTarget(request)}
                      >
                        {h.actions.discard}
                      </PermissionButton>
                    )}
                    {!isDiscardable(request.status) && (
                      <Button
                        variant="inline-link"
                        data-testid={`history-details-${request.changeRequestId}`}
                        onClick={() => toggleExpanded(request.changeRequestId)}
                      >
                        {h.actions.details}
                      </Button>
                    )}
                  </SpaceBetween>
                ),
              },
            ]}
          />
        )}
      </SpaceBetween>

      {/*
        GI-4 の破棄確認は掛けない（`GuardedModal` を使わない）。このモーダル自体が
        破棄の確認であり、入力欄を持たないため、閉じても失われる入力が存在しない。
        「破棄確認を閉じるための破棄確認」は意味を持たず、GI-4 の目的（入力の
        取りこぼしを防ぐ）にも合致しない。Escape で即座に閉じるのが正しい挙動である。
      */}
      <Modal
        visible={discardTarget !== null}
        header={h.discardModal.header}
        data-testid="discard-modal"
        onDismiss={() => setDiscardTarget(null)}
        footer={
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button data-testid="discard-cancel" onClick={() => setDiscardTarget(null)}>
                {h.discardModal.cancel}
              </Button>
              <Button
                variant="primary"
                loading={discarding}
                loadingText={h.discardModal.confirming}
                data-testid="discard-confirm"
                onClick={() => void runDiscard()}
              >
                {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
                {discarding ? h.discardModal.confirming : h.discardModal.confirm}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <Alert type="warning" statusIconAriaLabel={h.warningAriaLabel}>
          <SpaceBetween size="xs">
            <Box variant="p">{h.discardModal.keptInHistory}</Box>
            {/* FR-4.6 のロックが解ける副作用の明示。 */}
            <Box variant="p">
              {h.discardModal.unlockBefore}
              <strong>{roleNameOf(discardTarget?.roleArn ?? "")}</strong>
              {h.discardModal.unlockAfter}
            </Box>
          </SpaceBetween>
        </Alert>
      </Modal>
    </ContentLayout>
  );
}

function ArnList({
  heading,
  arns,
}: {
  heading: string;
  arns: string[];
}): React.JSX.Element {
  const t = useT();
  return (
    <Box variant="small">
      {t.history.detail.arnList(heading, arns.length)}
      {arns.length > 0 && (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {arns.map((arn) => (
            // ARN は識別子であり全文が必要。省略記号で切らず折り返す。
            <li key={arn} style={{ overflowWrap: "anywhere" }}>
              <code>{arn}</code>
            </li>
          ))}
        </ul>
      )}
    </Box>
  );
}
