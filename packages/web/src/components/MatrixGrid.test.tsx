// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { MatrixColumn, MatrixGridProps, MatrixRow } from "./MatrixGrid.js";
import { ATTRIBUTE_UNSET } from "../matrix-view.js";
import { MatrixGrid } from "./MatrixGrid.js";

/**
 * `MatrixGrid` のユニットテスト（Issue #91）。
 * 交点の描画と保存は `AssignmentMatrix.test.tsx` が固定している。ここは列ヘッダのメニュー・
 * フォーカス・スクロール領域のスタイルを固定する。
 */

const ROLE_ACCOUNT = "555566667777";
export const DEPLOY = `arn:aws:iam::${ROLE_ACCOUNT}:role/DeployProd`;
export const AUDIT = `arn:aws:iam::${ROLE_ACCOUNT}:role/ReadOnlyAudit`;

export const columns: MatrixColumn[] = [
  {
    roleArn: DEPLOY,
    roleName: "DeployProd",
    formalRoleName: "DeployProd",
    accountId: ROLE_ACCOUNT,
    description: null,
    changeCount: 1,
    lock: null,
    selected: false,
    color: null,
  },
  {
    roleArn: AUDIT,
    roleName: "ReadOnlyAudit",
    formalRoleName: "ReadOnlyAudit",
    accountId: ROLE_ACCOUNT,
    description: null,
    changeCount: 0,
    lock: null,
    selected: false,
    color: null,
  },
];

export const rows: MatrixRow[] = ["ayaka.mori", "kenji.sato"].map((userName) => ({
  userArn: `arn:aws:iam::111122223333:user/${userName}`,
  userName,
  accountId: "111122223333",
}));

export function renderGrid(overrides: Partial<MatrixGridProps> = {}): MatrixGridProps {
  const props: MatrixGridProps = {
    rows,
    columns,
    cellState: () => ({ checked: false, reflected: false, saving: false }),
    onToggleCell: vi.fn(),
    onToggleRole: vi.fn(),
    columnView: {},
    onChangeFilter: vi.fn(),
    onChangeSort: vi.fn(),
    onClearView: vi.fn(),
    ...overrides,
  };
  render(<MatrixGrid {...props} />);
  return props;
}

afterEach(() => {
  cleanup();
});

describe("スクロール領域（D-13）", () => {
  it("縦にも上限を持つ。sticky の基準がページ全体ではなくこの領域になり、列ヘッダ行が縦スクロールで固定される", () => {
    renderGrid();

    const scroll = screen.getByTestId("matrix-scroll");
    // overflow-x だけの指定では、overflow-y が auto として扱われるのに高さの上限が無く、
    // ページの縦スクロールに対して sticky の top が効かない。
    expect(scroll.style.overflow).toBe("auto");
    expect(scroll.style.maxHeight).not.toBe("");
  });
});

describe("表の横幅（Issue #155）", () => {
  it("表はコンテナ幅に合わせる（内容幅で止まらない）", () => {
    renderGrid();

    const table = screen.getByTestId("assignment-matrix-table") as HTMLTableElement;
    expect(table.style.width).toBe("100%");
  });

  it("ロール列の見出しは最小幅 12rem のまま（広い幅で列が不均等に伸びる上限を新たに持たない）", () => {
    renderGrid();

    const roleHeader = screen.getByText("DeployProd").closest("th") as HTMLElement;
    expect(roleHeader.style.minWidth).toBe("12rem");
    expect(roleHeader.style.maxWidth).toBe("");
  });

  it("属性の項目の見出しの最大幅 14rem は変えない", () => {
    renderGrid({ attributeColumns: [{ columnId: "c1", name: "部署" }] });

    const attributeHeader = screen.getByText("部署").closest("th") as HTMLElement;
    expect(attributeHeader.style.maxWidth).toBe("14rem");
  });
});

describe("列ヘッダのメニュー（D-2・D-10）", () => {
  it("「▾」を押すとメニューが開き、項目を選ぶとコールバックを呼んで閉じ、フォーカスがヘッダのセルへ戻る", () => {
    const props = renderGrid();

    fireEvent.click(screen.getByTestId(`role-menu-${DEPLOY}`));
    expect(screen.getByTestId("column-menu")).toBeDefined();
    expect(screen.getByTestId(`role-menu-${DEPLOY}`).getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));

    expect(props.onChangeFilter).toHaveBeenCalledWith(DEPLOY, "checked");
    expect(screen.queryByTestId("column-menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId(`role-select-${DEPLOY}`));
  });

  it("ソートを選ぶと、その列のロール ARN と順序で onChangeSort を呼ぶ", () => {
    const props = renderGrid();

    fireEvent.click(screen.getByTestId(`role-menu-${AUDIT}`));
    fireEvent.click(screen.getByTestId("column-menu-sort-checked-first"));

    expect(props.onChangeSort).toHaveBeenCalledWith(AUDIT, "checked-first");
  });

  it("ヘッダのセルで Enter を押すとメニューが開く。Escape で閉じ、フォーカスはそのセルへ戻る", () => {
    renderGrid();
    const header = screen.getByTestId(`role-select-${DEPLOY}`);
    header.focus();

    fireEvent.keyDown(header, { key: "Enter" });
    expect(screen.getByTestId("column-menu")).toBeDefined();

    fireEvent.keyDown(screen.getByTestId("column-menu"), { key: "Escape" });
    expect(screen.queryByTestId("column-menu")).toBeNull();
    expect(document.activeElement).toBe(header);
  });

  it("変更なしの列（フォーカス位置が span）でも Enter で開き、閉じるとその span へフォーカスが戻る", () => {
    renderGrid();
    const nochange = screen.getByTestId(`role-nochange-${AUDIT}`);

    fireEvent.keyDown(nochange, { key: "Enter" });
    expect(screen.getByTestId("column-menu")).toBeDefined();

    fireEvent.keyDown(screen.getByTestId("column-menu"), { key: "Escape" });
    expect(document.activeElement).toBe(nochange);
  });

  it("申請対象外の列（lock あり。フォーカス位置がチップ）でもメニューを開ける", () => {
    const locked: MatrixColumn[] = [
      {
        ...columns[0]!,
        lock: {
          roleArn: DEPLOY,
          changeRequestId: "cr-0142",
          status: "draft",
          createdAt: "2026-07-31T10:04:00.000Z",
        },
      },
      columns[1]!,
    ];
    renderGrid({ columns: locked });
    const chip = screen.getByTestId(`role-chip-${DEPLOY}`);

    fireEvent.keyDown(chip, { key: "Enter" });
    expect(screen.getByTestId("column-menu")).toBeDefined();

    fireEvent.keyDown(screen.getByTestId("column-menu"), { key: "Escape" });
    expect(document.activeElement).toBe(chip);
  });

  it("メニューを開いている間に「▾」をもう一度押すと閉じる", () => {
    renderGrid();

    fireEvent.click(screen.getByTestId(`role-menu-${DEPLOY}`));
    fireEvent.click(screen.getByTestId(`role-menu-${DEPLOY}`));

    expect(screen.queryByTestId("column-menu")).toBeNull();
  });

  it("現在の条件がメニューの選択に反映される", () => {
    renderGrid({ columnView: { [DEPLOY]: { filter: "changed", sort: "unchecked-first" } } });

    fireEvent.click(screen.getByTestId(`role-menu-${DEPLOY}`));

    expect(screen.getByTestId("column-menu-filter-changed").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("column-menu-sort-unchecked-first").getAttribute("aria-checked")).toBe("true");
  });

  it("Tab 停止点はメニューを閉じた状態でマトリクス全体に 1 つだけ（M-1.3）。「▾」は含まれない", () => {
    renderGrid();

    const table = screen.getByTestId("assignment-matrix-table");
    expect(table.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(screen.getByTestId(`role-menu-${DEPLOY}`).getAttribute("tabindex")).toBe("-1");
  });
});

describe("バッジ（D-11）", () => {
  it("条件の無い列にはバッジが無い", () => {
    renderGrid();

    expect(screen.queryByTestId(`role-badge-${DEPLOY}`)).toBeNull();
  });

  it("ソートとフィルタの両方が語で出る（色だけに頼らない）", () => {
    renderGrid({
      columnView: {
        [DEPLOY]: { filter: "changed", sort: "checked-first" },
        [AUDIT]: { filter: null, sort: "unchecked-first" },
      },
    });

    const deploy = screen.getByTestId(`role-badge-${DEPLOY}`).textContent ?? "";
    expect(deploy).toContain("↑ チェックあり");
    expect(deploy).toContain("絞り込み: 未反映の変更あり");
    expect(screen.getByTestId(`role-badge-${AUDIT}`).textContent).toBe("↑ チェックなし");
  });
});

describe("0 件（D-12）", () => {
  it("行が 0 件でも列ヘッダは残り、本体に理由と「すべて解除」を出す", () => {
    const props = renderGrid({ rows: [] });

    expect(screen.getByTestId(`role-column-${DEPLOY}`)).toBeDefined();
    expect(screen.getByTestId("matrix-no-match").textContent).toContain(
      "条件に一致する IAMユーザがいません",
    );

    fireEvent.click(screen.getByTestId("matrix-no-match-clear"));
    expect(props.onClearView).toHaveBeenCalledTimes(1);
  });

  it("行が 1 件でもあれば 0 件の行は出ない", () => {
    renderGrid();

    expect(screen.queryByTestId("matrix-no-match")).toBeNull();
  });
});

describe("列の背景色（Issue #100。FR-3.4）", () => {
  const rgb = (hex: string): string => {
    const n = Number.parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };
  const bg = (element: HTMLElement): string => getComputedStyle(element).backgroundColor;
  const cell = (userArn: string, roleArn: string): HTMLElement =>
    screen.getByTestId(`cell-${userArn}-${roleArn}`).closest("td") as HTMLElement;

  it("色のある列は、ヘッダにだけ背景色が付き、セルには付かない（Issue #105）", () => {
    renderGrid({ columns: [{ ...columns[0] as MatrixColumn, color: "blue" }, columns[1] as MatrixColumn] });

    expect(bg(screen.getByTestId(`role-column-${DEPLOY}`))).toBe(rgb("#d3e5fb"));
    for (const row of rows) {
      expect(bg(cell(row.userArn, DEPLOY))).toBe(bg(cell(row.userArn, AUDIT)));
      expect(bg(cell(row.userArn, DEPLOY))).not.toBe(rgb("#d3e5fb"));
    }
    expect(bg(screen.getByTestId(`role-column-${AUDIT}`))).not.toBe(rgb("#d3e5fb"));
  });

  it("選択中のヘッダは選択の背景を優先する", () => {
    renderGrid({ columns: [{ ...columns[0] as MatrixColumn, color: "blue", selected: true }, columns[1] as MatrixColumn] });

    expect(bg(screen.getByTestId(`role-column-${DEPLOY}`))).not.toBe(rgb("#d3e5fb"));
  });

  it("色名を aria-label・title に出さない（色は飾り。D-16）", () => {
    renderGrid({ columns: [{ ...columns[0] as MatrixColumn, color: "blue" }, columns[1] as MatrixColumn] });

    const header = screen.getByTestId(`role-column-${DEPLOY}`);
    expect(header.innerHTML).not.toContain("青");
    expect(screen.getByLabelText("DeployProd のソートとフィルタ")).toBeTruthy();
  });

  it("色のある列でも、セルの差分記号は既定の色のまま。ヘッダの文字は濃い色に替える（Issue #105）", () => {
    renderGrid({
      columns: [{ ...columns[0] as MatrixColumn, color: "red" }, columns[1] as MatrixColumn],
      cellState: (_user, role) => ({ checked: role === DEPLOY, reflected: false, saving: false }),
    });

    const marker = screen.getByTestId(`cell-marker-${(rows[0] as MatrixRow).userArn}-${DEPLOY}`);
    expect(getComputedStyle(marker).color).not.toBe(rgb("#025a09"));
    const header = screen.getByTestId(`role-column-${DEPLOY}`);
    expect(getComputedStyle(header).color).toBe(rgb("#000716"));
  });
});

describe("色のある列の文字色（Issue #100 fix round 1）", () => {
  const rgb = (hex: string): string => {
    const n = Number.parseInt(hex.slice(1), 16);
    return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
  };
  const lockedColumn = (status: "draft" | "failed", color: "red" | null): MatrixColumn[] => [
    {
      ...(columns[0] as MatrixColumn),
      color,
      lock: { roleArn: DEPLOY, changeRequestId: "cr-0142", status, createdAt: "2026-07-31T10:04:00.000Z" },
    },
    columns[1] as MatrixColumn,
  ];

  for (const status of ["draft", "failed"] as const) {
    it(`色のある列の ${status} のチップは白い囲みに置く。色のない列は囲みを付けない`, () => {
      renderGrid({ columns: lockedColumn(status, "red") });
      expect(getComputedStyle(screen.getByTestId(`role-chip-${DEPLOY}`)).backgroundColor).toBe(
        "rgb(255, 255, 255)",
      );
      cleanup();
      renderGrid({ columns: lockedColumn(status, null) });
      expect(getComputedStyle(screen.getByTestId(`role-chip-${DEPLOY}`)).backgroundColor).not.toBe(
        "rgb(255, 255, 255)",
      );
    });
  }

  it("AWSアカウントID・バッジ・「▾」の色を替え、差分記号「−」は既定の色のまま（Issue #105）", () => {
    renderGrid({
      columns: [{ ...(columns[0] as MatrixColumn), color: "red" }, columns[1] as MatrixColumn],
      cellState: (_user, role) => ({ checked: false, reflected: role === DEPLOY, saving: false }),
      columnView: { [DEPLOY]: { filter: "changed", sort: null } },
    });
    const userArn = (rows[0] as MatrixRow).userArn;
    expect(getComputedStyle(screen.getByTestId(`cell-marker-${userArn}-${DEPLOY}`)).color).not.toBe(rgb("#a30f0f"));
    const header = screen.getByTestId(`role-column-${DEPLOY}`);
    const accountId = Array.from(header.querySelectorAll("div")).find((d) => d.textContent === ROLE_ACCOUNT) as HTMLElement;
    expect(getComputedStyle(accountId).color).toBe(rgb("#414d5c"));
    expect(getComputedStyle(screen.getByTestId(`role-badge-${DEPLOY}`)).color).toBe(rgb("#000716"));
    // ボタンは実ブラウザでは色を継承しない。jsdom は継承するので、インラインの指定そのものを見る。
    expect(screen.getByTestId(`role-menu-${DEPLOY}`).style.color).toBe(rgb("#000716"));
  });
});

describe("属性の項目の表示（Issue #107）", () => {
  const attributeColumns = [
    { columnId: "c1", name: "部署" },
    { columnId: "c2", name: "役割" },
  ];
  const rowsWithAttributes: MatrixRow[] = [
    { ...rows[0]!, attributes: { c1: "開発", c2: "リーダー" } },
    { ...rows[1]!, attributes: { c1: "運用" } },
  ];

  it("行見出しの右・ロール列の手前に、定義の順で属性の見出しが並び、各行に値が出る。値が無いセルは「—」", () => {
    renderGrid({ rows: rowsWithAttributes, attributeColumns });

    const headers = Array.from(
      screen.getByTestId("assignment-matrix-table").querySelectorAll("thead th"),
    ).map((th) => th.getAttribute("data-testid"));
    expect(headers).toEqual([
      null,
      "attr-column-c1",
      "attr-column-c2",
      `role-column-${DEPLOY}`,
      `role-column-${AUDIT}`,
    ]);
    expect(screen.getByTestId("attr-column-c1").textContent).toContain("部署");
    const a = rowsWithAttributes[0]!.userArn;
    const b = rowsWithAttributes[1]!.userArn;
    expect(screen.getByTestId(`attr-cell-${a}-c1`).textContent).toBe("開発");
    expect(screen.getByTestId(`attr-cell-${a}-c2`).textContent).toBe("リーダー");
    expect(screen.getByTestId(`attr-cell-${b}-c2`).textContent).toBe("—");
  });

  it("属性の見出しは th scope=col、行見出しは th scope=row のまま。長い値は折り返す", () => {
    renderGrid({ rows: rowsWithAttributes, attributeColumns });

    expect(screen.getByTestId("attr-column-c1").getAttribute("scope")).toBe("col");
    expect(screen.getByTestId(`user-row-${rowsWithAttributes[0]!.userArn}`).getAttribute("scope")).toBe("row");
    const cell = screen.getByTestId(`attr-cell-${rowsWithAttributes[0]!.userArn}-c1`);
    expect(cell.style.overflowWrap).toBe("anywhere");
    expect(cell.style.maxWidth).toBe("14rem");
  });

  it("属性の項目が 0 件なら、何も増えない（属性の見出し・セルが無い）", () => {
    renderGrid();

    expect(document.querySelector('[data-testid^="attr-"]')).toBeNull();
  });

  it("0 件の本体は、属性の項目ぶんも含めて全列にまたがる", () => {
    renderGrid({ rows: [], attributeColumns });

    const cell = screen.getByTestId("matrix-no-match");
    expect(cell.getAttribute("colspan")).toBe(String(1 + attributeColumns.length + columns.length));
  });

  it("見出しの名前をクリックすると onToggleFold を呼ぶ。畳んだ列は細い列になり、値は出さない", () => {
    const onToggleFold = vi.fn();
    renderGrid({ rows: rowsWithAttributes, attributeColumns, onToggleFold });

    fireEvent.click(screen.getByTestId("attr-fold-c1"));
    expect(onToggleFold).toHaveBeenCalledWith("c1");
    expect(screen.getByTestId("attr-fold-c1").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("attr-fold-c1").getAttribute("aria-label")).toBe("部署 の列を畳む");
    cleanup();

    renderGrid({
      rows: rowsWithAttributes,
      attributeColumns,
      foldedColumnIds: new Set(["c1"]),
      onToggleFold,
    });
    const open = screen.getByTestId("attr-open-c1");
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(open.getAttribute("aria-label")).toBe("部署 の列を開く");
    expect(screen.queryByTestId("attr-fold-c1")).toBeNull();
    // 値は出さない（セルは空。もう一方の列は出たまま）。
    expect(screen.getByTestId(`attr-cell-${rowsWithAttributes[0]!.userArn}-c1`).textContent).toBe("");
    expect(screen.getByTestId(`attr-cell-${rowsWithAttributes[0]!.userArn}-c2`).textContent).toBe("リーダー");
    // 細い列は幅が狭い。
    expect(screen.getByTestId("attr-column-c1").style.width).toBe("2.25rem");
    // 表が横にあふれるとき、自動レイアウトが最小幅まで縮める（実測で 14px になった）。下限も 2.25rem に固定する。
    expect(screen.getByTestId("attr-column-c1").style.minWidth).toBe("2.25rem");
    expect(
      screen.getByTestId(`attr-cell-${rowsWithAttributes[0]!.userArn}-c1`).style.minWidth,
    ).toBe("2.25rem");

    fireEvent.click(open);
    expect(onToggleFold).toHaveBeenLastCalledWith("c1");
  });

  it("畳んだ列の見出しボタンは、行の流れから外れて行の高さに従う（行を押し広げない）（Issue #137）", () => {
    renderGrid({
      rows: rowsWithAttributes,
      attributeColumns,
      foldedColumnIds: new Set(["c1"]),
    });

    const button = screen.getByTestId("attr-open-c1");
    // 絶対配置にして、見出しのセルいっぱいに広げる。固定の高さは持たない（行の高さはロール列の見出しが決める）。
    expect(button.style.position).toBe("absolute");
    expect(button.style.inset).toBe("0px");
    expect(button.style.height).toBe("");
    // 行に収まらない縦書きの名前は隠し、全文は title で読める。
    expect(button.style.overflow).toBe("hidden");
    expect(button.getAttribute("title")).toBe("部署");
    // 縦書きの名前は 1 列で切る（折り返すと 2 列目が見出しの幅からはみ出す）。
    expect((button.children[1] as HTMLElement).style.whiteSpace).toBe("nowrap");
    // 絶対配置の基準は見出しのセル自身（sticky）。
    expect(screen.getByTestId("attr-column-c1").style.position).toBe("sticky");
  });

  it("畳みのボタンは Tab 停止点に入らない（tabIndex=-1）", () => {
    renderGrid({ rows: rowsWithAttributes, attributeColumns });

    expect(screen.getByTestId("attr-fold-c1").getAttribute("tabindex")).toBe("-1");
  });
});

describe("ローミング tabindex と属性の見出し（Issue #107。spec D-12）", () => {
  const attributeColumns = [
    { columnId: "c1", name: "部署" },
    { columnId: "c2", name: "役割" },
  ];
  const roleHeader = (roleArn: string): HTMLElement =>
    (document.querySelector(`[data-testid="role-select-${roleArn}"], [data-testid="role-nochange-${roleArn}"]`) ??
      document.body) as HTMLElement;
  const cell = (userIndex: number, roleArn: string): HTMLElement =>
    screen.getByTestId(`cell-${rows[userIndex]!.userArn}-${roleArn}`);

  it("Tab 停止点は 1 つだけで、最初は先頭の属性の見出し。属性の項目が 0 件なら従来どおり先頭のロール列", () => {
    renderGrid({ attributeColumns });
    const table = screen.getByTestId("assignment-matrix-table");
    expect(table.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(screen.getByTestId("attr-column-c1").getAttribute("tabindex")).toBe("0");
    expect(screen.getByTestId("attr-column-c2").getAttribute("tabindex")).toBe("-1");
    cleanup();

    renderGrid();
    expect(screen.getByTestId("assignment-matrix-table").querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(screen.getByTestId(`role-select-${DEPLOY}`).getAttribute("tabindex")).toBe("0");
  });

  it("ヘッダ行で → は属性の見出しからロール列へ進み、← で戻る", () => {
    renderGrid({ attributeColumns });
    const c1 = screen.getByTestId("attr-column-c1");
    c1.focus();

    fireEvent.keyDown(c1, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByTestId("attr-column-c2"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(roleHeader(DEPLOY));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByTestId("attr-column-c2"));
    // 先頭では止まる。
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(c1);
    // 移動した位置だけが Tab 停止点になる。
    expect(screen.getByTestId("assignment-matrix-table").querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("属性の見出しで ↓ を押しても動かない。ロール列の見出しからは本体の最初の行へ降りる", () => {
    renderGrid({ attributeColumns });
    const c2 = screen.getByTestId("attr-column-c2");
    c2.focus();

    fireEvent.keyDown(c2, { key: "ArrowDown" });
    expect(document.activeElement).toBe(c2);

    const deploy = roleHeader(DEPLOY);
    deploy.focus();
    fireEvent.keyDown(deploy, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(0, DEPLOY));
  });

  it("本体の最初の行で ↑ を押すと、同じロール列の見出しへ戻る。← は最初のロール列で止まる", () => {
    renderGrid({ attributeColumns });
    cell(0, AUDIT).focus();

    fireEvent.keyDown(cell(0, AUDIT), { key: "ArrowUp" });
    expect(document.activeElement).toBe(roleHeader(AUDIT));

    cell(0, DEPLOY).focus();
    fireEvent.keyDown(cell(0, DEPLOY), { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cell(0, DEPLOY));
  });

  it("Home / End: ヘッダ行では先頭・末尾の見出し、本体の行ではロール列の先頭・末尾", () => {
    renderGrid({ attributeColumns });
    const deploy = roleHeader(DEPLOY);
    deploy.focus();

    fireEvent.keyDown(deploy, { key: "Home" });
    expect(document.activeElement).toBe(screen.getByTestId("attr-column-c1"));
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement).toBe(roleHeader(AUDIT));

    cell(1, AUDIT).focus();
    fireEvent.keyDown(cell(1, AUDIT), { key: "Home" });
    expect(document.activeElement).toBe(cell(1, DEPLOY));
    fireEvent.keyDown(cell(1, DEPLOY), { key: "End" });
    expect(document.activeElement).toBe(cell(1, AUDIT));
  });

  it("属性の見出しの中のボタンで押したキーは、見出しのキー操作を起こさない", () => {
    renderGrid({ attributeColumns });
    const fold = screen.getByTestId("attr-fold-c1");

    fireEvent.keyDown(fold, { key: "ArrowRight" });

    expect(document.activeElement).not.toBe(screen.getByTestId("attr-column-c2"));
  });

  it("ロール列の既存のキー操作は属性の項目があっても変わらない（Space はチェックの切替、Enter はメニュー）", () => {
    const props = renderGrid({ attributeColumns });
    const deploy = roleHeader(DEPLOY);
    deploy.focus();

    fireEvent.keyDown(deploy, { key: "Enter" });
    expect(screen.getByTestId("column-menu")).toBeDefined();
    fireEvent.keyDown(screen.getByTestId("column-menu"), { key: "Escape" });
    expect(document.activeElement).toBe(deploy);

    fireEvent.click(cell(0, DEPLOY));
    expect(props.onToggleCell).toHaveBeenCalledWith(rows[0]!.userArn, DEPLOY, true);
  });
});

describe("属性の見出しのメニュー・バッジ（Issue #107。spec D-5・D-10・D-15）", () => {
  const attributeColumns = [
    { columnId: "c1", name: "部署" },
    { columnId: "c2", name: "役割" },
  ];
  const attributeOptions = {
    c1: { values: [{ value: "開発", count: 3 }, { value: "運用", count: 2 }], unset: 1 },
    c2: { values: [{ value: "メンバー", count: 4 }], unset: 0 },
  };

  it("「▾」を押すとメニューが開き、項目を選ぶとコールバックを呼んで閉じ、フォーカスは属性の見出しへ戻る", () => {
    const onChangeAttributeFilter = vi.fn();
    const onChangeAttributeSort = vi.fn();
    renderGrid({ attributeColumns, attributeOptions, onChangeAttributeFilter, onChangeAttributeSort });

    const button = screen.getByTestId("attr-menu-c1");
    expect(button.getAttribute("aria-haspopup")).toBe("menu");
    expect(button.getAttribute("aria-label")).toBe("部署 のソートとフィルタ");
    expect(button.getAttribute("tabindex")).toBe("-1");
    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(screen.getByTestId("column-menu-filter-value-1"));
    expect(onChangeAttributeFilter).toHaveBeenCalledWith("c1", "運用");
    expect(screen.queryByTestId("column-menu")).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId("attr-column-c1"));

    fireEvent.click(screen.getByTestId("attr-menu-c2"));
    fireEvent.click(screen.getByTestId("column-menu-sort-desc"));
    expect(onChangeAttributeSort).toHaveBeenCalledWith("c2", "desc");
  });

  it("属性の見出しで Enter を押すとメニューが開き、Escape で閉じてフォーカスがその見出しへ戻る", () => {
    renderGrid({ attributeColumns, attributeOptions });
    const header = screen.getByTestId("attr-column-c2");
    header.focus();

    fireEvent.keyDown(header, { key: "Enter" });
    expect(screen.getByTestId("column-menu")).toBeDefined();

    fireEvent.keyDown(screen.getByTestId("column-menu"), { key: "Escape" });
    expect(screen.queryByTestId("column-menu")).toBeNull();
    expect(document.activeElement).toBe(header);
    expect(screen.getByTestId("assignment-matrix-table").querySelectorAll('[tabindex="0"]')).toHaveLength(1);
  });

  it("現在の条件がメニューの選択に反映される。「この列を畳む」で onToggleFold を呼ぶ", () => {
    const onToggleFold = vi.fn();
    renderGrid({
      attributeColumns,
      attributeOptions,
      attributeView: { c1: { filter: "開発", sort: "asc" } },
      onToggleFold,
    });

    fireEvent.click(screen.getByTestId("attr-menu-c1"));
    expect(screen.getByTestId("column-menu-filter-value-0").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("column-menu-sort-asc").getAttribute("aria-checked")).toBe("true");

    fireEvent.click(screen.getByTestId("column-menu-fold"));
    expect(onToggleFold).toHaveBeenCalledWith("c1");
  });

  it("畳んだ列の見出しで Enter を押してもメニューが開き、列の項目は「この列を開く」", () => {
    renderGrid({ attributeColumns, attributeOptions, foldedColumnIds: new Set(["c1"]) });
    const header = screen.getByTestId("attr-column-c1");
    header.focus();

    fireEvent.keyDown(header, { key: "Enter" });

    expect(screen.getByTestId("column-menu-fold").textContent).toBe("この列を開く");
  });

  it("条件のある見出しにバッジを語で出す（色だけに頼らない）。aria-sort も付く", () => {
    renderGrid({
      attributeColumns,
      attributeOptions,
      attributeView: {
        c1: { filter: "開発", sort: "asc" },
        c2: { filter: ATTRIBUTE_UNSET, sort: null },
      },
    });

    const c1 = screen.getByTestId("attr-badge-c1").textContent ?? "";
    expect(c1).toContain("↑ 昇順");
    expect(c1).toContain("絞り込み: 開発");
    expect(screen.getByTestId("attr-badge-c2").textContent).toBe("絞り込み: （未設定）");
    expect(screen.getByTestId("attr-column-c1").getAttribute("aria-sort")).toBe("ascending");
    expect(screen.getByTestId("attr-column-c2").getAttribute("aria-sort")).toBeNull();
  });

  it("降順は「↓ 降順」と aria-sort=descending。条件の無い列にはバッジが無い", () => {
    renderGrid({ attributeColumns, attributeOptions, attributeView: { c1: { filter: null, sort: "desc" } } });

    expect(screen.getByTestId("attr-badge-c1").textContent).toBe("↓ 降順");
    expect(screen.getByTestId("attr-column-c1").getAttribute("aria-sort")).toBe("descending");
    expect(screen.queryByTestId("attr-badge-c2")).toBeNull();
  });

  it("条件のある畳んだ列には「●」の印が出る。条件が無ければ出ない", () => {
    renderGrid({
      attributeColumns,
      attributeOptions,
      foldedColumnIds: new Set(["c1", "c2"]),
      attributeView: { c1: { filter: "開発", sort: null } },
    });

    expect(screen.getByTestId("attr-dot-c1")).toBeDefined();
    expect(screen.queryByTestId("attr-dot-c2")).toBeNull();
  });
});

describe("最終レビューの修正（Issue #107）", () => {
  it("行が 0 件のとき、ロール列の見出しで ↓ を押しても別の列へ動かない", () => {
    renderGrid({
      rows: [],
      attributeColumns: [
        { columnId: "c1", name: "部署" },
        { columnId: "c2", name: "役割" },
      ],
    });
    const audit = screen.getByTestId(`role-select-${DEPLOY}`);
    audit.focus();

    fireEvent.keyDown(audit, { key: "ArrowDown" });

    expect(document.activeElement).toBe(audit);
  });
});

const BILLING = `arn:aws:iam::${ROLE_ACCOUNT}:role/BillingViewer`;
const ALL_COLUMNS: MatrixColumn[] = [
  ...columns,
  { ...columns[1]!, roleArn: BILLING, roleName: "BillingViewer", formalRoleName: "BillingViewer" },
];

function HidingGrid(props: { selectedArn?: string }): React.JSX.Element {
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const shown = ALL_COLUMNS.filter((column) => !hidden.has(column.roleArn)).map((column) => ({
    ...column,
    selected: column.roleArn === props.selectedArn,
  }));
  return (
    <MatrixGrid
      rows={rows}
      columns={shown}
      cellState={() => ({ checked: false, reflected: false, saving: false })}
      onToggleCell={() => {}}
      onToggleRole={() => {}}
      columnView={{}}
      onChangeFilter={() => {}}
      onChangeSort={() => {}}
      onClearView={() => {}}
      onHideRole={(roleArn) => setHidden((current) => new Set(current).add(roleArn))}
    />
  );
}

describe("列の表示名（Issue #150）", () => {
  const NAMED = `arn:aws:iam::${ROLE_ACCOUNT}:role/RolustManaged-DeployProd`;
  const named: MatrixColumn = {
    ...columns[0]!,
    roleArn: NAMED,
    roleName: "本番デプロイ",
    formalRoleName: "RolustManaged-DeployProd",
  };

  it("表示名のある列はヘッダに表示名を出し、ホバーに正式名を出す", () => {
    renderGrid({ columns: [named] });

    const header = screen.getByTestId(`role-column-${NAMED}`);
    expect(within(header).getByText("本番デプロイ")).toBeTruthy();
    expect(within(header).getByText("本番デプロイ").getAttribute("title")).toBe("RolustManaged-DeployProd");
  });

  it("説明もあれば、ホバーは正式名の次の行に説明を続ける", () => {
    renderGrid({ columns: [{ ...named, description: "本番用" }] });

    const header = screen.getByTestId(`role-column-${NAMED}`);
    expect(within(header).getByText("本番デプロイ").getAttribute("title")).toBe("RolustManaged-DeployProd\n本番用");
  });

  it("名前は切らずに折り返す（overflowWrap: anywhere）。列の操作の aria-label も表示名を使う", () => {
    renderGrid({ columns: [named] });

    const header = screen.getByTestId(`role-column-${NAMED}`);
    expect(within(header).getByText("本番デプロイ").style.overflowWrap).toBe("anywhere");
    expect(screen.getByTestId(`role-menu-${NAMED}`).getAttribute("aria-label")).toBe("本番デプロイ のソートとフィルタ");
  });
});

describe("この列を隠す（Issue #140）", () => {
  // フォーカス先は列の種類で変わる（選択のチェック・「変更なし」・除外のチップ）ので、
  // 「その列のヘッダの中で、ローミング tabindex の位置（tabindex=0）にフォーカスがある」ことで判定する。
  function expectFocusInHeaderOf(roleArn: string): void {
    const header = screen.getByTestId(`role-column-${roleArn}`);
    expect(header.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute("tabindex")).toBe("0");
  }

  function openMenuOf(roleArn: string): void {
    fireEvent.click(screen.getByTestId(`role-menu-${roleArn}`));
  }

  it("メニューの「この列を隠す」で、その列が消え、右隣の列のヘッダの操作にフォーカスが移る", () => {
    render(<HidingGrid />);
    const [first, second] = ALL_COLUMNS;
    openMenuOf(first!.roleArn);

    fireEvent.click(screen.getByTestId("column-menu-hide"));

    expect(screen.queryByTestId(`role-column-${first!.roleArn}`)).toBeNull();
    expectFocusInHeaderOf(second!.roleArn);
    // Tab 停止点は 1 つのまま（ローミング tabindex）。
    expect(document.querySelectorAll('table [tabindex="0"]').length).toBe(1);
  });

  it("右端の列を隠すと、左隣にフォーカスが移り、Tab 停止点を失わない", () => {
    render(<HidingGrid />);
    const last = ALL_COLUMNS[ALL_COLUMNS.length - 1]!;
    const beforeLast = ALL_COLUMNS[ALL_COLUMNS.length - 2]!;
    openMenuOf(last.roleArn);

    fireEvent.click(screen.getByTestId("column-menu-hide"));

    expectFocusInHeaderOf(beforeLast.roleArn);
    expect(document.querySelectorAll('table [tabindex="0"]').length).toBe(1);
  });

  it("選択中の列では「この列を隠す」が無効で、押しても列は消えない", () => {
    const selected = ALL_COLUMNS[0]!;
    render(<HidingGrid selectedArn={selected.roleArn} />);
    openMenuOf(selected.roleArn);

    const item = screen.getByTestId("column-menu-hide");
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);

    expect(screen.getByTestId(`role-column-${selected.roleArn}`)).toBeTruthy();
  });
});
