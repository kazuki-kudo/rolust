import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Input from "@cloudscape-design/components/input";
import SpaceBetween from "@cloudscape-design/components/space-between";
import type { Assignment, AttributeColumn, ExcludedRole, IamRole, IamUser, RoleLock } from "@rolust/core";
import { countChangesByRole } from "@rolust/core";

import { useMatrixHidden, type MatrixHiddenController } from "../hooks/useMatrixHidden.js";
import { useT } from "../i18n/index.js";
import { roleNameOf, userNameOf } from "../labels.js";
import { canHideRole, pruneHidden } from "../matrix-hidden.js";
import type {
  AttributeColumnView,
  AttributeSortOrder,
  CellValue,
  ColumnFilter,
  ColumnView,
  MatrixViewState,
  SortOrder,
} from "../matrix-view.js";
import {
  EMPTY_VIEW,
  attributeValueOptions,
  computeVisibleUserArns,
  isViewActive,
  withAttrFilter,
  withAttrSort,
  withFilter,
  withSort,
  withUserText,
} from "../matrix-view.js";
import { ExclusionBanner } from "./ExclusionBanner.js";
import { HiddenColumnsStatus, type HiddenColumnItem } from "./HiddenColumnsStatus.js";
import type { CellState, MatrixColumn, MatrixRow } from "./MatrixGrid.js";
import { MatrixGrid } from "./MatrixGrid.js";
import { SkipToActions } from "./SkipToActions.js";

/**
 * AssignmentMatrix — IamUser × IamRole の割り当てを増減し、申請対象のロールを
 * 列単位で選択するグリッド（`interaction-spec.md` § AssignmentMatrix）。
 *
 * 構成（`design-system-mapping.md` の自前構成図）:
 *
 * ```
 * AssignmentMatrix
 *  ├ SkipToActions     … マトリクスを飛ばしてツールバーへ（a11y M-1.4 / AN-3）
 *  ├ ExclusionBanner   … FR-4.6 の除外警告帯
 *  └ MatrixGrid        … 自前 <table>。行/列ヘッダ sticky、ローミング tabindex
 * ```
 *
 * ツールバー（選択件数と「申請を作成」）は**画面側が持つ**。ページヘッダ直下の
 * 固定領域という位置づけであり（`mockups.md` § 共通レイアウト規約）、
 * マトリクス部品の内側に閉じると画面の主アクション（1 画面 1 つ / GI-9）が
 * 部品に隠れるためである。部品は `toolbarTargetId` でスキップリンクの飛び先だけを受ける。
 *
 * ## 変更件数は導出値である
 *
 * 列ヘッダの「変更 n」は props で受けない（`interaction-spec.md` の明示的な指示）。
 * `Assignment.checked`（あるべき状態）と `Assignment.reflected`（最後に反映された状態
 * ＝ spec が言う `baseline`）の食い違いを `countChangesByRole` で数えて求める。
 * 件数を props で受けると `assignments` と二重の情報源になり、チェック操作のたびに
 * 同期させる必要が生じる。差分記号（`+` / `−`）も同じ導出から得る。
 *
 * ## ソート・フィルタ（Issue #91）
 *
 * 条件（`view`）と、**確定した表示順**（`order`。`null` は条件なしで `users` の順）を持つ。
 * 条件を変えたときにだけ表示順を計算し直す。セルのチェックで `assignments` が更新されても
 * 再計算しない — 絞り込み中にチェックを外して行が消えたり動いたりすると、フォーカスしている
 * セルごと失われるため（spec D-7）。マトリクスの読み直しとプールの切り替えでは、画面が読み込み中の
 * 表示に切り替わってこの部品が外れるので、条件は初期値に戻る。
 * 列ヘッダの「変更 n」・申請に含める対象は、絞り込みに関係なく全行で数える（D-8）。
 *
 * 当初の spec の props 表は `assignments` と `baseline` を別配列としていた（Issue #26 で正本をこの実装に合わせた）。本実装の
 * `Assignment` は 1 レコードに `checked` と `reflected` の両方を持つ
 * （`packages/core/src/types.ts`）。別配列にすると同じ事実を 2 箇所で持つことになるため、
 * 埋め込み済みの `reflected` を baseline として扱う。導出値であるという要件は変わらない。
 */

export interface AssignmentMatrixProps {
  /** プールの属性の項目（Issue #107）。省略は 0 件。 */
  attributeColumns?: AttributeColumn[];
  /** 行。 */
  users: IamUser[];
  /** 列。 */
  roles: IamRole[];
  /** 現在のチェック状態（`checked`）と最後に反映された状態（`reflected`）。 */
  assignments: Assignment[];
  /** ロール ARN → 未反映申請。FR-4.6 により申請対象外になる列。 */
  locks: Record<string, RoleLock>;
  /** 申請対象として選択中のロール ARN。 */
  selectedRoleArns: string[];
  /** 保存中の交点（`<userArn>|<roleArn>`）。楽観的更新をしないため、応答待ちを明示する。 */
  savingCells: ReadonlySet<string>;
  /** スキップリンクの飛び先（ツールバーの「申請を作成」ボタンの id）。 */
  toolbarTargetId: string;
  onToggleCell: (userArn: string, roleArn: string, next: boolean) => void;
  onToggleRole: (roleArn: string, next: boolean) => void;
  onNavigateToRequest?: (changeRequestId: string) => void;
  /**
   * ロールが 0 件の empty 状態に「IAMロールを新規登録」を出し、押されたら呼ぶ（画面 2 へ移る）。省略すると導線を出さない。
   * （Issue #135 で、「ロールの紐づけ」の導線から改めた。登録したロールは常に列になる。）
   */
  onRegisterRoles?: () => void;
  /**
   * 非表示の状態（Issue #140）。画面（`MatrixScreen`）が持って渡す。自動選択から非表示のロールを除くために、
   * 画面も同じ状態を読む必要があるため。省略すると、この部品のメモリ上の状態で動く（保存しない）。
   */
  hiddenController?: MatrixHiddenController;
  /**
   * 絞り込み欄を描く先（画面のツールバー内の枠。Issue #155）。
   * - 省略（undefined）: マトリクスの上に従来どおり描く（単独利用・テスト）。
   * - null: 枠がまだ無い。描かない。
   * - HTMLElement: その要素へポータルで描く。状態はこの部品が持つので、欄の値は保たれる。
   */
  filterAnchor?: HTMLElement | null;
}

const EMPTY_ATTRIBUTE_COLUMNS: AttributeColumn[] = [];

/** 交点のキー。`savingCells` と突き合わせる。 */
export function cellKey(userArn: string, roleArn: string): string {
  return `${userArn}|${roleArn}`;
}

export function AssignmentMatrix({
  attributeColumns = EMPTY_ATTRIBUTE_COLUMNS,
  users,
  roles,
  assignments,
  locks,
  selectedRoleArns,
  savingCells,
  toolbarTargetId,
  onToggleCell,
  onToggleRole,
  onNavigateToRequest,
  onRegisterRoles,
  hiddenController,
  filterAnchor,
}: AssignmentMatrixProps): React.JSX.Element {
  const t = useT();
  // 交点の索引。O(1) で引けるようにする（N×M の描画で毎回 find すると二乗になる）。
  const byCell = useMemo(() => {
    const map = new Map<string, Assignment>();
    for (const assignment of assignments) {
      map.set(cellKey(assignment.userArn, assignment.roleArn), assignment);
    }
    return map;
  }, [assignments]);

  // FR-3.1 の列ヘッダに出す変更件数。props ではなく導出値（本ファイル冒頭の解説を参照）。
  const changeCounts = useMemo(() => countChangesByRole(assignments), [assignments]);

  const selected = useMemo(() => new Set(selectedRoleArns), [selectedRoleArns]);

  // ソート・フィルタ（Issue #91）。表示する行と順序は、条件を変えたときに確定する（D-7）。
  const [view, setView] = useState<MatrixViewState>(EMPTY_VIEW);
  const [order, setOrder] = useState<string[] | null>(null);

  const cellOf = (userArn: string, roleArn: string): CellValue => {
    const assignment = byCell.get(cellKey(userArn, roleArn));
    return { checked: assignment?.checked ?? false, reflected: assignment?.reflected ?? false };
  };

  // 非表示の状態（Issue #140）。畳んだ属性の項目（Issue #107）も同じ状態で持ち、保存する。
  const ownController = useMatrixHidden(null);
  const controller = hiddenController ?? ownController;
  const hiddenState = useMemo(
    () =>
      pruneHidden(
        controller.hidden,
        roles.map((role) => role.arn),
        attributeColumns.map((column) => column.columnId),
      ),
    [controller.hidden, roles, attributeColumns],
  );
  const folded = hiddenState.foldedColumnIds;
  const hiddenRoleArns = hiddenState.roleArns;
  // 現在の列に無い値は捨てて保存し直す（D-9）。
  const { sync } = controller;
  useEffect(() => {
    sync(
      roles.map((role) => role.arn),
      attributeColumns.map((column) => column.columnId),
    );
  }, [sync, roles, attributeColumns]);
  const [hideAnnouncement, setHideAnnouncement] = useState("");

  // テキスト絞り込みが照合する文字列（Issue #106・#107）。ユーザ名・AWSアカウントID と、畳んでいない属性の項目の値（spec D-9）。
  const userByArn = useMemo(() => new Map(users.map((user) => [user.arn, user] as const)), [users]);
  const textOf = (userArn: string, foldedIds: ReadonlySet<string> = folded): string => {
    const user = userByArn.get(userArn);
    if (!user) return "";
    const values = attributeColumns
      .filter((column) => !foldedIds.has(column.columnId))
      .map((column) => user.attributes[column.columnId] ?? "");
    return [user.userName || userNameOf(user.arn), user.accountId, ...values].join(" ");
  };
  const attributeOf = (userArn: string, columnId: string): string | undefined =>
    userByArn.get(userArn)?.attributes[columnId];

  const applyView = (next: MatrixViewState, foldedIds: ReadonlySet<string> = folded): void => {
    setView(next);
    setOrder(
      isViewActive(next)
        ? computeVisibleUserArns(
            users.map((user) => user.arn),
            cellOf,
            next,
            (userArn) => textOf(userArn, foldedIds),
            attributeOf,
          )
        : null,
    );
  };

  /** 属性の項目を畳む・開く。テキストが入っているときだけ、照合の対象が変わるので確定し直す（spec D-11）。 */
  const toggleFold = (columnId: string): void => {
    const next = new Set(folded);
    if (next.has(columnId)) next.delete(columnId);
    else next.add(columnId);
    controller.toggleFold(columnId);
    if (view.userText.trim() !== "") applyView(view, next);
  };

  const gridRef = useRef<HTMLDivElement>(null);

  /**
   * 条件をすべて外す。押したボタン（件数の行・0 件の本体）は条件が無くなると消えるので、
   * フォーカスをマトリクスの Tab 停止点（ローミング tabindex の位置）へ明示的に移す。
   * 移さないとフォーカスが `<body>` へ落ち、次の Tab が文書の先頭から始まる（Focus management）。
   */
  const clearView = (): void => {
    applyView(EMPTY_VIEW);
    gridRef.current?.querySelector<HTMLElement>('table [tabindex="0"]')?.focus();
  };

  const columnView: Record<string, ColumnView> = useMemo(() => {
    const result: Record<string, ColumnView> = {};
    for (const [roleArn, filter] of Object.entries(view.filters)) {
      result[roleArn] = { filter, sort: null };
    }
    const sort = view.sort;
    if (sort?.kind === "role") {
      const current = result[sort.roleArn];
      result[sort.roleArn] = { filter: current?.filter ?? null, sort: sort.order };
    }
    return result;
  }, [view]);

  // 属性の項目の「▾」メニューに出す値の一覧（全ユーザ基準。spec D-8）。
  const attributeOptions = useMemo(
    () =>
      Object.fromEntries(
        attributeColumns.map((column) => [column.columnId, attributeValueOptions(users, column.columnId)]),
      ),
    [users, attributeColumns],
  );

  const attributeView: Record<string, AttributeColumnView> = useMemo(() => {
    const result: Record<string, AttributeColumnView> = {};
    for (const column of attributeColumns) {
      const filter = view.attrFilters[column.columnId] ?? null;
      const sort =
        view.sort?.kind === "attr" && view.sort.columnId === column.columnId ? view.sort.order : null;
      if (filter !== null || sort !== null) result[column.columnId] = { filter, sort };
    }
    return result;
  }, [view, attributeColumns]);

  const rows: MatrixRow[] = useMemo(() => {
    const toRow = (user: IamUser): MatrixRow => ({
      userArn: user.arn,
      userName: user.userName || userNameOf(user.arn),
      accountId: user.accountId,
      attributes: user.attributes,
    });
    if (order === null) return users.map(toRow);
    const byArn = new Map(users.map((user) => [user.arn, user] as const));
    return order.flatMap((userArn) => {
      const user = byArn.get(userArn);
      return user ? [toRow(user)] : [];
    });
  }, [users, order]);

  const allColumns: MatrixColumn[] = useMemo(
    () =>
      roles.map((role) => {
        const formalRoleName = role.roleName || roleNameOf(role.arn);
        return {
          roleArn: role.arn,
          // 表示名があれば列の名前に使う（Issue #150）。aria-label も同じ名前を使う。
          roleName: role.displayName ?? formalRoleName,
          formalRoleName,
          accountId: role.accountId,
          description: role.description,
          color: role.color,
          changeCount: changeCounts.get(role.arn) ?? 0,
          lock: locks[role.arn] ?? null,
          selected: selected.has(role.arn),
        };
      }),
    [roles, changeCounts, locks, selected],
  );

  // 隠したロールを除いた、描く列。変更件数・除外の帯・選択可能数は全ロール基準のまま（Issue #140。spec 3.3）。
  const columns: MatrixColumn[] = useMemo(
    () => allColumns.filter((column) => !hiddenRoleArns.has(column.roleArn)),
    [allColumns, hiddenRoleArns],
  );

  const hiddenItems: HiddenColumnItem[] = useMemo(
    () =>
      allColumns
        .filter((column) => hiddenRoleArns.has(column.roleArn))
        .map((column) => ({
          roleArn: column.roleArn,
          roleName: column.roleName,
          changed: column.changeCount > 0,
          conditioned: columnView[column.roleArn] !== undefined,
        })),
    [allColumns, hiddenRoleArns, columnView],
  );

  // 列を隠す・表示する読み上げは、列の表示名（無ければ正式名）を使う（Issue #150 の D-10）。
  const nameOfRole = (roleArn: string): string =>
    allColumns.find((column) => column.roleArn === roleArn)?.roleName ?? roleArn;

  const hideRole = (roleArn: string): void => {
    if (!canHideRole(roleArn, selected)) return;
    controller.hideRole(roleArn);
    setHideAnnouncement(t.matrix.announce.roleHidden(nameOfRole(roleArn)));
  };

  const showRole = (roleArn: string): void => {
    controller.showRole(roleArn);
    setHideAnnouncement(t.matrix.announce.roleShown(nameOfRole(roleArn)));
  };

  const showAllRoles = (): void => {
    controller.showAllRoles();
    setHideAnnouncement(t.matrix.announce.allShown);
  };

  const allHidden = allColumns.length > 0 && columns.length === 0;
  // 最後の列を隠した直後は、列が 0 件でフォーカス先が無いので、案内の「すべて表示」へ移す。
  // 初期値は現在の状態。保存した状態がすべて非表示でも、読み込み時にはフォーカスを奪わない。
  const wasAllHidden = useRef(allHidden);
  useEffect(() => {
    if (allHidden && !wasAllHidden.current) {
      document.querySelector<HTMLElement>('[data-testid="matrix-all-hidden-show-all"]')?.focus();
    }
    wasAllHidden.current = allHidden;
  }, [allHidden]);

  /** FR-4.6 により除外されたロール（変更のある列のみを帯に出す）。 */
  const excluded: ExcludedRole[] = useMemo(
    () =>
      allColumns
        .filter((column) => column.lock !== null && column.changeCount > 0)
        .map((column) => ({
          roleArn: column.roleArn,
          reason: (column.lock as RoleLock).status === "failed" ? "failed" : "draft",
          changeRequestId: (column.lock as RoleLock).changeRequestId,
        })),
    [allColumns],
  );

  const selectableCount = allColumns.filter(
    (column) => column.lock === null && column.changeCount > 0,
  ).length;

  // empty 状態: 行または列が 0 件。マトリクスは描かず、不足している側の導線を出す。
  // 列は登録したロールなので（FR-3.1。Issue #135 で、紐づけたロールから改めた）、0 件ならロールの登録へ導く。
  if (users.length === 0 || roles.length === 0) {
    return (
      <div data-testid="matrix-empty">
        <Alert
          type="info"
          header={
            users.length === 0 ? t.matrix.empty.noUsersHeader : t.matrix.empty.noRolesHeader
          }
          action={
            users.length > 0 && onRegisterRoles ? (
              <Button data-testid="matrix-register-roles-empty" onClick={onRegisterRoles}>
                {t.matrix.empty.goToRoles}
              </Button>
            ) : undefined
          }
        >
          <Box variant="p">
            {users.length === 0 ? t.matrix.empty.noUsersBody : t.matrix.empty.noRolesBody}
          </Box>
        </Alert>
      </div>
    );
  }

  const filterInput = (
    <Input
      type="search"
      data-testid="matrix-user-filter"
      ariaLabel={t.matrix.filterField.ariaLabel}
      placeholder={t.matrix.filterField.placeholder}
      value={view.userText}
      onChange={({ detail }) => applyView(withUserText(view, detail.value))}
    />
  );
  // 枠（filterAnchor）が無いときはマトリクスの上に描く。枠があるときは、画面のツールバーへポータルで描く（Issue #155）。
  const filterField =
    filterAnchor === undefined ? (
      <div style={{ maxWidth: "24rem" }}>{filterInput}</div>
    ) : filterAnchor === null ? null : (
      createPortal(filterInput, filterAnchor)
    );

  return (
    <>
      {/* 絞り込み欄はツールバーの枠へポータルで描く。ここに DOM は作らない（SpaceBetween の間隔に入れない）。 */}
      {filterField}
      {/*
        空の状態行（読み上げ領域・表示件数）は、間隔を取る箱（SpaceBetween）の外に置く。箱の中の子は、空でも
        間隔（12px）を取るため、表との間が広がる（Issue #155）。
      */}
      <SkipToActions targetId={toolbarTargetId} />
      {/* 領域は常に置く（動的に挿入された live region は読み上げられないことがある）。 */}
      <div
        aria-live="polite"
        data-testid="matrix-view-status"
        style={isViewActive(view) ? { paddingBottom: "0.75rem" } : undefined}
      >
        {isViewActive(view) && (
          <Box variant="small">
            {t.matrix.viewStatus(rows.length, users.length)}{" "}
            <Button
              variant="inline-link"
              data-testid="matrix-view-clear"
              onClick={clearView}
            >
              {t.matrix.clearAll}
            </Button>
          </Box>
        )}
      </div>
      {/* 領域は常に置く（動的に挿入された live region は読み上げられないことがある）。 */}
      <div
        aria-live="polite"
        data-testid="matrix-hidden-live"
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}
      >
        {hideAnnouncement}
      </div>

      <SpaceBetween size="s">
        <ExclusionBanner
          excluded={excluded}
          allExcluded={excluded.length > 0 && selectableCount === 0}
          onNavigateToRequest={onNavigateToRequest}
        />

        {/* 非表示の列があるときだけ出す（空の行は間隔を取るため）。 */}
        {hiddenItems.length > 0 && (
          <div data-testid="matrix-hidden-status">
            <Box variant="small">
              <HiddenColumnsStatus items={hiddenItems} onShow={showRole} onShowAll={showAllRoles} />
            </Box>
          </div>
        )}

        <div ref={gridRef}>
      <MatrixGrid
        rows={rows}
        attributeColumns={attributeColumns}
        foldedColumnIds={folded}
        onToggleFold={toggleFold}
        attributeView={attributeView}
        attributeOptions={attributeOptions}
        onChangeAttributeFilter={(columnId: string, value: string | null) =>
          applyView(withAttrFilter(view, columnId, value))
        }
        onChangeAttributeSort={(columnId: string, order: AttributeSortOrder | null) =>
          applyView(withAttrSort(view, columnId, order))
        }
        columns={columns}
        cellState={(userArn, roleArn): CellState => {
          const assignment = byCell.get(cellKey(userArn, roleArn));
          return {
            checked: assignment?.checked ?? false,
            reflected: assignment?.reflected ?? false,
            saving: savingCells.has(cellKey(userArn, roleArn)),
          };
        }}
        onToggleCell={onToggleCell}
        onToggleRole={onToggleRole}
        columnView={columnView}
        onChangeFilter={(roleArn: string, filter: ColumnFilter | null) =>
          applyView(withFilter(view, roleArn, filter))
        }
        onChangeSort={(roleArn: string, order: SortOrder | null) =>
          applyView(withSort(view, roleArn, order))
        }
        onClearView={clearView}
        onHideRole={hideRole}
      />
      </div>

      {allHidden && (
        <div data-testid="matrix-all-hidden">
          <Box textAlign="center" padding="m">
            <SpaceBetween size="xs">
              <b>{t.matrix.allHidden.message}</b>
              <Button data-testid="matrix-all-hidden-show-all" onClick={showAllRoles}>
                {t.matrix.allHidden.showAll}
              </Button>
            </SpaceBetween>
          </Box>
        </div>
      )}

      <Box variant="small" data-testid="matrix-legend">
        <span aria-hidden="true">+</span> {t.matrix.legend.add} {t.matrix.legend.separator}{" "}
        <span aria-hidden="true">−</span> {t.matrix.legend.remove} {t.matrix.legend.separator}{" "}
        {t.matrix.legend.lockNote}
      </Box>
      </SpaceBetween>
    </>
  );
}
