// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChangeRequest, DriftResponse, IamRole, RepairResponse, RoleView, TrustDriftView } from "@rolust/core";
import { buildRoleArn } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { navigate } from "../router.js";
import { RolesScreen } from "./RolesScreen.js";

/**
 * 画面 2（FR-7.2）のユニットテスト。
 *
 * 主目的は、登録モーダルが**管理対象タグの要件を提示すること**（GI-1 / 質問 10 = A）と、
 * `GuardedModal` へ正しい `dirty` を渡していること（GI-4）である。
 * Step 17-A の blur 事前検証は Step 18-C で撤去した。タグは AWS 上のロールにしか
 * 存在せず、画面が持っている情報だけでは判定できないためである。
 * `GuardedModal` 単体のテストは分岐の中身を固定しているが、各画面が正しい `dirty` を
 * 渡しているかは未検証だった。画面単位テストはその隙間を埋める。
 *
 * `api-client` だけを差し替え、画面・フック・Cloudscape は本物を通す。Cloudscape を
 * モックすると `FormField` の `errorText` 表示という検証対象そのものが消える。
 */

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

const TAG_KEY = "rolust:managed";
const TAG_VALUE = "true";
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
  ...role("RolustManaged-DeployProd", "本番デプロイ用"),
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
const getDrift = vi.mocked(api.getDrift);
const adoptDrift = vi.mocked(api.adoptDrift);

/** Cloudscape の `Input` は根要素に data-testid を載せる。内側の native input を返す。 */
function inputOf(testId: string): HTMLInputElement {
  const element = screen.getByTestId(testId);
  if (element instanceof HTMLInputElement) return element;
  const inner = element.querySelector("input");
  if (!inner) throw new Error(`${testId} の内側に input がありません`);
  return inner;
}

function type(testId: string, value: string): void {
  fireEvent.change(inputOf(testId), { target: { value } });
}

/** 一覧の描画を待ってから登録モーダルを開く。 */
async function openCreateModal(): Promise<void> {
  render(<RolesScreen />);
  fireEvent.click(await screen.findByTestId("create-role-button"));
  await screen.findByTestId("create-role-name");
}

beforeEach(() => {
  getDrift.mockReset();
  adoptDrift.mockReset();
  listRoles.mockResolvedValue({ roles: [deploy, audit] });
  getConfig.mockResolvedValue({ managedTagKey: TAG_KEY, managedTagValue: TAG_VALUE });
  createRole.mockResolvedValue({
    role: role("NewRole"),
    imported: { roleArn: buildRoleArn(ACCOUNT, "NewRole"), userCount: 0, registeredCount: 0, skippedCount: 0 },
  });
});

afterEach(cleanup);

describe("見出し行（Issue #155）", () => {
  it("見出しと件数は同じ行にある", async () => {
    render(<RolesScreen />);
    const heading = screen.getByRole("heading", { level: 1, name: "IAMロール管理" });
    const counts = await screen.findByTestId("page-heading-counts");
    expect((counts.parentElement as HTMLElement).contains(heading)).toBe(true);
  });
});

describe("IAMロール一覧（FR-7.2）", () => {
  it("登録済みロールと「未反映の申請」列を描画する", async () => {
    render(<RolesScreen />);

    await screen.findByText("RolustManaged-DeployProd");
    expect(screen.getByText("RolustManaged-ReadOnlyAudit")).toBeTruthy();

    // 未反映申請を持つロールだけが状態チップを持ち、持たない側は「—」になる。
    expect(screen.getByTestId(`role-unreflected-${audit.arn}`).textContent).toContain(
      "下書き",
    );
    expect(screen.getByTestId(`role-unreflected-${deploy.arn}`).textContent).toBe("—");
  });
});

describe("表のヘッダ行の固定（Issue #133）", () => {
  it("一覧の列ヘッダ行は、スクロールしても固定される", async () => {
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    const table = screen.getByTestId("roles-table");
    expect(table.querySelector('[class*="header-secondary"]')).not.toBeNull();
  });
});

describe("行の「登録を解除」は折り返さない（Issue #229）", () => {
  // 折り返しの有無は jsdom では測れない。実ブラウザ（幅 1024px）で測った下限を、列の最小幅が割らないことを確かめる。
  // 112px だと英語の「Unregister」が 2 行になり、120px で日本語・英語とも 1 行に収まった。
  // IAMユーザの表（Issue #15）のように `white-space: nowrap` の要素で包んでも効かない。Cloudscape のボタンは
  // 自身が `white-space: normal` を持つため、親の指定を継承しない。
  const MEASURED_LOWER_BOUND_PX = 120;

  /**
   * 「操作」列の見出し（`th`）の最小幅（px）。見出しは 2 組ある（先頭は `stickyHeader` の複製で `width` だけ）ので、
   * 列の幅を決める実体の表（最後）を見る。
   */
  function actionsMinWidth(): number {
    const header = [...screen.getByTestId("roles-table").querySelectorAll("th")]
      .filter((th) => th.textContent?.includes("操作"))
      .at(-1);
    expect(header).toBeDefined();
    return Number.parseInt((header as HTMLElement).style.minWidth, 10);
  }

  it("「操作」列は、「登録を解除」が 1 行に収まる最小幅を持つ", async () => {
    render(<RolesScreen />);
    await screen.findByTestId(`delete-role-${deploy.arn}`);

    expect(actionsMinWidth()).toBeGreaterThanOrEqual(MEASURED_LOWER_BOUND_PX);
  });

  it("並び順の編集モード（「移動」列が加わる）でも、同じ最小幅を持つ", async () => {
    render(<RolesScreen />);
    fireEvent.click(await screen.findByTestId("roles-order-start"));
    await screen.findByTestId("roles-order-bar");

    expect(actionsMinWidth()).toBeGreaterThanOrEqual(MEASURED_LOWER_BOUND_PX);
  });
});

describe("IAMロールの説明（Issue #21）", () => {
  it("説明があれば表示し、無ければ「—」を出す", async () => {
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    expect(screen.getByTestId(`role-description-${deploy.arn}`).textContent).toBe(
      "本番デプロイ用",
    );
    expect(screen.getByTestId(`role-description-${audit.arn}`).textContent).toBe("—");
  });

  it("「編集」から説明を編集モーダルを開き、保存すると通知して再取得する", async () => {
    updateRoleFields.mockResolvedValue({
      role: role("RolustManaged-DeployProd", "新しい説明"),
    });
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId(`edit-role-description-${deploy.arn}`));
    await screen.findByTestId("edit-role-description-input");

    type("edit-role-description-input", "新しい説明");
    fireEvent.click(screen.getByTestId("edit-role-description-submit"));

    await waitFor(() => {
      expect(updateRoleFields).toHaveBeenCalledWith(deploy.arn, { description: "新しい説明" });
    });
    await screen.findByText(/説明を保存しました/);
    await waitFor(() => expect(listRoles).toHaveBeenCalledTimes(2));
  });

  it("表示名だけを保存しても、表示名と説明を保存した通知を出して再取得する（Issue #150）", async () => {
    updateRoleFields.mockResolvedValue({
      role: { ...role("RolustManaged-DeployProd", "本番デプロイ用"), displayName: "本番デプロイ" },
    });
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId(`edit-role-description-${deploy.arn}`));
    await screen.findByTestId("edit-role-display-name-input");

    type("edit-role-display-name-input", "本番デプロイ");
    fireEvent.click(screen.getByTestId("edit-role-description-submit"));

    await waitFor(() => {
      expect(updateRoleFields).toHaveBeenCalledWith(deploy.arn, { displayName: "本番デプロイ" });
    });
    await screen.findByText("RolustManaged-DeployProd の表示名と説明を保存しました");
    await waitFor(() => expect(listRoles).toHaveBeenCalledTimes(2));
  });
});

describe("IAMロールの背景色（Issue #100）", () => {
  it("色があれば見本と色名を出し、無ければ「—」を出す", async () => {
    listRoles.mockResolvedValue({ roles: [{ ...deploy, color: "blue" }, audit] });
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    expect(screen.getByTestId(`role-color-${deploy.arn}`).textContent).toBe("青");
    expect(screen.getByTestId(`role-color-${audit.arn}`).textContent).toBe("—");
  });

  it("「編集」から編集モーダルを開き、保存すると通知して再取得する", async () => {
    updateRoleColor.mockResolvedValue({
      role: { ...role("RolustManaged-DeployProd", "本番デプロイ用"), color: "red" },
    });
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId(`edit-role-color-${deploy.arn}`));
    await screen.findByTestId("edit-role-color-tiles");

    fireEvent.click(screen.getByRole("radio", { name: /赤/ }));
    fireEvent.click(screen.getByTestId("edit-role-color-submit"));

    await waitFor(() => {
      expect(updateRoleColor).toHaveBeenCalledWith(deploy.arn, "red");
    });
    await screen.findByText("RolustManaged-DeployProd の背景色を保存しました");
    await waitFor(() => expect(listRoles).toHaveBeenCalledTimes(2));
  });
});

describe("管理対象タグの要件提示（GI-1 / 質問 10 = A）", () => {
  it("登録モーダルに必要なタグのキーと値、および付け方を出す", async () => {
    await openCreateModal();
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalled();
    });

    await screen.findByText(new RegExp(`${TAG_KEY} = ${TAG_VALUE}`));
    // 対処に直結する情報を隠さない（GI-6）。
    expect(screen.getByText(/aws iam tag-role/)).toBeTruthy();
  });

  it("ロール名は管理対象かどうかを決めない（接頭辞方式との違い）", async () => {
    await openCreateModal();
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalled();
    });

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "any-legacy-name");
    fireEvent.blur(inputOf("create-role-name"));

    // 画面はタグを判定できないので、名前を理由に送信を止めてはならない。
    fireEvent.click(screen.getByTestId("create-role-submit"));
    await waitFor(() => {
      expect(createRole).toHaveBeenCalledWith({
        accountId: ACCOUNT,
        roleName: "any-legacy-name",
      });
    });
    // 登録＝紐づけ（Issue #135）。「ロールの紐づけ」で紐づけるよう案内しない。
    const notice = await screen.findByText(/を登録しました。/);
    expect(notice.textContent).not.toContain("紐づけ");
  });

  it("登録の成功通知に、信頼ポリシーから取り込んだ IAMユーザの件数を添える（Issue #135）", async () => {
    createRole.mockResolvedValue({
      role: role("NewRole"),
      imported: { roleArn: buildRoleArn(ACCOUNT, "NewRole"), userCount: 3, registeredCount: 1, skippedCount: 0 },
    });
    await openCreateModal();

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "NewRole");
    fireEvent.click(screen.getByTestId("create-role-submit"));

    await screen.findByText(
      `IAMロール ${buildRoleArn(ACCOUNT, "NewRole")} を登録しました（信頼ポリシーから IAMユーザ 3 件を取り込みました。新規登録 1 件）`,
    );
  });

  it("許可リストに無いアカウントのため取り込まなかった IAMユーザがいれば、件数と理由を成功通知に添える（Issue #139）", async () => {
    createRole.mockResolvedValue({
      role: role("NewRole"),
      imported: { roleArn: buildRoleArn(ACCOUNT, "NewRole"), userCount: 3, registeredCount: 1, skippedCount: 2 },
    });
    await openCreateModal();

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "NewRole");
    fireEvent.click(screen.getByTestId("create-role-submit"));

    await screen.findByText(
      `IAMロール ${buildRoleArn(ACCOUNT, "NewRole")} を登録しました（信頼ポリシーから IAMユーザ 3 件を取り込みました。新規登録 1 件）` +
        "。許可リストに無いアカウントの IAMユーザ 2 件は取り込んでいません（信頼ポリシーには残ります）。",
    );
  });

  it("登録モーダルに、登録するとマトリクスの末尾の列になり、信頼ポリシーの IAMユーザが取り込まれることを示す", async () => {
    await openCreateModal();

    const modal = screen.getByTestId("create-role-modal");
    expect(modal.textContent).toContain("IAMロール割り当ての末尾の列になり");
    expect(modal.textContent).toContain("反映済みの割り当てとして取り込まれます");
  });

  it("設定の取得に失敗しても登録経路を塞がない（要件表示だけを諦める）", async () => {
    getConfig.mockRejectedValue(new Error("設定を取得できませんでした"));

    await openCreateModal();
    await waitFor(() => {
      expect(getConfig).toHaveBeenCalled();
    });

    expect(screen.queryByText(/aws iam tag-role/)).toBeNull();

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "ReadOnlyAudit");

    // 手当てが失敗したことを理由に、正当な登録を止めてはならない。
    fireEvent.click(screen.getByTestId("create-role-submit"));
    await waitFor(() => {
      expect(createRole).toHaveBeenCalled();
    });
  });

  it("書式が不正な名前は書式エラーとして出し、送信を止める", async () => {
    await openCreateModal();

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "Rolust/Managed");
    fireEvent.blur(inputOf("create-role-name"));

    await screen.findByText(/使えない文字が含まれています/);

    fireEvent.click(screen.getByTestId("create-role-submit"));
    await waitFor(() => {
      expect(createRole).not.toHaveBeenCalled();
    });
  });

  it("サーバがタグ不一致で 400 を返したらモーダル内に出す（判定はサーバが行う）", async () => {
    createRole.mockRejectedValue(
      Object.assign(new Error(`IAMロールに管理対象のタグ「${TAG_KEY}」が付いていません`), {
        name: "ApiClientError",
      }),
    );

    await openCreateModal();

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "ReadOnlyAudit");
    fireEvent.click(screen.getByTestId("create-role-submit"));

    // Cloudscape の `Form` は errorText を複数の要素へ描く（可視 + スクリーンリーダ用）。
    // 「1 要素であること」ではなく「利用者に見えること」を固定する。
    const shown = await screen.findAllByText(/管理対象のタグ/);
    expect(shown.length).toBeGreaterThan(0);
  });
});

describe("登録モーダルの説明欄（Issue #21）", () => {
  it("説明を入力すると正規化して送る", async () => {
    await openCreateModal();

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "ReadOnlyAudit");
    type("create-role-description", "  監査用の読み取り専用ロール  ");
    fireEvent.click(screen.getByTestId("create-role-submit"));

    await waitFor(() => {
      expect(createRole).toHaveBeenCalledWith({
        accountId: ACCOUNT,
        roleName: "ReadOnlyAudit",
        description: "監査用の読み取り専用ロール",
      });
    });
  });

  it("257 文字の説明は blur でエラーを出し、送信を止める", async () => {
    await openCreateModal();

    type("create-role-description", "a".repeat(257));
    fireEvent.blur(inputOf("create-role-description"));

    await screen.findByText("説明は 256 文字以内で入力してください");

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "ReadOnlyAudit");
    fireEvent.click(screen.getByTestId("create-role-submit"));

    await waitFor(() => {
      expect(createRole).not.toHaveBeenCalled();
    });
  });
});

describe("登録モーダルの破棄確認（GI-4）", () => {
  it("入力があるとキャンセルで破棄確認へ切り替わる（dirty = true を渡している）", async () => {
    await openCreateModal();

    type("create-role-name", "HalfTyped");
    fireEvent.click(screen.getByTestId("create-role-cancel"));

    await screen.findByTestId("create-role-modal-discard-alert");
    // フォーム本体はアンマウントされない（フォーカスと入力値を失わないため）。
    expect(inputOf("create-role-name").value).toBe("HalfTyped");
  });

  it("入力がなければキャンセルで即座に閉じる（破棄確認を出さない）", async () => {
    await openCreateModal();

    fireEvent.click(screen.getByTestId("create-role-cancel"));

    // 破棄確認は一度も現れない。
    expect(screen.queryByTestId("create-role-modal-discard-alert")).toBeNull();

    // Cloudscape の `Modal` は閉じても DOM から消えず、非表示クラスが付く。
    // したがって「消えたこと」ではなく「隠されたこと」で閉鎖を判定する。
    await waitFor(() => {
      expect(screen.getByTestId("create-role-modal").className).toMatch(/awsui_hidden/);
    });
  });
});

describe("IAMロールの削除（FR-2.4 / Issue #22）", () => {
  async function openDeleteModal(target: RoleView): Promise<HTMLElement> {
    listRoles.mockResolvedValue({ roles: [target] });
    render(<RolesScreen />);
    fireEvent.click(await screen.findByTestId(`delete-role-${target.arn}`));
    return screen.getByTestId("delete-role-modal");
  }

  it("行の「登録を解除」は、ロール名を含むラベルを持つ", async () => {
    render(<RolesScreen />);

    expect(await screen.findByRole("button", { name: `${deploy.roleName} の登録を解除` })).toBeTruthy();
  });

  it("未反映の申請があるロールは、状態と直し方を示し、「削除」を出さず、申請履歴へのリンクでその申請を開く", async () => {
    const modal = await openDeleteModal(audit);

    expect(modal.textContent).toContain("IAMロールの登録を解除できません");
    const blockers = screen.getByTestId("delete-role-blockers");
    expect(blockers.textContent).toContain("未反映の申請（下書き）があります。申請履歴で反映するか破棄してください。");
    // 紐づきは理由にならない（Issue #135。登録したロールは常に紐づく）。
    expect(blockers.textContent).not.toContain("紐づいています");
    expect(screen.queryByTestId("delete-role-to-pool")).toBeNull();
    expect(screen.queryByTestId("delete-role-confirm")).toBeNull();
    expect(screen.getByTestId("delete-role-cancel").textContent).toBe("閉じる");

    fireEvent.click(screen.getByTestId("delete-role-to-history"));
    expect(window.location.pathname).toBe("/history");
    expect(window.location.search).toContain("cr-0142");
  });

  it("割り当てが残るロールは、件数（うち未反映の変更）と、すべて消えることを示し、「割り当てごと削除」で削除する（Issue #135）", async () => {
    const modal = await openDeleteModal({ ...deploy, assignments: { total: 6, pending: 2 } });

    const alert = screen.getByTestId("delete-role-assignments");
    expect(alert.textContent).toContain("割り当てが 6 件残っています（うち未反映の変更 2 件）");
    expect(alert.textContent).toContain("解除すると、この IAMロールの割り当てもすべて消えます");
    expect(modal.textContent).toContain("IAMロールの登録を解除しますか");
    expect(screen.getByTestId("delete-role-confirm").textContent).toBe("割り当てごと登録を解除");
  });

  it("割り当てが無いロールの削除に、割り当ての警告を出さず、確定ボタンは「削除」", async () => {
    await openDeleteModal(deploy);

    expect(screen.queryByTestId("delete-role-assignments")).toBeNull();
    expect(screen.getByTestId("delete-role-confirm").textContent).toBe("登録を解除");
  });

  it("削除できるロールは、AWS に触れないことと principal の片付け方を明記し、削除すると通知して一覧を読み直す", async () => {
    const modal = await openDeleteModal(deploy);

    expect(modal.textContent).toContain("IAMロールの登録を解除しますか");
    expect(modal.textContent).toContain(deploy.arn);
    expect(modal.textContent).toContain("AWS 上の IAMロールと信頼ポリシーには触れません。");
    expect(modal.textContent).toContain("IAMロール割り当てでチェックを外して申請・反映してください。");
    expect(modal.textContent).toContain("作成済みの申請は申請履歴に残ります。同じ ARN で登録し直せます。");

    deleteRole.mockResolvedValue({ roleArn: deploy.arn, removedAssignments: 0 });
    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-role-confirm"));
      await Promise.resolve();
    });

    await screen.findByText(`IAMロール ${deploy.roleName} の登録を解除しました`);
    expect(deleteRole).toHaveBeenCalledWith(deploy.arn);
    await waitFor(() => {
      expect(listRoles).toHaveBeenCalledTimes(2);
    });
  });

  it("拒否（409）や失敗ではモーダルを閉じずにエラーを出す", async () => {
    await openDeleteModal(deploy);
    deleteRole.mockRejectedValue(
      new Error(
        `${deploy.roleName} を削除できません。未反映の申請（下書き）があります。` +
          "申請履歴で反映するか破棄してください。",
      ),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-role-confirm"));
      await Promise.resolve();
    });

    const error = await screen.findByTestId("delete-role-error");
    expect(error.textContent).toContain("未反映の申請（下書き）があります");
    expect(screen.getByTestId("delete-role-modal").className).not.toMatch(/awsui_hidden/);
    expect(listRoles).toHaveBeenCalledTimes(1);
  });

  it("確認は入力欄を持たないため、キャンセルで即座に閉じる", async () => {
    await openDeleteModal(deploy);

    fireEvent.click(screen.getByTestId("delete-role-cancel"));

    expect(screen.queryByTestId("delete-role-modal-discard-alert")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("delete-role-modal").className).toMatch(/awsui_hidden/);
    });
  });
});

describe("登録モーダルのAWSアカウントID 欄（Issue #22 spec D-11）", () => {
  it("別アカウントのロールも扱える前提で案内し、#85 より前の「申請は失敗になります」を出さない", async () => {
    await openCreateModal();

    const modal = screen.getByTestId("create-role-modal");
    expect(modal.textContent).toContain("デプロイ先と異なるアカウントのロールも登録できます。");
    expect(modal.textContent).toContain("docs/guide/cross-account.md");
    expect(modal.textContent).not.toContain("申請は失敗になります");
  });
});

describe("ロールの並び順の編集モード（Issue #135 / FR-2.6）", () => {
  const reorderRoles = vi.mocked(api.reorderRoles);
  // サーバは列順で返す。ロール名の昇順（Deploy → Audit）とは違う並びにして、列順で表示していることを確かめる。
  const first = audit;
  const second = deploy;

  async function renderOrdered(roles: RoleView[] = [first, second]): Promise<void> {
    listRoles.mockResolvedValue({ roles });
    render(<RolesScreen />);
    await screen.findByTestId(`role-position-${roles[0]!.arn}`);
  }

  function disabled(testId: string): boolean {
    const element = screen.getByTestId(testId);
    const button = element instanceof HTMLButtonElement ? element : element.querySelector("button");
    return button?.disabled === true || button?.getAttribute("aria-disabled") === "true";
  }

  async function startEditing(): Promise<void> {
    await renderOrdered();
    fireEvent.click(screen.getByTestId("roles-order-start"));
    await screen.findByTestId("roles-order-bar");
  }

  beforeEach(() => {
    reorderRoles.mockResolvedValue({ roleArns: [second.arn, first.arn] });
  });

  it("一覧は、サーバの列順で表示し、先頭に「順」列（1 から）を出す", async () => {
    await renderOrdered();

    expect(screen.getByTestId(`role-position-${first.arn}`).textContent).toBe("1");
    expect(screen.getByTestId(`role-position-${second.arn}`).textContent).toBe("2");
    const rows = [...screen.getByTestId("roles-table").querySelectorAll("tbody tr")].map((row) => row.textContent ?? "");
    expect(rows[0]).toContain(first.roleName);
    expect(rows[1]).toContain(second.roleName);
  });

  it("ロールが 1 件以下なら「並び順を編集」を出さない", async () => {
    await renderOrdered([deploy]);

    expect(screen.queryByTestId("roles-order-start")).toBeNull();
  });

  it("編集モードでは、行に「上へ」「下へ」が出る（先頭の「上へ」と末尾の「下へ」は無効）。登録・説明・色・削除は無効", async () => {
    await startEditing();

    expect(disabled(`role-move-up-${first.arn}`)).toBe(true);
    expect(disabled(`role-move-down-${first.arn}`)).toBe(false);
    expect(disabled(`role-move-up-${second.arn}`)).toBe(false);
    expect(disabled(`role-move-down-${second.arn}`)).toBe(true);
    expect(screen.getByRole("button", { name: `${first.roleName} を下へ` })).toBeTruthy();
    expect(disabled("create-role-button")).toBe(true);
    expect(disabled(`edit-role-description-${first.arn}`)).toBe(true);
    expect(disabled(`edit-role-color-${first.arn}`)).toBe(true);
    expect(disabled(`delete-role-${first.arn}`)).toBe(true);
    // 変更が無いので保存は押せない。
    expect(disabled("roles-order-save")).toBe(true);
    expect(screen.getByTestId("roles-order-save").textContent).toBe("保存（0 件）");
  });

  it("「下へ」で行が入れ替わり、移動を読み上げ、変更件数が保存に出る。保存は唯一の primary（GI-9）", async () => {
    await startEditing();

    fireEvent.click(screen.getByTestId(`role-move-down-${first.arn}`));

    const rows = [...screen.getByTestId("roles-table").querySelectorAll("tbody tr")].map((row) => row.textContent ?? "");
    expect(rows[0]).toContain(second.roleName);
    expect(screen.getByTestId("roles-order-live").textContent).toBe(`${first.roleName} を 2 番目に移動しました`);
    expect(screen.getByTestId("roles-order-save").textContent).toBe("保存（2 件）");
    expect(screen.getByTestId("roles-order-bar").textContent).toContain("変更 2 件");
    expect(disabled("roles-order-save")).toBe(false);
    const primaries = [...document.querySelectorAll("button")]
      .filter((button) => /variant-primary/.test(button.className) && !button.closest("[role='dialog']"))
      .map((button) => button.getAttribute("data-testid") ?? "");
    expect(primaries).toEqual(["roles-order-save"]);
  });

  it("端に着いて押したボタンが無効になったら、フォーカスは同じロールの反対向きのボタンへ戻る", async () => {
    await startEditing();

    fireEvent.click(screen.getByTestId(`role-move-down-${first.arn}`));

    await waitFor(() => {
      const button = screen.getByTestId(`role-move-up-${first.arn}`).querySelector("button") ?? screen.getByTestId(`role-move-up-${first.arn}`);
      expect(document.activeElement).toBe(button);
    });
  });

  it("保存で全ロールの ARN を列順で送り、通知して、一覧を読み直し、編集モードを抜ける", async () => {
    await startEditing();
    fireEvent.click(screen.getByTestId(`role-move-down-${first.arn}`));

    await act(async () => {
      fireEvent.click(screen.getByTestId("roles-order-save"));
      await Promise.resolve();
    });

    expect(reorderRoles).toHaveBeenCalledWith([second.arn, first.arn]);
    await screen.findByText("IAMロールの並び順を保存しました（2 件）");
    await waitFor(() => expect(listRoles).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("roles-order-bar")).toBeNull();
    expect(screen.getByTestId("roles-order-start")).toBeTruthy();
  });

  it("保存に失敗したら、編集モードに留まり、下書きの並びを捨てず、エラーを出す", async () => {
    reorderRoles.mockRejectedValue(new Error("ロールの並び順を一部しか保存できていない可能性があります。"));
    await startEditing();
    fireEvent.click(screen.getByTestId(`role-move-down-${first.arn}`));

    await act(async () => {
      fireEvent.click(screen.getByTestId("roles-order-save"));
      await Promise.resolve();
    });

    expect((await screen.findByTestId("roles-order-error")).textContent).toContain("一部しか保存できていない");
    expect(screen.getByTestId("roles-order-bar")).toBeTruthy();
    const rows = [...screen.getByTestId("roles-table").querySelectorAll("tbody tr")].map((row) => row.textContent ?? "");
    expect(rows[0]).toContain(second.roleName);
  });

  it("変更が無いときのキャンセルは、破棄確認なしで編集モードを抜ける", async () => {
    await startEditing();

    fireEvent.click(screen.getByTestId("roles-order-cancel"));

    expect(screen.queryByTestId("roles-order-discard-modal")).toBeNull();
    expect(screen.queryByTestId("roles-order-bar")).toBeNull();
  });

  it("変更があるときのキャンセルは破棄確認を挟み（GI-4）、「編集に戻る」で下書きを保ち、「破棄」で元の並びに戻す", async () => {
    await startEditing();
    fireEvent.click(screen.getByTestId(`role-move-down-${first.arn}`));

    fireEvent.click(screen.getByTestId("roles-order-cancel"));
    expect((await screen.findByTestId("roles-order-discard-modal")).textContent).toContain("保存していない変更が 2 件あります");
    fireEvent.click(screen.getByTestId("roles-order-discard-back"));
    expect(screen.queryByTestId("roles-order-discard-modal")).toBeNull();
    expect(screen.getByTestId("roles-order-save").textContent).toBe("保存（2 件）");

    fireEvent.click(screen.getByTestId("roles-order-cancel"));
    fireEvent.click(await screen.findByTestId("roles-order-discard-confirm"));

    expect(screen.queryByTestId("roles-order-bar")).toBeNull();
    const rows = [...screen.getByTestId("roles-table").querySelectorAll("tbody tr")].map((row) => row.textContent ?? "");
    expect(rows[0]).toContain(first.roleName);
    expect(reorderRoles).not.toHaveBeenCalled();
  });

  it("変更があるとき、アプリ内の遷移にも破棄確認を挟み、「破棄して移動」で移る", async () => {
    await startEditing();
    fireEvent.click(screen.getByTestId(`role-move-down-${first.arn}`));

    act(() => navigate("/matrix"));

    expect((await screen.findByTestId("roles-order-discard-modal")).textContent).toContain("別の画面へ移動しようとしました");
    expect(window.location.pathname).not.toBe("/matrix");
    fireEvent.click(screen.getByTestId("roles-order-discard-confirm"));
    expect(window.location.pathname).toBe("/matrix");
    window.history.replaceState({}, "", "/");
  });

  it("変更が無ければ、アプリ内の遷移を止めない", async () => {
    await startEditing();

    act(() => navigate("/matrix"));

    expect(window.location.pathname).toBe("/matrix");
    window.history.replaceState({}, "", "/");
  });

  it("変更があるとき、タブを閉じる・再読込には beforeunload の警告を出す。変更が無ければ出さない", async () => {
    await startEditing();
    const clean = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);

    fireEvent.click(screen.getByTestId(`role-move-down-${first.arn}`));
    const dirty = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
  });
});

describe("IAMロールの表示名（Issue #150）", () => {
  it("一覧に表示名を出し、未設定は「—」を出す", async () => {
    listRoles.mockResolvedValue({ roles: [{ ...deploy, displayName: "本番デプロイ" }, audit] });
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    expect(screen.getByTestId(`role-display-name-${deploy.arn}`).textContent).toBe("本番デプロイ");
    expect(screen.getByTestId(`role-display-name-${audit.arn}`).textContent).toBe("—");
  });

  it("説明列の「編集」ボタンは、表示名と説明を編集することをラベルで示す", async () => {
    render(<RolesScreen />);

    expect(await screen.findByRole("button", { name: `${deploy.roleName} の表示名と説明を編集` })).toBeTruthy();
  });

  it("登録モーダルで表示名を入れると、正規化して createRole に displayName を渡す", async () => {
    await openCreateModal();

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "NewRole");
    type("create-role-display-name-input", "  本番デプロイ  ");
    fireEvent.click(screen.getByTestId("create-role-submit"));

    await waitFor(() => {
      expect(createRole).toHaveBeenCalledWith(expect.objectContaining({ displayName: "本番デプロイ" }));
    });
  });

  it("登録モーダルで表示名を空にすると、displayName を送らない", async () => {
    await openCreateModal();

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "NewRole");
    fireEvent.click(screen.getByTestId("create-role-submit"));

    await waitFor(() => expect(createRole).toHaveBeenCalled());
    expect(createRole).toHaveBeenCalledWith(expect.not.objectContaining({ displayName: expect.anything() }));
  });

  it("33 文字の表示名は blur でエラーを出し、送信を止める", async () => {
    await openCreateModal();

    type("create-role-display-name-input", "あ".repeat(33));
    fireEvent.blur(inputOf("create-role-display-name-input"));

    await screen.findByText("表示名は 32 文字以内で入力してください");

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "NewRole");
    fireEvent.click(screen.getByTestId("create-role-submit"));
    await waitFor(() => {
      expect(createRole).not.toHaveBeenCalled();
    });
  });

  it("表示名だけを入力した登録モーダルは、キャンセルで破棄確認へ切り替わる（dirty）", async () => {
    await openCreateModal();

    type("create-role-display-name-input", "途中");
    fireEvent.click(screen.getByTestId("create-role-cancel"));

    await screen.findByTestId("create-role-modal-discard-alert");
  });

  it("表示名の重複（409）は、登録モーダルを閉じずにフォーム全体へ出し、入力を保持する", async () => {
    const message = "表示名「本番デプロイ」は、ほかのロールで使われています";
    createRole.mockRejectedValue(
      Object.assign(new Error(message), { name: "ApiClientError", status: 409 }),
    );
    await openCreateModal();

    type("create-role-account-id", ACCOUNT);
    type("create-role-name", "NewRole");
    type("create-role-display-name-input", "本番デプロイ");
    fireEvent.click(screen.getByTestId("create-role-submit"));

    const shown = await screen.findAllByText(message);
    expect(shown.length).toBeGreaterThan(0);
    expect(inputOf("create-role-display-name-input").value).toBe("本番デプロイ");
  });
});

/** 信頼ポリシーの乖離の確認（FR-4.9。Issue #170）。 */
describe("信頼ポリシーの乖離の確認（FR-4.9）", () => {
  const CHECKED_AT = "2026-10-15T11:41:00.000Z";

  function driftView(roleArn: string, overrides: Partial<TrustDriftView> = {}): TrustDriftView {
    return { roleArn, status: "match", missing: [], extra: [], unmanaged: [], readError: null, ...overrides };
  }
  function driftResponse(...roles: TrustDriftView[]): DriftResponse {
    return { checkedAt: CHECKED_AT, roles };
  }

  // 説明は常時表示をやめ、「信頼ポリシーを確認」の隣の「i」を押したときだけ出す（Issue #232。Issue #206 の見直し）。
  describe("ボタンの説明の「i」（Issue #232）", () => {
    const HELP_NAME = "「信頼ポリシーを確認」について";
    const CAPTION =
      "「信頼ポリシーを確認」は、AWS 上の信頼ポリシーと Rolust の記録（反映済みの割り当て）を読み取りで比べます。" +
      "AWS は書き換えません。食い違いがあれば、詳細から直す操作を選べます。";

    /** 2 つの要素の最も近い共通の祖先。 */
    function commonAncestor(a: HTMLElement, b: HTMLElement): HTMLElement {
      let current: HTMLElement | null = a;
      while (current && !current.contains(b)) current = current.parentElement;
      if (!current) throw new Error("共通の祖先がありません");
      return current;
    }

    it("説明は、押す前は出ていない。「i」を押すと出る。結果のサマリの読み上げ領域の外", async () => {
      render(<RolesScreen />);
      await screen.findByText("RolustManaged-DeployProd");

      expect(screen.queryByTestId("roles-drift-caption")).toBeNull();
      fireEvent.click(screen.getByTestId("roles-drift-help"));

      const caption = await screen.findByTestId("roles-drift-caption");
      expect(caption.textContent).toBe(CAPTION);
      expect(screen.getByTestId("drift-live").contains(caption)).toBe(false);
    });

    it("「i」は、読み上げ名を持つボタンである", async () => {
      render(<RolesScreen />);
      await screen.findByText("RolustManaged-DeployProd");

      expect(screen.getByRole("button", { name: HELP_NAME })).toBeTruthy();
    });

    it("「i」は「信頼ポリシーを確認」と 1 つの組で、「並び順を編集」とは 25px あける", async () => {
      render(<RolesScreen />);
      await screen.findByText("RolustManaged-DeployProd");

      const check = screen.getByTestId("roles-drift-check");
      const help = screen.getByTestId("roles-drift-help");
      const order = screen.getByTestId("roles-order-start");

      // 「i」は確認ボタンと同じ組に入り、その組に「並び順を編集」は入らない。
      const pair = commonAncestor(check, help);
      expect(pair.contains(order)).toBe(false);
      // 組と「並び順を編集」の間（依頼者の指定。「i」がどちらの説明か分かるように）。
      const group = commonAncestor(check, order);
      expect(group.style.columnGap).toBe("25px");
    });

    it("閉じるボタンで閉じる", async () => {
      render(<RolesScreen />);
      await screen.findByText("RolustManaged-DeployProd");
      fireEvent.click(screen.getByTestId("roles-drift-help"));
      const caption = await screen.findByTestId("roles-drift-caption");

      const dialog = caption.closest('[role="dialog"]') as HTMLElement;
      fireEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));

      await waitFor(() => expect(screen.queryByTestId("roles-drift-caption")).toBeNull());
    });

    it("並び順の編集モードの間も、「i」で説明を開ける（Issue #206 の「編集モードの間も消さない」を引き継ぐ）", async () => {
      render(<RolesScreen />);
      await screen.findByText("RolustManaged-DeployProd");

      fireEvent.click(screen.getByTestId("roles-order-start"));

      expect((screen.getByTestId("roles-drift-check") as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByTestId("roles-drift-help"));
      expect((await screen.findByTestId("roles-drift-caption")).textContent).toBe(CAPTION);
    });
  });

  it("描画しただけでは API を呼ばない。確認前の列は「—」", async () => {
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    expect(getDrift).not.toHaveBeenCalled();
    expect(screen.getByTestId(`role-drift-${deploy.arn}`).textContent).toBe("—");
    expect(screen.queryByTestId("drift-summary")).toBeNull();
  });

  it("押すと API を 1 回呼び、確認中は行が「確認中…」になる（連打しても 1 回）", async () => {
    let resolve: (value: DriftResponse) => void = () => {};
    getDrift.mockReturnValue(
      new Promise<DriftResponse>((r) => {
        resolve = r;
      }),
    );
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId("roles-drift-check"));
    fireEvent.click(screen.getByTestId("roles-drift-check")); // 連打

    await waitFor(() => expect(screen.getByTestId(`role-drift-${deploy.arn}`).textContent).toBe("確認中…"));
    expect(getDrift).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve(driftResponse(driftView(deploy.arn), driftView(audit.arn)));
    });
  });

  it("すべて一致なら、行は「✓ 一致」でサマリは一致を伝える（時刻つき）", async () => {
    getDrift.mockResolvedValue(driftResponse(driftView(deploy.arn), driftView(audit.arn)));
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId("roles-drift-check"));

    await waitFor(() => expect(screen.getByTestId(`role-drift-${deploy.arn}`).textContent).toBe("✓ 一致"));
    expect(screen.getByTestId("drift-summary").textContent).toContain("すべてのロール（2 件）で一致しています");
  });

  it("乖離のロールは件数と「詳細」を出し、詳細から ARN を見られる。一致のロールに「詳細」は無い", async () => {
    const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
    getDrift.mockResolvedValue(
      driftResponse(driftView(deploy.arn), driftView(audit.arn, { status: "drift", missing: [AYAKA], extra: [] })),
    );
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId("roles-drift-check"));

    await waitFor(() => expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toContain("! 乖離 1 件"));
    expect(screen.getByTestId("drift-summary").textContent).toContain("2 ロール中 1 ロールで");
    expect(screen.queryByTestId(`role-drift-detail-${deploy.arn}`)).toBeNull();

    fireEvent.click(screen.getByTestId(`role-drift-detail-${audit.arn}`));
    expect((await screen.findByTestId("drift-missing")).textContent).toContain(AYAKA);
  });

  it("読み取り失敗のロールは「✗ 読み取り失敗」で、詳細にエラーコードが出る（他のロールは止まらない）", async () => {
    getDrift.mockResolvedValue(
      driftResponse(
        driftView(deploy.arn),
        driftView(audit.arn, { status: "readError", readError: { errorCode: "AccessDenied", message: "拒否されました" } }),
      ),
    );
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId("roles-drift-check"));

    await waitFor(() => expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toContain("✗ 読み取り失敗"));
    expect(screen.getByTestId(`role-drift-${deploy.arn}`).textContent).toBe("✓ 一致");
    fireEvent.click(screen.getByTestId(`role-drift-detail-${audit.arn}`));
    expect((await screen.findByTestId("drift-read-error")).textContent).toContain("AccessDenied");
  });

  it("API 自体の失敗は、サマリの位置にエラー（コード併記）を出し、行は「—」に戻る（GI-6）", async () => {
    const { ApiClientError } = await vi.importActual<typeof ApiClientModule>("../api-client.js");
    getDrift.mockRejectedValue(new ApiClientError(403, { code: "Forbidden", message: "権限がありません", retryable: false }));
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId("roles-drift-check"));

    const error = await screen.findByTestId("drift-error");
    expect(error.textContent).toContain("権限がありません");
    expect(screen.getByTestId(`role-drift-${deploy.arn}`).textContent).toBe("—");
  });

  it("確認の後に登録したロール（結果に無い）の行は「—」で、落ちない（D-14）", async () => {
    getDrift.mockResolvedValue(driftResponse(driftView(deploy.arn))); // audit は結果に無い
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId("roles-drift-check"));

    await waitFor(() => expect(screen.getByTestId(`role-drift-${deploy.arn}`).textContent).toBe("✓ 一致"));
    expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toBe("—");
  });

  it("結果の「閉じる」でサマリと行の結果が消える（再確認までは保たれる）", async () => {
    getDrift.mockResolvedValue(driftResponse(driftView(deploy.arn), driftView(audit.arn)));
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");
    fireEvent.click(screen.getByTestId("roles-drift-check"));
    await screen.findByTestId("drift-summary");

    fireEvent.click(within(screen.getByTestId("drift-summary")).getByRole("button", { name: "閉じる" }));

    await waitFor(() => expect(screen.queryByTestId("drift-summary")).toBeNull());
    expect(screen.getByTestId(`role-drift-${deploy.arn}`).textContent).toBe("—");
  });

  it("並び順の編集中は、確認ボタンが無効になる（D-13）", async () => {
    render(<RolesScreen />);
    await screen.findByText("RolustManaged-DeployProd");

    fireEvent.click(screen.getByTestId("roles-order-start"));

    // 既存のテスト（並び順の編集）の `disabled()` と同じ判定。Cloudscape の Button は外側に data-testid を載せ、内側に <button> を持つ。
    const element = screen.getByTestId("roles-drift-check");
    const button = element instanceof HTMLButtonElement ? element : element.querySelector("button");
    expect(button?.disabled === true || button?.getAttribute("aria-disabled") === "true").toBe(true);
  });

  describe("記録を IAM に合わせた後の確認結果（Issue #172。D-16）", () => {
    const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";

    /** 乖離のある audit の詳細を開き、確認モーダルまで進める。 */
    async function openAdoptConfirm(): Promise<void> {
      getDrift.mockResolvedValue(
        driftResponse(driftView(deploy.arn), driftView(audit.arn, { status: "drift", missing: [AYAKA], extra: [] })),
      );
      render(<RolesScreen />);
      await screen.findByText("RolustManaged-DeployProd");
      fireEvent.click(screen.getByTestId("roles-drift-check"));
      await waitFor(() => expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toContain("! 乖離 1 件"));
      fireEvent.click(screen.getByTestId(`role-drift-detail-${audit.arn}`));
      const adopt = await screen.findByTestId("drift-adopt");
      fireEvent.click(adopt.querySelector("button") ?? adopt);
      await screen.findByTestId("drift-adopt-confirm");
    }
    function confirmAdopt(): void {
      const run = screen.getByTestId("drift-adopt-confirm-run");
      fireEvent.click(run.querySelector("button") ?? run);
    }
    /** サーバが実際に書いた集合（監査の ChangeRequest）。件数の根拠はここ（確認時の画面の結果ではない）。 */
    function adopted(addUserArns: string[] = [AYAKA], removeUserArns: string[] = []): RepairResponse {
      return {
        outcome: "adopted",
        changeRequest: { changeRequestId: "cr-0201", addUserArns, removeUserArns } as ChangeRequest,
        exclusion: null,
        failures: [],
      };
    }

    it("成功すると詳細を閉じ、そのロールの列だけ「再確認が必要」になる。サマリは残り、API の再確認はしない", async () => {
      adoptDrift.mockResolvedValue(adopted());
      await openAdoptConfirm();

      confirmAdopt();

      await waitFor(() => expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toBe("再確認が必要"));
      expect(adoptDrift).toHaveBeenCalledWith(audit.arn);
      await waitFor(() => expect(screen.queryByTestId("drift-detail-modal")).toBeNull());
      expect(screen.getByTestId(`role-drift-${deploy.arn}`).textContent).toBe("✓ 一致");
      expect(screen.getByTestId("drift-summary").textContent).toContain("2 ロール中 1 ロールで");
      expect(getDrift).toHaveBeenCalledTimes(1);
      // 古い乖離の件数・「詳細」は残さない
      expect(screen.queryByTestId(`role-drift-detail-${audit.arn}`)).toBeNull();
      // 閉じたあとも結果が分かるよう、成功の通知を出す（件数 = 乖離の件数）
      expect((await screen.findByText(/1 件を記録に合わせました。AWS は書き換えていません/)).textContent).toBeTruthy();
    });

    it("成功の通知の件数は、サーバの応答（実際に書いた集合）から出す。確認時の画面の結果と違っても応答に従う", async () => {
      // 画面の確認結果は 1 件（AYAKA が足りない）。確認から実行までの間に IAM が変わり、サーバは 3 件を書いた。
      const BOB = "arn:aws:iam::111122223333:user/bob";
      const KENJI = "arn:aws:iam::111122223333:user/kenji.sato";
      adoptDrift.mockResolvedValue(adopted([AYAKA, BOB], [KENJI]));
      await openAdoptConfirm();

      confirmAdopt();

      expect((await screen.findByText(/3 件を記録に合わせました。AWS は書き換えていません/)).textContent).toBeTruthy();
      expect(screen.queryByText(/^1 件を記録に合わせました/)).toBeNull();
    });

    it("失敗（一部）のときは列を変えず、詳細も閉じない", async () => {
      adoptDrift.mockResolvedValue({
        ...adopted(),
        failures: [{ userArn: AYAKA, message: "書き込みに失敗しました" }],
      });
      await openAdoptConfirm();

      confirmAdopt();

      await screen.findByTestId("drift-repair-partial");
      expect(screen.getByTestId("drift-detail-modal")).toBeTruthy();
      expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toContain("! 乖離 1 件");
    });

    it("「信頼ポリシーを確認」をもう一度押すと、列は新しい結果に戻る", async () => {
      adoptDrift.mockResolvedValue(adopted());
      await openAdoptConfirm();
      confirmAdopt();
      await waitFor(() => expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toBe("再確認が必要"));
      getDrift.mockResolvedValue(driftResponse(driftView(deploy.arn), driftView(audit.arn)));

      fireEvent.click(screen.getByTestId("roles-drift-check"));

      await waitFor(() => expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toBe("✓ 一致"));
      expect(getDrift).toHaveBeenCalledTimes(2);
    });

    it("サマリを閉じると「再確認が必要」も消え、次の確認の結果がそのまま出る", async () => {
      adoptDrift.mockResolvedValue(adopted());
      await openAdoptConfirm();
      confirmAdopt();
      await waitFor(() => expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toBe("再確認が必要"));

      fireEvent.click(within(screen.getByTestId("drift-summary")).getByRole("button", { name: "閉じる" }));

      await waitFor(() => expect(screen.queryByTestId("drift-summary")).toBeNull());
      expect(screen.getByTestId(`role-drift-${audit.arn}`).textContent).toBe("—");
    });
  });

  it("ロールが 0 件でも、押すと API を呼び、サマリに「確認するロールがありません」が出る", async () => {
    listRoles.mockResolvedValue({ roles: [] });
    getDrift.mockResolvedValue(driftResponse());
    render(<RolesScreen />);

    fireEvent.click(await screen.findByTestId("roles-drift-check"));

    expect((await screen.findByTestId("drift-summary")).textContent).toContain("確認するロールがありません");
    expect(getDrift).toHaveBeenCalledTimes(1);
  });
});
