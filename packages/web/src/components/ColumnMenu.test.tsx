// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ATTRIBUTE_UNSET } from "../matrix-view.js";
import {
  AttributeColumnMenu,
  ColumnMenu,
  type AttributeColumnMenuProps,
  type ColumnMenuProps,
} from "./ColumnMenu.js";

function renderMenu(overrides: Partial<ColumnMenuProps> = {}): ColumnMenuProps {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const props: ColumnMenuProps = {
    roleName: "DeployProd",
    anchor,
    filter: null,
    sort: null,
    onChangeFilter: vi.fn(),
    onChangeSort: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ColumnMenu {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ColumnMenu", () => {
  it("ソート 3 項目とフィルタ 4 項目を menuitemradio で出し、現在の値に aria-checked が付く", () => {
    renderMenu({ filter: "changed", sort: "checked-first" });

    expect(screen.getByRole("menu").getAttribute("aria-label")).toBe(
      "DeployProd のソートとフィルタ",
    );
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(7);
    const checked = (id: string): string | null =>
      screen.getByTestId(`column-menu-${id}`).getAttribute("aria-checked");
    expect(checked("sort-checked-first")).toBe("true");
    expect(checked("sort-unchecked-first")).toBe("false");
    expect(checked("sort-none")).toBe("false");
    expect(checked("filter-changed")).toBe("true");
    expect(checked("filter-all")).toBe("false");
  });

  it("条件が無いときは「解除」と「すべて」が選ばれている", () => {
    renderMenu();

    expect(screen.getByTestId("column-menu-sort-none").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("column-menu-filter-all").getAttribute("aria-checked")).toBe("true");
  });

  it("フィルタを選ぶと onChangeFilter を呼んで閉じる。「すべて」は null", () => {
    const props = renderMenu({ filter: "checked" });

    fireEvent.click(screen.getByTestId("column-menu-filter-changed"));
    expect(props.onChangeFilter).toHaveBeenCalledWith("changed");
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("column-menu-filter-all"));
    expect(props.onChangeFilter).toHaveBeenLastCalledWith(null);
  });

  it("ソートを選ぶと onChangeSort を呼んで閉じる。「解除」は null", () => {
    const props = renderMenu({ sort: "checked-first" });

    fireEvent.click(screen.getByTestId("column-menu-sort-unchecked-first"));
    expect(props.onChangeSort).toHaveBeenCalledWith("unchecked-first");

    fireEvent.click(screen.getByTestId("column-menu-sort-none"));
    expect(props.onChangeSort).toHaveBeenLastCalledWith(null);
    expect(props.onClose).toHaveBeenCalledTimes(2);
  });

  it("開いたとき、選ばれている最初の項目にフォーカスする", () => {
    renderMenu({ sort: "unchecked-first" });

    expect(document.activeElement).toBe(screen.getByTestId("column-menu-sort-unchecked-first"));
  });

  it("矢印キーで項目間を移動し（端で巻き戻る）、Home / End で先頭・末尾へ移る", () => {
    renderMenu({ sort: "checked-first" });
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("column-menu-sort-unchecked-first"));

    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(document.activeElement).toBe(screen.getByTestId("column-menu-filter-changed"));

    fireEvent.keyDown(menu, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByTestId("column-menu-sort-checked-first"));
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(screen.getByTestId("column-menu-filter-changed"));
  });

  it("Escape と Tab は何も変えずに閉じる", () => {
    const props = renderMenu();
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "Escape" });
    fireEvent.keyDown(menu, { key: "Tab" });

    expect(props.onClose).toHaveBeenCalledTimes(2);
    expect(props.onChangeFilter).not.toHaveBeenCalled();
    expect(props.onChangeSort).not.toHaveBeenCalled();
  });

  it("外側の押下・スクロール・リサイズで閉じるが、メニューの内側と「▾」ボタンの押下では閉じない", () => {
    const props = renderMenu();

    fireEvent.mouseDown(screen.getByTestId("column-menu-filter-all"));
    fireEvent.mouseDown(props.anchor);
    expect(props.onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(document.body);
    expect(props.onClose).toHaveBeenCalledTimes(1);

    fireEvent.scroll(window);
    expect(props.onClose).toHaveBeenCalledTimes(2);

    fireEvent(window, new Event("resize"));
    expect(props.onClose).toHaveBeenCalledTimes(3);
  });

  it("document.body へのポータルで描く（横スクロール領域の内側に閉じ込められない）", () => {
    renderMenu();

    expect(screen.getByRole("menu").parentElement).toBe(document.body);
  });

  describe("この列を隠す（Issue #140）", () => {
    it("onHide が無ければ、列のグループを出さない（既存の形を変えない）", () => {
      renderMenu();
      expect(screen.queryByTestId("column-menu-hide")).toBeNull();
    });

    it("onHide があれば「この列を隠す」を menuitem で出し、押すと onHide を呼んで閉じる", () => {
      const props = renderMenu({ onHide: vi.fn() });
      const item = screen.getByTestId("column-menu-hide");
      expect(item.getAttribute("role")).toBe("menuitem");
      expect(item.textContent).toContain("この列を隠す");

      fireEvent.click(item);

      expect(props.onHide).toHaveBeenCalledTimes(1);
      expect(props.onClose).toHaveBeenCalledTimes(1);
    });

    it("理由があれば無効にし、理由を読み上げに結ぶ。押しても何も起きず、閉じない", () => {
      const props = renderMenu({
        onHide: vi.fn(),
        hideDisabledReason: "申請に含めている列は隠せません",
      });
      const item = screen.getByTestId("column-menu-hide");
      expect(item.getAttribute("aria-disabled")).toBe("true");
      const describedBy = item.getAttribute("aria-describedby");
      expect(describedBy).not.toBeNull();
      expect(document.getElementById(describedBy as string)?.textContent).toBe(
        "申請に含めている列は隠せません",
      );

      fireEvent.click(item);

      expect(props.onHide).not.toHaveBeenCalled();
      expect(props.onClose).not.toHaveBeenCalled();
    });
  });
});

function renderAttributeMenu(overrides: Partial<AttributeColumnMenuProps> = {}): AttributeColumnMenuProps {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const props: AttributeColumnMenuProps = {
    attributeName: "部署",
    anchor,
    filter: null,
    sort: null,
    options: {
      values: [
        { value: "開発", count: 3 },
        { value: "運用", count: 2 },
      ],
      unset: 1,
    },
    folded: false,
    onChangeFilter: vi.fn(),
    onChangeSort: vi.fn(),
    onToggleFold: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<AttributeColumnMenu {...props} />);
  return props;
}

describe("AttributeColumnMenu（Issue #107）", () => {
  it("ソート 3 項目・フィルタ（すべて＋値＋未設定）・列の項目を出し、現在の値に aria-checked が付く", () => {
    renderAttributeMenu({ filter: "運用", sort: "desc" });

    expect(screen.getByRole("menu").getAttribute("aria-label")).toBe("部署 のソートとフィルタ");
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(3 + 1 + 2 + 1);
    expect(screen.getAllByRole("menuitem")).toHaveLength(1);
    const checked = (id: string): string | null =>
      screen.getByTestId(`column-menu-${id}`).getAttribute("aria-checked");
    expect(checked("sort-desc")).toBe("true");
    expect(checked("sort-asc")).toBe("false");
    expect(checked("filter-value-1")).toBe("true");
    expect(checked("filter-all")).toBe("false");
    expect(screen.getByTestId("column-menu-filter-value-0").textContent).toContain("開発");
    expect(screen.getByTestId("column-menu-filter-value-0").textContent).toContain("3");
    expect(screen.getByTestId("column-menu-filter-unset").textContent).toContain("（未設定）");
  });

  it("値の無いユーザがいなければ「（未設定）」を出さない", () => {
    renderAttributeMenu({ options: { values: [{ value: "開発", count: 3 }], unset: 0 } });

    expect(screen.queryByTestId("column-menu-filter-unset")).toBeNull();
  });

  it("フィルタ・ソートを選ぶと、値（または ATTRIBUTE_UNSET・null）で呼んで閉じる", () => {
    const props = renderAttributeMenu({ filter: "開発" });

    fireEvent.click(screen.getByTestId("column-menu-filter-value-1"));
    expect(props.onChangeFilter).toHaveBeenLastCalledWith("運用");
    fireEvent.click(screen.getByTestId("column-menu-filter-unset"));
    expect(props.onChangeFilter).toHaveBeenLastCalledWith(ATTRIBUTE_UNSET);
    fireEvent.click(screen.getByTestId("column-menu-filter-all"));
    expect(props.onChangeFilter).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByTestId("column-menu-sort-asc"));
    expect(props.onChangeSort).toHaveBeenLastCalledWith("asc");
    fireEvent.click(screen.getByTestId("column-menu-sort-none"));
    expect(props.onChangeSort).toHaveBeenLastCalledWith(null);
    expect(props.onClose).toHaveBeenCalledTimes(5);
  });

  it("「この列を畳む」を選ぶと onToggleFold を呼んで閉じる。畳んでいるときは「この列を開く」", () => {
    const props = renderAttributeMenu();
    fireEvent.click(screen.getByTestId("column-menu-fold"));
    expect(props.onToggleFold).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("column-menu-fold").textContent).toBe("この列を畳む");

    cleanup();
    document.body.innerHTML = "";
    renderAttributeMenu({ folded: true });
    expect(screen.getByTestId("column-menu-fold").textContent).toBe("この列を開く");
  });

  it("開いたとき、選ばれている項目へフォーカスする。矢印キーは radio と action をまたいで巡回する", () => {
    renderAttributeMenu({ sort: "asc" });
    expect(document.activeElement).toBe(screen.getByTestId("column-menu-sort-asc"));

    const menu = screen.getByTestId("column-menu");
    fireEvent.keyDown(menu, { key: "End" });
    expect(document.activeElement).toBe(screen.getByTestId("column-menu-fold"));
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByTestId("column-menu-sort-asc"));
  });

  it("値が多くてもメニューの高さに上限があり、内側でスクロールする。メニュー内のスクロールでは閉じない", () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ value: `値${i}`, count: 1 }));
    const props = renderAttributeMenu({ options: { values: many, unset: 0 } });
    const menu = screen.getByTestId("column-menu");

    expect(menu.style.maxHeight).not.toBe("");
    expect(menu.style.overflowY).toBe("auto");

    fireEvent.scroll(menu);
    expect(props.onClose).not.toHaveBeenCalled();

    // メニューの外のスクロール（ページ・スクロール領域）では閉じる。
    fireEvent.scroll(document.body);
    expect(props.onClose).toHaveBeenCalled();
  });
});

describe("AttributeColumnMenu の長い値（Issue #107。最終レビュー）", () => {
  it("区切りの無い長い値の項目は折り返す（メニューが画面の外へ伸びない）", () => {
    renderAttributeMenu({ options: { values: [{ value: "x".repeat(200), count: 1 }], unset: 0 } });

    expect(screen.getByTestId("column-menu-filter-value-0").style.overflowWrap).toBe("anywhere");
  });
});
