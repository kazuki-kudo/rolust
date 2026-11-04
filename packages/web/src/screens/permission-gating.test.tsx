// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  Assignment,
  ChangeRequest,
  DiffView,
  IamRole,
  IamUser,
  MatrixView,
  Permission,
  PoolView,
  RoleView,
  UserPool,
} from "@rolust/core";
import { buildRoleArn, buildUserArn } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { PermissionProvider } from "../permission.js";
import { isBlocked } from "../testing/blocked.js";
import { DiffScreen } from "./DiffScreen.js";
import { HistoryScreen } from "./HistoryScreen.js";
import { MatrixScreen } from "./MatrixScreen.js";
import { PoolScreen } from "./PoolScreen.js";
import { RolesScreen } from "./RolesScreen.js";

/**
 * 権限が足りない操作を、各画面が無効にする（Issue #141）。拒否そのものは API が行う（`http.permission.test.ts`）。
 * ここで固定するのは、画面が「操作の入口」を権限で無効にし、権限があれば有効のままであること。
 */

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: {
      getDiff: vi.fn(),
      applyChangeRequests: vi.fn(),
      getMatrix: vi.fn(),
      saveAssignment: vi.fn(),
      revertAssignments: vi.fn(),
      createChangeRequests: vi.fn(),
      listRoles: vi.fn(),
      getConfig: vi.fn(),
      createRole: vi.fn(),
      updateRoleFields: vi.fn(),
      updateRoleColor: vi.fn(),
      deleteRole: vi.fn(),
      reorderRoles: vi.fn(),
      getDrift: vi.fn(),
      restoreDrift: vi.fn(),
      adoptDrift: vi.fn(),
      getPool: vi.fn(),
      addUsers: vi.fn(),
      deleteUser: vi.fn(),
      saveAttributeColumns: vi.fn(),
      saveUserAttributes: vi.fn(),
      listChangeRequests: vi.fn(),
      discardChangeRequest: vi.fn(),
    },
  };
});

const POOL_ID = "platform-team";
const USER_ACCOUNT = "111122223333";
const ROLE_ACCOUNT = "555566667777";
const AYAKA = buildUserArn(USER_ACCOUNT, "ayaka.mori");
const DEPLOY = buildRoleArn(ROLE_ACCOUNT, "RolustManaged-DeployProd");
const CR_ID = "cr-0142";

const pool: UserPool = { poolId: POOL_ID, createdAt: "2026-07-30T00:00:00.000Z", attributeColumns: [] };
const ayaka: IamUser = {
  poolId: POOL_ID,
  accountId: USER_ACCOUNT,
  userName: "ayaka.mori",
  arn: AYAKA,
  createdAt: "2026-07-30T00:00:00.000Z",
  attributes: {},
};
const deployRole: IamRole = {
  accountId: ROLE_ACCOUNT,
  roleName: "RolustManaged-DeployProd",
  arn: DEPLOY,
  description: "本番デプロイ用",
  displayName: null,
  color: null,
  createdAt: "2026-07-30T00:00:00.000Z",
};

function changeRequest(status: ChangeRequest["status"], id = CR_ID): ChangeRequest {
  return {
    changeRequestId: id,
    poolId: POOL_ID,
    roleArn: DEPLOY,
    addUserArns: [AYAKA],
    removeUserArns: [],
    status,
    createdAt: "2026-07-31T10:04:00.000Z",
    createdBy: null,
    appliedAt: null,
    appliedBy: null,
    result: null,
  };
}

const readable: DiffView = {
  changeRequest: changeRequest("draft"),
  diff: {
    roleArn: DEPLOY,
    added: [AYAKA],
    removed: [],
    alreadyPresent: [],
    alreadyAbsent: [],
    changed: true,
    placeholderInjected: false,
    placeholderRemoved: false,
  },
  unmanaged: [],
  readError: null,
};

function withPermission(permission: Permission, ui: React.ReactNode): React.JSX.Element {
  return <PermissionProvider value={permission}>{ui}</PermissionProvider>;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  window.history.pushState({}, "", "/");
});
afterEach(() => {
  cleanup();
});

// 操作の入口が、どの権限から有効になるか。
const PERMISSIONS: Permission[] = ["none", "view", "edit", "apply"];
const RANK = { none: 0, view: 1, edit: 2, apply: 3 };
function expectedBlocked(permission: Permission, need: "edit" | "apply"): boolean {
  return RANK[permission] < RANK[need];
}

describe("画面 4 差分確認・反映", () => {
  it.each(PERMISSIONS)("権限 %s: 反映ボタンは apply のときだけ有効", async (permission) => {
    vi.mocked(api.getDiff).mockResolvedValue(readable);
    render(withPermission(permission, <DiffScreen query={new URLSearchParams(`ids=${CR_ID}`)} />));

    await waitFor(() => {
      expect(screen.getByTestId("diff-apply-selected").textContent).toContain("選択した 1 件を反映");
    });
    expect(isBlocked(screen.getByTestId("diff-apply-selected"))).toBe(expectedBlocked(permission, "apply"));
  });
});

describe("画面 3 IAMロール割り当て", () => {
  const assignment = {
    poolId: POOL_ID,
    userArn: AYAKA,
    roleArn: DEPLOY,
    checked: true,
    reflected: false,
  } as unknown as Assignment;
  const view: MatrixView = { pool, users: [ayaka], roles: [deployRole], assignments: [assignment], locks: {} };

  it.each(PERMISSIONS)("権限 %s: セルは edit のときから操作できる", async (permission) => {
    vi.mocked(api.getMatrix).mockResolvedValue(view);
    render(withPermission(permission, <MatrixScreen />));
    await screen.findByTestId("assignment-matrix-table");

    expect(isBlocked(screen.getByTestId(`cell-${AYAKA}-${DEPLOY}`))).toBe(expectedBlocked(permission, "edit"));
  });

  it.each(PERMISSIONS)("権限 %s: 変更を取り消す・申請を作成する は、権限が足りないとき必ず無効", async (permission) => {
    vi.mocked(api.getMatrix).mockResolvedValue(view);
    render(withPermission(permission, <MatrixScreen />));
    await screen.findByTestId("assignment-matrix-table");

    if (expectedBlocked(permission, "edit")) {
      expect(isBlocked(screen.getByTestId("matrix-revert-changes"))).toBe(true);
      expect(isBlocked(screen.getByTestId("matrix-create-requests"))).toBe(true);
    }
  });

  it("edit で、未反映の変更があれば申請を作成できる（権限だけで無効にしていない）", async () => {
    vi.mocked(api.getMatrix).mockResolvedValue(view);
    render(withPermission("edit", <MatrixScreen />));
    await screen.findByTestId("assignment-matrix-table");

    expect(isBlocked(screen.getByTestId("matrix-revert-changes"))).toBe(false);
  });

  it("view のとき、ロール見出しのチェックボックスも操作できない", async () => {
    vi.mocked(api.getMatrix).mockResolvedValue(view);
    render(withPermission("view", <MatrixScreen />));
    await screen.findByTestId("assignment-matrix-table");

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes.length).toBeGreaterThan(1);
    for (const box of boxes) expect(isBlocked(box)).toBe(true);
  });
});

describe("画面 2 IAMロール管理", () => {
  const roleView: RoleView = {
    ...deployRole,
    unreflected: null,
    assignments: { total: 0, pending: 0 },
  };

  it.each(PERMISSIONS)("権限 %s: 登録・並べ替え・編集・削除は edit のときから有効", async (permission) => {
    // 「並び順を編集」は 2 件以上のときだけ出る。
    const second: RoleView = {
      ...roleView,
      roleName: "RolustManaged-ReadOnlyAudit",
      arn: buildRoleArn(ROLE_ACCOUNT, "RolustManaged-ReadOnlyAudit"),
    };
    vi.mocked(api.listRoles).mockResolvedValue({ roles: [roleView, second] });
    vi.mocked(api.getConfig).mockResolvedValue({ managedTagKey: "rolust:managed", managedTagValue: "true" });
    render(withPermission(permission, <RolesScreen />));
    await screen.findByText("RolustManaged-DeployProd");

    const blocked = expectedBlocked(permission, "edit");
    for (const id of [
      "create-role-button",
      "roles-order-start",
      `edit-role-description-${DEPLOY}`,
      `edit-role-color-${DEPLOY}`,
      `delete-role-${DEPLOY}`,
    ]) {
      expect(isBlocked(screen.getByTestId(id)), id).toBe(blocked);
    }
  });

  it.each(PERMISSIONS)("権限 %s: 信頼ポリシーの確認は読み取りだけなので、どの権限でも有効（FR-4.9）", async (permission) => {
    vi.mocked(api.listRoles).mockResolvedValue({ roles: [roleView] });
    vi.mocked(api.getConfig).mockResolvedValue({ managedTagKey: "rolust:managed", managedTagValue: "true" });
    render(withPermission(permission, <RolesScreen />));
    await screen.findByText("RolustManaged-DeployProd");

    expect(isBlocked(screen.getByTestId("roles-drift-check"))).toBe(false);
  });
});

describe("画面 2 乖離を直す操作（Issue #172。FR-4.10・FR-4.11）", () => {
  const AUDIT = buildRoleArn(ROLE_ACCOUNT, "RolustManaged-ReadOnlyAudit");
  const auditView: RoleView = {
    ...deployRole,
    roleName: "RolustManaged-ReadOnlyAudit",
    arn: AUDIT,
    unreflected: null,
    assignments: { total: 0, pending: 0 },
  };

  it.each(PERMISSIONS)("権限 %s: restore・adopt は edit のときから有効（apply は要らない）", async (permission) => {
    vi.mocked(api.listRoles).mockResolvedValue({ roles: [auditView] });
    vi.mocked(api.getConfig).mockResolvedValue({ managedTagKey: "rolust:managed", managedTagValue: "true" });
    vi.mocked(api.getDrift).mockResolvedValue({
      checkedAt: "2026-10-16T00:00:00.000Z",
      roles: [{ roleArn: AUDIT, status: "drift", missing: [AYAKA], extra: [], unmanaged: [], readError: null }],
    });
    render(withPermission(permission, <RolesScreen />));
    await screen.findByText("RolustManaged-ReadOnlyAudit");
    fireEvent.click(screen.getByTestId("roles-drift-check"));
    fireEvent.click(await screen.findByTestId(`role-drift-detail-${AUDIT}`));

    const blocked = expectedBlocked(permission, "edit");
    for (const id of ["drift-restore", "drift-adopt"]) {
      const element = await screen.findByTestId(id);
      expect(isBlocked(element.querySelector("button") ?? element), id).toBe(blocked);
    }
  });
});

describe("画面 1 ユーザプール管理", () => {
  const poolView: PoolView = {
    poolId: POOL_ID,
    createdAt: "2026-07-30T00:00:00.000Z",
    users: [ayaka],
    linkedRoleCount: 0,
    // 「属性一括編集モード」は属性の項目があるときだけ出る。
    attributeColumns: [{ columnId: "col-1", name: "チーム" }],
  };

  it.each(PERMISSIONS)("権限 %s: 登録・属性・編集モード・削除は edit のときから有効", async (permission) => {
    vi.mocked(api.getPool).mockResolvedValue({ pool: poolView });
    render(withPermission(permission, <PoolScreen />));
    await screen.findByTestId("pool-users");
    await screen.findByText(/^IAMユーザ \d+ 件/);

    const blocked = expectedBlocked(permission, "edit");
    for (const id of [
      "add-users",
      "edit-attribute-columns",
      "edit-mode-start",
      `edit-user-attributes-${AYAKA}`,
      `delete-user-${AYAKA}`,
    ]) {
      expect(isBlocked(screen.getByTestId(id)), id).toBe(blocked);
    }
  });
});

describe("画面 5 申請履歴", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(PERMISSIONS)(
    "権限 %s: 破棄は edit のときから有効。再開・再反映は画面 4 へ移るだけなので常に有効",
    async (permission) => {
      vi.mocked(api.listChangeRequests).mockResolvedValue({
        changeRequests: [changeRequest("draft"), changeRequest("failed", "cr-0143")],
      });
      render(withPermission(permission, <HistoryScreen highlight={null} />));
      await screen.findByTestId(`history-resume-${CR_ID}`);

      expect(isBlocked(screen.getByTestId(`history-discard-${CR_ID}`))).toBe(expectedBlocked(permission, "edit"));
      expect(isBlocked(screen.getByTestId(`history-resume-${CR_ID}`))).toBe(false);
      expect(isBlocked(screen.getByTestId("history-reapply-cr-0143"))).toBe(false);
    },
  );
});

describe("申請の URL のコピー（Issue #141）。権限によらず、参照だけの人にも出る", () => {
  it("画面 4: カードに申請の ID と URL のコピーが出る", async () => {
    vi.mocked(api.getDiff).mockResolvedValue(readable);
    render(withPermission("view", <DiffScreen query={new URLSearchParams(`ids=${CR_ID}`)} />));

    const link = await screen.findByTestId(`request-link-${CR_ID}`);
    expect(link.textContent).toContain(CR_ID);
    expect(isBlocked(link.querySelector("button") as HTMLElement)).toBe(false);
  });

  it("画面 5: 状態によらず、すべての行の申請 ID の列に URL のコピーが出る（操作列には出ない。Issue #148）", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0));
    try {
      vi.mocked(api.listChangeRequests).mockResolvedValue({
        changeRequests: [
          changeRequest("draft"),
          changeRequest("applied", "cr-0144"),
          changeRequest("discarded", "cr-0145"),
        ],
      });
      render(withPermission("view", <HistoryScreen highlight={null} />));
      await screen.findByTestId(`history-resume-${CR_ID}`);

      for (const id of [CR_ID, "cr-0144", "cr-0145"]) {
        const link = screen.getByTestId(`request-link-${id}`);
        expect(isBlocked(link.querySelector("button") as HTMLElement), id).toBe(false);
        const cell = link.closest("td") as HTMLElement;
        expect(cell.contains(screen.getByTestId(`history-request-id-${id}`)), id).toBe(true);
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
