// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ChangeRequest, IamRole, RoleView, TrustDriftView } from "@rolust/core";
import { buildRoleArn } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiClientError } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { LocaleProvider } from "../i18n/index.js";
import { navigate } from "../router.js";
import { RolesScreen } from "./RolesScreen.js";

/** 画面 2（IAM roles）を英語で描く（Issue #94）。日本語の挙動は `RolesScreen.test.tsx` が守る。 */

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: {
      listRoles: vi.fn(),
      createRole: vi.fn(),
      updateRoleFields: vi.fn(),
      updateRoleColor: vi.fn(),
      getConfig: vi.fn(),
      deleteRole: vi.fn(),
      reorderRoles: vi.fn(),
      getDrift: vi.fn(),
      restoreDrift: vi.fn(),
      adoptDrift: vi.fn(),
    },
  };
});

const ACCOUNT = "555566667777";

function role(roleName: string, description: string | null = null): IamRole {
  return {
    accountId: ACCOUNT,
    roleName,
    arn: buildRoleArn(ACCOUNT, roleName),
    description,
    displayName: null,
    color: null,
    createdAt: "2026-07-30T00:00:00.000Z",
  };
}

const deploy: RoleView = {
  ...role("RolustManaged-DeployProd", "Production deploys"),
  color: "blue",
  unreflected: null,
  assignments: { total: 0, pending: 0 },
};
const audit: RoleView = {
  ...role("RolustManaged-ReadOnlyAudit"),
  unreflected: {
    roleArn: buildRoleArn(ACCOUNT, "RolustManaged-ReadOnlyAudit"),
    changeRequestId: "cr-0142",
    status: "draft",
    createdAt: "2026-07-31T10:04:00.000Z",
  },
  assignments: { total: 0, pending: 0 },
};

const listRoles = vi.mocked(api.listRoles);
const createRole = vi.mocked(api.createRole);
const updateRoleFields = vi.mocked(api.updateRoleFields);
const updateRoleColor = vi.mocked(api.updateRoleColor);
const getConfig = vi.mocked(api.getConfig);
const deleteRole = vi.mocked(api.deleteRole);
const reorderRoles = vi.mocked(api.reorderRoles);
const getDrift = vi.mocked(api.getDrift);
const restoreDrift = vi.mocked(api.restoreDrift);
const adoptDrift = vi.mocked(api.adoptDrift);

function renderEn(): void {
  render(
    <LocaleProvider initialLocale="en" storage={null}>
      <RolesScreen />
    </LocaleProvider>,
  );
}

function inputOf(testId: string): HTMLInputElement {
  const element = screen.getByTestId(testId);
  if (element instanceof HTMLInputElement) return element;
  const inner = element.querySelector("input");
  if (!inner) throw new Error(`${testId} has no input`);
  return inner;
}

function type(testId: string, value: string): void {
  fireEvent.change(inputOf(testId), { target: { value } });
}

/** 画面全体に日本語が残っていないこと（利用者のデータを除く）。 */
function expectNoJapanese(root: Element = document.body): void {
  expect(root.textContent ?? "").not.toMatch(/[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/);
}

beforeEach(() => {
  listRoles.mockReset();
  createRole.mockReset();
  updateRoleFields.mockReset();
  updateRoleColor.mockReset();
  getConfig.mockReset();
  deleteRole.mockReset();
  reorderRoles.mockReset();
  getDrift.mockReset();
  restoreDrift.mockReset();
  adoptDrift.mockReset();
  listRoles.mockResolvedValue({ roles: [deploy, audit] });
  getConfig.mockResolvedValue({ managedTagKey: "rolust:managed", managedTagValue: "true" });
});

afterEach(cleanup);

describe("行の「Unregister」は折り返さない（Issue #229）", () => {
  // 日本語側（RolesScreen.test.tsx）と同じ下限。英語の「Unregister」は 112px で 2 行になり、120px で 1 行に収まった。
  const MEASURED_LOWER_BOUND_PX = 120;

  /**
   * 「Actions」列の見出し（`th`）の最小幅（px）。見出しは 2 組ある（先頭は `stickyHeader` の複製で `width` だけ）ので、
   * 列の幅を決める実体の表（最後）を見る。
   */
  function actionsMinWidth(): number {
    const header = [...screen.getByTestId("roles-table").querySelectorAll("th")]
      .filter((th) => th.textContent?.includes("Actions"))
      .at(-1);
    expect(header).toBeDefined();
    return Number.parseInt((header as HTMLElement).style.minWidth, 10);
  }

  it("「Actions」列は、「Unregister」が 1 行に収まる最小幅を持つ", async () => {
    renderEn();
    await screen.findByTestId(`delete-role-${deploy.arn}`);

    expect(actionsMinWidth()).toBeGreaterThanOrEqual(MEASURED_LOWER_BOUND_PX);
  });

  it("並び順の編集モード（「Move」列が加わる）でも、同じ最小幅を持つ", async () => {
    renderEn();
    fireEvent.click(await screen.findByTestId("roles-order-start"));
    await screen.findByTestId("roles-order-bar");

    expect(actionsMinWidth()).toBeGreaterThanOrEqual(MEASURED_LOWER_BOUND_PX);
  });
});

describe("画面 2 の英語の表示（Issue #94）", () => {
  it("乖離の確認のボタンの「i」と説明が英語になる（Issue #206。Issue #232 で、押したときだけ出す形に変えた）", async () => {
    renderEn();
    await screen.findByText("RolustManaged-DeployProd");

    expect(screen.queryByTestId("roles-drift-caption")).toBeNull();
    const help = screen.getByRole("button", { name: "About Check trust policies" });
    expectNoJapanese(help);
    fireEvent.click(help);
    const caption = await screen.findByTestId("roles-drift-caption");
    expect(caption.textContent).toBe(
      '"Check trust policies" reads the trust policies on AWS and compares them with Rolust\'s records (reflected assignments). ' +
        "It never modifies AWS. If they differ, you can choose how to fix it from the details.",
    );
    expectNoJapanese(caption);
  });

  it("乖離の確認のボタン・列・サマリ・詳細が英語になる（Issue #170）", async () => {
    const views: TrustDriftView[] = [
      { roleArn: deploy.arn, status: "match", missing: [], extra: [], unmanaged: [], readError: null },
      {
        roleArn: audit.arn,
        status: "drift",
        missing: ["arn:aws:iam::111122223333:user/ayaka.mori"],
        extra: [],
        unmanaged: [],
        readError: null,
      },
    ];
    getDrift.mockResolvedValue({ checkedAt: "2026-10-15T11:41:00.000Z", roles: views });
    renderEn();
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId("roles-drift-check"));

    await waitFor(() => expect(screen.getByTestId(`role-drift-${deploy.arn}`).textContent).toBe("✓ Matches"));
    expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toContain("! 1 difference");
    expect(screen.getByTestId("drift-summary").textContent).toContain("1 of 2 roles differ from Rolust's records");

    fireEvent.click(screen.getByTestId(`role-drift-detail-${audit.arn}`));
    const modal = await screen.findByTestId("drift-detail-modal");
    expect(modal.textContent).toContain("Recorded by Rolust as able to assume the role, but missing from IAM");
    expect(modal.textContent).toContain("arn:aws:iam::111122223333:user/ayaka.mori");
    expect(modal.textContent).toContain("None"); // 余分は 0 件
    expectNoJapanese(modal);
    expectNoJapanese(screen.getByTestId("drift-summary"));
  });

  it("乖離を直す操作・確認・結果が英語になる（Issue #172）", async () => {
    const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
    const BOB = "arn:aws:iam::111122223333:user/bob";
    getDrift.mockResolvedValue({
      checkedAt: "2026-10-15T11:41:00.000Z",
      roles: [
        { roleArn: deploy.arn, status: "match", missing: [], extra: [], unmanaged: [], readError: null },
        { roleArn: audit.arn, status: "drift", missing: [AYAKA], extra: [BOB], unmanaged: [], readError: null },
      ],
    });
    renderEn();
    await screen.findByText("RolustManaged-DeployProd");
    fireEvent.click(screen.getByTestId("roles-drift-check"));
    await waitFor(() => expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toContain("! 2 differences"));
    fireEvent.click(screen.getByTestId(`role-drift-detail-${audit.arn}`));

    const modal = await screen.findByTestId("drift-detail-modal");
    expect(screen.getByTestId("drift-restore").textContent).toContain("Make IAM match the records");
    expect(screen.getByTestId("drift-adopt").textContent).toContain("Make the records match IAM");
    expect(modal.textContent).toContain("Treats Rolust's records as correct and restores the IAM trust policy");
    expectNoJapanese(modal);

    const adopt = screen.getByTestId("drift-adopt");
    fireEvent.click(adopt.querySelector("button") ?? adopt);
    const confirm = await screen.findByTestId("drift-adopt-confirm");
    expect(confirm.textContent).toContain("Add to the records (present in IAM)");
    expect(confirm.textContent).toContain("Remove from the records (not in IAM)");
    expect(confirm.textContent).toContain("Unapplied edits (checkbox changes) for these users will be overwritten.");
    expect(confirm.textContent).toContain(BOB);
    expect(confirm.textContent).toContain(AYAKA);
    expectNoJapanese(confirm);

    adoptDrift.mockResolvedValue({
      outcome: "adopted",
      changeRequest: { changeRequestId: "cr-0201", addUserArns: [BOB], removeUserArns: [AYAKA] } as ChangeRequest,
      exclusion: null,
      failures: [],
    });
    const run = screen.getByTestId("drift-adopt-confirm-run");
    fireEvent.click(run.querySelector("button") ?? run);

    await waitFor(() => expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toBe("Recheck needed"));
    expect(await screen.findByText(/Updated the records for 2 items\. AWS was not modified/)).toBeTruthy();
    expect(screen.getByTestId("drift-summary")).toBeTruthy();
  });

  it("乖離を直す操作のエラー・除外・一部失敗が英語になる（Issue #172）", async () => {
    const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
    getDrift.mockResolvedValue({
      checkedAt: "2026-10-15T11:41:00.000Z",
      roles: [{ roleArn: audit.arn, status: "drift", missing: [AYAKA], extra: [], unmanaged: [], readError: null }],
    });
    renderEn();
    await screen.findByText("RolustManaged-DeployProd");
    fireEvent.click(screen.getByTestId("roles-drift-check"));
    await waitFor(() => expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toContain("! 1 difference"));
    fireEvent.click(screen.getByTestId(`role-drift-detail-${audit.arn}`));
    await screen.findByTestId("drift-detail-modal");
    const restore = screen.getByTestId("drift-restore");

    restoreDrift.mockResolvedValueOnce({
      outcome: "excluded",
      changeRequest: null,
      exclusion: { reason: "draft", changeRequestId: "cr-0142" },
      failures: [],
    });
    fireEvent.click(restore.querySelector("button") ?? restore);
    expect((await screen.findByTestId("drift-repair-notice")).textContent).toBe(
      "Cannot run because there is an unapplied request (draft: cr-0142). Apply or discard it in the request history, then try again.",
    );

    restoreDrift.mockRejectedValueOnce(
      new ApiClientError(403, {
        code: "Forbidden",
        message: "権限がありません",
        localized: { id: "auth.forbidden", params: { need: "edit" } },
      }),
    );
    fireEvent.click(restore.querySelector("button") ?? restore);
    const error = await screen.findByTestId("drift-repair-error");
    expect(error.textContent).toContain("Could not repair the differences");
    expect(error.textContent).toContain('This action requires the "edit" permission');
    expect(error.textContent).toContain("Error code");
    expect(error.textContent).toContain("Forbidden");

    adoptDrift.mockResolvedValueOnce({
      outcome: "adopted",
      changeRequest: null,
      exclusion: null,
      failures: [{ userArn: AYAKA, message: "失敗しました" }],
    });
    const adopt = screen.getByTestId("drift-adopt");
    fireEvent.click(adopt.querySelector("button") ?? adopt);
    await screen.findByTestId("drift-adopt-confirm");
    const run = screen.getByTestId("drift-adopt-confirm-run");
    fireEvent.click(run.querySelector("button") ?? run);
    const partial = await screen.findByTestId("drift-repair-partial");
    expect(partial.textContent).toContain("Some records could not be updated");
    expect(partial.textContent).toContain("Run it again to fix the rest.");
    expect(partial.textContent).toContain(AYAKA);
  });

  it("見出し・件数・主操作・表の見出しが英語になる", async () => {
    renderEn();
    expect(screen.getByRole("heading", { level: 1, name: "IAM roles" })).toBeTruthy();
    expect(screen.getByTestId("page-heading-counts").textContent).toBe("IAM roles — / AWS accounts —");

    await screen.findByText("RolustManaged-DeployProd");
    expect(screen.getByTestId("page-heading-counts").textContent).toBe("IAM roles 2 / AWS accounts 1");
    expect(screen.getByTestId("create-role-button").textContent).toBe("Register new role");
    expect(screen.getByTestId("roles-order-start").textContent).toBe("Edit order");
    expect(screen.getByTestId("roles-drift-check").textContent).toBe("Check trust policies");

    const headers = [...(screen.getByTestId("roles-table").querySelector("thead tr")?.querySelectorAll("th") ?? [])].map(
      (th) => th.textContent?.trim() ?? "",
    );
    expect(headers).toEqual([
      "Order",
      "AWS account",
      "IAM role name",
      "Display name",
      "Unapplied request",
      "Trust policy",
      "Description",
      "Background color",
      "Actions",
    ]);
    expect(screen.getByTestId(`role-unreflected-${audit.arn}`).textContent).toContain("Draft");
    expect(screen.getByTestId(`role-color-${deploy.arn}`).textContent).toBe("Blue");
    expect(screen.getByTestId(`edit-role-description-${deploy.arn}`).textContent).toBe("Edit");
    expect(screen.getByTestId(`delete-role-${deploy.arn}`).textContent).toBe("Unregister");
    expect(screen.getByRole("button", { name: `Edit the display name and description of ${deploy.roleName}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Edit the background color of ${deploy.roleName}` })).toBeTruthy();
    expect(screen.getByRole("button", { name: `Unregister ${deploy.roleName}` })).toBeTruthy();
    expectNoJapanese();
  });

  it("0 件の案内が英語になる", async () => {
    listRoles.mockResolvedValue({ roles: [] });
    renderEn();
    const empty = await screen.findByTestId("roles-empty");
    expect(empty.textContent).toContain("No IAM roles are registered yet");
    expect(empty.textContent).toContain("Register an IAM role first");
    expect(screen.getByTestId("roles-empty-create").textContent).toBe("Register new role");
    expect(screen.getByTestId("roles-empty-to-matrix").textContent).toBe("Go to Role assignments");
    expectNoJapanese();
  });

  it("読み込みの失敗は localized を英語に描画し、見出しも英語になる", async () => {
    listRoles.mockRejectedValue(
      new ApiClientError(404, {
        code: "NotFound",
        message: "ロールは登録されていません",
        localized: { id: "role.notRegistered", params: { roleArn: deploy.arn } },
      }),
    );
    renderEn();
    const panel = await screen.findByTestId("roles-error");
    expect(panel.textContent).toContain("Could not load the IAM roles");
    expect(panel.textContent).toContain(`The IAM role is not registered: ${deploy.arn}`);
    expectNoJapanese(panel);
  });

  describe("並び順の編集モード", () => {
    async function startEditing(): Promise<void> {
      listRoles.mockResolvedValue({ roles: [audit, deploy] });
      reorderRoles.mockResolvedValue({ roleArns: [deploy.arn, audit.arn] });
      renderEn();
      await screen.findByTestId(`role-position-${audit.arn}`);
      fireEvent.click(screen.getByTestId("roles-order-start"));
      await screen.findByTestId("roles-order-bar");
    }

    it("バー・移動・保存・読み上げが英語になる", async () => {
      await startEditing();
      expect(screen.getByTestId("roles-order-bar").textContent).toContain("Editing order");
      expect(screen.getByTestId("roles-order-bar").textContent).toContain("0 changes");
      expect(screen.getByTestId("roles-order-cancel").textContent).toBe("Cancel");
      expect(screen.getByTestId("roles-order-save").textContent).toBe("Save (0 changes)");
      expect(screen.getByRole("button", { name: `Move ${audit.roleName} down` })).toBeTruthy();
      expect(screen.getByRole("button", { name: `Move ${deploy.roleName} up` })).toBeTruthy();

      fireEvent.click(screen.getByTestId(`role-move-down-${audit.arn}`));
      expect(screen.getByTestId("roles-order-live").textContent).toBe(`Moved ${audit.roleName} to position 2`);
      expect(screen.getByTestId("roles-order-bar").textContent).toContain("2 changes");
      expect(screen.getByTestId("roles-order-save").textContent).toBe("Save (2 changes)");
      expectNoJapanese();
    });

    it("保存の成功通知と、失敗（localized）が英語になる", async () => {
      await startEditing();
      fireEvent.click(screen.getByTestId(`role-move-down-${audit.arn}`));

      reorderRoles.mockRejectedValueOnce(
        new ApiClientError(409, {
          code: "Conflict",
          message: "ロールは登録されていません",
          localized: { id: "role.notRegistered", params: { roleArn: audit.arn } },
        }),
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId("roles-order-save"));
        await Promise.resolve();
      });
      const error = await screen.findByTestId("roles-order-error");
      expect(error.textContent).toContain(`The IAM role is not registered: ${audit.arn}`);
      expectNoJapanese(error);

      await act(async () => {
        fireEvent.click(screen.getByTestId("roles-order-save"));
        await Promise.resolve();
      });
      await screen.findByText("Saved the order of IAM roles (2 changes)");
    });

    it("破棄の確認が英語になる（キャンセルと画面遷移）", async () => {
      await startEditing();
      fireEvent.click(screen.getByTestId(`role-move-down-${audit.arn}`));

      fireEvent.click(screen.getByTestId("roles-order-cancel"));
      const modal = await screen.findByTestId("roles-order-discard-modal");
      expect(modal.textContent).toContain("Discard your input?");
      expect(modal.textContent).toContain("You have 2 unsaved changes. This cannot be undone once discarded.");
      expect(screen.getByTestId("roles-order-discard-back").textContent).toBe("Back to editing");
      expect(screen.getByTestId("roles-order-discard-confirm").textContent).toBe("Discard");
      expectNoJapanese(modal);

      fireEvent.click(screen.getByTestId("roles-order-discard-back"));
      act(() => navigate("/matrix"));
      const nav = await screen.findByTestId("roles-order-discard-modal");
      expect(nav.textContent).toContain("You tried to go to another screen.");
      expect(screen.getByTestId("roles-order-discard-confirm").textContent).toBe("Discard and leave");
      fireEvent.click(screen.getByTestId("roles-order-discard-back"));
      window.history.replaceState({}, "", "/");
    });
  });

  describe("登録", () => {
    async function openCreateModal(): Promise<void> {
      renderEn();
      fireEvent.click(await screen.findByTestId("create-role-button"));
      await screen.findByTestId("create-role-name");
    }

    async function submitNew(imported: { userCount: number; registeredCount: number; skippedCount: number }): Promise<void> {
      createRole.mockResolvedValue({
        role: role("NewRole"),
        imported: { roleArn: buildRoleArn(ACCOUNT, "NewRole"), ...imported },
      });
      await openCreateModal();
      type("create-role-account-id", ACCOUNT);
      type("create-role-name", "NewRole");
      await act(async () => {
        fireEvent.click(screen.getByTestId("create-role-submit"));
        await Promise.resolve();
      });
    }

    it("モーダルの見出し・項目・案内・タグ要件が英語になる", async () => {
      await openCreateModal();
      const modal = screen.getByTestId("create-role-modal");
      expect(modal.textContent).toContain("Register new IAM role");
      expect(modal.textContent).toContain("AWS account ID");
      expect(modal.textContent).toContain("docs/guide/cross-account.md");
      expect(modal.textContent).toContain("rolust:managed = true");
      expect(modal.textContent).toContain("aws iam tag-role --role-name <name> --tags Key=rolust:managed,Value=true");
      expect(modal.textContent).toContain("Derived ARN");
      expect(screen.getByTestId("create-role-link-note").textContent).toContain("last column of the role assignments");
      expect(modal.textContent).toContain("Optional. Up to 32 characters.");
      expect(screen.getByTestId("create-role-cancel").textContent).toBe("Cancel");
      expect(screen.getByTestId("create-role-submit").textContent).toBe("Register");
      expectNoJapanese(modal);
    });

    it("入力の検証メッセージが英語になる", async () => {
      await openCreateModal();
      fireEvent.click(screen.getByTestId("create-role-submit"));
      const modal = screen.getByTestId("create-role-modal");
      expect(modal.textContent).toContain("AWS account ID is required");
      expect(modal.textContent).toContain("IAM role name is required");

      type("create-role-account-id", "12");
      type("create-role-name", "bad/name");
      type("create-role-display-name-input", "x".repeat(40));
      fireEvent.click(screen.getByTestId("create-role-submit"));
      expect(modal.textContent).toContain("AWS account ID must be 12 digits");
      expect(modal.textContent).toContain("IAM role name contains characters that are not allowed: bad/name");
      expectNoJapanese(modal);
    });

    it("成功通知は、取り込み件数と新規登録件数を英語で添える", async () => {
      await submitNew({ userCount: 3, registeredCount: 1, skippedCount: 0 });
      await screen.findByText(
        `IAM role ${buildRoleArn(ACCOUNT, "NewRole")} registered (imported 3 IAM users from its trust policy; 1 new)`,
      );
    });

    it("成功通知の単数形と、取り込みが無い場合", async () => {
      await submitNew({ userCount: 1, registeredCount: 0, skippedCount: 0 });
      await screen.findByText(
        `IAM role ${buildRoleArn(ACCOUNT, "NewRole")} registered (imported 1 IAM user from its trust policy; 0 new)`,
      );
      cleanup();
      await submitNew({ userCount: 0, registeredCount: 0, skippedCount: 0 });
      await screen.findByText(`IAM role ${buildRoleArn(ACCOUNT, "NewRole")} registered.`);
    });

    it("許可リストに無いアカウントのユーザを取り込まなかった旨が、単数・複数で英語になる", async () => {
      await submitNew({ userCount: 3, registeredCount: 1, skippedCount: 2 });
      await screen.findByText(
        `IAM role ${buildRoleArn(ACCOUNT, "NewRole")} registered (imported 3 IAM users from its trust policy; 1 new). ` +
          "2 IAM users in accounts not on the allow list were not imported (they remain in the trust policy).",
      );
      cleanup();
      await submitNew({ userCount: 3, registeredCount: 1, skippedCount: 1 });
      await screen.findByText(/1 IAM user in an account not on the allow list was not imported \(it remains in the trust policy\)\./);
    });

    it("登録の失敗は localized を英語に描画する", async () => {
      createRole.mockRejectedValue(
        new ApiClientError(404, {
          code: "NotFound",
          message: "ロールは登録されていません",
          localized: { id: "role.notRegistered", params: { roleArn: deploy.arn } },
        }),
      );
      await openCreateModal();
      type("create-role-account-id", ACCOUNT);
      type("create-role-name", "NewRole");
      await act(async () => {
        fireEvent.click(screen.getByTestId("create-role-submit"));
        await Promise.resolve();
      });
      const shown = await screen.findAllByText(`The IAM role is not registered: ${deploy.arn}`);
      expect(shown.length).toBeGreaterThan(0);
    });

    it("設定を取得できないときの案内が英語になる", async () => {
      getConfig.mockRejectedValue(new Error("x"));
      await openCreateModal();
      await waitFor(() => expect(getConfig).toHaveBeenCalled());
      expect(screen.getByTestId("create-role-modal").textContent).toContain(
        "Whether the role exists in AWS is checked when you register it.",
      );
    });
  });

  describe("編集", () => {
    it("表示名と説明のモーダル・通知・重複の検証が英語になる", async () => {
      renderEn();
      await screen.findByText("RolustManaged-DeployProd");
      fireEvent.click(screen.getByTestId(`edit-role-description-${deploy.arn}`));
      await screen.findByTestId("edit-role-description-input");
      const modal = screen.getByTestId("edit-role-description-modal");
      expect(modal.textContent).toContain("Edit display name and description");
      expect(modal.textContent).toContain(
        "Optional. Up to 32 characters. Used as the column name in Role assignments. The IAM role name does not change.",
      );
      expect(screen.getByTestId("edit-role-description-cancel").textContent).toBe("Cancel");
      expect(screen.getByTestId("edit-role-description-submit").textContent).toBe("Save");

      type("edit-role-display-name-input", "x".repeat(40));
      fireEvent.blur(inputOf("edit-role-display-name-input"));
      expectNoJapanese(modal);

      type("edit-role-display-name-input", "Prod");
      updateRoleFields.mockResolvedValue({ role: { ...role(deploy.roleName), displayName: "Prod" } });
      await act(async () => {
        fireEvent.click(screen.getByTestId("edit-role-description-submit"));
        await Promise.resolve();
      });
      await screen.findByText(`Saved the display name and description of ${deploy.roleName}`);
    });

    it("表示名の重複（409）は localized を英語に描画する", async () => {
      renderEn();
      await screen.findByText("RolustManaged-DeployProd");
      fireEvent.click(screen.getByTestId(`edit-role-description-${deploy.arn}`));
      await screen.findByTestId("edit-role-description-input");
      type("edit-role-display-name-input", "dup");
      updateRoleFields.mockRejectedValue(
        new ApiClientError(409, {
          code: "Conflict",
          message: "ロールは登録されていません",
          localized: { id: "role.notRegistered", params: { roleArn: deploy.arn } },
        }),
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId("edit-role-description-submit"));
        await Promise.resolve();
      });
      const shown = await screen.findAllByText(`The IAM role is not registered: ${deploy.arn}`);
      expect(shown.length).toBeGreaterThan(0);
    });

    it("背景色のモーダル・色名・通知が英語になる", async () => {
      renderEn();
      await screen.findByText("RolustManaged-DeployProd");
      fireEvent.click(screen.getByTestId(`edit-role-color-${deploy.arn}`));
      await screen.findByTestId("edit-role-color-tiles");
      const modal = screen.getByTestId("edit-role-color-modal");
      expect(modal.textContent).toContain("Edit background color");
      expect(modal.textContent).toContain("The color applied to this IAM role's column in the matrix.");
      expect(screen.getAllByRole("radio")).toHaveLength(9);
      for (const name of ["None", "Red", "Orange", "Yellow", "Green", "Teal", "Blue", "Purple", "Pink"]) {
        expect(screen.getByRole("radio", { name })).toBeTruthy();
      }
      expectNoJapanese(modal);

      updateRoleColor.mockResolvedValue({ role: { ...role(deploy.roleName), color: "red" } });
      fireEvent.click(screen.getByRole("radio", { name: "Red" }));
      await act(async () => {
        fireEvent.click(screen.getByTestId("edit-role-color-submit"));
        await Promise.resolve();
      });
      await screen.findByText(`Saved the background color of ${deploy.roleName}`);
    });
  });

  describe("登録の解除", () => {
    async function openDelete(target: RoleView): Promise<HTMLElement> {
      listRoles.mockResolvedValue({ roles: [target] });
      renderEn();
      fireEvent.click(await screen.findByTestId(`delete-role-${target.arn}`));
      return screen.getByTestId("delete-role-modal");
    }

    it("未反映の申請があるときは解除できない理由と直し方が英語になる", async () => {
      const modal = await openDelete(audit);
      expect(modal.textContent).toContain("Cannot unregister the IAM role");
      const blockers = screen.getByTestId("delete-role-blockers");
      expect(blockers.textContent).toContain(`${audit.roleName} cannot be unregistered.`);
      expect(blockers.textContent).toContain("There is an unapplied request (Draft). Apply or discard it in the request history.");
      expect(screen.getByTestId("delete-role-to-history").textContent).toBe("Open in request history");
      expect(screen.getByTestId("delete-role-cancel").textContent).toBe("Close");
      expectNoJapanese(modal);
    });

    it("残る割り当ての件数が、単数・複数で英語になる", async () => {
      const many = await openDelete({ ...deploy, assignments: { total: 6, pending: 2 } });
      expect(screen.getByTestId("delete-role-assignments").textContent).toContain(
        "6 assignments remain (including 2 unapplied changes).",
      );
      expect(screen.getByTestId("delete-role-confirm").textContent).toBe("Unregister with its assignments");
      expect(many.textContent).toContain("Unregister the IAM role?");
      expectNoJapanese(many);
      cleanup();

      await openDelete({ ...deploy, assignments: { total: 1, pending: 1 } });
      expect(screen.getByTestId("delete-role-assignments").textContent).toContain(
        "1 assignment remains (including 1 unapplied change).",
      );
    });

    it("確認の本文・失敗（localized）・完了通知が英語になる", async () => {
      const modal = await openDelete(deploy);
      expect(modal.textContent).toContain(`${deploy.roleName} (${deploy.arn}) will be unregistered.`);
      expect(modal.textContent).toContain("are not touched");
      expect(screen.getByTestId("delete-role-cancel").textContent).toBe("Cancel");
      expect(screen.getByTestId("delete-role-confirm").textContent).toBe("Unregister");
      expectNoJapanese(modal);

      deleteRole.mockRejectedValueOnce(
        new ApiClientError(409, {
          code: "Conflict",
          message: "ロールは登録されていません",
          localized: { id: "role.notRegistered", params: { roleArn: deploy.arn } },
        }),
      );
      await act(async () => {
        fireEvent.click(screen.getByTestId("delete-role-confirm"));
        await Promise.resolve();
      });
      const error = await screen.findByTestId("delete-role-error");
      expect(error.textContent).toContain(`The IAM role is not registered: ${deploy.arn}`);
      expectNoJapanese(error);

      deleteRole.mockResolvedValue({ roleArn: deploy.arn, removedAssignments: 0 });
      await act(async () => {
        fireEvent.click(screen.getByTestId("delete-role-confirm"));
        await Promise.resolve();
      });
      await screen.findByText(`Unregistered IAM role ${deploy.roleName}`);
    });
  });
});
