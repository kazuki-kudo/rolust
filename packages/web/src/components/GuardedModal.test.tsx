// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import Button from "@cloudscape-design/components/button";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../i18n/index.js";
import { GuardedModal } from "./GuardedModal.js";

/**
 * `GuardedModal` のユニットテスト（`interaction-spec.md` GI-4 / GI-10 / Focus management）。
 *
 * GI-4: 「モーダルの Escape — 入力が空なら閉じる。入力があれば『入力内容を破棄しますか』
 * を確認する」。GI-10: 「モーダルは入れ子にしない」。
 */

function Harness({ onClose }: { onClose: () => void }): React.JSX.Element {
  const [value, setValue] = useState("");

  return (
    <GuardedModal
      visible
      header="テスト用モーダル"
      testId="test-modal"
      dirty={value !== ""}
      onClose={onClose}
      footer={(requestClose) => (
        <Button data-testid="test-modal-cancel" onClick={requestClose}>
          キャンセル
        </Button>
      )}
    >
      <input
        data-testid="test-input"
        aria-label="テスト入力"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    </GuardedModal>
  );
}

function pressEscape(): void {
  fireEvent.keyDown(document.activeElement ?? document.body, {
    key: "Escape",
    code: "Escape",
    keyCode: 27,
  });
}

afterEach(cleanup);

describe("GuardedModal（GI-4）", () => {
  it("入力が空なら Escape で即座に閉じる", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    pressEscape();

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("test-modal-discard-alert")).toBeNull();
  });

  it("入力があれば Escape で閉じず、同じモーダル内で破棄を確認する", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    const input = screen.getByTestId("test-input") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "platform-team" } });

    pressEscape();

    // 閉じていない
    expect(onClose).not.toHaveBeenCalled();
    // 確認は同じモーダルの中に出る（GI-10: モーダルを重ねない）
    expect(screen.getByTestId("test-modal-discard-alert")).toBeDefined();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    // 入力欄は DOM に残り、値も保持される（フォーカスを壊す差し替えをしない）
    expect((screen.getByTestId("test-input") as HTMLInputElement).value).toBe(
      "platform-team",
    );
    // フォーカスはダイアログ外へ出ず、既定は非破壊側の「編集に戻る」
    expect(document.activeElement).toBe(
      screen.getByTestId("test-modal-back-to-edit").closest("button"),
    );
  });

  it("「編集に戻る」で確認を畳み、元の入力欄へフォーカスを返す", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    const input = screen.getByTestId("test-input") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "platform-team" } });
    pressEscape();

    fireEvent.click(screen.getByTestId("test-modal-back-to-edit"));

    expect(screen.queryByTestId("test-modal-discard-alert")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByTestId("test-input") as HTMLInputElement).value).toBe(
      "platform-team",
    );
    expect(document.activeElement).toBe(screen.getByTestId("test-input"));
  });

  it("「破棄する」を選んだときだけ閉じる", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    const input = screen.getByTestId("test-input") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "platform-team" } });
    pressEscape();

    fireEvent.click(screen.getByTestId("test-modal-discard-confirm"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("確認表示のまま Escape を押しても破棄せず、編集へ戻る", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    const input = screen.getByTestId("test-input") as HTMLInputElement;
    input.focus();
    fireEvent.change(input, { target: { value: "platform-team" } });
    pressEscape();
    expect(screen.getByTestId("test-modal-discard-alert")).toBeDefined();

    // Escape は破壊的な確定に使わない。
    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.queryByTestId("test-modal-discard-alert")).toBeNull();
  });

  it("フッターの「キャンセル」も同じ確認を通り、フォーカスをダイアログ内に留める", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);

    const input = screen.getByTestId("test-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "platform-team" } });

    const cancel = screen.getByTestId("test-modal-cancel");
    (cancel.closest("button") as HTMLButtonElement).focus();
    fireEvent.click(cancel);

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("test-modal-discard-alert")).toBeDefined();
    // 「キャンセル」ボタン自体は消えるが、フォーカスはダイアログ内に移る。
    expect(document.activeElement).toBe(
      screen.getByTestId("test-modal-back-to-edit").closest("button"),
    );
  });
});

describe("GuardedModal（英語。Issue #94）", () => {
  it("破棄の確認が英語になる", () => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <Harness onClose={vi.fn()} />
      </LocaleProvider>,
    );
    fireEvent.change(screen.getByTestId("test-input"), { target: { value: "x" } });
    fireEvent.click(screen.getByTestId("test-modal-cancel"));

    expect(screen.getByTestId("test-modal-discard-alert").textContent).toContain("Discard your input?");
    expect(screen.getByTestId("test-modal-back-to-edit").textContent).toBe("Back to editing");
    expect(screen.getByTestId("test-modal-discard-confirm").textContent).toBe("Discard");
  });
});
