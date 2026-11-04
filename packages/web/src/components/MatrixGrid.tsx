import { useCallback, useEffect, useRef, useState } from "react";
import Spinner from "@cloudscape-design/components/spinner";
import StatusIndicator from "@cloudscape-design/components/status-indicator";
import {
  ROLE_SECONDARY_TEXT_COLOR,
  ROLE_TEXT_COLOR,
  roleColorOf,
} from "@rolust/core";
import type { AttributeColumn, Permission, RoleColorId, RoleLock } from "@rolust/core";
import { permits } from "@rolust/core";

import { useT, type Messages } from "../i18n/index.js";
import { statusLabel } from "../labels.js";
import type {
  AttributeColumnView,
  AttributeSortOrder,
  AttributeValueOptions,
  ColumnFilter,
  ColumnView,
  SortOrder,
} from "../matrix-view.js";
import { ATTRIBUTE_UNSET } from "../matrix-view.js";
import { usePermission } from "../permission.js";
import { roleColumnTitle } from "../role-column-title.js";
import { AttributeColumnMenu, ColumnMenu } from "./ColumnMenu.js";
import { permissionBlock } from "./PermissionButton.js";

/**
 * MatrixGrid — `AssignmentMatrix` の内部で交点を描く自前の `<table>`。
 *
 * **なぜ自前か**（`design-system-mapping.md` FR-7.3）: Cloudscape の `Table` は
 * 行選択を持つが**列選択を持たない**。Q4=`A` が要求するのは列ヘッダの
 * チェックボックスによる列選択であり、既製部品の設定では実現できない。
 *
 * **なぜネイティブの `<input type="checkbox">` か**（`design-system-mapping.md` の X-1 で正式に採用）:
 * 当初の `design-system-mapping.md` は交点セルに Cloudscape の `Checkbox` を割り当てていたが、
 * a11y の Must である M-1.2 / M-1.3（矢印キー移動・マトリクス全体で Tab 停止点 1 つ）は
 * ローミング tabindex を要し、各要素の `tabIndex` を直接制御する必要がある。
 * Cloudscape の `Checkbox` は `tabIndex` を公開していないため、Must を満たせない。
 * 列ヘッダのチェックも同じ理由でネイティブである。Component Inventory も `MatrixGrid` を自前に分類している。
 *
 * a11y:
 * - ネイティブのテーブルセマンティクス（`<th scope>`）で行/列見出しを関連付ける（B-10）
 * - 矢印キーでセル間移動、Home / End で行頭・行末、Space でチェック切替（M-1.2）
 * - Tab 停止点はヘッダ行を含めてマトリクス全体で 1 つ（M-1.3）
 * - 差分記号 `+` / `−` は視覚的に隠したテキスト（「追加」/「削除」）を伴う（M-3.4）
 */

export interface MatrixColumn {
  roleArn: string;
  /** 列に出す名前。表示名があれば表示名、無ければ正式なロール名（Issue #150）。 */
  roleName: string;
  /** 正式なロール名（IAM のロール名）。`roleName` は表示名（無ければ正式名）。ホバーで出す（Issue #150）。 */
  formalRoleName: string;
  accountId: string;
  /** 任意の説明（Issue #21）。あればロール名にネイティブ tooltip（`title`）で出す。表示名がある列は正式名の次の行に続ける（Issue #150）。 */
  description: string | null;
  /** `assignments` と `baseline` の差分から求めた導出値。props で受けない。 */
  changeCount: number;
  /** FR-4.6 により申請対象外なら未反映申請、そうでなければ null。 */
  lock: RoleLock | null;
  selected: boolean;
  /** 任意の背景色（Issue #100）。ヘッダの行だけに付ける（Issue #105）。 */
  color: RoleColorId | null;
}

export interface MatrixRow {
  userArn: string;
  userName: string;
  accountId: string;
  /** 属性の値（Issue #107）。`columnId` をキーにする。値の無い列は持たない。省略は属性なし。 */
  attributes?: Record<string, string>;
}

export interface CellState {
  checked: boolean;
  reflected: boolean;
  saving: boolean;
}

export interface MatrixGridProps {
  rows: MatrixRow[];
  columns: MatrixColumn[];
  /** プールの属性の項目（Issue #107）。定義の順で、行見出しとロール列の間に並べる。省略は 0 件。 */
  attributeColumns?: AttributeColumn[];
  /** 畳んでいる属性の項目の ID（Issue #107）。省略は全部開いている。 */
  foldedColumnIds?: ReadonlySet<string>;
  /** 属性の項目の畳み・開き。見出しの名前と細い列のクリックで呼ぶ。 */
  onToggleFold?: (columnId: string) => void;
  /** 属性の項目 ID → その列のソート・フィルタの条件（Issue #107）。無い列は条件なし。 */
  attributeView?: Record<string, AttributeColumnView>;
  /** 属性の項目 ID → メニューに出す値の一覧（全ユーザ基準）。 */
  attributeOptions?: Record<string, AttributeValueOptions>;
  onChangeAttributeFilter?: (columnId: string, value: string | null) => void;
  onChangeAttributeSort?: (columnId: string, order: AttributeSortOrder | null) => void;
  cellState: (userArn: string, roleArn: string) => CellState;
  onToggleCell: (userArn: string, roleArn: string, next: boolean) => void;
  onToggleRole: (roleArn: string, next: boolean) => void;
  /** ロール ARN → その列のソート・フィルタの条件（Issue #91）。無い列は条件なし。 */
  columnView: Record<string, ColumnView>;
  onChangeFilter: (roleArn: string, filter: ColumnFilter | null) => void;
  onChangeSort: (roleArn: string, order: SortOrder | null) => void;
  /** 行が 0 件のときの「すべて解除」。 */
  onClearView: () => void;
  /**
   * ロール列を隠す（Issue #140）。渡されたとき、ロール列のメニューに「この列を隠す」を出す。
   * 選択中の列（`MatrixColumn.selected`）は、理由つきで無効にする（spec D-5）。
   */
  onHideRole?: (roleArn: string) => void;
}

const HEADER_ROW = -1;

/**
 * スクロール領域の高さの上限。`overflow-x: auto` だけだと `overflow-y` も auto として扱われ、
 * この div がスクロールコンテナになるのに縦には伸びきるので、列ヘッダの `sticky; top: 0` が
 * ページの縦スクロールに対して効かない（Issue #91）。上限を付けて、縦横ともこの領域の内側で
 * スクロールさせ、`sticky` の基準をこの領域にする。
 *
 * 18rem は、画面 3 でマトリクスの領域より上にあるもの（ナビ・ページヘッダ・ツールバー。実測で上端が
 * 251px）と、下の凡例（30px）を足した高さの見立て。`100vh` から引くと、ページの先頭で領域の下端と
 * 凡例が画面に収まる（600px・720px・900px・1080px の高さで実測。Issue #91）。警告帯や通知が出て
 * 領域が下がったときは、ページ側が少しスクロールする。
 */
const SCROLL_MAX_HEIGHT = "calc(100vh - 18rem)";

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

const tableStyle: React.CSSProperties = {
  borderCollapse: "separate",
  borderSpacing: 0,
  // コンテナ幅に合わせる（Issue #155）。内容幅のままだと、ウィンドウを広げても右側が空く。
  width: "100%",
  fontFamily: "var(--font-family-base, inherit)",
};

const cornerStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  left: 0,
  zIndex: 3,
  background: "var(--color-background-container-content, #ffffff)",
  borderBottom: "1px solid var(--color-border-divider-default, #d1d5db)",
  borderRight: "1px solid var(--color-border-divider-default, #d1d5db)",
  padding: "0.5rem",
  textAlign: "left",
};

const columnHeaderStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 2,
  background: "var(--color-background-container-content, #ffffff)",
  borderBottom: "1px solid var(--color-border-divider-default, #d1d5db)",
  padding: "0.5rem",
  minWidth: "12rem",
  textAlign: "left",
  verticalAlign: "top",
};

const rowHeaderStyle: React.CSSProperties = {
  position: "sticky",
  left: 0,
  zIndex: 1,
  background: "var(--color-background-container-content, #ffffff)",
  borderRight: "1px solid var(--color-border-divider-default, #d1d5db)",
  borderBottom: "1px solid var(--color-border-divider-default, #d1d5db)",
  padding: "0.5rem",
  textAlign: "left",
  whiteSpace: "nowrap",
};

const cellStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--color-border-divider-default, #d1d5db)",
  padding: "0.5rem",
  textAlign: "center",
};

const EMPTY_FOLDED: ReadonlySet<string> = new Set();
const EMPTY_ATTRIBUTE_VIEW: Record<string, AttributeColumnView> = {};
const EMPTY_ATTRIBUTE_OPTIONS: Record<string, AttributeValueOptions> = {};
const NO_OPTIONS: AttributeValueOptions = { values: [], unset: 0 };

/** 開いているメニュー。ロール列は添字、属性の項目は属性の項目の添字（Issue #107）。 */
type MenuTarget = { kind: "role"; col: number } | { kind: "attr"; index: number };

/** 属性の項目の見出し（Issue #107）。固定するのは行見出しだけで、属性の項目はロール列と一緒に横へスクロールする（spec D-2）。 */
const attributeHeaderStyle: React.CSSProperties = {
  ...columnHeaderStyle,
  minWidth: "8.5rem",
  maxWidth: "14rem",
  padding: 0,
};

const attributeCellStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--color-border-divider-default, #d1d5db)",
  padding: "0.5rem",
  textAlign: "left",
  verticalAlign: "top",
  minWidth: "8.5rem",
  maxWidth: "14rem",
  overflowWrap: "anywhere",
};

const foldedHeaderStyle: React.CSSProperties = {
  ...attributeHeaderStyle,
  minWidth: "2.25rem",
  width: "2.25rem",
  maxWidth: "2.25rem",
};

const foldedCellStyle: React.CSSProperties = {
  ...attributeCellStyle,
  minWidth: "2.25rem",
  width: "2.25rem",
  maxWidth: "2.25rem",
  padding: 0,
  // 値は出さない。畳んでいることが分かるよう、縞で示す（色だけに頼らない: 見出しに「▸」がある）。
  background:
    "repeating-linear-gradient(135deg, transparent 0 5px, var(--color-border-divider-default, #d1d5db) 5px 6px)",
};

const foldButtonStyle: React.CSSProperties = {
  border: 0,
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
  padding: 0,
  textAlign: "left",
};

const openButtonStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: "0.125rem",
  width: "100%",
  // 行の流れから外し、見出しのセル（sticky で位置の基準になる）いっぱいに広げる。ヘッダ行の高さは
  // ロール列の見出しが決め、畳んでも変わらない（Issue #137）。収まらない名前は隠す（全文は title）。
  position: "absolute",
  inset: 0,
  overflow: "hidden",
  boxSizing: "border-box",
  padding: "0.25rem 0",
  border: 0,
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  fontWeight: 700,
};

const menuButtonStyle: React.CSSProperties = {
  border: 0,
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  padding: "0 0.25rem",
};

const badgeStyle: React.CSSProperties = {
  marginTop: "0.25rem",
  fontSize: "0.75rem",
  color: "var(--color-text-status-info, #0972d3)",
};

const identifierStyle: React.CSSProperties = {
  fontFamily: "var(--font-family-monospace, monospace)",
  fontSize: "0.75rem",
  color: "var(--color-text-body-secondary, #5f6b7a)",
};

/** 背景色のある列の補助文字。既定の `#5f6b7a` は淡い背景で 4.5:1 を下回る。 */
const tintedIdentifierStyle: React.CSSProperties = {
  ...identifierStyle,
  color: ROLE_SECONDARY_TEXT_COLOR,
};

/**
 * 背景色のある列の lock のチップ。`StatusIndicator` は文字色を内側で決めて外から変えられないので、
 * 白の囲みに置いて 4.5:1 を保つ（error は約 5.2:1、warning は約 6.1:1）。
 */
const tintedChipStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "0 0.375rem",
  borderRadius: 4,
  // 白の固定値。4.5:1 の根拠が白なので、テーマ変数にしない（ライトテーマのみ）。
  background: "#ffffff",
  border: "1px solid var(--color-border-divider-default, #d1d5db)",
};

export function MatrixGrid({
  rows,
  columns,
  attributeColumns = [],
  foldedColumnIds = EMPTY_FOLDED,
  onToggleFold,
  attributeView = EMPTY_ATTRIBUTE_VIEW,
  attributeOptions = EMPTY_ATTRIBUTE_OPTIONS,
  onChangeAttributeFilter,
  onChangeAttributeSort,
  cellState,
  onToggleCell,
  onToggleRole,
  columnView,
  onChangeFilter,
  onChangeSort,
  onClearView,
  onHideRole,
}: MatrixGridProps): React.JSX.Element {
  // ヘッダ行の位置は「属性の項目 ＋ ロール列」の連続した添字（Issue #107。spec D-12）。本体の行の位置は
  // ロール列の添字のまま（属性セルは文字だけで、操作できる要素が無いため位置を作らない）。
  const permission = usePermission();
  const t = useT();
  const canEdit = permits(permission, "edit");
  const attributeCount = attributeColumns.length;
  const headerLength = attributeCount + columns.length;

  // ローミング tabindex。フォーカス位置だけが tabIndex=0 を持つ。
  const [focus, setFocus] = useState<{ row: number; col: number }>({
    row: HEADER_ROW,
    col: 0,
  });
  const refs = useRef(new Map<string, HTMLElement | null>());

  // 開いているメニュー（Issue #91・#107）。「▾」ボタンは位置の基準（anchor）として持つ。
  const [menu, setMenu] = useState<MenuTarget | null>(null);
  const menuButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const attrMenuButtons = useRef(new Map<string, HTMLButtonElement | null>());
  const menuColumn = menu?.kind === "role" ? columns[menu.col] : undefined;
  const menuAnchor = menuColumn ? menuButtons.current.get(menuColumn.roleArn) : undefined;
  const attrMenuColumn = menu?.kind === "attr" ? attributeColumns[menu.index] : undefined;
  // 畳んだ列には「▾」が無いので、見出しのセル自身を位置の基準にする。
  const attrMenuAnchor =
    menu?.kind === "attr" && attrMenuColumn
      ? (attrMenuButtons.current.get(attrMenuColumn.columnId) ??
        refs.current.get(`${HEADER_ROW}:${menu.index}`))
      : undefined;

  /** メニューを閉じ、フォーカスを開く前のヘッダのセルへ戻す（Focus management）。 */
  const closeMenu = (): void => {
    if (menu !== null) {
      const position = menu.kind === "role" ? attributeCount + menu.col : menu.index;
      setFocus({ row: HEADER_ROW, col: position });
      refs.current.get(`${HEADER_ROW}:${position}`)?.focus();
    }
    setMenu(null);
  };

  // 列を隠した直後のフォーカス（Issue #140）。隠した列は DOM から消えるので、列が減った描画の後で
  // 隣の列のヘッダの操作へ移す。移さないと、ローミング tabindex の位置が消えて Tab 停止点を失う。
  const pendingFocus = useRef<number | null>(null);
  useEffect(() => {
    const position = pendingFocus.current;
    if (position === null) return;
    pendingFocus.current = null;
    setFocus({ row: HEADER_ROW, col: position });
    refs.current.get(`${HEADER_ROW}:${position}`)?.focus();
  }, [columns.length]);

  const hideColumn = (col: number): void => {
    const column = columns[col];
    if (!column || !onHideRole) return;
    // 隠した後の列数は columns.length - 1。右隣は同じ添字、右端なら左隣。最後の 1 列なら移さない。
    const remaining = columns.length - 1;
    pendingFocus.current = remaining > 0 ? attributeCount + Math.min(col, remaining - 1) : null;
    onHideRole(column.roleArn);
  };

  const register = useCallback(
    (row: number, col: number) => (element: HTMLElement | null) => {
      refs.current.set(`${row}:${col}`, element);
    },
    [],
  );

  const moveFocus = useCallback(
    (row: number, col: number) => {
      const nextRow = clamp(row, HEADER_ROW, rows.length - 1);
      const nextCol =
        nextRow === HEADER_ROW
          ? clamp(col, 0, Math.max(headerLength - 1, 0))
          : clamp(col, 0, Math.max(columns.length - 1, 0));
      setFocus({ row: nextRow, col: nextCol });
      refs.current.get(`${nextRow}:${nextCol}`)?.focus();
    },
    [rows.length, headerLength, columns.length],
  );

  const handleKeyDown = useCallback(
    (row: number, col: number) => (event: React.KeyboardEvent) => {
      // 属性の見出しは `th` 自身が位置。中のボタンから伝わったキーでは動かない。
      if (row === HEADER_ROW && col < attributeCount && event.target !== event.currentTarget) return;
      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          // 本体の最初の行からは、同じロール列の見出しへ戻る。
          if (row === 0) moveFocus(HEADER_ROW, attributeCount + col);
          else moveFocus(row - 1, col);
          break;
        case "ArrowDown":
          event.preventDefault();
          if (row === HEADER_ROW) {
            // 属性の見出しの下は文字だけのセルなので動かない。ロール列の見出しは最初の行へ降りる。
            // 行が 0 件のときも動かない（動くと別の列の見出しへずれる）。
            if (col >= attributeCount && rows.length > 0) moveFocus(0, col - attributeCount);
          } else {
            moveFocus(row + 1, col);
          }
          break;
        case "ArrowLeft":
          event.preventDefault();
          moveFocus(row, col - 1);
          break;
        case "ArrowRight":
          event.preventDefault();
          moveFocus(row, col + 1);
          break;
        case "Home":
          event.preventDefault();
          moveFocus(row, 0);
          break;
        case "End":
          event.preventDefault();
          moveFocus(row, row === HEADER_ROW ? headerLength - 1 : columns.length - 1);
          break;
        case "Enter":
          if (row === HEADER_ROW) {
            event.preventDefault();
            setMenu(col < attributeCount ? { kind: "attr", index: col } : { kind: "role", col: col - attributeCount });
          }
          break;
        default:
          // Space はネイティブの checkbox が処理する（明示的な preventDefault は不要）。
          break;
      }
    },
    [moveFocus, headerLength, attributeCount, columns.length, rows.length],
  );

  const isFocused = (row: number, col: number): boolean =>
    focus.row === row && focus.col === col;

  return (
    <>
    <div
      style={{ overflow: "auto", maxWidth: "100%", maxHeight: SCROLL_MAX_HEIGHT }}
      data-testid="matrix-scroll"
    >
      <table style={tableStyle} data-testid="assignment-matrix-table">
        <caption style={visuallyHidden}>{t.matrixGrid.caption}</caption>
        <thead>
          <tr>
            <th scope="col" style={cornerStyle}>
              {t.matrixGrid.corner}
            </th>
            {attributeColumns.map((column, index) => {
              const isFolded = foldedColumnIds.has(column.columnId);
              return (
                <th
                  key={column.columnId}
                  scope="col"
                  ref={register(HEADER_ROW, index)}
                  aria-sort={
                    attributeView[column.columnId]?.sort === "asc"
                      ? "ascending"
                      : attributeView[column.columnId]?.sort === "desc"
                        ? "descending"
                        : undefined
                  }
                  tabIndex={isFocused(HEADER_ROW, index) ? 0 : -1}
                  onFocus={() => setFocus({ row: HEADER_ROW, col: index })}
                  onKeyDown={handleKeyDown(HEADER_ROW, index)}
                  style={isFolded ? foldedHeaderStyle : attributeHeaderStyle}
                  data-testid={`attr-column-${column.columnId}`}
                >
                  {isFolded ? (
                    <button
                      type="button"
                      tabIndex={-1}
                      aria-expanded={false}
                      aria-label={t.matrixGrid.openColumn(column.name)}
                      title={column.name}
                      data-testid={`attr-open-${column.columnId}`}
                      style={openButtonStyle}
                      onClick={() => onToggleFold?.(column.columnId)}
                    >
                      <span aria-hidden="true">▸</span>
                      <span
                        aria-hidden="true"
                        style={{
                          writingMode: "vertical-rl",
                          fontSize: "0.75rem",
                          minHeight: 0,
                          overflow: "hidden",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {column.name}
                      </span>
                      {attributeBadgeText(t, attributeView[column.columnId]) && (
                        <span aria-hidden="true" data-testid={`attr-dot-${column.columnId}`}>
                          ●
                        </span>
                      )}
                    </button>
                  ) : (
                    <>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          justifyContent: "space-between",
                          gap: "0.25rem",
                          padding: "0.5rem 0.5rem 0 0.5rem",
                        }}
                      >
                        <button
                          type="button"
                          tabIndex={-1}
                          aria-expanded={true}
                          aria-label={t.matrixGrid.foldColumn(column.name)}
                          data-testid={`attr-fold-${column.columnId}`}
                          style={foldButtonStyle}
                          onClick={() => onToggleFold?.(column.columnId)}
                        >
                          {column.name}
                        </button>
                        <button
                          type="button"
                          ref={(element) => {
                            attrMenuButtons.current.set(column.columnId, element);
                          }}
                          tabIndex={-1}
                          aria-haspopup="menu"
                          aria-expanded={menu?.kind === "attr" && menu.index === index}
                          aria-label={t.matrixGrid.sortAndFilter(column.name)}
                          data-testid={`attr-menu-${column.columnId}`}
                          style={menuButtonStyle}
                          onClick={() =>
                            menu?.kind === "attr" && menu.index === index
                              ? closeMenu()
                              : setMenu({ kind: "attr", index })
                          }
                        >
                          ▾
                        </button>
                      </div>
                      {attributeBadgeText(t, attributeView[column.columnId]) ? (
                        <div
                          data-testid={`attr-badge-${column.columnId}`}
                          style={{ ...badgeStyle, padding: "0 0.5rem 0.5rem 0.5rem", marginTop: 0 }}
                        >
                          {attributeBadgeText(t, attributeView[column.columnId])}
                        </div>
                      ) : (
                        <div style={{ height: "0.5rem" }} />
                      )}
                    </>
                  )}
                </th>
              );
            })}
            {columns.map((column, col) => {
              const tint = roleColorOf(column.color);
              return (
              <th
                key={column.roleArn}
                scope="col"
                style={{
                  ...columnHeaderStyle,
                  background: column.selected
                    ? "var(--color-background-item-selected, #f0f7ff)"
                    : (tint?.background ?? columnHeaderStyle.background),
                  ...(tint ? { color: ROLE_TEXT_COLOR } : {}),
                }}
                data-testid={`role-column-${column.roleArn}`}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: "0.25rem",
                  }}
                >
                  <div
                    title={roleColumnTitle(column)}
                    style={{ overflowWrap: "anywhere", minWidth: 0 }}
                  >
                    {column.roleName}
                  </div>
                  <button
                    type="button"
                    ref={(element) => {
                      menuButtons.current.set(column.roleArn, element);
                    }}
                    tabIndex={-1}
                    aria-haspopup="menu"
                    aria-expanded={menu?.kind === "role" && menu.col === col}
                    aria-label={t.matrixGrid.sortAndFilter(column.roleName)}
                    data-testid={`role-menu-${column.roleArn}`}
                    style={tint ? { ...menuButtonStyle, color: ROLE_TEXT_COLOR } : menuButtonStyle}
                    onClick={() =>
                      menu?.kind === "role" && menu.col === col
                        ? closeMenu()
                        : setMenu({ kind: "role", col })
                    }
                  >
                    ▾
                  </button>
                </div>
                <div style={tint ? tintedIdentifierStyle : identifierStyle}>{column.accountId}</div>
                {badgeText(t, columnView[column.roleArn]) && (
                  <div data-testid={`role-badge-${column.roleArn}`}
                    style={tint ? { ...badgeStyle, color: ROLE_TEXT_COLOR } : badgeStyle}
                  >
                    {badgeText(t, columnView[column.roleArn])}
                  </div>
                )}
                <div style={{ marginTop: "0.25rem" }}>
                  {renderColumnControl({
                    column,
                    col,
                    tinted: tint !== null,
                    focused: isFocused(HEADER_ROW, attributeCount + col),
                    register: register(HEADER_ROW, attributeCount + col),
                    onKeyDown: handleKeyDown(HEADER_ROW, attributeCount + col),
                    onFocus: () => setFocus({ row: HEADER_ROW, col: attributeCount + col }),
                    onToggleRole,
                    permission,
                    t,
                  })}
                </div>
              </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td
                colSpan={1 + attributeColumns.length + columns.length}
                style={{ ...cellStyle, textAlign: "left" }}
                data-testid="matrix-no-match"
              >
                {t.matrixGrid.noMatch}{" "}
                <button
                  type="button"
                  data-testid="matrix-no-match-clear"
                  style={{ ...menuButtonStyle, textDecoration: "underline" }}
                  onClick={onClearView}
                >
                  {t.matrix.clearAll}
                </button>
              </td>
            </tr>
          )}
          {rows.map((row, rowIndex) => (
            <tr key={row.userArn}>
              <th scope="row" style={rowHeaderStyle} data-testid={`user-row-${row.userArn}`}>
                <div>{row.userName}</div>
                <div style={identifierStyle}>{row.accountId}</div>
              </th>
              {attributeColumns.map((column) => {
                const isFolded = foldedColumnIds.has(column.columnId);
                return (
                  <td
                    key={column.columnId}
                    style={isFolded ? foldedCellStyle : attributeCellStyle}
                    data-testid={`attr-cell-${row.userArn}-${column.columnId}`}
                  >
                    {isFolded ? null : row.attributes?.[column.columnId] || "—"}
                  </td>
                );
              })}
              {columns.map((column, col) => {
                const state = cellState(row.userArn, column.roleArn);
                const marker = diffMarker(state);
                return (
                  <td key={column.roleArn} style={cellStyle}>
                    {/*
                      保存中もチェックボックス自体は DOM に残す。差し替えると
                      フォーカスが失われ、`interaction-spec.md` の Focus management
                      （保存失敗時にフォーカスを当該セルに留める）が満たせなくなる。
                      進行中であることは隣のスピナーと `aria-busy` で示す。
                    */}
                    <input
                      type="checkbox"
                      ref={register(rowIndex, col)}
                      data-testid={`cell-${row.userArn}-${column.roleArn}`}
                      checked={state.checked}
                      disabled={!canEdit}
                      title={canEdit ? undefined : (permissionBlock(permission, "edit", t) ?? undefined)}
                      tabIndex={isFocused(rowIndex, col) ? 0 : -1}
                      aria-label={t.matrixGrid.assignAriaLabel(row.userName, column.roleName)}
                      aria-busy={state.saving || undefined}
                      onFocus={() => setFocus({ row: rowIndex, col })}
                      onKeyDown={handleKeyDown(rowIndex, col)}
                      onChange={(event) =>
                        onToggleCell(row.userArn, column.roleArn, event.target.checked)
                      }
                    />
                    {state.saving && (
                      <span data-testid={`cell-saving-${row.userArn}-${column.roleArn}`}>
                        <Spinner />
                      </span>
                    )}
                    {marker && (
                      <span
                        data-testid={`cell-marker-${row.userArn}-${column.roleArn}`}
                        style={{
                          marginLeft: "0.25rem",
                          color:
                            marker === "+"
                              ? "var(--color-text-status-success, #037f0c)"
                              : "var(--color-text-status-error, #d91515)",
                        }}
                      >
                        {marker}
                        <span style={visuallyHidden}>
                          {marker === "+" ? t.matrixGrid.added : t.matrixGrid.removed}
                        </span>
                      </span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {menuColumn && menuAnchor && (
      <ColumnMenu
        roleName={menuColumn.roleName}
        anchor={menuAnchor}
        filter={columnView[menuColumn.roleArn]?.filter ?? null}
        sort={columnView[menuColumn.roleArn]?.sort ?? null}
        onChangeFilter={(filter) => onChangeFilter(menuColumn.roleArn, filter)}
        onChangeSort={(order) => onChangeSort(menuColumn.roleArn, order)}
        onHide={onHideRole ? () => hideColumn(menu?.kind === "role" ? menu.col : 0) : undefined}
        hideDisabledReason={menuColumn.selected ? t.matrixGrid.hideDisabledReason : null}
        onClose={closeMenu}
      />
    )}
    {attrMenuColumn && attrMenuAnchor && (
      <AttributeColumnMenu
        attributeName={attrMenuColumn.name}
        anchor={attrMenuAnchor}
        filter={attributeView[attrMenuColumn.columnId]?.filter ?? null}
        sort={attributeView[attrMenuColumn.columnId]?.sort ?? null}
        options={attributeOptions[attrMenuColumn.columnId] ?? NO_OPTIONS}
        folded={foldedColumnIds.has(attrMenuColumn.columnId)}
        onChangeFilter={(value) => onChangeAttributeFilter?.(attrMenuColumn.columnId, value)}
        onChangeSort={(order) => onChangeAttributeSort?.(attrMenuColumn.columnId, order)}
        onToggleFold={() => onToggleFold?.(attrMenuColumn.columnId)}
        onClose={closeMenu}
      />
    )}
    </>
  );
}

function renderColumnControl(options: {
  column: MatrixColumn;
  col: number;
  /** 背景色のある列。補助文字をコントラストの足りる色にする（Issue #100）。 */
  tinted: boolean;
  focused: boolean;
  register: (element: HTMLElement | null) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
  onFocus: () => void;
  onToggleRole: (roleArn: string, next: boolean) => void;
  /** 呼び出した人の権限（Issue #141）。edit に満たなければ、選択のチェックボックスを無効にする。 */
  permission: Permission;
  t: Messages;
}): React.JSX.Element {
  const { column, tinted, focused, register, onKeyDown, onFocus, onToggleRole, permission, t } = options;
  const canEdit = permits(permission, "edit");
  const secondaryStyle = tinted ? tintedIdentifierStyle : identifierStyle;

  // 除外列: チェックボックスを描画せず状態チップを出す（FR-4.6）。
  if (column.lock) {
    return (
      <span
        ref={register}
        tabIndex={focused ? 0 : -1}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        data-testid={`role-chip-${column.roleArn}`}
        style={tinted ? tintedChipStyle : undefined}
        aria-label={t.matrixGrid.lockedChipAriaLabel(column.roleName, column.lock.status === "failed")}
      >
        <StatusIndicator type={column.lock.status === "failed" ? "error" : "warning"}>
          {statusLabel(t, column.lock.status)}
        </StatusIndicator>
      </span>
    );
  }

  // 変更なしの列: 申請に含める意味がない（追加も削除も発生しない）。
  if (column.changeCount === 0) {
    return (
      <span
        ref={register}
        tabIndex={focused ? 0 : -1}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        data-testid={`role-nochange-${column.roleArn}`}
        style={secondaryStyle}
      >
        {t.matrixGrid.noChange}
      </span>
    );
  }

  return (
    <label style={{ display: "inline-flex", alignItems: "center", gap: "0.25rem" }}>
      <input
        type="checkbox"
        ref={register}
        data-testid={`role-select-${column.roleArn}`}
        checked={column.selected}
        disabled={!canEdit}
        title={canEdit ? undefined : (permissionBlock(permission, "edit", t) ?? undefined)}
        tabIndex={focused ? 0 : -1}
        aria-label={t.matrixGrid.includeAriaLabel(column.roleName)}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        onChange={(event) => onToggleRole(column.roleArn, event.target.checked)}
      />
      <span style={secondaryStyle}>{t.matrixGrid.includeLabel(column.changeCount)}</span>
    </label>
  );
}

/** 差分記号。`checked !== reflected` の交点だけに付く。 */
function diffMarker(state: CellState): "+" | "−" | null {
  if (state.checked === state.reflected) return null;
  return state.checked ? "+" : "−";
}

/** 列ヘッダのバッジの語。色だけに頼らない（D-11）。 */
function badgeText(t: Messages, view: ColumnView | undefined): string | null {
  if (!view) return null;
  const badge = t.matrixGrid.badge;
  const parts: string[] = [];
  if (view.sort) {
    parts.push(view.sort === "checked-first" ? badge.sortCheckedFirst : badge.sortUncheckedFirst);
  }
  if (view.filter) parts.push(badge.filter(t.matrixGrid.filterLabel[view.filter]));
  return parts.length > 0 ? parts.join(badge.separator) : null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** 属性の項目の見出しのバッジの語。色だけに頼らない（spec D-15）。 */
function attributeBadgeText(t: Messages, view: AttributeColumnView | undefined): string | null {
  if (!view) return null;
  const badge = t.matrixGrid.badge;
  const parts: string[] = [];
  if (view.sort) parts.push(view.sort === "asc" ? badge.sortAsc : badge.sortDesc);
  if (view.filter !== null) {
    parts.push(badge.filter(view.filter === ATTRIBUTE_UNSET ? badge.unset : view.filter));
  }
  return parts.length > 0 ? parts.join(badge.separator) : null;
}
