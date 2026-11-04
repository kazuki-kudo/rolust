import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import type { ButtonProps } from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Flashbar from "@cloudscape-design/components/flashbar";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import { PageHeading } from "../components/PageHeading.js";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import Popover from "@cloudscape-design/components/popover";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import type { ConfigResponse, DriftResponse, IamRole, Locale, RegisterRoleResponse, RoleView } from "@rolust/core";
import {
  ACCOUNT_ID_PATTERN,
  IAM_NAME_PATTERN,
  ROLE_DESCRIPTION_MAX_LENGTH,
  ROLE_DISPLAY_NAME_MAX_LENGTH,
  ValidationError,
  buildRoleArn,
  normalizeRoleDescription,
  normalizeRoleDisplayName,
  roleColorOf,
} from "@rolust/core";

import { api } from "../api-client.js";
import { summarizeDrift } from "../drift-summary.js";
import type { ApiClientError } from "../api-client.js";
import { ColorSwatch } from "../components/ColorSwatch.js";
import { PermissionButton } from "../components/PermissionButton.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { GuardedModal } from "../components/GuardedModal.js";
import { RequestStatusChip } from "../components/RequestStatusChip.js";
import { toApiError, useAsync } from "../hooks/useAsync.js";
import { useAutoDismiss } from "../hooks/useAutoDismiss.js";
import { useRoleOrderEditMode } from "../hooks/useRoleOrderEditMode.js";
import { useTrustDrift } from "../hooks/useTrustDrift.js";
import { describeError, localizeMessage, useLocale, useT, type Messages } from "../i18n/index.js";
import { formatTimestamp } from "../labels.js";
import { navigate } from "../router.js";
import { ROUTES, historyPath } from "../routes.js";
import { DeleteRoleModal } from "./DeleteRoleModal.js";
import { DriftDetailModal } from "./DriftDetailModal.js";
import { EditRoleColorModal } from "./EditRoleColorModal.js";
import { EditRoleDescriptionModal } from "./EditRoleDescriptionModal.js";

/** 「信頼ポリシーを確認」と「i」の組と、「並び順を編集」の間（px）。依頼者の指定（Issue #232）。 */
const ACTIONS_GROUP_GAP_PX = 25;

/** 「操作」列の幅（px）。「登録を解除」が日本語・英語のどちらでも 1 行に収まる広さ（Issue #229）。 */
const ACTIONS_COLUMN_WIDTH = 128;

/**
 * 画面 2 — FR-7.2 IAMロール管理。
 *
 * 「未反映の申請」列は requirements.md の FR-7.2 が直接求めたものではなく、
 * FR-4.6 の帰結を可視化するために `mockups.md` が足した列である。未反映の申請を持つ
 * ロールは新規申請の対象から除外され続けるため、その事実をロール一覧で見えるようにする。
 *
 * **画面側では AWS に問い合わせない**。ロールの実在と管理対象タグは、送信時に `POST /roles` が
 * `iam:ListRoleTags` で確かめる（質問 11 = A。FR-5.7 / C-4 の例外）。デプロイ先と異なるAWSアカウントID の
 * ロールも、サーバがターゲット側の Reader を引き受けて同じ検証をし、差分確認と反映もできる
 * （Issue #85。docs/design/requirements.md の「FR-2.2 とクロスアカウント構成」）。
 *
 * ## 並び順の編集（Issue #135 / FR-2.6）
 *
 * 一覧はサーバの列順（マトリクスの列の左から）で、先頭の「順」列に番号を出す。「並び順を編集」で編集モードに入り、
 * 行の「上へ」「下へ」で並べて、「保存」で 1 回で保存する（ロジックは `useRoleOrderEditMode`）。
 *
 * ## 管理対象タグの提示（質問 10 = A / Step 18-C）
 *
 * `GET /config` が返すタグのキーと値を、登録モーダルに**要件として表示する**。
 *
 * **事前検証は行わない。** 接頭辞方式ではロール名そのものが判定材料だったため blur 時に
 * 画面側で照合できたが、タグは AWS 上のロールにしか存在せず、画面が持っている情報だけ
 * では原理的に判定できない。判定は `POST /roles` が `iam:ListRoleTags` で行う。
 * GI-1 の意図（送信して初めて弾かれるのを避ける）は、要件を送信前に見せることで
 * 満たせる範囲まで満たす。
 *
 * 設定の取得に失敗した場合は要件を表示せず、登録そのものは止めない —
 * 手当てが失敗したことを理由に、正当な登録経路を塞いではならない。
 */
export function RolesScreen(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const load = useCallback(() => api.listRoles(), []);
  const { state, reload } = useAsync(load);

  // タグは要件の提示にのみ使う。取得に失敗しても画面は動き続けるべきなので、
  // 一覧とは別の非同期状態として持ち、error を握り潰さずに「未取得」へ落とす。
  const loadConfig = useCallback(() => api.getConfig(), []);
  const configAsync = useAsync(loadConfig);
  /** `null` は「未取得」を意味し、要件を表示しない（登録は止めない）。 */
  const managedTag =
    configAsync.state.status === "success" ? configAsync.state.data : null;
  const [createOpen, setCreateOpen] = useState(false);
  // 説明の編集は、ほかのモーダルと同じく画面内の状態で開く（ほかの編集モーダルと同じ形。Issue #21）。
  const [editDescriptionTarget, setEditDescriptionTarget] = useState<RoleView | null>(null);
  // 背景色の編集（Issue #100）。説明と同じ形。
  const [editColorTarget, setEditColorTarget] = useState<RoleView | null>(null);
  // 削除の確認（Issue #22）。削除できないロールでも開き、理由と直し方を示す（spec D-9）。
  const [deleteTarget, setDeleteTarget] = useState<RoleView | null>(null);
  // 通知を出すたびに新しい参照になるようオブジェクトで持つ（GI-5 の計時をやり直すため）。文は描画のたびに
  // 選んだ言語で組み立てる（通知が出ている間に言語を切り替えても追随する）。
  const [notice, setNotice] = useState<{ text: (t: Messages) => string } | null>(null);

  // GI-5: 成功通知は 5 秒で自動的に消す。この画面の通知は成功のみ。
  useAutoDismiss(notice, () => setNotice(null));

  // useMemo で包むのは、下流の useMemo の依存として同一性が安定している必要があるため。
  const roles = useMemo(
    () => (state.status === "success" ? state.data.roles : []),
    [state],
  );

  // 並び順の編集モード（Issue #135）。保存に成功したら通知して一覧を読み直す。
  const edit = useRoleOrderEditMode({
    roles,
    onSaved: (count) => {
      setNotice({ text: (m) => m.roles.notices.orderSaved(count) });
      reload();
    },
  });

  // 信頼ポリシーの乖離の確認（FR-4.9。Issue #170）。押したときだけ API を呼び、結果は画面内の状態にだけ持つ（D-1）。
  const drift = useTrustDrift();
  const [driftDetailArn, setDriftDetailArn] = useState<string | null>(null);
  // 記録を IAM に合わせた（adopt が成功した）ロール。確認結果が古くなったので、「信頼ポリシー」列に「再確認が必要」を
  // 出す（Issue #172。D-16）。確認結果は自動更新しない（#170 D-1）。再確認・サマリを閉じたときに空にする。
  const [recheckArns, setRecheckArns] = useState<ReadonlySet<string>>(new Set());
  const driftViews = useMemo(
    () => (drift.state.status === "success" ? drift.state.data.roles : []),
    [drift.state],
  );
  const driftByArn = useMemo(() => new Map(driftViews.map((view) => [view.roleArn, view] as const)), [driftViews]);
  // 一覧にあるロールの結果だけを詳細に出す（削除したロールの結果は出さない。D-14）。
  const driftDetailRole = roles.find((role) => role.arn === driftDetailArn) ?? null;
  const driftDetailView = driftDetailRole ? (driftByArn.get(driftDetailRole.arn) ?? null) : null;

  // サーバの列順（ソート UI は置かない。NFR-1）。編集中は下書きの並び。
  const rows = useMemo(() => {
    if (!edit.editing) return roles;
    const byArn = new Map(roles.map((role) => [role.arn, role] as const));
    return edit.order.flatMap((arn) => {
      const role = byArn.get(arn);
      return role ? [role] : [];
    });
  }, [roles, edit.editing, edit.order]);
  const positionOf = useMemo(() => new Map(rows.map((role, index) => [role.arn, index + 1] as const)), [rows]);

  // 行が入れ替わるとフォーカスを失うので、動かしたロールの同じ向きのボタンへ戻す。端に着いてそのボタンが無効に
  // なったときは、反対向きのボタンへ戻す（#100 の規則）。
  const moveButtons = useRef(new Map<string, ButtonProps.Ref | null>());
  const pendingFocus = useRef<{ arn: string; direction: "up" | "down" } | null>(null);
  const move = (arn: string, direction: "up" | "down"): void => {
    pendingFocus.current = { arn, direction };
    edit.move(arn, direction);
  };
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    const index = edit.order.indexOf(pending.arn);
    const direction =
      pending.direction === "up" && index === 0
        ? "down"
        : pending.direction === "down" && index === edit.order.length - 1
          ? "up"
          : pending.direction;
    moveButtons.current.get(`${pending.arn}:${direction}`)?.focus();
  }, [edit.order]);

  const accountCount = new Set(roles.map((role) => role.accountId)).size;

  return (
    <ContentLayout
      header={
        <PageHeading
          title={t.roles.title}
          counts={
            state.status === "success"
              ? t.roles.counts(roles.length, accountCount)
              : t.roles.countsLoading
          }
          actions={
            // 「信頼ポリシーを確認」と「i」を 1 つの組にし、組と「並び順を編集」の間を広げる（Issue #232）。
            // 「i」が両隣のボタンの真ん中にあると、どちらの説明か分からなかったため。
            // Cloudscape の `SpaceBetween` は 25px の間隔を持たない（20px か 24px）ので、flex の gap で置く。
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                columnGap: ACTIONS_GROUP_GAP_PX,
                rowGap: 8,
              }}
            >
              <SpaceBetween direction="horizontal" size="xxxs" alignItems="center">
                {/* 読み取りだけなので `view` で押せる（PermissionButton にしない。D-10）。編集モードの間は無効（D-13）。 */}
                <Button
                  data-testid="roles-drift-check"
                  disabled={edit.editing}
                  loading={drift.state.status === "loading"}
                  loadingText={t.roles.drift.checking}
                  onClick={() => {
                    setRecheckArns(new Set());
                    void drift.run();
                  }}
                >
                  {t.roles.drift.check}
                </Button>
                {/* 「信頼ポリシーを確認」の説明（Issue #206 で常時表示にし、Issue #232 で、押したときだけ出す形に変えた）。
                    「i」は、押す・Enter / Space で開き、「×」・Esc・外側のクリックで閉じる。読み取りだけのボタンと同じく、
                    編集モードの間も使える。吹き出しは結果のサマリ（`aria-live` の領域）の外にある。 */}
                <Popover
                  triggerType="custom"
                  position="bottom"
                  size="large"
                  dismissAriaLabel={t.roles.drift.dismiss}
                  content={
                    <Box variant="small" data-testid="roles-drift-caption">
                      {t.roles.drift.caption}
                    </Box>
                  }
                >
                  <Button
                    variant="inline-icon"
                    iconName="status-info"
                    ariaLabel={t.roles.drift.helpAria}
                    data-testid="roles-drift-help"
                  />
                </Popover>
              </SpaceBetween>
              <SpaceBetween direction="horizontal" size="xs">
                {/* 2 件以上のときだけ出す。編集モードの間は、下書きを守るため更新系の操作を無効にし、
                    「保存」を唯一の primary にする（GI-9）。 */}
                {roles.length >= 2 && (
                  <PermissionButton need="edit" data-testid="roles-order-start" disabled={edit.editing} onClick={edit.start}>
                    {t.roles.editOrder}
                  </PermissionButton>
                )}
                <PermissionButton need="edit"
                  variant={edit.editing ? "normal" : "primary"}
                  data-testid="create-role-button"
                  disabled={edit.editing}
                  onClick={() => setCreateOpen(true)}
                >
                  {t.roles.register}
                </PermissionButton>
              </SpaceBetween>
            </div>
          }
        />
      }
    >
      <SpaceBetween size="l">
        {/* 読み上げのため、領域は常にマウントし、中身だけを出し入れする。 */}
        <div aria-live="polite" data-testid="drift-live">
          {drift.state.status === "success" && (
            <DriftSummaryAlert
              data={drift.state.data}
              onDismiss={() => {
                setRecheckArns(new Set());
                drift.clear();
              }}
            />
          )}
          {drift.state.status === "error" && (
            <Alert
              type="error"
              header={t.roles.drift.errorHeader}
              statusIconAriaLabel={t.roles.errorAriaLabel}
              dismissible
              dismissAriaLabel={t.roles.drift.dismiss}
              onDismiss={drift.clear}
              data-testid="drift-error"
            >
              {describeError(locale, t, drift.state.error)}
            </Alert>
          )}
        </div>

        {notice && (
          <Flashbar
            items={[
              {
                type: "success",
                content: notice.text(t),
                dismissible: true,
                onDismiss: () => setNotice(null),
                id: "roles-notice",
              },
            ]}
          />
        )}

        {edit.editing && (
          <div
            data-testid="roles-order-bar"
            style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}
          >
            <span>
              <Box variant="strong">{t.roles.orderBar.title}</Box> {t.roles.orderBar.changes(edit.changeCount)}
            </span>
            <SpaceBetween direction="horizontal" size="xs">
              <Button data-testid="roles-order-cancel" disabled={edit.saving} onClick={edit.cancel}>
                {t.roles.cancel}
              </Button>
              <Button
                variant="primary"
                data-testid="roles-order-save"
                disabled={edit.changeCount === 0}
                loading={edit.saving}
                loadingText={t.roles.saving}
                onClick={() => void edit.save()}
              >
                {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
                {edit.saving ? t.roles.saving : t.roles.orderBar.save(edit.changeCount)}
              </Button>
            </SpaceBetween>
          </div>
        )}

        {edit.error !== null && (
          <Alert type="error" statusIconAriaLabel={t.roles.errorAriaLabel} data-testid="roles-order-error">
            {edit.error}
          </Alert>
        )}

        {/* 移動の読み上げ（#100 の領域のスタイルを移した）。 */}
        <div
          aria-live="polite"
          data-testid="roles-order-live"
          style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}
        >
          {edit.announcement}
        </div>

        {state.status === "error" ? (
          <ErrorPanel
            header={t.roles.loadErrorHeader}
            error={state.error}
            onRetry={reload}
            testId="roles-error"
          />
        ) : (
          <Table<RoleView>
            stickyHeader
            items={rows}
            loading={state.status === "loading"}
            loadingText={t.roles.loading}
            trackBy={(role) => role.arn}
            wrapLines
            data-testid="roles-table"
            empty={
              <Box textAlign="center" padding="l" data-testid="roles-empty">
                <SpaceBetween size="s">
                  <Box variant="strong">{t.roles.empty.header}</Box>
                  <Box variant="p">{t.roles.empty.body}</Box>
                  <PermissionButton need="edit"
                    variant="primary"
                    data-testid="roles-empty-create"
                    onClick={() => setCreateOpen(true)}
                  >
                    {t.roles.empty.register}
                  </PermissionButton>
                  <Button
                    variant="inline-link"
                    data-testid="roles-empty-to-matrix"
                    onClick={() => navigate(ROUTES.matrix)}
                  >
                    {t.roles.empty.toMatrix}
                  </Button>
                </SpaceBetween>
              </Box>
            }
            columnDefinitions={[
              {
                id: "order",
                header: t.roles.columns.order,
                width: 64,
                cell: (role) => <span data-testid={`role-position-${role.arn}`}>{positionOf.get(role.arn)}</span>,
              },
              {
                id: "accountId",
                header: t.roles.columns.accountId,
                width: 180,
                cell: (role) => <code>{role.accountId}</code>,
              },
              {
                id: "roleName",
                // ロール名は識別子なので省略記号で切らず、セル内で折り返す。
                header: t.roles.columns.roleName,
                cell: (role) => <code>{role.roleName}</code>,
              },
              {
                id: "displayName",
                header: t.roles.columns.displayName,
                cell: (role) => (
                  <span data-testid={`role-display-name-${role.arn}`}>{role.displayName ?? "—"}</span>
                ),
              },
              {
                id: "unreflected",
                header: t.roles.columns.unreflected,
                width: 260,
                cell: (role) =>
                  role.unreflected ? (
                    <RequestStatusChip
                      state={role.unreflected.status}
                      timestamp={role.unreflected.createdAt}
                      interactive
                      testId={`role-unreflected-${role.arn}`}
                      onFollow={() =>
                        navigate(
                          historyPath(
                            (role.unreflected as NonNullable<RoleView["unreflected"]>)
                              .changeRequestId,
                          ),
                        )
                      }
                    />
                  ) : (
                    <span data-testid={`role-unreflected-${role.arn}`}>—</span>
                  ),
              },
              {
                id: "drift",
                header: t.roles.columns.drift,
                cell: (role) => {
                  const view = driftByArn.get(role.arn);
                  const testId = `role-drift-${role.arn}`;
                  if (drift.state.status === "loading") {
                    return <span data-testid={testId}>{t.roles.drift.cellChecking}</span>;
                  }
                  if (view === undefined) return <span data-testid={testId}>—</span>;
                  if (recheckArns.has(role.arn)) {
                    return <span data-testid={testId}>{t.roles.drift.needsRecheck}</span>;
                  }
                  if (view.status === "match") return <span data-testid={testId}>{t.roles.drift.match}</span>;
                  const label =
                    view.status === "readError"
                      ? t.roles.drift.readFailed
                      : t.roles.drift.mismatch(view.missing.length + view.extra.length);
                  return (
                    <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                      <span data-testid={testId}>{label}</span>
                      <Button
                        variant="inline-link"
                        data-testid={`role-drift-detail-${role.arn}`}
                        ariaLabel={t.roles.drift.detailAria(role.roleName)}
                        onClick={() => setDriftDetailArn(role.arn)}
                      >
                        {t.roles.drift.detail}
                      </Button>
                    </SpaceBetween>
                  );
                },
              },
              {
                id: "description",
                header: t.roles.columns.description,
                cell: (role) => (
                  <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                    <span data-testid={`role-description-${role.arn}`}>
                      {role.description ?? "—"}
                    </span>
                    <PermissionButton need="edit"
                      variant="inline-link"
                      disabled={edit.editing}
                      data-testid={`edit-role-description-${role.arn}`}
                      ariaLabel={t.roles.editDescriptionAria(role.roleName)}
                      onClick={() => setEditDescriptionTarget(role)}
                    >
                      {t.roles.edit}
                    </PermissionButton>
                  </SpaceBetween>
                ),
              },
              {
                id: "color",
                header: t.roles.columns.color,
                cell: (role) => {
                  const tint = roleColorOf(role.color);
                  return (
                    <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                      <span data-testid={`role-color-${role.arn}`}>
                        {tint ? (
                          <>
                            <ColorSwatch background={tint.background} />
                            {t.roles.editColor.names[tint.id]}
                          </>
                        ) : (
                          "—"
                        )}
                      </span>
                      <PermissionButton need="edit"
                        variant="inline-link"
                        disabled={edit.editing}
                        data-testid={`edit-role-color-${role.arn}`}
                        ariaLabel={t.roles.editColorAria(role.roleName)}
                        onClick={() => setEditColorTarget(role)}
                      >
                        {t.roles.edit}
                      </PermissionButton>
                    </SpaceBetween>
                  );
                },
              },
              ...(edit.editing
                ? [
                    {
                      id: "move",
                      header: t.roles.columns.move,
                      width: 120,
                      cell: (role: RoleView) => {
                        const index = edit.order.indexOf(role.arn);
                        return (
                          <SpaceBetween direction="horizontal" size="xxs">
                            <Button
                              ref={(element) => {
                                moveButtons.current.set(`${role.arn}:up`, element);
                              }}
                              variant="icon"
                              iconName="angle-up"
                              disabled={index === 0 || edit.saving}
                              ariaLabel={t.roles.moveUpAria(role.roleName)}
                              data-testid={`role-move-up-${role.arn}`}
                              onClick={() => move(role.arn, "up")}
                            />
                            <Button
                              ref={(element) => {
                                moveButtons.current.set(`${role.arn}:down`, element);
                              }}
                              variant="icon"
                              iconName="angle-down"
                              disabled={index === edit.order.length - 1 || edit.saving}
                              ariaLabel={t.roles.moveDownAria(role.roleName)}
                              data-testid={`role-move-down-${role.arn}`}
                              onClick={() => move(role.arn, "down")}
                            />
                          </SpaceBetween>
                        );
                      },
                    },
                  ]
                : []),
              {
                id: "actions",
                header: t.roles.columns.actions,
                // 「登録を解除」が折り返されて行が高くなるのを、列の最小幅で防ぐ（Issue #229）。
                // IAMユーザの表（Issue #15）のように `white-space: nowrap` の要素で包んでも効かない。Cloudscape の
                // ボタンは自身が `white-space: normal` と `word-break: break-word` を持ち、親の指定を継承しないため
                // （実測: 幅 1024px で、包んだだけでは日本語が 3 行→2 行、英語は 2 行のまま）。`width` も初期幅の
                // ヒントで、表が詰まると縮むので、`minWidth` で下限を決める。
                // 128px は、幅 1024px で日本語（5 文字）・英語（Unregister）が 1 行に収まった 120px に余裕を足した値。
                // 通常と並び順の編集モード（「移動」列が加わる）のどちらでも収まる。
                width: ACTIONS_COLUMN_WIDTH,
                minWidth: ACTIONS_COLUMN_WIDTH,
                cell: (role) => (
                  <PermissionButton need="edit"
                    variant="inline-link"
                    disabled={edit.editing}
                    data-testid={`delete-role-${role.arn}`}
                    ariaLabel={t.roles.unregisterAria(role.roleName)}
                    onClick={() => setDeleteTarget(role)}
                  >
                    {t.roles.unregister}
                  </PermissionButton>
                ),
              },
            ]}
          />
        )}
      </SpaceBetween>

      {/* 並び順の編集モードの破棄確認（キャンセル・アプリ内の遷移）。入力欄を持たない確認なので Escape は「編集に戻る」（GI-4）。 */}
      {edit.discard && (
        <Modal
          visible
          header={t.roles.discard.header}
          data-testid="roles-order-discard-modal"
          onDismiss={edit.closeDiscard}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button data-testid="roles-order-discard-back" onClick={edit.closeDiscard}>
                  {t.roles.discard.back}
                </Button>
                <Button variant="primary" data-testid="roles-order-discard-confirm" onClick={edit.discard.confirm}>
                  {edit.discard.kind === "navigate" ? t.roles.discard.navigateConfirm : t.roles.discard.confirm}
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="xs">
            <Box variant="p">{t.roles.discard.body(edit.changeCount)}</Box>
            {edit.discard.kind === "navigate" && <Box variant="p">{t.roles.discard.navigateReason}</Box>}
          </SpaceBetween>
        </Modal>
      )}

      <EditRoleDescriptionModal
        role={editDescriptionTarget}
        onDismiss={() => setEditDescriptionTarget(null)}
        onSaved={(saved: IamRole) => {
          setEditDescriptionTarget(null);
          setNotice({ text: (m) => m.roles.notices.descriptionSaved(saved.roleName) });
          reload();
        }}
      />

      <EditRoleColorModal
        role={editColorTarget}
        onDismiss={() => setEditColorTarget(null)}
        onSaved={(saved: IamRole) => {
          setEditColorTarget(null);
          setNotice({ text: (m) => m.roles.notices.colorSaved(saved.roleName) });
          reload();
        }}
      />

      <DriftDetailModal
        roleName={driftDetailRole?.roleName ?? ""}
        view={driftDetailView}
        onDismiss={() => setDriftDetailArn(null)}
        onRepaired={(arn, count) => {
          setRecheckArns((current) => new Set(current).add(arn));
          setDriftDetailArn(null);
          setNotice({ text: (m) => m.roles.drift.repair.adoptedNotice(count) });
        }}
      />

      <DeleteRoleModal
        role={deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onDeleted={(deleted) => {
          setDeleteTarget(null);
          setNotice({ text: (m) => m.roles.notices.unregistered(deleted.roleName) });
          reload();
        }}
      />

      <CreateRoleModal
        visible={createOpen}
        managedTag={managedTag}
        onDismiss={() => setCreateOpen(false)}
        onCreated={(result) => {
          setCreateOpen(false);
          const { userCount, registeredCount, skippedCount } = result.imported;
          const arn = result.role.arn;
          setNotice({ text: (m) => m.roles.notices.registered(arn, userCount, registeredCount, skippedCount) });
          reload();
        }}
      />
    </ContentLayout>
  );
}

/**
 * 登録モーダルに出すタグ要件の文言（GI-1 / 質問 10 = A）。
 *
 * 検証ではなく**要件の提示**である。合致するかどうかは AWS 上のタグを読まないと
 * 決まらないため、画面はここで判定しない。
 */
function managedTagDescription(t: Messages, managedTag: ConfigResponse | null): string {
  if (managedTag === null) return t.roles.create.tagUnknown;
  return t.roles.create.tagRequirement(managedTag.managedTagKey, managedTag.managedTagValue);
}

/** 入力の検証。`ValidationError` の `localized` を選んだ言語で描画する（無ければ日本語の `message`）。 */
function validateDisplayName(locale: Locale, value: string): string | null {
  try {
    normalizeRoleDisplayName(value);
    return null;
  } catch (error) {
    if (error instanceof ValidationError) return localizeMessage(locale, error.message, error.localized);
    throw error;
  }
}

function validateDescription(locale: Locale, value: string): string | null {
  try {
    normalizeRoleDescription(value);
    return null;
  } catch (error) {
    if (error instanceof ValidationError) return localizeMessage(locale, error.message, error.localized);
    throw error;
  }
}

function CreateRoleModal({
  visible,
  managedTag,
  onDismiss,
  onCreated,
}: {
  visible: boolean;
  /** `GET /config` の返す管理対象タグ。`null` は未取得（要件を表示しない）。 */
  managedTag: ConfigResponse | null;
  onDismiss: () => void;
  onCreated: (result: RegisterRoleResponse) => void;
}): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const [accountId, setAccountId] = useState("");
  const [roleName, setRoleName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // API のエラーのまま持ち、描画のたびに選んだ言語で文にする。
  const [submitError, setSubmitError] = useState<ApiClientError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const accountIdError =
    accountId.trim() === ""
      ? t.roles.create.accountIdRequired
      : !ACCOUNT_ID_PATTERN.test(accountId.trim())
        ? t.roles.create.accountIdFormat
        : null;
  const roleNameError =
    roleName.trim() === ""
      ? t.roles.create.roleNameRequired
      : !IAM_NAME_PATTERN.test(roleName.trim())
        ? t.roles.create.roleNameInvalid(roleName.trim())
        : // タグの照合は画面側で判定できない（AWS 上のロールにしか無い情報のため）。
          // ここで見るのは書式だけであり、タグはサーバの `POST /roles` が判定する。
          null;
  const displayNameError = validateDisplayName(locale, displayName);
  const descriptionError = validateDescription(locale, description);
  const valid = !accountIdError && !roleNameError && !displayNameError && !descriptionError;

  const preview = valid ? buildRoleArn(accountId.trim(), roleName.trim()) : null;

  // GI-4: 「入力がある」の判定はフォーム状態が初期値から変化しているかで行う。
  // `touched` や `submitError` は利用者の入力ではないので数えない。
  const dirty = accountId !== "" || roleName !== "" || displayName !== "" || description !== "";

  const reset = (): void => {
    setAccountId("");
    setRoleName("");
    setDisplayName("");
    setDescription("");
    setTouched({});
    setSubmitError(null);
  };

  const close = (): void => {
    reset();
    onDismiss();
  };

  const submit = async (): Promise<void> => {
    setTouched({ accountId: true, roleName: true, displayName: true, description: true });
    if (!valid) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api.createRole({
        accountId: accountId.trim(),
        roleName: roleName.trim(),
        displayName: normalizeRoleDisplayName(displayName) ?? undefined,
        description: normalizeRoleDescription(description) ?? undefined,
      });
      reset();
      onCreated(created);
    } catch (cause) {
      setSubmitError(toApiError(cause));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <GuardedModal
      visible={visible}
      header={t.roles.create.header}
      testId="create-role-modal"
      dirty={dirty}
      onClose={close}
      footer={(requestClose) => (
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            {/* GI-4: 入力があれば破棄確認を挟む（`requestClose` が判断する）。 */}
            <Button data-testid="create-role-cancel" onClick={requestClose}>
              {t.roles.cancel}
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              loadingText={t.roles.create.submitting}
              data-testid="create-role-submit"
              onClick={() => void submit()}
            >
              {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
              {submitting ? t.roles.create.submitting : t.roles.create.submit}
            </Button>
          </SpaceBetween>
        </Box>
      )}
    >
      <Form errorText={submitError === null ? undefined : describeError(locale, t, submitError)}>
        <SpaceBetween size="m">
          <FormField
            label={t.roles.create.accountIdLabel}
            description={t.roles.create.accountIdDescription}
            errorText={touched.accountId ? (accountIdError ?? undefined) : undefined}
          >
            <Input
              data-testid="create-role-account-id"
              value={accountId}
              inputMode="numeric"
              placeholder="123456789012"
              onChange={(event) => setAccountId(event.detail.value)}
              onBlur={() => setTouched((current) => ({ ...current, accountId: true }))}
            />
          </FormField>

          <FormField
            label={t.roles.create.roleNameLabel}
            description={managedTagDescription(t, managedTag)}
            errorText={touched.roleName ? (roleNameError ?? undefined) : undefined}
          >
            <Input
              data-testid="create-role-name"
              value={roleName}
              onChange={(event) => setRoleName(event.detail.value)}
              onBlur={() => setTouched((current) => ({ ...current, roleName: true }))}
            />
          </FormField>

          <FormField label={t.roles.create.arnPreviewLabel}>
            <Box variant="code" data-testid="create-role-arn-preview">
              {preview ?? "—"}
            </Box>
          </FormField>

          <Box variant="small" color="text-body-secondary" data-testid="create-role-link-note">
            {t.roles.create.linkNote}
          </Box>

          <FormField
            label={t.roles.create.displayNameLabel}
            description={t.roles.create.optionalMax(ROLE_DISPLAY_NAME_MAX_LENGTH)}
            errorText={touched.displayName ? (displayNameError ?? undefined) : undefined}
          >
            <Input
              data-testid="create-role-display-name-input"
              value={displayName}
              onChange={(event) => setDisplayName(event.detail.value)}
              onBlur={() => setTouched((current) => ({ ...current, displayName: true }))}
            />
          </FormField>

          <FormField
            label={t.roles.create.descriptionLabel}
            description={t.roles.create.optionalMax(ROLE_DESCRIPTION_MAX_LENGTH)}
            errorText={touched.description ? (descriptionError ?? undefined) : undefined}
          >
            <Input
              data-testid="create-role-description"
              value={description}
              onChange={(event) => setDescription(event.detail.value)}
              onBlur={() => setTouched((current) => ({ ...current, description: true }))}
            />
          </FormField>
        </SpaceBetween>
      </Form>
    </GuardedModal>
  );
}

/** 確認結果のサマリ（FR-4.9）。乖離・読み取り失敗があれば警告、すべて一致なら成功、ロール 0 件なら情報。 */
function DriftSummaryAlert({ data, onDismiss }: { data: DriftResponse; onDismiss: () => void }): React.JSX.Element {
  const t = useT();
  const summary = summarizeDrift(data.roles);
  const time = formatTimestamp(data.checkedAt);
  const m = t.roles.drift.summary;
  const text =
    summary.kind === "empty"
      ? m.empty
      : summary.kind === "allMatch"
        ? m.allMatch(summary.total, time)
        : summary.kind === "allFailed"
          ? m.allFailed(summary.total, time)
          : m.issues(summary.total, summary.drifted, summary.failed, time);
  const alert =
    summary.kind === "allMatch"
      ? { type: "success" as const, label: t.roles.drift.successAriaLabel }
      : summary.kind === "empty"
        ? { type: "info" as const, label: t.roles.drift.infoAriaLabel }
        : { type: "warning" as const, label: t.roles.warningAriaLabel };
  return (
    <Alert
      type={alert.type}
      statusIconAriaLabel={alert.label}
      dismissible
      dismissAriaLabel={t.roles.drift.dismiss}
      onDismiss={onDismiss}
      data-testid="drift-summary"
    >
      {text}
    </Alert>
  );
}
