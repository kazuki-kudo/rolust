import { useCallback, useMemo, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import ContentLayout from "@cloudscape-design/components/content-layout";
import Flashbar from "@cloudscape-design/components/flashbar";
import Form from "@cloudscape-design/components/form";
import FormField from "@cloudscape-design/components/form-field";
import { PageHeading } from "../components/PageHeading.js";
import Input from "@cloudscape-design/components/input";
import Modal from "@cloudscape-design/components/modal";
import SpaceBetween from "@cloudscape-design/components/space-between";
import Table from "@cloudscape-design/components/table";
import Textarea from "@cloudscape-design/components/textarea";
import TextFilter from "@cloudscape-design/components/text-filter";
import SegmentedControl from "@cloudscape-design/components/segmented-control";
import type { AddUsersResponse, AttributeColumn, IamUser } from "@rolust/core";
import { ACCOUNT_ID_PATTERN, IAM_NAME_PATTERN, buildUserArn, formatUserCsvHeader, parseUserCsv } from "@rolust/core";

import { api } from "../api-client.js";
import type { ApiClientError } from "../api-client.js";
import { filterUsers, groupByAccount, sortUsers, type AccountRow, type PoolSort } from "../pool-view.js";
import { ErrorPanel } from "../components/ErrorPanel.js";
import { PermissionButton } from "../components/PermissionButton.js";
import { GuardedModal } from "../components/GuardedModal.js";
import { useAsync } from "../hooks/useAsync.js";
import { toApiError } from "../hooks/useAsync.js";
import { useAttributeEditMode } from "../hooks/useAttributeEditMode.js";
import { useAutoDismiss } from "../hooks/useAutoDismiss.js";
import { describeError, localizeMessage, useLocale, useT, type Messages } from "../i18n/index.js";
import { AttributeColumnsModal } from "./AttributeColumnsModal.js";
import { UserAttributesModal } from "./UserAttributesModal.js";
import { UserCsvFields, type CsvFieldError } from "./UserCsvFields.js";

/**
 * 画面 1 — FR-7.1 ユーザプール管理。
 *
 * ユーザプールはデプロイにつき 1 つに固定したので（Issue #108）、プールの一覧・カード・作成・名前変更・
 * 削除は無い。ページヘッダに件数と「ユーザを新規登録」「属性の項目を編集」を置き、本体は
 * IamUser の表 1 枚にする。表は、属性の項目が 0 件ならAWSアカウントID ごとに 1 行、1 件以上なら 1 ユーザ 1 行。
 *
 * **AWSアカウントID ごとの 1 行**は、登録操作の単位が「1 AWSアカウントID ＋ 複数ユーザ名」（C-5）であるため、
 * 表示もその単位に合わせる（`mockups.md` 画面 1 の設計判断）。ARN は一覧に出さない — AWSアカウントID と
 * ユーザ名から機械的に導出でき（FR-1.2）、両方が表示済みであるため冗長。導出書式はモーダルのプレビュー行で確認できる。
 *
 * **ユーザ削除の導線**（質問 4 = B）: ユーザ名の隣に行内の削除ボタンを置き、配下の Assignment が連鎖削除される
 * ことを確認モーダルに明記する（Issue #26）。
 *
 * **属性の項目**（Issue #61）のモーダルは画面内の状態で開く。ロールの紐づけは Issue #135 で廃止した（登録したロールは
 * 常に紐づく。ロールの登録と並び順は画面 2）。
 *
 * **属性の編集モード**（Issue #103）: 属性の項目があるときだけ、「属性一括編集モード」で属性のセルを表の中でまとめて編集できる
 * （ロジックは `useAttributeEditMode`）。編集モードの間は、下書きを守るためほかの更新系の操作を無効にする。
 * 既存の行内の「属性を編集」モーダル（1 人ずつ）も残す。
 */

/** 属性の項目が無い間（読み込み中）の、安定した空配列。 */
const NO_COLUMNS: AttributeColumn[] = [];

/**
 * 「このプールにユーザを新規登録」モーダルのAWSアカウントID 初期値（Issue #60）。
 *
 * 最後に登録された（`createdAt` が最大の）ユーザーのAWSアカウントID を返す。複数アカウントが
 * 混在するプールでも、繰り返し登録の対象になりやすい直近のアカウントで一意に決まる。
 * ユーザーが 0 件なら空文字（プリフィルしない）。
 */
function mostRecentAccountId(users: IamUser[]): string {
  return (
    users.reduce<IamUser | null>(
      (latest, user) => (!latest || user.createdAt > latest.createdAt ? user : latest),
      null,
    )?.accountId ?? ""
  );
}

export function PoolScreen(): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const load = useCallback(() => api.getPool(), []);
  const { state, reload, patch } = useAsync(load);

  const [addUsersOpen, setAddUsersOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IamUser | null>(null);
  // 通知を出すたびに新しい参照になるようオブジェクトで持つ（GI-5 の計時をやり直すため）。文言は描画のたびに選んだ言語で引く。
  const [notice, setNotice] = useState<{ text: (m: Messages) => string } | null>(null);
  // 失敗は API のエラーのまま持ち、描画のたびに選んだ言語で文にする（言語を切り替えても追随する）。
  const [deleteError, setDeleteError] = useState<ApiClientError | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 属性の項目の編集は、ほかのモーダルと同じく画面内の状態で開く（Issue #46 spec D-5）。
  const [attributeColumnsOpen, setAttributeColumnsOpen] = useState(false);
  const [userAttributesTarget, setUserAttributesTarget] = useState<{
    user: IamUser;
    columns: AttributeColumn[];
  } | null>(null);

  // GI-5: 成功通知は 5 秒で自動的に消す。失敗はモーダル内の deleteError が担う。
  useAutoDismiss(notice, () => setNotice(null));

  const pool = state.status === "success" ? state.data.pool : null;
  const users = useMemo(() => pool?.users ?? [], [pool]);
  const accountCount = useMemo(() => new Set(users.map((user) => user.accountId)).size, [users]);

  const edit = useAttributeEditMode({
    users,
    columns: pool?.attributeColumns ?? NO_COLUMNS,
    // 保存したユーザの値だけを、再取得せずに入れ替える（表の読み込み表示と入力中のフォーカスを乱さないため）。
    onUserSaved: (saved) =>
      patch((current) => ({
        ...current,
        pool: {
          ...current.pool,
          users: current.pool.users.map((user) =>
            user.arn === saved.arn ? { ...user, attributes: saved.attributes } : user,
          ),
        },
      })),
    onAllSaved: (count) => setNotice({ text: (m) => m.pool.notices.attributesSaved(count) }),
  });

  // 絞り込みとソートは表示だけの条件で、保存しない（Issue #104）。一覧の再取得（`reload`）では維持する。
  const [filterText, setFilterText] = useState("");
  const [sort, setSort] = useState<PoolSort | null>(null);
  const attributeColumnIds = useMemo(
    () => (pool?.attributeColumns ?? []).map((column) => column.columnId),
    [pool],
  );
  const filteredUsers = useMemo(
    () => filterUsers(users, filterText, attributeColumnIds),
    [users, filterText, attributeColumnIds],
  );
  // 属性の項目を全部消すと表がアカウント別に戻る。そのとき別の列のソートが残っていても、効かせるのはAWSアカウントID 列だけ。
  const accountSort = sort?.columnId === "accountId" ? sort : null;
  const filtering = filterText.trim() !== "";
  const filterCountText = filtering ? t.pool.filter.countText(filteredUsers.length, users.length) : undefined;

  // 昇順 → 降順 → 解除の順に切り替える。Cloudscape は昇順と降順しか返さないので、降順の列をもう一度押したら解除する。
  const handleSortingChange = (columnId: string | undefined, descending: boolean): void => {
    if (!columnId || (sort?.columnId === columnId && sort.descending)) setSort(null);
    else setSort({ columnId, descending });
  };
  // ユーザが 1 人もいないときは絞り込み欄を出さない（従来の空表示のまま）。
  const filterField =
    users.length > 0 ? (
      <TextFilter
        data-testid="pool-filter"
        filteringText={filterText}
        filteringPlaceholder={t.pool.filter.placeholder}
        filteringAriaLabel={t.pool.filter.ariaLabel}
        countText={filterCountText}
        onChange={({ detail }) => setFilterText(detail.filteringText)}
      />
    ) : undefined;

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await api.deleteUser(deleteTarget.arn);
      setDeleteTarget(null);
      const { userName } = deleteTarget;
      setNotice({ text: (m) => m.pool.notices.unregistered(userName, result.removedAssignments) });
      reload();
    } catch (cause) {
      // モーダルは閉じない。閉じると失敗した事実が行方不明になる。
      setDeleteError(toApiError(cause));
    } finally {
      setDeleting(false);
    }
  };

  // 属性の表の上の行: 絞り込み欄と、編集モードの操作（Issue #103）。
  const editToolbar = (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center", justifyContent: "space-between" }}>
      <div style={{ flex: "1 1 320px", maxWidth: 520 }}>{filterField}</div>
      {users.length > 0 && (
        <SpaceBetween direction="horizontal" size="xs" alignItems="center">
          {edit.editing ? (
            <>
              {/* 隣のボタンと接しないよう、右に余白を取る。 */}
              <span data-testid="edit-mode-status" style={{ paddingRight: 8 }}>
                <Box variant="strong">{t.pool.edit.title}</Box> {t.pool.edit.changes(edit.changedCells)}
              </span>
              <Button data-testid="edit-mode-cancel" disabled={edit.saving} onClick={edit.cancel}>
                {t.pool.cancel}
              </Button>
              <Button
                variant="primary"
                data-testid="edit-mode-save"
                disabled={edit.changedCells === 0}
                loading={edit.saving}
                loadingText={t.pool.saving}
                onClick={() => void edit.save()}
              >
                {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
                {edit.saving ? t.pool.saving : t.pool.edit.save(edit.changedCells)}
              </Button>
            </>
          ) : (
            <PermissionButton need="edit" data-testid="edit-mode-start" onClick={edit.start}>
              {t.pool.edit.start}
            </PermissionButton>
          )}
        </SpaceBetween>
      )}
    </div>
  );

  // 2 つの表で同じ空表示を使う（食い違わないよう 1 つの要素を共有する）。
  // 絞り込みで 0 件のときは、ユーザ 0 件の空表示とは別にして、条件を外す導線を出す。
  const emptyUsers =
    users.length > 0 ? (
      <Box textAlign="center" padding="s" data-testid="pool-filter-empty">
        <SpaceBetween size="xs">
          <Box variant="strong">{t.pool.empty.noMatch}</Box>
          <Button data-testid="pool-filter-clear" onClick={() => setFilterText("")}>
            {t.pool.empty.clear}
          </Button>
        </SpaceBetween>
      </Box>
    ) : (
      <Box textAlign="center" padding="s" data-testid="pool-users-empty">
        <SpaceBetween size="xs">
          <Box variant="strong">{t.pool.empty.none}</Box>
          <PermissionButton need="edit" data-testid="pool-empty-add-users" onClick={() => setAddUsersOpen(true)}>
            {t.pool.addUsers}
          </PermissionButton>
        </SpaceBetween>
      </Box>
    );

  return (
    <ContentLayout
      header={
        <PageHeading
          title={t.pool.title}
          counts={
            pool ? t.pool.counts(users.length, accountCount, pool.linkedRoleCount) : t.pool.countsLoading
          }
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              {/* 編集モードの間は、再取得で下書きが消えないよう更新系の操作を無効にする。表の「保存」を
                  唯一の primary にするため、ここは normal に落とす（GI-9。Issue #103）。 */}
              <PermissionButton need="edit"
                variant={edit.editing ? "normal" : "primary"}
                data-testid="add-users"
                disabled={edit.editing}
                onClick={() => setAddUsersOpen(true)}
              >
                {t.pool.addUsers}
              </PermissionButton>
              <PermissionButton need="edit"
                data-testid="edit-attribute-columns"
                disabled={edit.editing}
                onClick={() => setAttributeColumnsOpen(true)}
              >
                {t.pool.editAttributeColumns}
              </PermissionButton>
            </SpaceBetween>
          }
        />
      }
    >
      <SpaceBetween size="l">
        {notice && (
          <Flashbar
            items={[
              {
                type: "success",
                content: notice.text(t),
                dismissible: true,
                onDismiss: () => setNotice(null),
                id: "pools-notice",
              },
            ]}
          />
        )}

        {edit.partial && (
          <Alert
            type="error"
            statusIconAriaLabel={t.pool.errorAriaLabel}
            data-testid="attr-save-alert"
            action={
              <Button data-testid="attr-save-retry" disabled={edit.saving} onClick={() => void edit.save()}>
                {t.pool.edit.retry(edit.partial.failed)}
              </Button>
            }
          >
            {t.pool.edit.partial(edit.partial.saved, edit.partial.failed)}
          </Alert>
        )}

        {state.status === "error" ? (
          <ErrorPanel
            header={t.pool.loadErrorHeader}
            error={state.error}
            onRetry={reload}
            testId="pools-error"
          />
        ) : pool && pool.attributeColumns.length > 0 ? (
          <Table<IamUser>
            stickyHeader
            variant="embedded"
            items={sortUsers(filteredUsers, sort)}
            trackBy={(user) => user.arn}
            wrapLines
            data-testid="pool-users"
            empty={emptyUsers}
            filter={editToolbar}
            sortingColumn={sort ? { sortingField: sort.columnId } : undefined}
            sortingDescending={sort?.descending ?? false}
            onSortingChange={({ detail }) =>
              handleSortingChange(detail.sortingColumn.sortingField, detail.isDescending ?? false)
            }
            columnDefinitions={[
              {
                id: "accountId",
                header: t.pool.columns.accountId,
                width: 180,
                sortingField: "accountId",
                cell: (user) => <code>{user.accountId}</code>,
              },
              {
                id: "userName",
                header: t.pool.columns.userName,
                sortingField: "userName",
                cell: (user) => <code>{user.userName}</code>,
              },
              ...pool.attributeColumns.map((column) => ({
                id: `attr-${column.columnId}`,
                header: column.name,
                sortingField: `attr-${column.columnId}`,
                cell: (user: IamUser) => {
                  if (!edit.editing) {
                    return (
                      <span data-testid={`attr-${user.arn}-${column.columnId}`}>
                        {user.attributes[column.columnId] ?? "—"}
                      </span>
                    );
                  }
                  const error = edit.errorOf(user, column.columnId);
                  return (
                    <div>
                      <Input
                        data-testid={`attr-input-${user.arn}-${column.columnId}`}
                        ariaLabel={t.pool.edit.cellAria(user.userName, column.name)}
                        value={edit.valueOf(user, column.columnId)}
                        invalid={error !== null || edit.failedCell(user, column.columnId)}
                        // 保存中も入力欄を残す（disabled にするとフォーカスを失う）。
                        readOnly={edit.saving}
                        onChange={({ detail }) => edit.setCell(user, column.columnId, detail.value)}
                        onBlur={() => edit.blurCell(user, column.columnId)}
                      />
                      {error !== null && (
                        <Box color="text-status-error" fontSize="body-s" data-testid={`attr-cell-error-${user.arn}-${column.columnId}`}>
                          {error}
                        </Box>
                      )}
                    </div>
                  );
                },
              })),
              {
                id: "actions",
                header: t.pool.columns.actions,
                cell: (user) => (
                  // Issue #15 と同じく、操作は折り返さない 1 単位にする。
                  <span style={{ whiteSpace: "nowrap" }}>
                    {edit.editing && edit.failures[user.arn] !== undefined && (
                      <Box color="text-status-error" fontSize="body-s" data-testid={`attr-row-status-${user.arn}`}>
                        {t.pool.edit.rowFailed(edit.failures[user.arn] ?? "")}
                      </Box>
                    )}
                    {edit.editing && edit.saved[user.arn] === true && (
                      <Box color="text-status-success" fontSize="body-s" data-testid={`attr-row-status-${user.arn}`}>
                        {t.pool.edit.rowSaved}
                      </Box>
                    )}
                    <PermissionButton need="edit"
                      variant="inline-link"
                      data-testid={`edit-user-attributes-${user.arn}`}
                      ariaLabel={t.pool.editAttributesAria(user.userName)}
                      disabled={edit.editing}
                      onClick={() => setUserAttributesTarget({ user, columns: pool.attributeColumns })}
                    >
                      {t.pool.editAttributes}
                    </PermissionButton>{" "}
                    <PermissionButton need="edit"
                      variant="inline-link"
                      data-testid={`delete-user-${user.arn}`}
                      ariaLabel={t.pool.unregisterAria(user.userName)}
                      disabled={edit.editing}
                      onClick={() => setDeleteTarget(user)}
                    >
                      {t.pool.unregister}
                    </PermissionButton>
                  </span>
                ),
              },
            ]}
          />
        ) : (
          <Table<AccountRow>
            stickyHeader
            variant="embedded"
            items={groupByAccount(filteredUsers, accountSort?.descending ?? false)}
            trackBy={(row) => row.accountId}
            loading={state.status === "loading"}
            loadingText={t.pool.loading}
            wrapLines
            data-testid="pool-users"
            empty={emptyUsers}
            filter={filterField}
            // 1 行に複数のユーザを束ねるので、並べ替えられるのは「AWSアカウント」列だけ。
            sortingColumn={accountSort ? { sortingField: "accountId" } : undefined}
            sortingDescending={accountSort?.descending ?? false}
            onSortingChange={({ detail }) =>
              handleSortingChange(detail.sortingColumn.sortingField, detail.isDescending ?? false)
            }
            columnDefinitions={[
              {
                id: "accountId",
                header: t.pool.columns.accountId,
                width: 180,
                sortingField: "accountId",
                cell: (row) => <code>{row.accountId}</code>,
              },
              {
                id: "userNames",
                header: t.pool.columns.userName,
                cell: (row) => (
                  <SpaceBetween size="xxs">
                    {row.users.map((user) => (
                      // Issue #15: ユーザ名と削除ボタンを折り返さない 1 単位にする。
                      // `wrapLines` を外す方法は採らない — 外すと Cloudscape がセルに
                      // `overflow: hidden` と省略記号を掛け、列が狭まると削除ボタンごと
                      // 隠れうる。収まらない幅では表の側が横スクロールする。
                      <span key={user.arn} style={{ whiteSpace: "nowrap" }}>
                        <code>{user.userName}</code>{" "}
                        <PermissionButton need="edit"
                          variant="inline-link"
                          data-testid={`delete-user-${user.arn}`}
                          ariaLabel={t.pool.unregisterAria(user.userName)}
                          onClick={() => setDeleteTarget(user)}
                        >
                          {t.pool.unregister}
                        </PermissionButton>
                      </span>
                    ))}
                  </SpaceBetween>
                ),
              },
            ]}
          />
        )}
      </SpaceBetween>

      {/* 編集モードの破棄確認（キャンセル・アプリ内の遷移）。入力欄を持たない確認なので Escape は「編集に戻る」（GI-4）。 */}
      {edit.discard && (
        <Modal
          visible
          header={t.pool.discard.header}
          data-testid="attr-discard-modal"
          onDismiss={edit.closeDiscard}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button data-testid="attr-discard-back" onClick={edit.closeDiscard}>
                  {t.pool.discard.back}
                </Button>
                <Button variant="primary" data-testid="attr-discard-confirm" onClick={edit.discard.confirm}>
                  {edit.discard.kind === "navigate" ? t.pool.discard.navigateConfirm : t.pool.discard.confirm}
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="xs">
            <Box variant="p">{t.pool.discard.body(edit.changedCells)}</Box>
            {edit.discard.kind === "navigate" && <Box variant="p">{t.pool.discard.navigateReason}</Box>}
          </SpaceBetween>
        </Modal>
      )}

      <AddUsersModal
        open={addUsersOpen}
        users={users}
        attributeColumns={pool?.attributeColumns ?? []}
        onDismiss={() => setAddUsersOpen(false)}
        onAdded={(result) => {
          setAddUsersOpen(false);
          setNotice({ text: (m) => m.pool.notices.registered(result.createdCount, result.skippedCount) });
          reload();
        }}
      />

      <AttributeColumnsModal
        pool={attributeColumnsOpen && pool ? pool : null}
        onDismiss={() => setAttributeColumnsOpen(false)}
        onSaved={() => {
          setAttributeColumnsOpen(false);
          setNotice({ text: (m) => m.pool.notices.columnsSaved });
          reload();
        }}
      />

      <UserAttributesModal
        target={userAttributesTarget}
        onDismiss={() => setUserAttributesTarget(null)}
        onSaved={(saved) => {
          setUserAttributesTarget(null);
          setNotice({ text: (m) => m.pool.notices.userAttributesSaved(saved.userName) });
          reload();
        }}
      />

      {/*
        GI-4: このモーダルは入力欄を持たない確認モーダルであり、閉じても失われる
        入力が存在しない。したがって `dirty` は常に false — Escape で即座に閉じる
        のが正しい挙動である。`GuardedModal` を通すのは、全モーダルが GI-4 の
        判断を明示的に経ていることをコード上で示すためである。
      */}
      <GuardedModal
        visible={deleteTarget !== null}
        header={t.pool.delete.header}
        testId="delete-user-modal"
        dirty={false}
        onClose={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        footer={(requestClose) => (
          <Box float="right">
            <SpaceBetween direction="horizontal" size="xs">
              <Button data-testid="delete-user-cancel" onClick={requestClose}>
                {t.pool.cancel}
              </Button>
              <Button
                variant="primary"
                loading={deleting}
                loadingText={t.pool.delete.unregistering}
                data-testid="delete-user-confirm"
                onClick={() => void handleDelete()}
              >
                {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
                {deleting ? t.pool.delete.unregistering : t.pool.unregister}
              </Button>
            </SpaceBetween>
          </Box>
        )}
      >
        <SpaceBetween size="s">
          <Alert type="warning" statusIconAriaLabel={t.pool.warningAriaLabel}>
            <Box variant="p">
              <code>{deleteTarget?.arn}</code>
              {t.pool.delete.afterArn}
            </Box>
            <Box variant="p">{t.pool.delete.cascade}</Box>
            <Box variant="p">{t.pool.delete.requestsKept}</Box>
            <Box variant="p">{t.pool.delete.blocked}</Box>
          </Alert>
          {deleteError && (
            <Alert type="error" statusIconAriaLabel={t.pool.errorAriaLabel} data-testid="delete-user-error">
              {describeError(locale, t, deleteError)}
            </Alert>
          )}
        </SpaceBetween>
      </GuardedModal>
    </ContentLayout>
  );
}

// --- モーダル ---------------------------------------------------------------

interface UserInputState {
  accountId: string;
  userNames: string;
}

/** GI-1: 検証は blur 時と送信時に行う。キーストロークごとには行わない。 */
function validateAccountId(t: Messages, value: string): string | null {
  if (value.trim() === "") return t.pool.register.accountIdRequired;
  if (!ACCOUNT_ID_PATTERN.test(value.trim())) return t.pool.register.accountIdFormat;
  return null;
}

function parseUserNames(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    ),
  ];
}

function validateUserNames(t: Messages, raw: string): string | null {
  const names = parseUserNames(raw);
  if (names.length === 0) return t.pool.register.userNamesRequired;
  const invalid = names.find((name) => !IAM_NAME_PATTERN.test(name));
  if (invalid) {
    return t.pool.register.userNameInvalid(invalid);
  }
  return null;
}

/** FR-1.2 の導出書式を確認できるプレビュー（1 件目のみ）。 */
function arnPreview(accountId: string, raw: string): string | null {
  const [first] = parseUserNames(raw);
  if (!first || !ACCOUNT_ID_PATTERN.test(accountId.trim())) return null;
  try {
    return buildUserArn(accountId.trim(), first);
  } catch {
    return null;
  }
}

function UserFields({
  idPrefix,
  value,
  onChange,
  errors,
  onBlurField,
}: {
  idPrefix: string;
  value: UserInputState;
  onChange: (next: UserInputState) => void;
  errors: { accountId: string | null; userNames: string | null };
  onBlurField: (field: "accountId" | "userNames") => void;
}): React.JSX.Element {
  const t = useT();
  const preview = arnPreview(value.accountId, value.userNames);

  return (
    <>
      <FormField label={t.pool.register.accountIdLabel} errorText={errors.accountId ?? undefined}>
        <Input
          data-testid={`${idPrefix}-account-id`}
          value={value.accountId}
          inputMode="numeric"
          placeholder="123456789012"
          onChange={(event) => onChange({ ...value, accountId: event.detail.value })}
          onBlur={() => onBlurField("accountId")}
        />
      </FormField>

      <FormField
        label={t.pool.register.userNamesLabel}
        description={t.pool.register.userNamesDescription}
        errorText={errors.userNames ?? undefined}
      >
        <Textarea
          data-testid={`${idPrefix}-user-names`}
          value={value.userNames}
          rows={5}
          onChange={(event) => onChange({ ...value, userNames: event.detail.value })}
          onBlur={() => onBlurField("userNames")}
        />
      </FormField>

      <FormField label={t.pool.register.arnPreviewLabel}>
        <Box variant="code" data-testid={`${idPrefix}-arn-preview`}>
          {preview ?? "—"}
        </Box>
      </FormField>
    </>
  );
}

function AddUsersModal({
  open,
  users,
  attributeColumns,
  onDismiss,
  onAdded,
}: {
  open: boolean;
  /** AWSアカウントID の初期値（Issue #60）に使う、登録済みの IamUser。 */
  users: IamUser[];
  /** CSV の説明と検証に使う属性の項目（FR-1.9・FR-1.10）。 */
  attributeColumns: AttributeColumn[];
  onDismiss: () => void;
  onAdded: (result: AddUsersResponse) => void;
}): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  const initialAccountId = open ? mostRecentAccountId(users) : "";
  const attributeColumnNames = attributeColumns.map((column) => column.name);
  // CSV の入力欄の初期値（Issue #207）。必須の列名とプールの属性の項目名のヘッダ行。
  const initialCsv = formatUserCsvHeader(attributeColumnNames);

  // AWSアカウントID も、利用者が書き換えるまでは null。ユーザ一覧の読み込みが終わる前に開いても、読み込み後に
  // 初期値（Issue #60）へ追随し、触っていないのに破棄確認が出ることもない（Issue #207 の実測で見つけた）。
  const [accountIdEdited, setAccountIdEdited] = useState<string | null>(null);
  const [userNames, setUserNames] = useState("");
  const fields: UserInputState = { accountId: accountIdEdited ?? initialAccountId, userNames };
  const setFields = (next: UserInputState): void => {
    if (next.accountId !== fields.accountId) setAccountIdEdited(next.accountId);
    setUserNames(next.userNames);
  };
  const [mode, setMode] = useState<"single" | "csv">("single");
  // 利用者が入力を始めるまでは null。null の間は、いまの属性の項目から導いたヘッダを出す。プールの読み込みが
  // 終わる前にモーダルを開いても、読み込み後にヘッダが属性の項目名へ追随する（本番の実測で見つけた。Issue #207）。
  const [csvEdited, setCsvEdited] = useState<string | null>(null);
  const csvText = csvEdited ?? initialCsv;
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  // 失敗は API のエラーのまま持ち、描画のたびに選んだ言語で文にする（言語を切り替えても追随する）。
  // `csv` は送信したときのモード。再送の案内は、失敗した送信が CSV だったかで決める（あとからモードを切り替えても変えない）。
  const [submitError, setSubmitError] = useState<{ error: ApiClientError; csv: boolean } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // モーダルが開くたびに、初期値（Issue #60）へそろえる。`useEffect` だと効果が
  // 走るまでの最初の描画が古い値のまま出る（Issue #67）ため、レンダー中に検知してその場で書き換える。
  const [renderedFor, setRenderedFor] = useState(open);
  if (renderedFor !== open) {
    setRenderedFor(open);
    setAccountIdEdited(null);
    setUserNames("");
    setMode("single");
    setCsvEdited(null);
    setTouched({});
    setSubmitError(null);
  }

  const accountIdError = validateAccountId(t, fields.accountId);
  const userNamesError = validateUserNames(t, fields.userNames);
  const csvResult = useMemo(
    () => (csvText.trim() === "" ? null : parseUserCsv(csvText, attributeColumnNames)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 列名は attributeColumns から導く
    [csvText, attributeColumns],
  );
  // 構文エラーは localized を選んだ言語で描画する。入力が空のときの案内は画面の文言。
  const csvErrors: CsvFieldError[] =
    csvResult === null
      ? [{ line: null, text: t.pool.csv.required }]
      : csvResult.ok
        ? []
        : csvResult.errors.map((error) => ({
            line: error.line,
            text: localizeMessage(locale, error.message, error.localized),
          }));
  const valid = !accountIdError && (mode === "csv" ? csvErrors.length === 0 : !userNamesError);

  // GI-4: 開いたときの初期値（プリフィルされたAWSアカウントID と CSV のヘッダ行を含む）からの変化で判定する。
  const dirty = fields.accountId !== initialAccountId || fields.userNames !== "" || csvText !== initialCsv;

  const reset = (): void => {
    setAccountIdEdited(null);
    setUserNames("");
    setCsvEdited(null);
    setMode("single");
    setTouched({});
    setSubmitError(null);
  };

  const close = (): void => {
    reset();
    onDismiss();
  };

  const submit = async (): Promise<void> => {
    setTouched({ accountId: true, userNames: true, csv: true });
    if (!valid) return;

    setSubmitting(true);
    setSubmitError(null);
    try {
      const accountId = fields.accountId.trim();
      const result =
        mode === "csv" && csvResult?.ok
          ? await api.addUsers({ accountId, users: csvResult.rows })
          : await api.addUsers({ accountId, userNames: parseUserNames(fields.userNames) });
      reset();
      onAdded(result);
    } catch (cause) {
      setSubmitError({ error: toApiError(cause), csv: mode === "csv" });
    } finally {
      setSubmitting(false);
    }
  };

  // CSV の登録に失敗したときは、同じ CSV をそのまま再送できることを添える。
  const submitErrorText =
    submitError === null
      ? ""
      : submitError.csv
        ? t.pool.register.csvRetry(describeError(locale, t, submitError.error))
        : describeError(locale, t, submitError.error);

  return (
    <GuardedModal
      visible={open}
      header={t.pool.register.header}
      testId="add-users-modal"
      dirty={dirty}
      onClose={close}
      footer={(requestClose) => (
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            {/* GI-4: 入力があれば破棄確認を挟む（`requestClose` が判断する）。 */}
            <Button data-testid="add-users-cancel" onClick={requestClose}>
              {t.pool.cancel}
            </Button>
            <Button
              variant="primary"
              loading={submitting}
              loadingText={t.pool.register.submitting}
              data-testid="add-users-submit"
              onClick={() => void submit()}
            >
              {/* GI-7: 非同期処理中はラベルを進行形にする。 */}
              {submitting ? t.pool.register.submitting : t.pool.register.submit}
            </Button>
          </SpaceBetween>
        </Box>
      )}
    >
      <Form errorText={submitError === null ? undefined : submitErrorText}>
        <SpaceBetween size="m">
          <SegmentedControl
            data-testid="add-users-mode"
            selectedId={mode}
            label={t.pool.register.methodLabel}
            options={[
              { id: "single", text: t.pool.register.single },
              { id: "csv", text: t.pool.register.csv },
            ]}
            onChange={({ detail }) => setMode(detail.selectedId as "single" | "csv")}
          />
          {mode === "single" ? (
            <UserFields
              idPrefix="add-users"
              value={fields}
              onChange={setFields}
              errors={{
                accountId: touched.accountId ? accountIdError : null,
                userNames: touched.userNames ? userNamesError : null,
              }}
              onBlurField={(field) => setTouched((current) => ({ ...current, [field]: true }))}
            />
          ) : (
            <>
              <FormField label={t.pool.register.accountIdLabel} errorText={(touched.accountId ? accountIdError : null) ?? undefined}>
                <Input
                  data-testid="add-users-account-id"
                  value={fields.accountId}
                  inputMode="numeric"
                  placeholder="123456789012"
                  onChange={(event) => setFields({ ...fields, accountId: event.detail.value })}
                  onBlur={() => setTouched((current) => ({ ...current, accountId: true }))}
                />
              </FormField>
              <UserCsvFields
                idPrefix="add-users"
                value={csvText}
                onChange={setCsvEdited}
                onBlur={() => setTouched((current) => ({ ...current, csv: true }))}
                attributeColumnNames={attributeColumnNames}
                errors={csvErrors}
                showErrors={touched.csv === true}
              />
            </>
          )}
        </SpaceBetween>
      </Form>
    </GuardedModal>
  );
}
