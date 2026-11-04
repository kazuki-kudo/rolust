// @vitest-environment jsdom
import { Profiler } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import createWrapper from "@cloudscape-design/components/test-utils/dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiClientError, api } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { EditRoleDescriptionModal } from "./EditRoleDescriptionModal.js";

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, api: { updateRoleFields: vi.fn() } };
});

const ROLE_ARN = "arn:aws:iam::123456789012:role/ReadOnlyAudit";
const CREATED_AT = "2026-09-27T00:00:00.000Z";
const updateRoleFields = vi.mocked(api.updateRoleFields);

type Target = {
  arn: string;
  roleName: string;
  displayName: string | null;
  description: string | null;
} | null;

function renderModal(
  role: Target = { arn: ROLE_ARN, roleName: "ReadOnlyAudit", displayName: null, description: "監査用" },
) {
  const onDismiss = vi.fn();
  const onSaved = vi.fn();
  const view = render(
    <EditRoleDescriptionModal role={role} onDismiss={onDismiss} onSaved={onSaved} />,
  );
  const rerender = (next: Target) =>
    view.rerender(<EditRoleDescriptionModal role={next} onDismiss={onDismiss} onSaved={onSaved} />);
  return { onDismiss, onSaved, rerender };
}

/** Cloudscape の `Input` は根要素に data-testid を載せる。 */
function descriptionInput(): HTMLInputElement {
  const element = screen.getByTestId("edit-role-description-input");
  return (element instanceof HTMLInputElement ? element : element.querySelector("input")) as HTMLInputElement;
}

function displayNameInput(): HTMLInputElement {
  const element = screen.getByTestId("edit-role-display-name-input");
  return (element instanceof HTMLInputElement ? element : element.querySelector("input")) as HTMLInputElement;
}

async function submit(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId("edit-role-description-submit"));
    await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ロールの説明を編集するモーダル（Issue #21）", () => {
  it("一覧の説明を初期値にする", () => {
    renderModal();

    expect(descriptionInput().value).toBe("監査用");
  });

  it("説明が未設定なら空欄", () => {
    renderModal({ arn: ROLE_ARN, roleName: "ReadOnlyAudit", displayName: null, description: null });

    expect(descriptionInput().value).toBe("");
  });

  it("保存すると前後の空白を除いた説明を送り、更新後のロールを onSaved に渡す", async () => {
    const saved = {
      accountId: "123456789012",
      roleName: "ReadOnlyAudit",
      arn: ROLE_ARN,
      description: "新しい説明",
      displayName: null,
      color: null,
      createdAt: CREATED_AT,
    };
    updateRoleFields.mockResolvedValue({ role: saved });
    const { onSaved } = renderModal();

    fireEvent.change(descriptionInput(), { target: { value: "  新しい説明  " } });
    await submit();

    expect(updateRoleFields).toHaveBeenCalledWith(ROLE_ARN, { description: "新しい説明" });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(saved));
  });

  it("空にすると null を送る", async () => {
    updateRoleFields.mockResolvedValue({
      role: {
        accountId: "123456789012",
        roleName: "ReadOnlyAudit",
        arn: ROLE_ARN,
        description: null,
        displayName: null,
        color: null,
        createdAt: CREATED_AT,
      },
    });
    renderModal();

    fireEvent.change(descriptionInput(), { target: { value: "  " } });
    await submit();

    expect(updateRoleFields).toHaveBeenCalledWith(ROLE_ARN, { description: null });
  });

  it("257 文字の説明は blur でエラーを出し、保存しない", async () => {
    renderModal();

    fireEvent.change(descriptionInput(), { target: { value: "a".repeat(257) } });
    fireEvent.blur(descriptionInput());
    await screen.findByText("説明は 256 文字以内で入力してください");
    await submit();

    expect(updateRoleFields).not.toHaveBeenCalled();
  });

  it("サーバのエラーはモーダルを閉じずに中に出し、入力を保持する", async () => {
    updateRoleFields.mockRejectedValue(
      new ApiClientError(404, {
        code: "NotFound",
        message: "IAMロールが登録されていません",
        retryable: false,
      }),
    );
    const { onSaved } = renderModal();

    fireEvent.change(descriptionInput(), { target: { value: "新しい説明" } });
    await submit();

    await screen.findAllByText(/IAMロールが登録されていません/);
    expect(descriptionInput().value).toBe("新しい説明");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("変更があるとキャンセルで破棄確認を挟む（GI-4）", async () => {
    const { onDismiss } = renderModal();

    fireEvent.change(descriptionInput(), { target: { value: "新しい説明" } });
    fireEvent.click(screen.getByTestId("edit-role-description-cancel"));

    await screen.findByTestId("edit-role-description-modal-discard-alert");
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("変更が無ければキャンセルですぐ閉じる", () => {
    const { onDismiss } = renderModal();

    fireEvent.click(screen.getByTestId("edit-role-description-cancel"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("閉じて別のロールで開き直すと、最初の描画から説明が入っていて空欄の瞬間が DOM に出ない（ほかの編集モーダルと同じ形。Issue #67）", () => {
    // `useEffect` での戻しは、効果が走るまでの最初の描画が古い値のまま commit される。
    // `Profiler` で commit ごとの入力値を記録し、開き直しが空欄を経由しないことを固定する。
    const commits: string[] = [];
    const onDismiss = vi.fn();
    const onSaved = vi.fn();

    function readInputValue(): string | null {
      const element = document.querySelector('[data-testid="edit-role-description-input"]');
      if (!element) return null;
      const input = element instanceof HTMLInputElement ? element : element.querySelector("input");
      return input?.value ?? null;
    }

    function Wrapped({ role }: { role: Target }) {
      return (
        <Profiler
          id="edit-role-description-modal-test"
          onRender={() => {
            const value = readInputValue();
            if (value !== null) commits.push(value);
          }}
        >
          <EditRoleDescriptionModal role={role} onDismiss={onDismiss} onSaved={onSaved} />
        </Profiler>
      );
    }

    const { rerender } = render(
      <Wrapped
        role={{ arn: ROLE_ARN, roleName: "ReadOnlyAudit", displayName: null, description: "監査用" }}
      />,
    );
    commits.length = 0;

    rerender(<Wrapped role={null} />);
    commits.length = 0;

    rerender(
      <Wrapped
        role={{
          arn: "arn:aws:iam::123456789012:role/BillingViewer",
          roleName: "BillingViewer",
          displayName: null,
          description: "請求閲覧用",
        }}
      />,
    );

    expect(commits.length).toBeGreaterThan(0);
    expect(commits.every((value) => value === "請求閲覧用")).toBe(true);
  });

  it("閉じて別のロールで開き直すと、前の入力とエラーを残さない", async () => {
    updateRoleFields.mockRejectedValue(
      new ApiClientError(404, { code: "NotFound", message: "見つかりません", retryable: false }),
    );
    const { rerender } = renderModal();
    fireEvent.change(descriptionInput(), { target: { value: "書きかけ" } });
    await submit();
    await screen.findAllByText(/見つかりません/);

    rerender(null);
    rerender({
      arn: "arn:aws:iam::123456789012:role/BillingViewer",
      roleName: "BillingViewer",
      displayName: null,
      description: "請求閲覧用",
    });

    await waitFor(() => expect(descriptionInput().value).toBe("請求閲覧用"));
    expect(screen.queryAllByText(/見つかりません/)).toHaveLength(0);
  });
});

describe("ロールの表示名を編集するモーダル（Issue #150）", () => {
  const withNames = (displayName: string | null) => ({
    arn: ROLE_ARN,
    roleName: "ReadOnlyAudit",
    displayName,
    description: "説明",
  });
  const savedRole = {
    accountId: "123456789012",
    roleName: "ReadOnlyAudit",
    arn: ROLE_ARN,
    description: "説明",
    displayName: null,
    color: null,
    createdAt: CREATED_AT,
  };

  it("一覧の表示名を初期値にする", () => {
    renderModal(withNames("本番デプロイ"));

    expect(displayNameInput().value).toBe("本番デプロイ");
  });

  it("表示名だけを変えると、displayName だけを送る", async () => {
    updateRoleFields.mockResolvedValue({ role: savedRole });
    renderModal(withNames(null));

    fireEvent.change(displayNameInput(), { target: { value: "本番デプロイ" } });
    await submit();

    expect(updateRoleFields).toHaveBeenCalledWith(ROLE_ARN, { displayName: "本番デプロイ" });
  });

  it("表示名を空にすると、displayName: null を送る", async () => {
    updateRoleFields.mockResolvedValue({ role: savedRole });
    renderModal(withNames("本番デプロイ"));

    fireEvent.change(displayNameInput(), { target: { value: "" } });
    await submit();

    expect(updateRoleFields).toHaveBeenCalledWith(ROLE_ARN, { displayName: null });
  });

  it("どちらも変えずに保存すると、通信せずに閉じる", async () => {
    const { onDismiss } = renderModal(withNames("本番デプロイ"));

    await submit();

    expect(updateRoleFields).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("表示名が 33 文字なら、保存せずにエラーを出す", async () => {
    renderModal(withNames(null));

    fireEvent.change(displayNameInput(), { target: { value: "あ".repeat(33) } });
    fireEvent.blur(displayNameInput());
    await screen.findByText("表示名は 32 文字以内で入力してください");
    await submit();

    expect(updateRoleFields).not.toHaveBeenCalled();
  });

  it("ほかのロールと同じ表示名（409）は、表示名の欄の下に出し、モーダルを閉じず入力を保持する", async () => {
    const message = "表示名「本番デプロイ」は、ほかのロールで使われています";
    updateRoleFields.mockRejectedValue(
      new ApiClientError(409, { code: "Conflict", message, retryable: false }),
    );
    const { onSaved, onDismiss } = renderModal(withNames(null));

    fireEvent.change(displayNameInput(), { target: { value: "本番デプロイ" } });
    await submit();

    await screen.findByText(message);
    const fields = createWrapper(document.body).findAllFormFields();
    const displayNameField = fields.find(
      (field) => (field.findControl()?.find("input")?.getElement() as HTMLInputElement | undefined)?.value === "本番デプロイ",
    );
    expect(displayNameField?.findError()?.getElement().textContent).toContain(message);
    // フォーム全体のエラー（Form の errorText）には出さない。
    expect(screen.getAllByText(message)).toHaveLength(1);
    expect(screen.getByTestId("edit-role-description-modal")).toBeTruthy();
    expect(displayNameInput().value).toBe("本番デプロイ");
    expect(onSaved).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("409 以外のエラーは、表示名の欄ではなくフォーム全体に出す", async () => {
    // 5xx は describeError が定型文（localized の無い旧 API の message は出さない）に置き換えるので、
    // 「409 以外」を示す status は 400 にする（Issue #94）。
    updateRoleFields.mockRejectedValue(
      new ApiClientError(400, { code: "InternalError", message: "保存に失敗しました", retryable: true }),
    );
    renderModal(withNames(null));

    fireEvent.change(displayNameInput(), { target: { value: "本番デプロイ" } });
    await submit();

    await screen.findByText("保存に失敗しました");
    const fields = createWrapper(document.body).findAllFormFields();
    expect(fields.every((field) => field.findError() === null)).toBe(true);
  });
});
