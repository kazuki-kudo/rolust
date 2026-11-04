import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useT } from "../i18n/index.js";
import type {
  AttributeSortOrder,
  AttributeValueOptions,
  ColumnFilter,
  SortOrder,
} from "../matrix-view.js";
import { ATTRIBUTE_UNSET } from "../matrix-view.js";

/**
 * ColumnMenu — 列ヘッダの「▾」から開く、ソートとフィルタのメニュー（Issue #91。spec D-9・D-10）。
 *
 * **なぜ自前か**: Cloudscape の `ButtonDropdown` はトリガーの `tabIndex` を公開しない。
 * マトリクスは Tab 停止点を 1 つに保つ（ローミング tabindex。M-1.2・M-1.3）ため、
 * 「▾」を `tabIndex=-1` にして、ヘッダのセルの Enter で開く。メニュー自体も自前で持つ
 * （`MatrixGrid` と同じ理由。`design-system-mapping.md` の X-1）。
 *
 * **なぜポータルか**: マトリクスのスクロール領域は `overflow: auto` なので、内側に描くと切れる。
 * `document.body` に `position: fixed` で描く。位置がずれるので、スクロール・リサイズでは閉じる。
 *
 * Issue #107: 属性の項目の見出しにも同じ形のメニューを出すため、メニューの殻（`MenuShell`。ポータル・
 * キー操作・外側の押下で閉じる動作）を項目のグループを受ける形に一般化した。ロール列用の `ColumnMenu`
 * は props・見た目・`data-testid` を変えず、属性の項目用に `AttributeColumnMenu` を足した。
 */

const MENU_WIDTH = 240;

const menuStyle: React.CSSProperties = {
  position: "fixed",
  zIndex: 10000,
  minWidth: MENU_WIDTH,
  maxHeight: "min(24rem, 70vh)",
  overflowY: "auto",
  padding: "0.25rem 0",
  background: "var(--color-background-container-content, #ffffff)",
  border: "1px solid var(--color-border-divider-default, #d1d5db)",
  borderRadius: 4,
  boxShadow: "0 4px 8px rgba(0, 0, 0, 0.15)",
};

const headingStyle: React.CSSProperties = {
  padding: "0.25rem 0.75rem",
  fontSize: "0.75rem",
  color: "var(--color-text-body-secondary, #5f6b7a)",
};

const itemStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: "0.25rem 0.75rem",
  border: 0,
  background: "transparent",
  textAlign: "left",
  font: "inherit",
  cursor: "pointer",
  // 区切りの無い長い値（属性値）でメニューが伸びないよう折り返す（Issue #107）。
  overflowWrap: "anywhere",
};

export interface MenuItem {
  id: string;
  label: string;
  /** 既定は `radio`（`menuitemradio`）。`action` は選ぶだけの項目（`menuitem`）。 */
  kind?: "radio" | "action";
  checked?: boolean;
  /** 無効の項目。フォーカスは受けるが（矢印キーで読み上げられる）、選んでも何も起きず、メニューは閉じない。 */
  disabled?: boolean;
  /** 無効の理由。項目の直下に出し、`aria-describedby` で結ぶ。 */
  hint?: string;
  choose: () => void;
}

export interface MenuGroup {
  label: string;
  items: MenuItem[];
}

export interface MenuShellProps {
  /** メニューの `aria-label`。 */
  label: string;
  /** 位置の基準。ここへの押下では閉じない（開閉は呼び出し側が持つ）。 */
  anchor: HTMLElement;
  groups: MenuGroup[];
  /** 選択後・Escape・Tab・外側の押下・スクロール・リサイズで呼ぶ。 */
  onClose: () => void;
}

const ITEM_SELECTOR = '[role="menuitemradio"], [role="menuitem"]';

export function MenuShell({ label, anchor, groups, onClose }: MenuShellProps): React.JSX.Element {
  const menuRef = useRef<HTMLDivElement>(null);

  // 開いたとき、選ばれている最初の項目へフォーカスする。
  useEffect(() => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const first = items.find((item) => item.getAttribute("aria-checked") === "true") ?? items[0];
    first?.focus({ preventScroll: true });
  }, []);

  // 外側の押下・スクロール・リサイズで閉じる。メニュー自身のスクロール（値が多いとき）では閉じない。
  useEffect(() => {
    const onPointerDown = (event: MouseEvent): void => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    const onScroll = (event: Event): void => {
      // window へのスクロール（target が Node でない）は外側として閉じる。
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    const dismiss = (): void => onClose();
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("resize", dismiss);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>(ITEM_SELECTOR) ?? []);
    const index = items.indexOf(document.activeElement as HTMLElement);
    const move = (next: number): void => {
      event.preventDefault();
      items[(next + items.length) % items.length]?.focus({ preventScroll: true });
    };
    switch (event.key) {
      case "ArrowDown":
        move(index + 1);
        break;
      case "ArrowUp":
        move(index - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(items.length - 1);
        break;
      case "Escape":
      case "Tab":
        // Tab は閉じてフォーカスをヘッダのセルへ戻す（呼び出し側）。マトリクスの Tab 停止点は 1 つのまま。
        event.preventDefault();
        onClose();
        break;
      default:
        break;
    }
  };

  const rect = anchor.getBoundingClientRect();
  const left = Math.max(0, Math.min(rect.left, window.innerWidth - MENU_WIDTH));

  const renderItem = (item: MenuItem): React.JSX.Element => {
    const isRadio = (item.kind ?? "radio") === "radio";
    const checked = item.checked === true;
    const hintId = item.hint ? `column-menu-hint-${item.id}` : undefined;
    return (
      <div key={item.id}>
        <button
          type="button"
          role={isRadio ? "menuitemradio" : "menuitem"}
          aria-checked={isRadio ? checked : undefined}
          aria-disabled={item.disabled ? true : undefined}
          aria-describedby={item.disabled ? hintId : undefined}
          tabIndex={-1}
          data-testid={`column-menu-${item.id}`}
          style={{
            ...itemStyle,
            fontWeight: checked ? 700 : 400,
            ...(item.disabled
              ? { color: "var(--color-text-status-inactive, #8d99a8)", cursor: "not-allowed" }
              : {}),
          }}
          onClick={() => {
            if (item.disabled) return;
            item.choose();
            onClose();
          }}
        >
          {isRadio && <span aria-hidden="true">{checked ? "● " : "○ "}</span>}
          {item.label}
        </button>
        {item.hint && (
          <div
            id={hintId}
            style={{ ...headingStyle, color: "var(--color-text-status-warning, #855900)" }}
          >
            {item.hint}
          </div>
        )}
      </div>
    );
  };

  return createPortal(
    <div
      ref={menuRef}
      role="menu"
      aria-label={label}
      data-testid="column-menu"
      style={{ ...menuStyle, top: rect.bottom + 4, left }}
      onKeyDown={handleKeyDown}
    >
      {groups.map((group) => (
        <div key={group.label} role="group" aria-label={group.label}>
          <div style={headingStyle} aria-hidden="true">
            {group.label}
          </div>
          {group.items.map(renderItem)}
        </div>
      ))}
    </div>,
    document.body,
  );
}

export interface ColumnMenuProps {
  roleName: string;
  /** 「▾」ボタン。位置の基準。ここへの押下では閉じない（開閉はボタン自身が持つ）。 */
  anchor: HTMLElement;
  filter: ColumnFilter | null;
  sort: SortOrder | null;
  onChangeFilter: (filter: ColumnFilter | null) => void;
  onChangeSort: (order: SortOrder | null) => void;
  /** 列を隠す（Issue #140）。渡したときだけ「列」のグループに「この列を隠す」を出す。 */
  onHide?: () => void;
  /** 隠せない理由。あれば「この列を隠す」を無効にして、理由を出す。 */
  hideDisabledReason?: string | null;
  /** 選択後・Escape・Tab・外側の押下・スクロール・リサイズで呼ぶ。 */
  onClose: () => void;
}

/** ロール列のメニュー（Issue #91）。 */
export function ColumnMenu({
  roleName,
  anchor,
  filter,
  sort,
  onChangeFilter,
  onChangeSort,
  onHide,
  hideDisabledReason,
  onClose,
}: ColumnMenuProps): React.JSX.Element {
  const t = useT().matrixGrid;
  const sortItems: MenuItem[] = [
    {
      id: "sort-checked-first",
      label: t.menu.checkedFirst,
      checked: sort === "checked-first",
      choose: () => onChangeSort("checked-first"),
    },
    {
      id: "sort-unchecked-first",
      label: t.menu.uncheckedFirst,
      checked: sort === "unchecked-first",
      choose: () => onChangeSort("unchecked-first"),
    },
    {
      id: "sort-none",
      label: t.menu.clearSort,
      checked: sort === null,
      choose: () => onChangeSort(null),
    },
  ];
  const filterItems: MenuItem[] = [
    { id: "filter-all", label: t.menu.filterAll, checked: filter === null, choose: () => onChangeFilter(null) },
    ...(["checked", "unchecked", "changed"] as const).map((value) => ({
      id: `filter-${value}`,
      label: t.filterLabel[value],
      checked: filter === value,
      choose: () => onChangeFilter(value),
    })),
  ];
  return (
    <MenuShell
      label={t.sortAndFilter(roleName)}
      anchor={anchor}
      groups={[
        { label: t.menu.groupSort, items: sortItems },
        { label: t.menu.groupFilter, items: filterItems },
        ...(onHide
          ? [
              {
                label: t.menu.groupColumn,
                items: [
                  {
                    id: "hide",
                    kind: "action" as const,
                    label: t.menu.hideColumn,
                    disabled: Boolean(hideDisabledReason),
                    hint: hideDisabledReason ?? undefined,
                    choose: onHide,
                  },
                ],
              },
            ]
          : []),
      ]}
      onClose={onClose}
    />
  );
}

export interface AttributeColumnMenuProps {
  attributeName: string;
  anchor: HTMLElement;
  /** 選んでいる値、`ATTRIBUTE_UNSET`、または null（すべて）。 */
  filter: string | null;
  sort: AttributeSortOrder | null;
  /** その列に実在する値と件数（全ユーザ基準。spec D-8）。 */
  options: AttributeValueOptions;
  /** 畳んでいるとき、列の項目は「この列を開く」になる。 */
  folded: boolean;
  onChangeFilter: (value: string | null) => void;
  onChangeSort: (order: AttributeSortOrder | null) => void;
  onToggleFold: () => void;
  onClose: () => void;
}

/** 属性の項目のメニュー（Issue #107）。ロール列と同じ形で、ソート・フィルタ・列の 3 グループ。 */
export function AttributeColumnMenu({
  attributeName,
  anchor,
  filter,
  sort,
  options,
  folded,
  onChangeFilter,
  onChangeSort,
  onToggleFold,
  onClose,
}: AttributeColumnMenuProps): React.JSX.Element {
  const t = useT().matrixGrid;
  const sortItems: MenuItem[] = [
    { id: "sort-asc", label: t.menu.ascending, checked: sort === "asc", choose: () => onChangeSort("asc") },
    { id: "sort-desc", label: t.menu.descending, checked: sort === "desc", choose: () => onChangeSort("desc") },
    { id: "sort-none", label: t.menu.clearSort, checked: sort === null, choose: () => onChangeSort(null) },
  ];
  const filterItems: MenuItem[] = [
    { id: "filter-all", label: t.menu.filterAll, checked: filter === null, choose: () => onChangeFilter(null) },
    ...options.values.map((option, index) => ({
      id: `filter-value-${index}`,
      label: t.menu.valueCount(option.value, option.count),
      checked: filter === option.value,
      choose: () => onChangeFilter(option.value),
    })),
    ...(options.unset > 0
      ? [
          {
            id: "filter-unset",
            label: t.menu.unsetCount(options.unset),
            checked: filter === ATTRIBUTE_UNSET,
            choose: () => onChangeFilter(ATTRIBUTE_UNSET),
          },
        ]
      : []),
  ];
  return (
    <MenuShell
      label={t.sortAndFilter(attributeName)}
      anchor={anchor}
      groups={[
        { label: t.menu.groupSort, items: sortItems },
        { label: t.menu.groupFilter, items: filterItems },
        {
          label: t.menu.groupColumn,
          items: [
            {
              id: "fold",
              kind: "action",
              label: folded ? t.menu.openColumn : t.menu.foldColumn,
              choose: onToggleFold,
            },
          ],
        },
      ]}
      onClose={onClose}
    />
  );
}
