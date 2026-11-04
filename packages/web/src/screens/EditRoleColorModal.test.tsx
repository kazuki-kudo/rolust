// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { IamRole } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, api } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { EditRoleColorModal } from "./EditRoleColorModal.js";

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, api: { updateRoleColor: vi.fn() } };
});

const ROLE_ARN = "arn:aws:iam::555566667777:role/DeployProd";
const updateRoleColor = vi.mocked(api.updateRoleColor);
const savedRole: IamRole = {
  accountId: "555566667777", roleName: "DeployProd", arn: ROLE_ARN, description: null, displayName: null, color: "blue", createdAt: "2026-09-27T00:00:00.000Z",
};

function renderModal(color: IamRole["color"] = null) {
  const onDismiss = vi.fn();
  const onSaved = vi.fn();
  render(<EditRoleColorModal role={{ arn: ROLE_ARN, roleName: "DeployProd", color }} onDismiss={onDismiss} onSaved={onSaved} />);
  return { onDismiss, onSaved };
}

async function save(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("edit-role-color-submit"));
    await Promise.resolve();
  });
}

beforeEach(() => {
  updateRoleColor.mockResolvedValue({ role: savedRole });
});
afterEach(cleanup);

describe("ロールの背景色を編集するモーダル（FR-2.5。Issue #100）", () => {
  it("パレットの 8 色と「なし」を選べ、いまの色が選ばれている", () => {
    renderModal("blue");
    expect(screen.getAllByRole("radio")).toHaveLength(9);
    expect((screen.getByRole("radio", { name: /青$/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("色が無いロールは「なし」が選ばれている", () => {
    renderModal(null);
    expect((screen.getByRole("radio", { name: /なし/ }) as HTMLInputElement).checked).toBe(true);
  });

  it("変更が無いうちは「保存」を押せない", () => {
    renderModal("blue");
    expect((screen.getByTestId("edit-role-color-submit") as HTMLButtonElement).disabled).toBe(true);
  });

  it("色を選んで保存すると、その ID を送り、保存したロールを返す", async () => {
    const { onSaved } = renderModal(null);
    fireEvent.click(screen.getByRole("radio", { name: /青$/ }));
    await save();

    expect(updateRoleColor).toHaveBeenCalledWith(ROLE_ARN, "blue");
    expect(onSaved).toHaveBeenCalledWith(savedRole);
  });

  it("「なし」を選んで保存すると null を送る", async () => {
    renderModal("blue");
    fireEvent.click(screen.getByRole("radio", { name: /なし/ }));
    await save();

    expect(updateRoleColor).toHaveBeenCalledWith(ROLE_ARN, null);
  });

  it("保存に失敗したらモーダルを閉じず、メッセージを出して入力を残す", async () => {
    updateRoleColor.mockRejectedValue(new ApiClientError(404, { message: "IAMロールが登録されていません" }));
    const { onSaved, onDismiss } = renderModal(null);
    fireEvent.click(screen.getByRole("radio", { name: /赤/ }));
    await save();

    expect(onSaved).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByText("IAMロールが登録されていません")).toBeTruthy();
    expect((screen.getByRole("radio", { name: /赤/ }) as HTMLInputElement).checked).toBe(true);
  });
});
