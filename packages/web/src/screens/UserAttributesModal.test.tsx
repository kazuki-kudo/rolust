// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { IamUser } from "@rolust/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, api } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { UserAttributesModal } from "./UserAttributesModal.js";

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, api: { saveUserAttributes: vi.fn() } };
});

const saveUserAttributes = vi.mocked(api.saveUserAttributes);
const POOL_ID = "platform-team";
const ARN = "arn:aws:iam::111122223333:user/ayaka.mori";
const COLUMNS = [
  { columnId: "c-name", name: "名前" },
  { columnId: "c-role", name: "役割" },
];
const USER: IamUser = {
  poolId: POOL_ID,
  accountId: "111122223333",
  userName: "ayaka.mori",
  arn: ARN,
  attributes: { "c-name": "森 彩花" },
  createdAt: "2026-10-03T00:00:00.000Z",
};

type Target = { user: IamUser; columns: typeof COLUMNS } | null;

function renderModal(target: Target = { user: USER, columns: COLUMNS }) {
  const onDismiss = vi.fn();
  const onSaved = vi.fn();
  const view = render(<UserAttributesModal target={target} onDismiss={onDismiss} onSaved={onSaved} />);
  const rerender = (next: Target) =>
    view.rerender(<UserAttributesModal target={next} onDismiss={onDismiss} onSaved={onSaved} />);
  return { onDismiss, onSaved, rerender };
}

/** Cloudscape の `Input` は根要素に data-testid を載せる。 */
function input(testId: string): HTMLInputElement {
  const element = screen.getByTestId(testId);
  return (element instanceof HTMLInputElement ? element : element.querySelector("input")) as HTMLInputElement;
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("user-attributes-submit"));
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("属性を編集モーダル（Issue #61）", () => {
  it("列ごとの入力欄に今の値を出し、値の無い列は空欄", () => {
    renderModal();

    expect(input("user-attribute-c-name").value).toBe("森 彩花");
    expect(input("user-attribute-c-role").value).toBe("");
    expect(screen.getByTestId("user-attributes-modal").textContent).toContain("ayaka.mori");
  });

  it("保存すると、値のある列だけを columnId で送り、保存後のユーザを onSaved に渡す", async () => {
    const saved = { ...USER, attributes: { "c-name": "森 彩花", "c-role": "管理者" } };
    saveUserAttributes.mockResolvedValue({ user: saved });
    const { onSaved } = renderModal();

    fireEvent.change(input("user-attribute-c-role"), { target: { value: " 管理者 " } });
    await submit();

    expect(saveUserAttributes).toHaveBeenCalledWith(ARN, { "c-name": "森 彩花", "c-role": "管理者" });
    expect(onSaved).toHaveBeenCalledWith(saved);
  });

  it("値を空にして保存すると、その列を送らない（解除）", async () => {
    saveUserAttributes.mockResolvedValue({ user: { ...USER, attributes: {} } });
    renderModal();

    fireEvent.change(input("user-attribute-c-name"), { target: { value: "  " } });
    await submit();

    expect(saveUserAttributes).toHaveBeenCalledWith(ARN, {});
  });

  it("制御文字・129 文字以上の値は保存を送らずにエラーを出す", async () => {
    renderModal();

    fireEvent.change(input("user-attribute-c-name"), { target: { value: "a".repeat(129) } });
    await submit();

    expect(saveUserAttributes).not.toHaveBeenCalled();
    expect(screen.getByTestId("user-attributes-modal").textContent).toContain("128 文字以内");
  });

  it("保存に失敗したらモーダルを閉じず、入力を保ってエラーを出す", async () => {
    saveUserAttributes.mockRejectedValue(new ApiClientError(404, { message: "IAMユーザが見つかりません", code: "NotFound" }));
    const { onSaved } = renderModal();

    fireEvent.change(input("user-attribute-c-role"), { target: { value: "管理者" } });
    await submit();

    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByTestId("user-attributes-modal").textContent).toContain("IAMユーザが見つかりません");
    expect(input("user-attribute-c-role").value).toBe("管理者");
  });

  it("入力があるとキャンセルで破棄確認に切り替わり、無ければ即座に閉じる（GI-4）", () => {
    const { onDismiss } = renderModal();

    fireEvent.click(screen.getByTestId("user-attributes-cancel"));
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent.change(input("user-attribute-c-role"), { target: { value: "管理者" } });
    fireEvent.click(screen.getByTestId("user-attributes-cancel"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("user-attributes-modal").textContent).toContain("破棄");
  });

  it("別のユーザで開き直すと、そのユーザの値に切り替わる", () => {
    const { rerender } = renderModal();
    const other = { ...USER, arn: "arn:aws:iam::111122223333:user/kenji.sato", userName: "kenji.sato", attributes: { "c-role": "開発" } };

    rerender({ user: other, columns: COLUMNS });

    expect(input("user-attribute-c-name").value).toBe("");
    expect(input("user-attribute-c-role").value).toBe("開発");
  });
});
