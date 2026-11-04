import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Flashbar from "@cloudscape-design/components/flashbar";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import type { Assignment, Locale, MatrixView, RevertAssignmentsResponse } from "@rolust/core";
import { countChangesByRole } from "@rolust/core";

import { useActorKey } from "../actor.js";
import { api } from "../api-client.js";
import { AssignmentMatrix, cellKey } from "../components/AssignmentMatrix.js";
import { PageHeading } from "../components/PageHeading.js";
import { PermissionButton } from "../components/PermissionButton.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { exclusionReasonLabel, roleNameOf } from "../labels.js";
import { toApiError, useAsync } from "../hooks/useAsync.js";
import { useAutoDismiss } from "../hooks/useAutoDismiss.js";
import { useMatrixHidden } from "../hooks/useMatrixHidden.js";
import { describeError, localizeMessage, useLocale, useT, type Messages } from "../i18n/index.js";
import { navigate } from "../router.js";
import { ROUTES, historyPath, requestsPath } from "../routes.js";
import { RevertChangesModal } from "./RevertChangesModal.js";

/**
 * 画面 3 — FR-7.3 IAMロール割り当て。本 poc の中心画面。
 *
 * ## 保存の方針（FR-3.2 / MQ-4）
 *
 * チェック増減は**交点 1 件ずつ即時に保存する**。保存ボタンは置かない —
 * 「保存＝反映」と誤解される危険があり、FR-3.2 は「チェック増減は AWS へ一切書き込まない」と
 * 定めているためである。
 *
 * **楽観的更新は行わない**。チェック状態はサーバの応答で確定した `Assignment` のみを
 * 描画元とする。保存に失敗した場合、画面の状態は操作前のまま変わらず（＝チェックが戻り）、
 * ツールバー位置にエラー帯を出す。保存できていない状態を保存済みに見せると、
 * FR-3.2 の判定が UI 上で偽になる。
 *
 * ## 列の自動プリセレクト（DF-4 / Q4）
 *
 * 変更件数が 0 → 1 になった列は自動的に選択され、1 → 0 になった列は選択が外れる。
 * 管理者がチェックを増減した直後に「申請を作成」を押すのが最短の動線だからである。
 * 選択解除は手で行えるため取捨選択の自由は失われない。
 */

const SUBMIT_BUTTON_ID = "matrix-submit-button";

/**
 * 通知は、作った時点の言語の文字列ではなく、描画の時点の言語で文字列にする関数を持つ（Issue #94）。
 * 常駐する帯が、言語を切り替えても元の言語のまま残らないようにするため。
 */
type NoticeText = (m: Messages, locale: Locale) => string;

interface CreationNotice {
  type: "info" | "error";
  header: NoticeText;
  lines: NoticeText[];
}

export function MatrixScreen(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  // ユーザプールはデプロイにつき 1 つに固定したので（Issue #108）、プールの選択も `?pool=` も無い。
  const loadMatrix = useCallback(() => api.getMatrix(), []);
  const { state, reload, patch } = useAsync<MatrixView>(loadMatrix);

  const matrix = state.status === "success" ? state.data : null;

  // 非表示の状態（Issue #140）。自動選択（DF-4）が非表示のロールを除くために、画面が持って部品へ渡す。
  const hiddenController = useMatrixHidden(useActorKey());
  const hiddenRoleArnsRef = useRef<ReadonlySet<string>>(hiddenController.hidden.roleArns);
  hiddenRoleArnsRef.current = hiddenController.hidden.roleArns;

  const [selectedRoleArns, setSelectedRoleArns] = useState<string[]>([]);
  const [savingCells, setSavingCells] = useState<ReadonlySet<string>>(new Set());
  const [saveError, setSaveError] = useState<{ text: NoticeText } | null>(null);
  const [creating, setCreating] = useState(false);
  const [creationNotice, setCreationNotice] = useState<CreationNotice | null>(null);
  // 未反映の変更の取り消し（Issue #88）。
  const [revertOpen, setRevertOpen] = useState(false);
  const [revertNotice, setRevertNotice] = useState<{ text: NoticeText } | null>(null);
  const [revertFailure, setRevertFailure] = useState<RevertAssignmentsResponse | null>(null);
  // 絞り込み欄の枠（ツールバー内）。AssignmentMatrix がここへ欄を描く（Issue #155）。
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  useAutoDismiss(revertNotice, () => setRevertNotice(null));

  /** 直前の変更件数。0 →(1 以上) の遷移を検出して自動選択するために保持する。 */
  const previousCounts = useRef<Map<string, number>>(new Map());

  const changeCounts = useMemo(
    () => (matrix ? countChangesByRole(matrix.assignments) : new Map<string, number>()),
    [matrix],
  );

  // DF-4: 変更件数の 0 ⇄ 1 の遷移に追従して選択を出し入れする。
  useEffect(() => {
    if (!matrix) return;

    const before = previousCounts.current;
    const additions: string[] = [];
    const removals: string[] = [];

    for (const role of matrix.roles) {
      const previous = before.get(role.arn) ?? 0;
      const current = changeCounts.get(role.arn) ?? 0;
      if (matrix.locks[role.arn]) {
        removals.push(role.arn);
        continue;
      }
      // 非表示のロールは自動選択しない（Issue #140。spec D-13）。選択中の列は常に見えている、を保つ。
      if (previous === 0 && current > 0) {
        if (!hiddenRoleArnsRef.current.has(role.arn)) additions.push(role.arn);
      } else if (previous > 0 && current === 0) removals.push(role.arn);
    }
    previousCounts.current = changeCounts;

    if (additions.length === 0 && removals.length === 0) return;
    setSelectedRoleArns((current) => {
      const next = new Set(current);
      for (const arn of additions) next.add(arn);
      for (const arn of removals) next.delete(arn);
      return [...next];
    });
  }, [matrix, changeCounts]);

  /** 交点 1 件の保存（MQ-4）。応答を待ってからチェック状態を確定する。 */
  const toggleCell = useCallback(
    (userArn: string, roleArn: string, next: boolean) => {
      const key = cellKey(userArn, roleArn);
      if (savingCells.has(key)) return;

      setSaveError(null);
      setSavingCells((current) => new Set(current).add(key));

      api
        .saveAssignment({ userArn, roleArn, checked: next })
        .then((result) => {
          patch((current) => {
            if (!current) return current;
            return { ...current, assignments: upsert(current.assignments, result.assignment) };
          });
        })
        .catch((cause: unknown) => {
          // 楽観的更新をしていないため「戻す」処理は不要 — 画面はまだ操作前の状態である。
          // eslint-disable-next-line no-restricted-syntax -- 開発者向けのログ。画面には出ない
          console.error("[rolust] 割り当ての保存に失敗しました", cause);
          const error = toApiError(cause);
          setSaveError({
            text: (m, noticeLocale) =>
              m.matrix.saveFailed(roleNameOf(roleArn), describeError(noticeLocale, m, error)),
          });
        })
        .finally(() => {
          setSavingCells((current) => {
            const updated = new Set(current);
            updated.delete(key);
            return updated;
          });
        });
    },
    [savingCells, patch],
  );

  const toggleRole = useCallback((roleArn: string, next: boolean) => {
    setSelectedRoleArns((current) =>
      next
        ? [...new Set([...current, roleArn])]
        : current.filter((arn) => arn !== roleArn),
    );
  }, []);

  const createRequests = async (): Promise<void> => {
    if (selectedRoleArns.length === 0) return;
    setCreating(true);
    setCreationNotice(null);
    try {
      const result = await api.createChangeRequests({ roleArns: selectedRoleArns });

      if (result.failures.length > 0) {
        // 握り潰さない。作成できなかったロールを画面に残したまま提示する。
        setCreationNotice({
          type: "error",
          header: (m) => m.matrix.creationFailedHeader(result.failures.length),
          lines: result.failures.map(
            (failure): NoticeText =>
              (m, noticeLocale) =>
                m.matrix.roleLine(
                  roleNameOf(failure.roleArn),
                  localizeMessage(noticeLocale, failure.message, failure.localized),
                ),
          ),
        });
        reload();
        return;
      }

      if (result.created.length > 0) {
        navigate(requestsPath(result.created.map((entry) => entry.changeRequestId)));
        return;
      }

      setCreationNotice({
        type: "info",
        header: (m) => m.matrix.noRequestsHeader,
        lines: result.excluded.map(
          (entry): NoticeText =>
            (m) =>
              m.matrix.roleLine(roleNameOf(entry.roleArn), exclusionReasonLabel(m, entry.reason)),
        ),
      });
      reload();
    } catch (cause) {
      const error = toApiError(cause);
      setCreationNotice({
        type: "error",
        header: (m) => m.matrix.createFailedHeader,
        lines: [(m, noticeLocale) => describeError(noticeLocale, m, error)],
      });
    } finally {
      setCreating(false);
    }
  };

  /** 取り消せる変更（ロックの無い列の未反映の交点）。実際の対象はサーバが取り消しの時点で決める。 */
  const revertable = useMemo(() => {
    if (!matrix) return { changes: 0, roles: 0 };
    let changes = 0;
    const roles = new Set<string>();
    for (const entry of matrix.assignments) {
      if (entry.checked === entry.reflected || matrix.locks[entry.roleArn]) continue;
      changes += 1;
      roles.add(entry.roleArn);
    }
    return { changes, roles: roles.size };
  }, [matrix]);

  const handleReverted = (result: RevertAssignmentsResponse): void => {
    setRevertOpen(false);
    setSaveError(null);
    if (result.failures.length > 0) {
      setRevertNotice(null);
      setRevertFailure(result);
    } else {
      setRevertFailure(null);
      const skipped = result.skippedRoleArns.length;
      setRevertNotice({
        text: (m) =>
          result.reverted > 0
            ? m.matrix.revertedNotice(result.reverted, skipped)
            : m.matrix.nothingToRevertNotice(skipped),
      });
    }
    // 画面の状態はサーバの応答で確定する（楽観的更新はしない）。一部が失敗していても、戻せた分を反映する。
    reload();
  };

  const excludedCount = matrix
    ? matrix.roles.filter(
        (role) => matrix.locks[role.arn] && (changeCounts.get(role.arn) ?? 0) > 0,
      ).length
    : 0;
  const totalChanges = [...changeCounts.values()].reduce((sum, count) => sum + count, 0);
  const canSubmit = selectedRoleArns.length > 0 && !creating;

  return (
    <ContentLayout
      header={
        <PageHeading
          title={t.matrix.title}
          counts={
            matrix
              ? t.matrix.counts(matrix.users.length, matrix.roles.length)
              : t.matrix.countsLoading
          }
        />
      }
    >
      {/* 間隔は s（12px）。l（20px）だと、ツールバーと表の間が空きすぎる（Issue #155）。 */}
      <SpaceBetween size="s">
        {revertNotice && (
          <div data-testid="matrix-revert-notice">
            <Flashbar
              items={[
                {
                  type: "success",
                  content: revertNotice.text(t, locale),
                  dismissible: true,
                  onDismiss: () => setRevertNotice(null),
                  id: "matrix-revert-notice",
                },
              ]}
            />
          </div>
        )}

        {/* ツールバー: 1 行に件数・絞り込み欄・主アクション（`mockups.md` 共通レイアウト規約。Issue #155 で 2 行目に収めた）。 */}
        <Container data-testid="matrix-toolbar">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "1rem",
              flexWrap: "wrap",
            }}
          >
            <Box variant="small" data-testid="matrix-counts">
              {matrix
                ? t.matrix.selectionSummary(selectedRoleArns.length, excludedCount, totalChanges)
                : t.matrix.loading}
            </Box>
            {/*
              保存状態（Issue #158）。件数の近くに置き、表の下の凡例には出さない（mockups.md の画面 3）。
              読み上げ領域には入れない（保存は 1 チェックごとに起きるため。各セルは aria-busy で伝わる）。
            */}
            {matrix &&
              (savingCells.size > 0 ? (
                <Box variant="small" data-testid="matrix-saving">
                  <Spinner size="normal" /> {t.matrix.saving}
                </Box>
              ) : (
                <Box variant="small" data-testid="matrix-saved">
                  {t.matrix.saved}
                </Box>
              ))}
            {/* 絞り込み欄の枠。欄の本体は AssignmentMatrix がこの枠へ描く（空状態では描かない）。読み直しの間も枠は残る。 */}
            <div
              ref={setFilterAnchor}
              data-testid="matrix-filter-slot"
              style={{ flex: "1 1 14rem", maxWidth: "24rem", minWidth: 0 }}
            />
            <div data-testid="matrix-actions" style={{ marginLeft: "auto" }}>
              <SpaceBetween direction="horizontal" size="xs">
                <PermissionButton need="edit"
                  data-testid="matrix-revert-changes"
                  disabled={!matrix || revertable.changes === 0 || savingCells.size > 0 || creating}
                  onClick={() => setRevertOpen(true)}
                >
                  {t.matrix.revertChanges}
                </PermissionButton>
                <PermissionButton need="edit"
                  id={SUBMIT_BUTTON_ID}
                  variant="primary"
                  loading={creating}
                  loadingText={t.matrix.creating}
                  disabled={!canSubmit}
                  data-testid="matrix-create-requests"
                  onClick={() => void createRequests()}
                >
                  {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
                  {creating ? t.matrix.creating : t.matrix.createRequests}
                </PermissionButton>
              </SpaceBetween>
            </div>
          </div>
        </Container>

        {saveError && (
          <div data-testid="matrix-save-error">
            <Alert
              type="error"
              statusIconAriaLabel={t.error.statusIconAriaLabel}
              dismissible
              onDismiss={() => setSaveError(null)}
            >
              {saveError.text(t, locale)}
            </Alert>
          </div>
        )}

        {revertFailure && (
          <div data-testid="matrix-revert-error">
            <Alert
              type="error"
              header={t.matrix.revertFailureHeader(revertFailure.failures.length)}
              statusIconAriaLabel={t.error.statusIconAriaLabel}
              dismissible
              onDismiss={() => setRevertFailure(null)}
            >
              <SpaceBetween size="xs">
                {revertFailure.reverted > 0 && (
                  <Box variant="p">{t.matrix.revertedCount(revertFailure.reverted)}</Box>
                )}
                <ul>
                  {revertFailure.failures.map((failure) => (
                    <li key={`${failure.userArn}#${failure.roleArn}`}>
                      {t.matrix.revertFailureItem(
                        roleNameOf(failure.roleArn),
                        failure.userArn.split("/").pop() ?? "",
                        localizeMessage(locale, failure.message, failure.localized),
                      )}
                    </li>
                  ))}
                </ul>
                <Box variant="p">{t.matrix.revertRetryHint}</Box>
              </SpaceBetween>
            </Alert>
          </div>
        )}

        {creationNotice && (
          <div data-testid="matrix-creation-notice">
            <Alert
              type={creationNotice.type === "error" ? "error" : "info"}
              header={creationNotice.header(t, locale)}
              statusIconAriaLabel={
                creationNotice.type === "error" ? t.error.statusIconAriaLabel : t.matrix.infoAriaLabel
              }
              dismissible
              onDismiss={() => setCreationNotice(null)}
            >
              <ul>
                {creationNotice.lines.map((line) => {
                  const text = line(t, locale);
                  return <li key={text}>{text}</li>;
                })}
              </ul>
            </Alert>
          </div>
        )}

        {state.status === "loading" ? (
          <div data-testid="matrix-loading">
            <Spinner /> {t.matrix.loading}
          </div>
        ) : state.status === "error" ? (
          <ErrorPanel
            header={t.matrix.loadErrorHeader}
            error={state.error}
            onRetry={reload}
            testId="matrix-error"
          />
        ) : matrix ? (
          <AssignmentMatrix
            hiddenController={hiddenController}
            attributeColumns={matrix.pool.attributeColumns}
            users={matrix.users}
            roles={matrix.roles}
            assignments={matrix.assignments}
            locks={matrix.locks}
            selectedRoleArns={selectedRoleArns}
            savingCells={savingCells}
            toolbarTargetId={SUBMIT_BUTTON_ID}
            filterAnchor={filterAnchor}
            onToggleCell={toggleCell}
            onToggleRole={toggleRole}
            onNavigateToRequest={(changeRequestId) => navigate(historyPath(changeRequestId))}
            onRegisterRoles={() => navigate(ROUTES.roles)}
          />
        ) : null}

        <RevertChangesModal
          open={revertOpen}
          changeCount={revertable.changes}
          roleCount={revertable.roles}
          excludedRoleCount={excludedCount}
          onClose={() => setRevertOpen(false)}
          onDone={handleReverted}
        />
      </SpaceBetween>
    </ContentLayout>
  );
}

/** 保存済みの交点で置き換える。まだ存在しなければ追加する。 */
function upsert(assignments: Assignment[], saved: Assignment): Assignment[] {
  const index = assignments.findIndex(
    (entry) => entry.userArn === saved.userArn && entry.roleArn === saved.roleArn,
  );
  if (index < 0) return [...assignments, saved];
  const next = [...assignments];
  next[index] = saved;
  return next;
}
