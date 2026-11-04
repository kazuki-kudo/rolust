// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  Assignment,
  IamRole,
  IamUser,
  MatrixView,
  RoleLock,
  UserPool,
} from "@rolust/core";
import { buildRoleArn, buildUserArn } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ActorProvider } from "../actor.js";
import { api, ApiClientError } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { LocaleProvider, useLocale } from "../i18n/index.js";
import { hiddenKey } from "../matrix-hidden.js";
import { MatrixScreen } from "./MatrixScreen.js";

/**
 * 画面 3（FR-7.3）のユニットテスト。
 *
 * `AssignmentMatrix.test.tsx` は部品が N×M を描くことと、チェック操作が交点 1 件の
 * 保存しか起こさないことを固定している。この画面テストが埋めるのはその外側 —
 * **画面が持つ状態機械**である。
 *
 * - 変更件数 0 → 1 の遷移で列が自動的に選択される（DF-4 / Q4）
 * - 保存は交点ごとの即時呼び出しで、debounce でまとめない（MQ-4）
 * - **楽観的更新を行わない**: 保存に失敗した交点は操作前の状態のまま残る（FR-3.2）
 * - FR-4.6 でロックされた列は除外帯に出て、申請対象に入らない
 */

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: {
      getMatrix: vi.fn(),
      saveAssignment: vi.fn(),
      revertAssignments: vi.fn(),
      createChangeRequests: vi.fn(),
    },
  };
});

const POOL_ID = "platform-team";
const USER_ACCOUNT = "111122223333";
const ROLE_ACCOUNT = "555566667777";

const pool: UserPool = {
  poolId: POOL_ID,
  createdAt: "2026-07-30T00:00:00.000Z",
  attributeColumns: [],
};

const ayaka: IamUser = {
  poolId: POOL_ID,
  accountId: USER_ACCOUNT,
  userName: "ayaka.mori",
  arn: buildUserArn(USER_ACCOUNT, "ayaka.mori"),
  createdAt: "2026-07-30T00:00:00.000Z",
  attributes: {},
};

const deploy: IamRole = {
  accountId: ROLE_ACCOUNT,
  roleName: "RolustManaged-DeployProd",
  arn: buildRoleArn(ROLE_ACCOUNT, "RolustManaged-DeployProd"),
  description: "本番デプロイ用",
  displayName: null,
  color: null,
  createdAt: "2026-07-30T00:00:00.000Z",
};

const audit: IamRole = {
  accountId: ROLE_ACCOUNT,
  roleName: "RolustManaged-ReadOnlyAudit",
  arn: buildRoleArn(ROLE_ACCOUNT, "RolustManaged-ReadOnlyAudit"),
  description: null,
  displayName: null,
  color: null,
  createdAt: "2026-07-30T00:00:00.000Z",
};

function assignment(roleArn: string, checked: boolean, reflected: boolean): Assignment {
  return {
    poolId: POOL_ID,
    userArn: ayaka.arn,
    roleArn,
    checked,
    reflected,
    updatedAt: "2026-07-31T00:00:00.000Z",
  };
}

const draftLock: RoleLock = {
  roleArn: audit.arn,
  changeRequestId: "cr-0142",
  status: "draft",
  createdAt: "2026-07-31T10:04:00.000Z",
};

function matrix(overrides: Partial<MatrixView> = {}): MatrixView {
  return {
    pool,
    users: [ayaka],
    roles: [deploy, audit],
    assignments: [],
    locks: {},
    ...overrides,
  };
}

const getMatrix = vi.mocked(api.getMatrix);
const saveAssignment = vi.mocked(api.saveAssignment);
const revertAssignments = vi.mocked(api.revertAssignments);
const createChangeRequests = vi.mocked(api.createChangeRequests);

function cell(roleArn: string): HTMLInputElement {
  return screen.getByTestId(`cell-${ayaka.arn}-${roleArn}`) as HTMLInputElement;
}

async function renderScreen(view: MatrixView = matrix()): Promise<void> {
  getMatrix.mockResolvedValue(view);
  render(<MatrixScreen />);
  await screen.findByTestId("assignment-matrix-table");
}

describe("見出し行とツールバーの配置（Issue #155）", () => {
  it("見出しと件数は同じ行にある", async () => {
    await renderScreen();
    const heading = screen.getByRole("heading", { level: 1, name: "IAMロール割り当て" });
    const counts = screen.getByTestId("page-heading-counts");
    expect(counts.textContent).toBe("IAMユーザ 1 / IAMロール 2");
    expect((counts.parentElement as HTMLElement).contains(heading)).toBe(true);
  });

  it("ツールバーは件数・絞り込み欄・操作を 1 行に並べる", async () => {
    await renderScreen();
    const toolbar = screen.getByTestId("matrix-toolbar");
    expect(toolbar.contains(screen.getByTestId("matrix-counts"))).toBe(true);
    expect(toolbar.querySelector('[data-testid="matrix-user-filter"]')).not.toBeNull();
    expect(toolbar.contains(screen.getByTestId("matrix-create-requests"))).toBe(true);
    expect(toolbar.contains(screen.getByTestId("matrix-revert-changes"))).toBe(true);
  });

  it("狭い幅で折り返せるよう、ツールバーは flex-wrap を持ち、操作の塊は右寄せする", async () => {
    await renderScreen();
    const row = screen.getByTestId("matrix-counts").closest('div[style*="flex-wrap: wrap"]');
    expect(row).not.toBeNull();
    expect(screen.getByTestId("matrix-actions").style.marginLeft).toBe("auto");
  });

  it("空状態（IAMユーザ 0 件）では、絞り込み欄を描かない", async () => {
    getMatrix.mockResolvedValue(matrix({ users: [] }));
    render(<MatrixScreen />);
    await screen.findByTestId("matrix-empty");
    expect(screen.queryByTestId("matrix-user-filter")).toBeNull();
  });

  it("キーボードの順序は、絞り込み欄 → 「変更を取り消す」→「申請を作成」→ マトリクス", async () => {
    await renderScreen();
    const input = document.querySelector('[data-testid="matrix-user-filter"] input') as HTMLElement;
    const revert = screen.getByTestId("matrix-revert-changes");
    const create = screen.getByTestId("matrix-create-requests");
    const table = screen.getByTestId("assignment-matrix-table");
    // a が b より後ろにあるかを、文書の順序で確かめる。
    const follows = (a: Node, b: Node): boolean => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(input, revert)).toBe(true);
    expect(follows(revert, create)).toBe(true);
    expect(follows(create, table)).toBe(true);
  });
});

beforeEach(() => {
  window.localStorage.clear();
  // jsdom の URL はファイル内で共有される。遷移の検証が前のテストの結果を引き継がないよう戻す。
  window.history.pushState({}, "", "/matrix");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("読み込み（画面 3 の 5 状態。Issue #108 でプール選択を外した）", () => {
  it("選択欄なしで、固定プールのマトリクスを読み込む。poolId は渡さない", async () => {
    getMatrix.mockResolvedValue(matrix());
    render(<MatrixScreen />);

    await screen.findByTestId("assignment-matrix-table");
    expect(getMatrix).toHaveBeenCalledTimes(1);
    expect(getMatrix).toHaveBeenCalledWith();
    expect(screen.queryByTestId("pool-select")).toBeNull();
    expect(screen.queryByTestId("matrix-no-pool")).toBeNull();
  });

  it("読み込みに失敗したら error 状態を出し、再試行の導線を持つ", async () => {
    getMatrix.mockRejectedValue(new Error("DynamoDB の Query に失敗しました"));
    render(<MatrixScreen />);

    await screen.findByTestId("matrix-error");
    expect(screen.getByTestId("matrix-error-retry")).toBeTruthy();
  });
});

describe("セル単位の即時保存（MQ-4 / FR-3.2）", () => {
  it("チェック操作は交点 1 件の保存を 1 回だけ呼ぶ（まとめない）", async () => {
    await renderScreen();
    saveAssignment.mockResolvedValue({ assignment: assignment(deploy.arn, true, false) });

    fireEvent.click(cell(deploy.arn));

    await waitFor(() => {
      expect(saveAssignment).toHaveBeenCalledTimes(1);
    });
    expect(saveAssignment).toHaveBeenCalledWith({
      userArn: ayaka.arn,
      roleArn: deploy.arn,
      checked: true,
    });
  });

  it("保存に失敗した交点は操作前の状態のまま残る（楽観的更新を行わない）", async () => {
    await renderScreen();
    saveAssignment.mockRejectedValue(new Error("ConditionalCheckFailed"));

    expect(cell(deploy.arn).checked).toBe(false);
    fireEvent.click(cell(deploy.arn));

    // 失敗は握り潰さずツールバー位置のエラー帯に出る。
    const error = await screen.findByTestId("matrix-save-error");
    expect(error.textContent).toContain("RolustManaged-DeployProd");
    // 画面の状態は操作前のまま（＝チェックが入っていない）。
    expect(cell(deploy.arn).checked).toBe(false);
  });
});

describe("保存状態の表示（Issue #158）", () => {
  it("保存済みはツールバーの件数の近くに出し、表の凡例には出さない", async () => {
    await renderScreen();
    const toolbar = screen.getByTestId("matrix-toolbar");
    expect(toolbar.contains(screen.getByTestId("matrix-saved"))).toBe(true);
    expect(screen.getByTestId("matrix-legend").querySelector('[data-testid="matrix-saved"]')).toBeNull();
  });

  it("保存中はツールバーに「保存中」を出し、表の凡例には出さない。完了すると保存済みに戻る", async () => {
    await renderScreen();
    let finish: (value: { assignment: ReturnType<typeof assignment> }) => void = () => {};
    saveAssignment.mockReturnValue(new Promise((resolve) => { finish = resolve; }));

    fireEvent.click(cell(deploy.arn));

    const saving = await screen.findByTestId("matrix-saving");
    expect(saving.textContent).toContain("保存中");
    expect(screen.getByTestId("matrix-toolbar").contains(saving)).toBe(true);
    expect(screen.getByTestId("matrix-legend").querySelector('[data-testid="matrix-saving"]')).toBeNull();

    finish({ assignment: assignment(deploy.arn, true, false) });

    await waitFor(() => {
      expect(screen.queryByTestId("matrix-saving")).toBeNull();
    });
    expect(screen.getByTestId("matrix-toolbar").contains(screen.getByTestId("matrix-saved"))).toBe(true);
  });
});

describe("変更列の自動プリセレクト（DF-4 / Q4）", () => {
  it("変更件数が 0 → 1 になった列は自動的に選択される", async () => {
    await renderScreen();

    // 変更が 0 件の間は申請を作れない。
    expect(screen.getByTestId("matrix-counts").textContent).toContain("変更はありません");
    expect((screen.getByTestId("matrix-create-requests") as HTMLButtonElement).disabled).toBe(
      true,
    );

    saveAssignment.mockResolvedValue({ assignment: assignment(deploy.arn, true, false) });
    fireEvent.click(cell(deploy.arn));

    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("1 件の IAMロールを選択中");
    });
    expect(screen.getByTestId("matrix-counts").textContent).toContain("変更 1 件");
    expect((screen.getByTestId("matrix-create-requests") as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it("選択を手で外せる（自動選択は取捨選択の自由を奪わない）", async () => {
    await renderScreen(matrix({ assignments: [assignment(deploy.arn, true, false)] }));

    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("1 件の IAMロールを選択中");
    });

    fireEvent.click(screen.getByTestId(`role-select-${deploy.arn}`));

    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("0 件の IAMロールを選択中");
    });
    expect((screen.getByTestId("matrix-create-requests") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

describe("FR-4.6 の除外（ExclusionBanner）", () => {
  it("未反映申請を持つ列に変更があると除外帯に理由つきで出る", async () => {
    await renderScreen(
      matrix({
        assignments: [assignment(audit.arn, true, false)],
        locks: { [audit.arn]: draftLock },
      }),
    );

    const banner = await screen.findByTestId("exclusion-banner");
    expect(banner.textContent).toContain("RolustManaged-ReadOnlyAudit");
    expect(screen.getByTestId(`exclusion-item-${audit.arn}`)).toBeTruthy();

    // 除外された列は申請対象に入らないため、押せるものが無い。
    expect(screen.getByTestId("matrix-counts").textContent).toContain("1 件の IAMロールを除外");
    expect((screen.getByTestId("matrix-create-requests") as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("ロックがあっても変更が無い列は除外帯に出さない（伝えることが無い）", async () => {
    await renderScreen(matrix({ locks: { [audit.arn]: draftLock } }));

    expect(screen.queryByTestId("exclusion-banner")).toBeNull();
    expect(screen.getByTestId("matrix-counts").textContent).toContain("0 件の IAMロールを除外");
  });
});

describe("申請の作成（FR-4.4 / FR-4.6）", () => {
  it("作成できた申請の id を並べた URL へ遷移する（MQ-2）", async () => {
    await renderScreen(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("1 件の IAMロールを選択中");
    });

    createChangeRequests.mockResolvedValue({
      created: [
        {
          changeRequestId: "cr-9001",
          poolId: POOL_ID,
          roleArn: deploy.arn,
          addUserArns: [ayaka.arn],
          removeUserArns: [],
          status: "draft",
          createdAt: "2026-07-31T12:00:00.000Z",
          createdBy: null,
          appliedAt: null,
          appliedBy: null,
          result: null,
        },
      ],
      excluded: [],
      failures: [],
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("matrix-create-requests"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(window.location.pathname).toBe("/requests");
    });
    expect(window.location.search).toContain("cr-9001");
  });

  it("1 件も作成できなかった場合は理由を列挙し、遷移しない", async () => {
    await renderScreen(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("1 件の IAMロールを選択中");
    });

    createChangeRequests.mockResolvedValue({
      created: [],
      excluded: [
        { roleArn: deploy.arn, reason: "draft", changeRequestId: "cr-0142" },
      ],
      failures: [],
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("matrix-create-requests"));
      await Promise.resolve();
    });

    const notice = await screen.findByTestId("matrix-creation-notice");
    expect(notice.textContent).toContain("RolustManaged-DeployProd");
    expect(notice.textContent).toContain("下書きの申請が 1 件あります");
  });

  it("作成に失敗したロールは握り潰さず、失敗として提示する", async () => {
    await renderScreen(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("1 件の IAMロールを選択中");
    });

    createChangeRequests.mockResolvedValue({
      created: [],
      excluded: [],
      failures: [{ roleArn: deploy.arn, message: "ロックの取得に失敗しました" }],
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("matrix-create-requests"));
      await Promise.resolve();
    });

    const notice = await screen.findByTestId("matrix-creation-notice");
    expect(notice.textContent).toContain("ロックの取得に失敗しました");
    expect(window.location.pathname).not.toBe("/requests");
  });
});

describe("ロールの紐づけは廃止した（Issue #135）", () => {
  it("ツールバーに「ロールの紐づけ」が無い", async () => {
    await renderScreen();

    expect(screen.queryByTestId("matrix-link-roles")).toBeNull();
    expect(screen.queryByText("ロールの紐づけ")).toBeNull();
  });

  it("ロールが 0 件のときは、画面 2 へ移って登録する導線を出す（その場でモーダルは開かない）", async () => {
    getMatrix.mockResolvedValue({ ...matrix(), roles: [], assignments: [], locks: {} });
    render(<MatrixScreen />);

    fireEvent.click(await screen.findByTestId("matrix-register-roles-empty"));

    expect(window.location.pathname).toBe("/roles");
  });
});

describe("未反映の変更の取り消し（Issue #88 / FR-3.2）", () => {
  const revertButton = (): HTMLButtonElement =>
    screen.getByTestId("matrix-revert-changes") as HTMLButtonElement;

  async function openConfirm(): Promise<void> {
    fireEvent.click(revertButton());
    await screen.findByTestId("revert-changes-modal");
  }

  it("「選択をリセット」は無い（列の選択は列ヘッダのチェックで外せる）", async () => {
    await renderScreen(matrix({ assignments: [assignment(deploy.arn, true, false)] }));

    expect(screen.queryByTestId("matrix-reset-selection")).toBeNull();
    expect(screen.queryByText("選択をリセット")).toBeNull();
  });

  it("取り消せる変更が無いときは押せない", async () => {
    await renderScreen(matrix({ assignments: [assignment(deploy.arn, true, true)] }));

    expect(revertButton().disabled).toBe(true);
  });

  it("未反映の申請（ロック）のある列の変更だけなら押せない", async () => {
    await renderScreen(
      matrix({ assignments: [assignment(audit.arn, true, false)], locks: { [audit.arn]: draftLock } }),
    );

    expect(revertButton().disabled).toBe(true);
  });

  it("押すと確認を出し、件数と対象外のロール数を示す。キャンセルでは何も呼ばない（GI-4）", async () => {
    await renderScreen(
      matrix({
        assignments: [assignment(deploy.arn, true, false), assignment(audit.arn, false, true)],
        locks: { [audit.arn]: draftLock },
      }),
    );
    await openConfirm();

    const modal = screen.getByTestId("revert-changes-modal");
    expect(modal.textContent).toContain("1 件");
    expect(modal.textContent).toContain("1 件の IAMロール");
    expect(modal.textContent).toContain("AWS には影響しません");
    expect(modal.textContent).toContain("1 件の IAMロールは対象外");
    expect(modal.textContent).toContain("申請履歴で破棄");

    fireEvent.click(screen.getByTestId("revert-changes-cancel"));
    await waitFor(() => {
      expect(screen.getByTestId("revert-changes-modal").className).toMatch(/awsui_hidden/);
    });
    expect(revertAssignments).not.toHaveBeenCalled();
  });

  it("確定すると取り消しの API を 1 回呼び、マトリクスを読み直して成功を通知する。交点は 1 件ずつ PUT しない", async () => {
    await renderScreen(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    revertAssignments.mockResolvedValue({ reverted: 1, skippedRoleArns: [], failures: [] });
    getMatrix.mockResolvedValue(matrix({ assignments: [assignment(deploy.arn, false, false)] }));
    await openConfirm();

    fireEvent.click(screen.getByTestId("revert-changes-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("revert-changes-modal").className).toMatch(/awsui_hidden/);
    });
    expect(revertAssignments).toHaveBeenCalledTimes(1);
    expect(revertAssignments).toHaveBeenCalledWith();
    expect(saveAssignment).not.toHaveBeenCalled();
    const notice = await screen.findByTestId("matrix-revert-notice");
    expect(notice.textContent).toContain("1 件の変更を取り消しました");
    await waitFor(() => {
      expect(cell(deploy.arn).checked).toBe(false);
    });
    // 取り消した列の変更件数は 0 になり、選択から外れる（DF-4）。選択が外れる更新は読み直しの後の描画で起きるので、待つ。
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("0 件の IAMロールを選択中");
    });
  });

  it("確定の処理中は進行形にし、二重に押せない（GI-7）", async () => {
    await renderScreen(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    let resolve!: (value: Awaited<ReturnType<typeof api.revertAssignments>>) => void;
    revertAssignments.mockReturnValue(new Promise((r) => (resolve = r)));
    await openConfirm();

    fireEvent.click(screen.getByTestId("revert-changes-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId("revert-changes-confirm").textContent).toContain("取り消し中");
    });
    fireEvent.click(screen.getByTestId("revert-changes-confirm"));
    expect(revertAssignments).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ reverted: 1, skippedRoleArns: [], failures: [] });
    });
  });

  it("API が失敗したらモーダルを閉じずに理由を出し、変更は残る（GI-6）", async () => {
    await renderScreen(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    revertAssignments.mockRejectedValue(new Error("通信できませんでした"));
    await openConfirm();

    fireEvent.click(screen.getByTestId("revert-changes-confirm"));

    const error = await screen.findByTestId("revert-changes-error");
    expect(error.textContent).toContain("通信できませんでした");
    expect(screen.getByTestId("revert-changes-modal")).toBeTruthy();
    expect(cell(deploy.arn).checked).toBe(true);
  });

  it("一部の交点が失敗したら、戻せた分は読み直して反映し、失敗を握りつぶさず示す", async () => {
    await renderScreen(
      matrix({ assignments: [assignment(deploy.arn, true, false), assignment(audit.arn, true, false)] }),
    );
    revertAssignments.mockResolvedValue({
      reverted: 1,
      skippedRoleArns: [],
      failures: [{ userArn: ayaka.arn, roleArn: audit.arn, message: "DynamoDB の UpdateItem に失敗しました" }],
    });
    getMatrix.mockResolvedValue(
      matrix({ assignments: [assignment(deploy.arn, false, false), assignment(audit.arn, true, false)] }),
    );
    await openConfirm();

    fireEvent.click(screen.getByTestId("revert-changes-confirm"));

    const error = await screen.findByTestId("matrix-revert-error");
    expect(error.textContent).toContain("1 件を取り消せませんでした");
    expect(error.textContent).toContain("RolustManaged-ReadOnlyAudit");
    expect(error.textContent).toContain("もう一度");
    await waitFor(() => {
      expect(cell(deploy.arn).checked).toBe(false);
    });
    expect(cell(audit.arn).checked).toBe(true);
  });
});

describe("ソート・フィルタの条件のリセット（Issue #91 / D-6・D-7）", () => {
  it("条件を付けると行が絞られ、別のマトリクスに替えると条件がリセットされる", async () => {
    getMatrix.mockResolvedValue(matrix());
    const view = render(<MatrixScreen />);
    await screen.findByTestId("assignment-matrix-table");

    // 交点が無いので「チェックあり」で 0 件になる。
    fireEvent.click(screen.getByTestId(`role-menu-${deploy.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));
    expect(screen.getByTestId("matrix-no-match")).toBeDefined();
    expect(screen.getByTestId(`role-badge-${deploy.arn}`)).toBeDefined();

    // 画面を付け直す（別画面から戻った場合など）。条件は持ち越さない。
    view.unmount();
    render(<MatrixScreen />);
    await screen.findByTestId("assignment-matrix-table");

    expect(screen.queryByTestId("matrix-no-match")).toBeNull();
    expect(screen.queryByTestId(`role-badge-${deploy.arn}`)).toBeNull();
    expect(screen.getByTestId(`user-row-${ayaka.arn}`)).toBeDefined();
  });

  it("マトリクスを読み直すと（変更を取り消した後）条件がリセットされる", async () => {
    await renderScreen(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    revertAssignments.mockResolvedValue({ reverted: 1, skippedRoleArns: [], failures: [] });
    getMatrix.mockResolvedValue(matrix({ assignments: [assignment(deploy.arn, false, false)] }));

    // 「チェックなし」で絞ると ayaka の行は消える（deploy はチェックあり）。
    fireEvent.click(screen.getByTestId(`role-menu-${deploy.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-filter-unchecked"));
    expect(screen.getByTestId("matrix-no-match")).toBeDefined();

    fireEvent.click(screen.getByTestId("matrix-revert-changes"));
    await screen.findByTestId("revert-changes-modal");
    fireEvent.click(screen.getByTestId("revert-changes-confirm"));

    await waitFor(() => {
      expect(screen.getByTestId(`user-row-${ayaka.arn}`)).toBeDefined();
    });
    expect(screen.queryByTestId("matrix-no-match")).toBeNull();
    expect(screen.queryByTestId(`role-badge-${deploy.arn}`)).toBeNull();
  });
});

describe("属性の項目（Issue #107）", () => {
  it("プールの属性の項目とユーザの属性値がマトリクスに出る。属性の項目が 0 件のプールでは出ない", async () => {
    const withAttributes = matrix({
      pool: { ...pool, attributeColumns: [{ columnId: "c1", name: "部署" }] },
      users: [{ ...ayaka, attributes: { c1: "開発" } }],
    });
    await renderScreen(withAttributes);

    expect(screen.getByTestId("attr-column-c1").textContent).toContain("部署");
    expect(screen.getByTestId(`attr-cell-${ayaka.arn}-c1`).textContent).toBe("開発");

    cleanup();
    await renderScreen(matrix());
    expect(document.querySelector('[data-testid^="attr-column-"]')).toBeNull();
  });

  it("識別子が無い（ActorProvider なし）とき、マトリクスを付け直すと、畳みは初期状態に戻る（保存しない。#91 の D-7。識別子があれば残る: Issue #140・FR-3.6）", async () => {
    const withAttributes = matrix({
      pool: { ...pool, attributeColumns: [{ columnId: "c1", name: "部署" }] },
      users: [{ ...ayaka, attributes: { c1: "開発" } }],
    });
    await renderScreen(withAttributes);
    fireEvent.click(screen.getByTestId("attr-fold-c1"));
    expect(screen.getByTestId("attr-open-c1")).toBeDefined();

    // プールの切り替えと同じく、AssignmentMatrix を外して付け直す（画面が読み込み中の表示を挟む）。
    cleanup();
    await renderScreen(withAttributes);

    expect(screen.getByTestId("attr-fold-c1")).toBeDefined();
    expect(screen.queryByTestId("attr-open-c1")).toBeNull();
  });
});

describe("列の非表示と申請（Issue #140。spec D-5・D-13）", () => {
  function seedHidden(roleArns: string[]): void {
    window.localStorage.setItem(
      hiddenKey("sub-1"),
      JSON.stringify({ roleArns, foldedColumnIds: [] }),
    );
  }

  async function renderAsAdmin(view: MatrixView, sub = "sub-1"): Promise<void> {
    getMatrix.mockResolvedValue(view);
    render(
      <ActorProvider value={sub}>
        <MatrixScreen />
      </ActorProvider>,
    );
    await screen.findByTestId("assignment-matrix-table");
  }

  it("変更のある非表示ロールは、読み込み直しても自動選択されず、申請に入らない（D-13）", async () => {
    seedHidden([audit.arn]);
    await renderAsAdmin(
      matrix({
        assignments: [assignment(deploy.arn, true, false), assignment(audit.arn, true, false)],
      }),
    );

    // 隠していないロールだけが自動選択される。
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("1 件の IAMロールを選択中");
    });
    expect(screen.queryByTestId(`role-column-${audit.arn}`)).toBeNull();

    createChangeRequests.mockResolvedValue({ created: [], excluded: [], failures: [] });
    await act(async () => {
      fireEvent.click(screen.getByTestId("matrix-create-requests"));
      await Promise.resolve();
    });

    expect(createChangeRequests).toHaveBeenCalledWith({ roleArns: [deploy.arn] });
  });

  it("隠した列を再表示しても、自動では選択されない（D-13）", async () => {
    seedHidden([audit.arn]);
    await renderAsAdmin(matrix({ assignments: [assignment(audit.arn, true, false)] }));

    fireEvent.click(screen.getByTestId("matrix-hidden-button"));
    fireEvent.click(screen.getByTestId(`matrix-hidden-show-${audit.arn}`));

    const select = screen.getByTestId(`role-select-${audit.arn}`) as HTMLInputElement;
    expect(select.checked).toBe(false);
    expect(screen.getByTestId("matrix-counts").textContent).not.toContain("1 件の IAMロールを選択中");
  });

  it("選択中の列は隠せない。選択を外すと隠せて、隠しても選択は変わらない（D-5）", async () => {
    await renderAsAdmin(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("1 件の IAMロールを選択中");
    });

    fireEvent.click(screen.getByTestId(`role-menu-${deploy.arn}`));
    expect(screen.getByTestId("column-menu-hide").getAttribute("aria-disabled")).toBe("true");
    fireEvent.keyDown(screen.getByTestId("column-menu"), { key: "Escape" });

    fireEvent.click(screen.getByTestId(`role-select-${deploy.arn}`)); // 選択を外す
    fireEvent.click(screen.getByTestId(`role-menu-${deploy.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-hide"));

    expect(screen.queryByTestId(`role-column-${deploy.arn}`)).toBeNull();
    expect(screen.getByTestId("matrix-counts").textContent).not.toContain("1 件の IAMロールを選択中");
  });

  it("隠した状態は、画面を読み込み直しても（マウントし直しても）残る", async () => {
    await renderAsAdmin(matrix());
    fireEvent.click(screen.getByTestId(`role-menu-${audit.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-hide"));
    expect(screen.queryByTestId(`role-column-${audit.arn}`)).toBeNull();

    cleanup();
    await renderAsAdmin(matrix());

    expect(screen.queryByTestId(`role-column-${audit.arn}`)).toBeNull();
    expect(screen.getByTestId(`role-column-${deploy.arn}`)).toBeTruthy();
  });

  it("別の管理者（別の sub）の隠した列は、自分には効かない", async () => {
    seedHidden([audit.arn]); // sub-1 の状態
    await renderAsAdmin(matrix(), "sub-2");

    expect(screen.getByTestId(`role-column-${audit.arn}`)).toBeTruthy();
  });

  it("登録解除されたロールの保存は、読み込み後に捨てられ、再登録しても隠れた列として復活しない（D-9）", async () => {
    seedHidden([audit.arn]);
    // audit が登録されていないマトリクスで開く。
    await renderAsAdmin(matrix({ roles: [deploy] }));
    expect(JSON.parse(window.localStorage.getItem(hiddenKey("sub-1")) ?? "{}")).toEqual({
      roleArns: [],
      foldedColumnIds: [],
    });

    cleanup();
    await renderAsAdmin(matrix({ roles: [deploy, audit] })); // 再登録

    expect(screen.getByTestId(`role-column-${audit.arn}`)).toBeTruthy();
  });
});

describe("英語の表示（Issue #94）", () => {
  async function renderEn(view: MatrixView = matrix()): Promise<void> {
    getMatrix.mockResolvedValue(view);
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <MatrixScreen />
      </LocaleProvider>,
    );
    await screen.findByTestId("assignment-matrix-table");
  }

  async function clickCreate(): Promise<void> {
    await act(async () => {
      fireEvent.click(screen.getByTestId("matrix-create-requests"));
      await Promise.resolve();
    });
  }

  it("見出し・件数・主操作が英語になる", async () => {
    await renderEn();

    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Role assignments");
    expect(screen.getByTestId("page-heading-counts").textContent).toBe("IAM users 1 / IAM roles 2");
    expect(screen.getByTestId("matrix-counts").textContent).toBe(
      "0 IAM roles selected · 0 IAM roles excluded · No changes",
    );
    expect(screen.getByTestId("matrix-create-requests").textContent).toBe("Create requests");
    expect(screen.getByTestId("matrix-revert-changes").textContent).toBe("Revert changes");
    expect(screen.getByTestId("matrix-saved").textContent).toBe("Saved");
    expect(screen.getByTestId("matrix-legend").textContent).toContain("Add");
    expect(cell(deploy.arn).getAttribute("aria-label")).toBe(
      "Assign RolustManaged-DeployProd to ayaka.mori",
    );
  });

  it("件数の単数・複数が英語の文法に従う", async () => {
    await renderEn(
      matrix({ assignments: [assignment(deploy.arn, true, false), assignment(audit.arn, true, false)] }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toBe(
        "2 IAM roles selected · 0 IAM roles excluded · 2 changes",
      );
    });
    cleanup();
    await renderEn(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toBe(
        "1 IAM role selected · 0 IAM roles excluded · 1 change",
      );
    });
  });

  it("ロールが 0 件のときの案内が英語になる", async () => {
    getMatrix.mockResolvedValue({ ...matrix(), roles: [], assignments: [], locks: {} });
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <MatrixScreen />
      </LocaleProvider>,
    );

    const empty = await screen.findByTestId("matrix-empty");
    expect(empty.textContent).toContain("No IAM roles are registered");
    expect(empty.textContent).toContain(
      "Once you register an IAM role, it is shown as a column of Role assignments.",
    );
    expect(screen.getByTestId("matrix-register-roles-empty").textContent).toBe("Go to IAM roles");
  });

  it("除外の帯が英語になる", async () => {
    await renderEn(
      matrix({ assignments: [assignment(audit.arn, true, false)], locks: { [audit.arn]: draftLock } }),
    );

    const banner = screen.getByTestId("exclusion-banner");
    expect(banner.textContent).toContain("No IAM roles can be requested");
    expect(banner.textContent).toContain("Because unapplied requests remain");
    expect(screen.getByTestId(`exclusion-link-${audit.arn}`).textContent).toBe("There is 1 draft request");
    expect(screen.getByTestId(`role-chip-${audit.arn}`).textContent).toBe("Draft");
  });

  it("取り消しの完了通知が、件数の単数・複数と対象外の件数つきで英語になる", async () => {
    await renderEn(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    getMatrix.mockResolvedValue(matrix());
    revertAssignments.mockResolvedValueOnce({ reverted: 1, skippedRoleArns: [], failures: [] });
    fireEvent.click(screen.getByTestId("matrix-revert-changes"));
    const dialog = await screen.findByTestId("revert-changes-modal");
    expect(dialog.textContent).toContain("1 unapplied change (1 IAM role) will be reverted");
    fireEvent.click(screen.getByTestId("revert-changes-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-revert-notice").textContent).toBe("Reverted 1 change");
    });

    cleanup();
    await renderEn(
      matrix({ assignments: [assignment(deploy.arn, true, false), assignment(audit.arn, true, false)] }),
    );
    revertAssignments.mockResolvedValueOnce({
      reverted: 2,
      skippedRoleArns: [audit.arn, deploy.arn],
      failures: [],
    });
    fireEvent.click(screen.getByTestId("matrix-revert-changes"));
    await screen.findByTestId("revert-changes-modal");
    fireEvent.click(screen.getByTestId("revert-changes-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-revert-notice").textContent).toBe(
        "Reverted 2 changes (2 IAM roles were excluded because they have unapplied requests)",
      );
    });
  });

  it("取り消しの一部の失敗が、localized を英語に描画して並ぶ", async () => {
    await renderEn(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    revertAssignments.mockResolvedValueOnce({
      reverted: 1,
      skippedRoleArns: [],
      failures: [
        {
          userArn: ayaka.arn,
          roleArn: audit.arn,
          message: "ロールは登録されていません",
          localized: { id: "role.notRegistered", params: { roleArn: audit.arn } },
        },
      ],
    });
    fireEvent.click(screen.getByTestId("matrix-revert-changes"));
    await screen.findByTestId("revert-changes-modal");
    fireEvent.click(screen.getByTestId("revert-changes-confirm"));

    const error = await screen.findByTestId("matrix-revert-error");
    expect(error.textContent).toContain("1 change could not be reverted");
    expect(error.textContent).toContain("1 change was reverted.");
    expect(error.textContent).toContain(`The IAM role is not registered: ${audit.arn}`);
    expect(error.textContent).not.toContain("登録されていません");
  });

  it("申請の作成の失敗が、localized を英語に描画して並ぶ", async () => {
    await renderEn(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("1 IAM role selected");
    });
    createChangeRequests.mockResolvedValue({
      created: [],
      excluded: [],
      failures: [
        {
          roleArn: deploy.arn,
          message: "ロックの取得に失敗しました",
          localized: { id: "role.notRegistered", params: { roleArn: deploy.arn } },
        },
      ],
    });

    await clickCreate();

    const notice = await screen.findByTestId("matrix-creation-notice");
    expect(notice.textContent).toContain("Could not create requests for 1 IAM role");
    expect(notice.textContent).toContain(
      `RolustManaged-DeployProd — The IAM role is not registered: ${deploy.arn}`,
    );
    expect(notice.textContent).not.toContain("ロック");
  });

  it("作成できる申請が無いときの理由が英語になる", async () => {
    await renderEn(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("1 IAM role selected");
    });
    createChangeRequests.mockResolvedValue({
      created: [],
      excluded: [{ roleArn: deploy.arn, reason: "draft", changeRequestId: "cr-0142" }],
      failures: [],
    });

    await clickCreate();

    const notice = await screen.findByTestId("matrix-creation-notice");
    expect(notice.textContent).toContain("No requests could be created");
    expect(notice.textContent).toContain("RolustManaged-DeployProd — There is 1 draft request");
  });

  it("保存の失敗は、API の localized を英語に描画する", async () => {
    await renderEn();
    saveAssignment.mockRejectedValue(
      new ApiClientError(404, {
        code: "NotFound",
        message: "ロールは登録されていません",
        localized: { id: "role.notRegistered", params: { roleArn: deploy.arn } },
      }),
    );

    fireEvent.click(cell(deploy.arn));

    const error = await screen.findByTestId("matrix-save-error");
    expect(error.textContent).toContain("Could not save the assignment (RolustManaged-DeployProd)");
    expect(error.textContent).toContain(`The IAM role is not registered: ${deploy.arn}`);
    expect(error.textContent).not.toContain("登録されていません");
  });

  it("読み込みの失敗の見出しが英語になる", async () => {
    getMatrix.mockRejectedValue(new Error("boom"));
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <MatrixScreen />
      </LocaleProvider>,
    );

    const panel = await screen.findByTestId("matrix-error");
    expect(panel.textContent).toContain("Could not load the role assignments");
  });
});

describe("通知は、表示中の言語に追随する（Issue #94）", () => {
  /** 言語を切り替えるボタン（Provider の外に出せない言語切り替えの代わり）。 */
  function SwitchToJa(): React.JSX.Element {
    const { setLocale } = useLocale();
    return (
      <button type="button" data-testid="to-ja" onClick={() => setLocale("ja")}>
        ja
      </button>
    );
  }

  async function renderEn(view: MatrixView): Promise<void> {
    getMatrix.mockResolvedValue(view);
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <MatrixScreen />
        <SwitchToJa />
      </LocaleProvider>,
    );
    await screen.findByTestId("assignment-matrix-table");
  }

  const notRegistered = (message: string): ApiClientError =>
    new ApiClientError(404, {
      code: "NotFound",
      message,
      localized: { id: "role.notRegistered", params: { roleArn: deploy.arn } },
    });

  it("保存の失敗の帯（常駐）は、言語を切り替えると日本語になる", async () => {
    await renderEn(matrix());
    saveAssignment.mockRejectedValue(notRegistered("ロールは登録されていません"));
    fireEvent.click(cell(deploy.arn));

    const error = await screen.findByTestId("matrix-save-error");
    expect(error.textContent).toContain("Could not save the assignment (RolustManaged-DeployProd)");

    fireEvent.click(screen.getByTestId("to-ja"));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-save-error").textContent).toContain("割り当てを保存できませんでした（RolustManaged-DeployProd）");
    });
    expect(screen.getByTestId("matrix-save-error").textContent).toContain("IAM ロールが登録されていません");
    expect(screen.getByTestId("matrix-save-error").textContent).not.toContain("Could not save");
  });

  it("取り消しの完了通知は、言語を切り替えると日本語になる", async () => {
    await renderEn(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    getMatrix.mockResolvedValue(matrix());
    revertAssignments.mockResolvedValue({ reverted: 1, skippedRoleArns: [], failures: [] });
    fireEvent.click(screen.getByTestId("matrix-revert-changes"));
    await screen.findByTestId("revert-changes-modal");
    fireEvent.click(screen.getByTestId("revert-changes-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-revert-notice").textContent).toBe("Reverted 1 change");
    });

    fireEvent.click(screen.getByTestId("to-ja"));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-revert-notice").textContent).toBe("1 件の変更を取り消しました");
    });
  });

  it("申請の作成の通知（見出しと行）は、言語を切り替えると日本語になる", async () => {
    await renderEn(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-counts").textContent).toContain("1 IAM role selected");
    });
    createChangeRequests.mockResolvedValue({
      created: [],
      excluded: [{ roleArn: deploy.arn, reason: "draft", changeRequestId: "cr-0142" }],
      failures: [],
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId("matrix-create-requests"));
      await Promise.resolve();
    });
    const notice = await screen.findByTestId("matrix-creation-notice");
    expect(notice.textContent).toContain("No requests could be created");

    fireEvent.click(screen.getByTestId("to-ja"));
    await waitFor(() => {
      expect(screen.getByTestId("matrix-creation-notice").textContent).toContain("作成できる申請がありませんでした");
    });
    expect(screen.getByTestId("matrix-creation-notice").textContent).toContain("RolustManaged-DeployProd — ");
    expect(screen.getByTestId("matrix-creation-notice").textContent).not.toContain("draft request");
  });

  it("取り消しの確認モーダルの失敗は、開いたまま言語を切り替えると日本語になる", async () => {
    await renderEn(matrix({ assignments: [assignment(deploy.arn, true, false)] }));
    revertAssignments.mockRejectedValue(notRegistered("ロールは登録されていません"));
    fireEvent.click(screen.getByTestId("matrix-revert-changes"));
    await screen.findByTestId("revert-changes-modal");
    fireEvent.click(screen.getByTestId("revert-changes-confirm"));
    const error = await screen.findByTestId("revert-changes-error");
    expect(error.textContent).toContain("The IAM role is not registered");

    fireEvent.click(screen.getByTestId("to-ja"));
    await waitFor(() => {
      expect(screen.getByTestId("revert-changes-error").textContent).toContain("IAM ロールが登録されていません");
    });
    expect(screen.getByTestId("revert-changes-error").textContent).not.toContain("The IAM role");
  });
});
