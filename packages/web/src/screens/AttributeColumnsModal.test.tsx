// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, api } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { AttributeColumnsModal } from "./AttributeColumnsModal.js";

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, api: { saveAttributeColumns: vi.fn() } };
});

const saveAttributeColumns = vi.mocked(api.saveAttributeColumns);
const NAME = { columnId: "c-name", name: "名前" };
const ROLE = { columnId: "c-role", name: "役割" };

type Target = { attributeColumns: { columnId: string; name: string }[] } | null;

function renderModal(pool: Target = { attributeColumns: [NAME, ROLE] }) {
  const onDismiss = vi.fn();
  const onSaved = vi.fn();
  const view = render(<AttributeColumnsModal pool={pool} onDismiss={onDismiss} onSaved={onSaved} />);
  const rerender = (next: Target) =>
    view.rerender(<AttributeColumnsModal pool={next} onDismiss={onDismiss} onSaved={onSaved} />);
  return { onDismiss, onSaved, rerender };
}

/** Cloudscape の `Input` は根要素に data-testid を載せる。 */
function input(testId: string): HTMLInputElement {
  const element = screen.getByTestId(testId);
  return (element instanceof HTMLInputElement ? element : element.querySelector("input")) as HTMLInputElement;
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("attribute-columns-submit"));
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("属性の項目を編集モーダル（Issue #61）", () => {
  it("今の列名を追加順に出す", () => {
    renderModal();

    expect(input("attribute-column-name-0").value).toBe("名前");
    expect(input("attribute-column-name-1").value).toBe("役割");
  });

  it("名前を変えて保存すると、columnId を保ったまま送り、保存後の列を onSaved に渡す", async () => {
    saveAttributeColumns.mockResolvedValue({ columns: [{ columnId: "c-name", name: "氏名" }, ROLE] });
    const { onSaved } = renderModal();

    fireEvent.change(input("attribute-column-name-0"), { target: { value: "氏名" } });
    await submit();

    expect(saveAttributeColumns).toHaveBeenCalledWith([
      { columnId: "c-name", name: "氏名" },
      { columnId: "c-role", name: "役割" },
    ]);
    expect(onSaved).toHaveBeenCalledWith([{ columnId: "c-name", name: "氏名" }, ROLE]);
  });

  it("項目を追加すると columnId の無い列として送る", async () => {
    saveAttributeColumns.mockResolvedValue({ columns: [NAME, ROLE, { columnId: "n1", name: "部署" }] });
    renderModal();

    fireEvent.click(screen.getByTestId("attribute-columns-add"));
    fireEvent.change(input("attribute-column-name-2"), { target: { value: "部署" } });
    await submit();

    expect(saveAttributeColumns).toHaveBeenCalledWith([
      { columnId: "c-name", name: "名前" },
      { columnId: "c-role", name: "役割" },
      { name: "部署" },
    ]);
  });

  it("列を削除すると、その列の値が見えなくなる警告を出し、送る列から外す", async () => {
    saveAttributeColumns.mockResolvedValue({ columns: [NAME] });
    renderModal();
    expect(screen.queryByTestId("attribute-columns-delete-warning")).toBeNull();

    fireEvent.click(screen.getByTestId("attribute-column-remove-1"));

    expect(screen.getByTestId("attribute-columns-delete-warning").textContent).toContain("役割");
    await submit();
    expect(saveAttributeColumns).toHaveBeenCalledWith([{ columnId: "c-name", name: "名前" }]);
  });

  it("10 列あるときは「項目を追加」を無効にする", () => {
    const ten = Array.from({ length: 10 }, (_, index) => ({ columnId: `c${index}`, name: `列${index}` }));
    renderModal({ attributeColumns: ten });

    const button = screen.getByTestId("attribute-columns-add");
    expect((button.querySelector("button") ?? button).hasAttribute("disabled")).toBe(true);
  });

  it("空の列名・重複は保存を送らずにエラーを出す", async () => {
    renderModal();

    fireEvent.change(input("attribute-column-name-0"), { target: { value: "   " } });
    await submit();
    expect(saveAttributeColumns).not.toHaveBeenCalled();
    expect(screen.getByTestId("attribute-columns-modal").textContent).toContain("列名を入力してください");

    fireEvent.change(input("attribute-column-name-0"), { target: { value: "役割" } });
    await submit();
    expect(saveAttributeColumns).not.toHaveBeenCalled();
    expect(screen.getByTestId("attribute-columns-modal").textContent).toContain("重複");
  });

  it("保存に失敗したらモーダルを閉じず、入力を保ってエラーを出す", async () => {
    saveAttributeColumns.mockRejectedValue(new ApiClientError(502, { message: "保存できませんでした", code: "StorageError" }));
    const { onSaved } = renderModal();

    fireEvent.change(input("attribute-column-name-0"), { target: { value: "氏名" } });
    await submit();

    expect(onSaved).not.toHaveBeenCalled();
    // 5xx の本文は内部の文面なので出さず、定型の文にする（`describeError`。Issue #94）。
    expect(screen.getByTestId("attribute-columns-modal").textContent).toContain("サーバ内部でエラーが発生しました");
    expect(input("attribute-column-name-0").value).toBe("氏名");
  });

  it("入力があるとキャンセルで破棄確認に切り替わり、無ければ即座に閉じる（GI-4）", () => {
    const { onDismiss } = renderModal();

    fireEvent.click(screen.getByTestId("attribute-columns-cancel"));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent.change(input("attribute-column-name-0"), { target: { value: "氏名" } });
    fireEvent.click(screen.getByTestId("attribute-columns-cancel"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("attribute-columns-modal").textContent).toContain("破棄");
  });

  it("開き直すと、前の入力ではなく一覧の列に戻る", () => {
    const { rerender } = renderModal();
    fireEvent.change(input("attribute-column-name-0"), { target: { value: "氏名" } });

    rerender(null);
    rerender({ attributeColumns: [NAME, ROLE] });

    expect(input("attribute-column-name-0").value).toBe("名前");
  });
});
