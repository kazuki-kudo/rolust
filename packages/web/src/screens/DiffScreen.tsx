import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Container from "@cloudscape-design/components/container";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Flashbar from "@cloudscape-design/components/flashbar";
import { PageHeading } from "../components/PageHeading.js";
import Link from "@cloudscape-design/components/link";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Spinner from "@cloudscape-design/components/spinner";
import type { ApplyReport, DiffView } from "@rolust/core";

import { api } from "../api-client.js";
import type { ApiClientError } from "../api-client.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { PermissionButton } from "../components/PermissionButton.js";
import { PolicyDiffPanel, isSelectableForApply } from "../components/PolicyDiffPanel.js";
import { describeError, useLocale, useT } from "../i18n/index.js";
import { formatTimestamp } from "../labels.js";
import { toApiError } from "../hooks/useAsync.js";
import { useAutoDismiss } from "../hooks/useAutoDismiss.js";
import { navigate, useRequestIds } from "../router.js";
import { ROUTES } from "../routes.js";

/**
 * 画面 4 — FR-7.4 差分確認・反映。
 *
 * この画面は**ナビゲーション項目を持たない**。到達経路は FR-7.3 の「申請を作成」と
 * FR-7.5 の「再開 / 再反映」の 2 つに限られる。
 *
 * 対象は URL の `?ids=<csv>` で表す（MQ-2）。再読み込みでも戻る操作でも同じ画面に
 * 復帰でき、これが FR-4.7（セッションをまたいだ下書き再開）の実装上の担保である。
 *
 * ## カード単位のローディング（質問 6 = C / 質問 8 = A）
 *
 * 差分は **id ごとに `GET /diff?ids=<1 件>` を並列で呼ぶ**。`GET /diff` の形は変えない。
 * `diff-service.ts` は元から `Promise.allSettled` でカードごとに独立して読んでいたが、
 * 1 レスポンスに畳んでいたためその独立性が画面まで届いていなかった。呼び出しを分けると、
 * 先に届いたカードから順に描画でき、1 件の失敗が他のカードの描画を止めない。
 *
 * 設計上の禁止事項:
 * - **破棄ボタンを置かない**（Q27）。破棄の起点は FR-7.5 申請履歴のみ。
 * - **反映に確認モーダルを挟まない**（FR-4.3 / GI-4）。この画面自体が確認の段である。
 * - **管理外 principal の警告で反映を妨げない**（FR-4.2 / Q22）。
 *   反映ボタンの活性は `isSelectableForApply`（読み取り成功のみを見る）で決まる。
 * - **読み込みが終わっていないカードを反映対象に入れない**。中身を見る前に反映ボタンが
 *   活性化するのは、この画面が最終確認の場であるという前提を壊す。
 */

/** ツールバーの「選択した n 件を反映」を押せるか。管理外 principal の有無は関与しない。 */
export function applyDisabled(
  views: DiffView[],
  selectedIds: ReadonlySet<string>,
): boolean {
  return !views.some(
    (view) =>
      selectedIds.has(view.changeRequest.changeRequestId) && isSelectableForApply(view),
  );
}

/**
 * 1 枚のカードの読み込み状態。
 *
 * `missing`（申請が見つからない）と `error`（読み込めなかった）を分ける。
 * 反映済み・破棄済みの申請を「読み込み失敗」として出すと、利用者は再試行を試み続ける。
 */
export type DiffCardState =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "found"; view: DiffView }
  | { status: "missing" };

/**
 * id ごとに独立した非同期状態を持つ（質問 8 = A）。
 *
 * 1 件の失敗が他のカードを止めないことを、状態の持ち方そのもので担保する。
 */
function useDiffCards(ids: string[]): {
  cards: ReadonlyMap<string, DiffCardState>;
  reloadCard: (changeRequestId: string) => void;
  reloadAll: () => void;
} {
  const [cards, setCards] = useState<ReadonlyMap<string, DiffCardState>>(new Map());
  const [attempt, setAttempt] = useState(0);
  const key = ids.join(",");

  const fetchOne = useCallback((id: string, isCancelled: () => boolean): void => {
    setCards((current) => new Map(current).set(id, { status: "loading" }));
    api
      .getDiff(id)
      .then((view) => {
        if (isCancelled()) return;
        setCards((current) =>
          new Map(current).set(
            id,
            view ? { status: "found", view } : { status: "missing" },
          ),
        );
      })
      .catch((cause: unknown) => {
        if (isCancelled()) return;
        // 記録したうえで画面へ渡す。どちらか片方だけにしない。
        // eslint-disable-next-line no-restricted-syntax -- 開発者向けのログ。画面には出ない
        console.error("[rolust] 差分の取得に失敗しました", id, cause);
        setCards((current) =>
          new Map(current).set(id, { status: "error", error: toApiError(cause) }),
        );
      });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const isCancelled = (): boolean => cancelled;

    // 対象が変わったら前の結果は捨てる（別の申請の差分を混ぜない）。
    setCards(new Map(ids.map((id) => [id, { status: "loading" } as DiffCardState])));
    for (const id of ids) fetchOne(id, isCancelled);

    return () => {
      cancelled = true;
    };
    // ids は毎レンダー新しい配列になりうるため、内容（key）で固定する。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt, fetchOne]);

  const reloadCard = useCallback(
    (changeRequestId: string) => fetchOne(changeRequestId, () => false),
    [fetchOne],
  );
  const reloadAll = useCallback(() => setAttempt((value) => value + 1), []);

  return { cards, reloadCard, reloadAll };
}

export function DiffScreen({ query }: { query: URLSearchParams }): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const ids = useRequestIds(query);
  const { cards, reloadCard, reloadAll } = useDiffCards(ids);

  /**
   * 利用者が明示的に切り替えたカードだけを記録する。
   *
   * 「現在の選択集合」をそのまま保持すると、あとから届いたカードが選択に入らない。
   * 上書きだけを持ち、記録のないカードは既定（読み込めた＝選択）に従わせる。
   */
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [reports, setReports] = useState<Map<string, ApplyReport>>(new Map());
  const [applyingIds, setApplyingIds] = useState<ReadonlySet<string>>(new Set());
  // 文字列ではなくエラーのまま持ち、描画のときに今の言語で組み立てる（言語を切り替えても追随する）。
  const [applyError, setApplyError] = useState<ApiClientError | null>(null);
  const [summary, setSummary] = useState<{ total: number; applied: number } | null>(null);

  // GI-5: 全件成功した場合だけ 5 秒で消す。一部失敗（warning）は残す —
  // どのロールが未反映かを利用者が読み取る前に消えてはならない。
  useAutoDismiss(summary && summary.applied === summary.total ? summary : null, () =>
    setSummary(null),
  );

  /** 読み込みが完了したカードの差分だけ。未着のカードはここに入らない。 */
  const views = useMemo(
    () =>
      ids
        .map((id) => cards.get(id))
        .filter(
          (card): card is { status: "found"; view: DiffView } => card?.status === "found",
        )
        .map((card) => card.view),
    [ids, cards],
  );

  const loadingIds = ids.filter((id) => (cards.get(id)?.status ?? "loading") === "loading");
  const errorIds = ids.filter((id) => cards.get(id)?.status === "error");
  const missing = ids.filter((id) => cards.get(id)?.status === "missing");
  const settled = loadingIds.length === 0;

  /**
   * 初期選択は「**読み込みが完了した**反映可能なカードすべて」。
   *
   * 未着のカードを選択済みにすると、利用者が中身を見る前に反映ボタンが活性化する。
   */
  const effectiveSelection = useMemo<ReadonlySet<string>>(() => {
    const selected = new Set<string>();
    for (const view of views) {
      const id = view.changeRequest.changeRequestId;
      const override = overrides.get(id);
      if (override ?? isSelectableForApply(view)) selected.add(id);
    }
    return selected;
  }, [views, overrides]);

  const toggle = (changeRequestId: string, next: boolean): void => {
    setOverrides((current) => new Map(current).set(changeRequestId, next));
  };

  const runApply = async (targetIds: string[]): Promise<void> => {
    if (targetIds.length === 0) return;
    setApplyError(null);
    setApplyingIds(new Set(targetIds));
    try {
      const response = await api.applyChangeRequests(targetIds);
      setReports((current) => {
        const next = new Map(current);
        for (const report of response.reports) next.set(report.changeRequestId, report);
        return next;
      });
      setSummary({ total: response.total, applied: response.applied });
    } catch (cause) {
      // 一括反映そのものが失敗した場合。個々のロールの成否は不明なので、その旨を出す。
      setApplyError(toApiError(cause));
    } finally {
      setApplyingIds(new Set());
    }
  };

  /** いま押したら反映されるカード。読み込み済み・選択済み・未反映のものだけ。 */
  const applyTargets = views.filter(
    (view) =>
      effectiveSelection.has(view.changeRequest.changeRequestId) &&
      isSelectableForApply(view) &&
      !reports.has(view.changeRequest.changeRequestId),
  );

  const oldestCreatedAt = views
    .map((view) => view.changeRequest.createdAt)
    .sort()
    .at(0);

  const showEmpty =
    ids.length === 0 || (settled && views.length === 0 && errorIds.length === 0);

  return (
    <ContentLayout
      header={
        <SpaceBetween size="xs">
          <Link
            href={ROUTES.matrix}
            data-testid="diff-back-to-matrix"
            onFollow={(event) => {
              event.preventDefault();
              navigate(ROUTES.matrix);
            }}
          >
            {t.diff.backToMatrix}
          </Link>
          <PageHeading
            title={t.diff.title}
            counts={
              settled
                ? t.diff.counts(views.length, formatTimestamp(oldestCreatedAt ?? null))
                : t.diff.countsLoading(views.length, ids.length)
            }
            actions={
              <PermissionButton need="apply"
                variant="primary"
                data-testid="diff-apply-selected"
                loading={applyingIds.size > 0}
                loadingText={t.diff.applying}
                disabled={
                  applyTargets.length === 0 ||
                  applyDisabled(
                    views.filter(
                      (view) => !reports.has(view.changeRequest.changeRequestId),
                    ),
                    effectiveSelection,
                  )
                }
                onClick={() =>
                  void runApply(
                    applyTargets.map((view) => view.changeRequest.changeRequestId),
                  )
                }
              >
                {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
                {applyingIds.size > 0 ? t.diff.applying : t.diff.applySelected(applyTargets.length)}
              </PermissionButton>
            }
          />
        </SpaceBetween>
      }
    >
      <SpaceBetween size="l">
        {summary && (
          <Flashbar
            items={[
              {
                type: summary.applied === summary.total ? "success" : "warning",
                content: t.diff.summary(summary.total, summary.applied),
                dismissible: true,
                onDismiss: () => setSummary(null),
                id: "apply-summary",
              },
            ]}
          />
        )}

        {applyError && (
          <div data-testid="diff-apply-error">
            <Alert
              type="error"
              header={t.diff.applyErrorHeader}
              statusIconAriaLabel={t.diff.errorAriaLabel}
            >
              {t.diff.applyErrorBody(describeError(locale, t, applyError))}
            </Alert>
          </div>
        )}

        {missing.length > 0 && settled && (
          <div data-testid="diff-missing">
            <Alert type="warning" header={t.diff.missingHeader(missing.length)}>
              <ul>
                {missing.map((id) => (
                  <li key={id}>
                    <code>{id}</code>
                  </li>
                ))}
              </ul>
            </Alert>
          </div>
        )}

        {showEmpty ? (
          <div data-testid="diff-empty">
            <Alert type="info" header={t.diff.empty.header}>
              <SpaceBetween size="s">
                <Box variant="p">{t.diff.empty.body}</Box>
                <Button
                  data-testid="diff-empty-to-matrix"
                  onClick={() => navigate(ROUTES.matrix)}
                >
                  {t.diff.empty.toMatrix}
                </Button>
              </SpaceBetween>
            </Alert>
          </div>
        ) : (
          <SpaceBetween size="m">
            {ids.map((id) => {
              const card: DiffCardState = cards.get(id) ?? { status: "loading" };

              // 読み込み中。カードの枠は残したまま状態だけを示す。
              if (card.status === "loading") {
                return (
                  <Container key={id} data-testid={`diff-loading-${id}`}>
                    <Spinner /> {t.diff.loadingPolicy}
                  </Container>
                );
              }

              // このカードだけが失敗した。他のカードの描画は止めない（FR-7.4）。
              if (card.status === "error") {
                return (
                  <ErrorPanel
                    key={id}
                    header={t.diff.cardLoadErrorHeader(id)}
                    error={card.error}
                    onRetry={() => reloadCard(id)}
                    testId={`diff-error-${id}`}
                  />
                );
              }

              // 見つからなかった申請は上部の警告帯にまとめる（カードを描かない）。
              if (card.status === "missing") return null;

              return (
                <PolicyDiffPanel
                  key={id}
                  view={card.view}
                  selected={effectiveSelection.has(id)}
                  applying={applyingIds.has(id)}
                  report={reports.get(id) ?? null}
                  onToggle={(next) => toggle(id, next)}
                  onRetry={() => void runApply([id])}
                />
              );
            })}

            {errorIds.length > 1 && (
              <Box data-testid="diff-reload-all">
                <Button onClick={reloadAll}>
                  {t.diff.reloadAll(errorIds.length)}
                </Button>
              </Box>
            )}
          </SpaceBetween>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
