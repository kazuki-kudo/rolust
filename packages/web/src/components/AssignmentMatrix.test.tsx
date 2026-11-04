// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Assignment, IamRole, IamUser } from "@rolust/core";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api-client.js";
import { AssignmentMatrix } from "./AssignmentMatrix.js";

/**
 * `AssignmentMatrix` のユニットテスト。
 *
 * - FR-3.1: 行 = IamUser、列 = IamRole の N×M が描画される
 * - FR-3.2: チェック操作が AWS への書き込みも ChangeRequest の生成も起こさない
 *
 * FR-3.2 は「起きないこと」の検証なので、部品を単体で叩くだけでは弱い。
 * 実際の `api-client` に配線したうえで `fetch` を観測し、発生した HTTP 呼び出しが
 * 交点 1 件の保存だけであることを確かめる。
 */

const POOL_ID = "platform-team";
const ACCOUNT = "111122223333";
const ROLE_ACCOUNT = "555566667777";

const users: IamUser[] = ["ayaka.mori", "kenji.sato"].map((userName) => ({
  poolId: POOL_ID,
  accountId: ACCOUNT,
  userName,
  arn: `arn:aws:iam::${ACCOUNT}:user/${userName}`,
  createdAt: "2026-07-30T00:00:00.000Z",
  attributes: {},
}));

const roles: IamRole[] = ["DeployProd", "ReadOnlyAudit", "BillingViewer"].map((roleName) => ({
  accountId: ROLE_ACCOUNT,
  roleName,
  arn: `arn:aws:iam::${ROLE_ACCOUNT}:role/${roleName}`,
  description: roleName === "DeployProd" ? "本番デプロイ用" : null,
  displayName: null,
  color: null,
  createdAt: "2026-07-30T00:00:00.000Z",
}));

function assignment(
  userIndex: number,
  roleIndex: number,
  checked: boolean,
  reflected: boolean,
): Assignment {
  return {
    poolId: POOL_ID,
    userArn: users[userIndex]!.arn,
    roleArn: roles[roleIndex]!.arn,
    checked,
    reflected,
    updatedAt: "2026-07-31T00:00:00.000Z",
  };
}

interface FetchCall {
  url: string;
  method: string;
}

const calls: FetchCall[] = [];

function stubFetch(): void {
  const fetchMock = vi.fn((input: unknown, init?: { method?: string }) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () =>
        Promise.resolve(JSON.stringify({ assignment: assignment(0, 0, true, false) })),
    } as unknown as Response);
  });
  vi.stubGlobal("fetch", fetchMock);
}

function renderMatrix(assignments: Assignment[]): void {
  render(
    <AssignmentMatrix
      users={users}
      roles={roles}
      assignments={assignments}
      locks={{}}
      selectedRoleArns={[]}
      savingCells={new Set()}
      toolbarTargetId="matrix-submit-button"
      // 画面と同じ配線: 交点の増減は Assignment 1 件の保存だけを起こす。
      onToggleCell={(userArn, roleArn, next) => {
        void api.saveAssignment({ userArn, roleArn, checked: next });
      }}
      onToggleRole={() => {}}
    />,
  );
}

beforeEach(() => {
  calls.length = 0;
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AssignmentMatrix", () => {
  it("FR-3.1: 行 = IamUser・列 = IamRole の N×M が描画される", () => {
    renderMatrix([assignment(0, 0, true, true)]);

    for (const user of users) {
      expect(screen.getByTestId(`user-row-${user.arn}`)).toBeDefined();
    }
    for (const role of roles) {
      expect(screen.getByTestId(`role-column-${role.arn}`)).toBeDefined();
    }

    // 交点は 2 × 3 = 6 件ちょうど。
    for (const user of users) {
      for (const role of roles) {
        expect(screen.getByTestId(`cell-${user.arn}-${role.arn}`)).toBeDefined();
      }
    }
    expect(document.querySelectorAll('[data-testid^="cell-arn:aws:iam"]')).toHaveLength(6);

    // ヘッダ行 1 + ユーザ行 2
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });

  it("Issue #21: 説明があるロールの列ヘッダは title でツールチップを出す", () => {
    renderMatrix([assignment(0, 0, true, true)]);

    const deployColumn = screen.getByTestId(`role-column-${roles[0]!.arn}`);
    expect(deployColumn.querySelector('[title="本番デプロイ用"]')).not.toBeNull();

    const auditColumn = screen.getByTestId(`role-column-${roles[1]!.arn}`);
    expect(auditColumn.querySelector("[title]")).toBeNull();
  });

  it("FR-3.2: チェック操作は Assignment の保存だけを起こし、AWS 書き込みも ChangeRequest 生成も起こさない", async () => {
    renderMatrix([assignment(0, 0, false, false)]);

    const cell = screen.getByTestId(`cell-${users[0]!.arn}-${roles[0]!.arn}`);
    fireEvent.click(cell);

    await waitFor(() => expect(calls).toHaveLength(1));

    expect(calls[0]).toEqual({
      url: "/api/pool/assignments",
      method: "PUT",
    });
    // ChangeRequest の生成にも、信頼ポリシーの反映にも触れていないこと。
    expect(calls.some((call) => call.url.includes("/change-requests"))).toBe(false);
    expect(calls.some((call) => call.url.includes("/apply"))).toBe(false);
    expect(calls.some((call) => call.url.includes("/diff"))).toBe(false);
  });

  it("エッジケース: 列ヘッダの変更件数は props ではなく assignments と reflected の差から導かれる", () => {
    renderMatrix([
      assignment(0, 0, true, false), // 追加 1 件
      assignment(1, 0, false, true), // 削除 1 件
      assignment(0, 1, true, true), // 変更なし
    ]);

    // DeployProd 列は変更 2 件 → 申請対象として選択できる
    expect(screen.getByTestId(`role-select-${roles[0]!.arn}`)).toBeDefined();
    expect(screen.getByText("申請に含める（変更 2）")).toBeDefined();

    // ReadOnlyAudit 列は変更 0 件 → チェックボックスを描かない
    expect(screen.getByTestId(`role-nochange-${roles[1]!.arn}`)).toBeDefined();
    expect(screen.queryByTestId(`role-select-${roles[1]!.arn}`)).toBeNull();
  });

  it("エッジケース: ロールが 0 件ならマトリクスを描かず、画面 2 でロールを新規登録する導線を出す（Issue #135）", () => {
    const onRegisterRoles = vi.fn();
    render(
      <AssignmentMatrix
        users={users}
        roles={[]}
        assignments={[]}
        locks={{}}
        selectedRoleArns={[]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        onToggleCell={() => {}}
        onToggleRole={() => {}}
        onRegisterRoles={onRegisterRoles}
      />,
    );

    expect(screen.getByTestId("matrix-empty").textContent).toContain("IAMロールが登録されていません");
    expect(screen.getByTestId("matrix-empty").textContent).toContain("IAMロールを新規登録すると、IAMロール割り当ての列として表示されます。");
    expect(screen.queryByTestId("assignment-matrix-table")).toBeNull();
    expect(screen.queryByText("ロールの紐づけ")).toBeNull();
    const button = screen.getByTestId("matrix-register-roles-empty");
    expect(button.textContent).toBe("IAMロール管理へ");
    fireEvent.click(button);
    expect(onRegisterRoles).toHaveBeenCalledTimes(1);
  });
});

describe("ソート・フィルタ（Issue #91）", () => {
  function mount(assignments: Assignment[]): { rerender: (next: Assignment[]) => void } {
    const element = (next: Assignment[]): React.JSX.Element => (
      <AssignmentMatrix
        users={users}
        roles={roles}
        assignments={next}
        locks={{}}
        selectedRoleArns={[]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        onToggleCell={() => {}}
        onToggleRole={() => {}}
      />
    );
    const view = render(element(assignments));
    return { rerender: (next) => view.rerender(element(next)) };
  }

  const visibleUsers = (): string[] =>
    Array.from(document.querySelectorAll('[data-testid^="user-row-"]')).map(
      (element) => element.getAttribute("data-testid")!.replace("user-row-", "").split("/").pop()!,
    );

  const filter = (roleIndex: number, id: string): void => {
    fireEvent.click(screen.getByTestId(`role-menu-${roles[roleIndex]!.arn}`));
    fireEvent.click(screen.getByTestId(`column-menu-filter-${id}`));
  };
  const sort = (roleIndex: number, id: string): void => {
    fireEvent.click(screen.getByTestId(`role-menu-${roles[roleIndex]!.arn}`));
    fireEvent.click(screen.getByTestId(`column-menu-sort-${id}`));
  };

  it("条件が無いときは全行を元の順で出し、件数の行は空（領域は常にある）", () => {
    mount([]);

    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);
    const status = screen.getByTestId("matrix-view-status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe("");
  });

  it("フィルタ「チェックあり」でその列にチェックのある行だけを出し、件数の行とバッジが出る", () => {
    mount([assignment(1, 0, true, true)]);

    filter(0, "checked");

    expect(visibleUsers()).toEqual(["kenji.sato"]);
    expect(screen.getByTestId("matrix-view-status").textContent).toContain("表示 1 / 全 2 行");
    expect(screen.getByTestId(`role-badge-${roles[0]!.arn}`).textContent).toContain(
      "絞り込み: チェックあり",
    );
  });

  it("フィルタ「チェックなし」「未反映の変更あり」", () => {
    mount([assignment(0, 0, true, false), assignment(1, 0, true, true)]);

    filter(0, "unchecked");
    expect(visibleUsers()).toEqual([]);

    filter(0, "changed");
    expect(visibleUsers()).toEqual(["ayaka.mori"]);

    filter(0, "all");
    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);
  });

  it("複数の列のフィルタは AND", () => {
    mount([
      assignment(0, 0, true, true),
      assignment(1, 0, true, true),
      assignment(1, 1, true, true),
    ]);

    filter(0, "checked");
    filter(1, "checked");

    expect(visibleUsers()).toEqual(["kenji.sato"]);
  });

  it("ソートは 1 列だけ。チェックありを上に／チェックなしを上に／解除で元の順に戻る", () => {
    mount([assignment(1, 0, true, true)]);

    sort(0, "checked-first");
    expect(visibleUsers()).toEqual(["kenji.sato", "ayaka.mori"]);
    expect(screen.getByTestId(`role-badge-${roles[0]!.arn}`).textContent).toContain("↑ チェックあり");

    sort(0, "unchecked-first");
    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);

    // 別の列に付けると、前の列のソートのバッジは消える。
    sort(1, "checked-first");
    expect(screen.queryByTestId(`role-badge-${roles[0]!.arn}`)).toBeNull();

    sort(1, "none");
    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);
  });

  it("同値の行はソートしても元の順のまま（安定）", () => {
    mount([]);

    sort(0, "checked-first");

    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);
  });

  it("D-7: 絞り込み中にチェックを外しても、その行は消えない（保存後の assignments の更新で再計算しない）", () => {
    const view = mount([assignment(1, 0, true, true)]);
    filter(0, "checked");
    expect(visibleUsers()).toEqual(["kenji.sato"]);

    // 保存が通って assignments が更新された状況（チェックが外れた）。
    view.rerender([assignment(1, 0, false, true)]);

    expect(visibleUsers()).toEqual(["kenji.sato"]);
  });

  it("D-7: ソート中にチェックを足しても、行は動かない", () => {
    const view = mount([assignment(1, 0, true, true)]);
    sort(0, "checked-first");
    expect(visibleUsers()).toEqual(["kenji.sato", "ayaka.mori"]);

    view.rerender([assignment(1, 0, false, true), assignment(0, 0, true, false)]);

    expect(visibleUsers()).toEqual(["kenji.sato", "ayaka.mori"]);
  });

  it("D-8: 絞り込みで行が減っても、ほかの列の「変更 n」と申請に含める対象は全行で数える", () => {
    // ayaka は ReadOnlyAudit に未反映の変更が 1 件。kenji は DeployProd にチェックあり（反映済み）。
    mount([assignment(0, 1, true, false), assignment(1, 0, true, true)]);

    filter(0, "checked");

    expect(visibleUsers()).toEqual(["kenji.sato"]);
    const audit = screen.getByTestId(`role-column-${roles[1]!.arn}`);
    expect(audit.textContent).toContain("変更 1");
    expect(screen.getByTestId(`role-select-${roles[1]!.arn}`)).toBeDefined();
  });

  it("0 件でも列ヘッダは残り、本体の「すべて解除」で全行に戻る", () => {
    mount([]);

    filter(0, "checked");

    expect(visibleUsers()).toEqual([]);
    expect(screen.getByTestId("matrix-no-match")).toBeDefined();
    expect(screen.getByTestId(`role-column-${roles[0]!.arn}`)).toBeDefined();
    expect(screen.getByTestId("matrix-view-status").textContent).toContain("表示 0 / 全 2 行");

    fireEvent.click(screen.getByTestId("matrix-no-match-clear"));

    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);
    expect(screen.queryByTestId("matrix-no-match")).toBeNull();
    expect(screen.getByTestId("matrix-view-status").textContent).toBe("");
  });

  it("件数の行の「すべて解除」で、フィルタとソートの両方が外れる", () => {
    mount([assignment(1, 0, true, true)]);
    filter(0, "checked");
    sort(1, "checked-first");

    fireEvent.click(screen.getByTestId("matrix-view-clear"));

    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);
    expect(screen.queryByTestId(`role-badge-${roles[0]!.arn}`)).toBeNull();
    expect(screen.queryByTestId(`role-badge-${roles[1]!.arn}`)).toBeNull();
  });
});

describe("ユーザのテキスト絞り込み（Issue #106）", () => {
  function mount(assignments: Assignment[]): { rerender: (next: Assignment[]) => void } {
    const element = (next: Assignment[]): React.JSX.Element => (
      <AssignmentMatrix
        users={users}
        roles={roles}
        assignments={next}
        locks={{}}
        selectedRoleArns={[]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        onToggleCell={() => {}}
        onToggleRole={() => {}}
      />
    );
    const view = render(element(assignments));
    return { rerender: (next) => view.rerender(element(next)) };
  }

  const visibleUsers = (): string[] =>
    Array.from(document.querySelectorAll('[data-testid^="user-row-"]')).map(
      (element) => element.getAttribute("data-testid")!.replace("user-row-", "").split("/").pop()!,
    );
  const input = (): HTMLInputElement =>
    document.querySelector('[data-testid="matrix-user-filter"] input') as HTMLInputElement;
  const type = (value: string): void => {
    fireEvent.change(input(), { target: { value } });
  };

  it("入力欄は Tab 停止点として表の外にあり、ラベルを持つ。表の Tab 停止点は 1 つのまま", () => {
    mount([]);

    expect(input().getAttribute("aria-label")).toBe("IAMユーザを絞り込み");
    expect(screen.getByTestId("assignment-matrix-table").contains(input())).toBe(false);
    expect(
      screen.getByTestId("assignment-matrix-table").querySelectorAll('[tabindex="0"]'),
    ).toHaveLength(1);
  });

  it("ユーザ名の一部を入れると行が絞られ、件数の行が出る（大文字小文字は無視）", () => {
    mount([]);

    type("KENJI");

    expect(visibleUsers()).toEqual(["kenji.sato"]);
    expect(screen.getByTestId("matrix-view-status").textContent).toContain("表示 1 / 全 2 行");
  });

  it("AWSアカウントID でも絞れる", () => {
    mount([]);

    type("1111222");

    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);
  });

  it("列のフィルタと AND で効く", () => {
    mount([assignment(0, 0, true, true), assignment(1, 0, true, true)]);
    fireEvent.click(screen.getByTestId(`role-menu-${roles[0]!.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));

    type("ayaka");

    expect(visibleUsers()).toEqual(["ayaka.mori"]);
  });

  it("D-8: 絞り込みで行が減っても、列ヘッダの「変更 n」は全行で数える", () => {
    mount([assignment(0, 1, true, false), assignment(1, 1, true, false)]);

    type("kenji");

    expect(visibleUsers()).toEqual(["kenji.sato"]);
    expect(screen.getByTestId(`role-column-${roles[1]!.arn}`).textContent).toContain("変更 2");
  });

  it("D-7: 絞り込み中にチェックを外しても、その行は消えない", () => {
    const view = mount([assignment(1, 0, true, true)]);
    fireEvent.click(screen.getByTestId(`role-menu-${roles[0]!.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));
    type("kenji");
    expect(visibleUsers()).toEqual(["kenji.sato"]);

    view.rerender([assignment(1, 0, false, true)]);

    expect(visibleUsers()).toEqual(["kenji.sato"]);
  });

  it("0 件でも列ヘッダと入力欄は残り、本体の「すべて解除」でテキストも空になって全行に戻る", () => {
    mount([]);

    type("nobody");

    expect(visibleUsers()).toEqual([]);
    expect(screen.getByTestId("matrix-no-match")).toBeDefined();
    expect(screen.getByTestId(`role-column-${roles[0]!.arn}`)).toBeDefined();
    expect(input()).toBeDefined();

    fireEvent.click(screen.getByTestId("matrix-no-match-clear"));

    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);
    expect(input().value).toBe("");
  });

  it("件数の行の「すべて解除」で、テキストも列の条件も外れる", () => {
    mount([assignment(1, 0, true, true)]);
    fireEvent.click(screen.getByTestId(`role-menu-${roles[0]!.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));
    type("kenji");

    fireEvent.click(screen.getByTestId("matrix-view-clear"));

    expect(input().value).toBe("");
    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);
    expect(screen.queryByTestId(`role-badge-${roles[0]!.arn}`)).toBeNull();
  });

  it("入力を空に戻すと条件なしに戻る（件数の行は空）", () => {
    mount([]);
    type("kenji");

    type("");

    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato"]);
    expect(screen.getByTestId("matrix-view-status").textContent).toBe("");
  });
});

describe("「すべて解除」の後のフォーカス（Issue #91 の最終レビュー）", () => {
  function mountWith(assignments: Assignment[]): void {
    render(
      <AssignmentMatrix
        users={users}
        roles={roles}
        assignments={assignments}
        locks={{}}
        selectedRoleArns={[]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        onToggleCell={() => {}}
        onToggleRole={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId(`role-menu-${roles[0]!.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));
  }

  const rovingStop = (): Element | null =>
    screen.getByTestId("assignment-matrix-table").querySelector('[tabindex="0"]');

  it("件数の行の「すべて解除」を押すと、ボタンが消えても、フォーカスはマトリクスの Tab 停止点へ移る", () => {
    mountWith([]);
    // キーボード利用者は、ボタンにフォーカスを置いて押す。
    screen.getByTestId("matrix-view-clear").focus();
    expect(document.activeElement).toBe(screen.getByTestId("matrix-view-clear"));

    fireEvent.click(screen.getByTestId("matrix-view-clear"));

    expect(screen.queryByTestId("matrix-view-clear")).toBeNull();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(rovingStop());
  });

  it("0 件の本体の「すべて解除」でも、フォーカスはマトリクスの Tab 停止点へ移る", () => {
    mountWith([]);
    screen.getByTestId("matrix-no-match-clear").focus();

    fireEvent.click(screen.getByTestId("matrix-no-match-clear"));

    expect(screen.queryByTestId("matrix-no-match")).toBeNull();
    expect(document.activeElement).toBe(rovingStop());
  });
});

describe("列の順（Issue #100）", () => {
  it("列は roles の順に並ぶ（サーバが position 順に返した順。画面で並べ替えない。Issue #100）", () => {
    const audit = roles[1]!;
    const deploy = roles[0]!;
    render(
      <AssignmentMatrix
        users={users}
        roles={[audit, deploy]}
        assignments={[]}
        locks={{}}
        selectedRoleArns={[]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        onToggleCell={() => {}}
        onToggleRole={() => {}}
      />,
    );

    const headers = screen.getAllByTestId(/^role-column-/).map((element) => element.getAttribute("data-testid"));
    expect(headers).toEqual([`role-column-${audit.arn}`, `role-column-${deploy.arn}`]);
  });
});

describe("列の表示名（Issue #150）", () => {
  const named: IamRole = { ...roles[0]!, displayName: "本番デプロイ", description: "本番用" };

  function renderNamed(): void {
    render(
      <AssignmentMatrix
        users={users}
        roles={[named, roles[1]!]}
        assignments={[]}
        locks={{}}
        selectedRoleArns={[]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        onToggleCell={() => {}}
        onToggleRole={() => {}}
      />,
    );
  }

  it("表示名のある列は表示名を出し、ホバーに正式名と説明を出す。無い列は正式名のまま", () => {
    renderNamed();

    const header = screen.getByTestId(`role-column-${named.arn}`);
    const name = within(header).getByText("本番デプロイ");
    expect(name.getAttribute("title")).toBe("DeployProd\n本番用");
    expect(within(screen.getByTestId(`role-column-${roles[1]!.arn}`)).getByText("ReadOnlyAudit")).toBeTruthy();
  });

  it("交点の aria-label は表示名を使う", () => {
    renderNamed();

    expect(
      screen.getByLabelText(`${users[0]!.userName} に 本番デプロイ を割り当てる`),
    ).toBeTruthy();
  });

  it("列を隠したときの読み上げも、非表示の一覧も、表示名を使う（spec D-10）", () => {
    renderNamed();

    fireEvent.click(screen.getByTestId(`role-menu-${named.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-hide"));

    expect(screen.getByTestId("matrix-hidden-live").textContent).toBe("本番デプロイ の列を隠しました");
    fireEvent.click(screen.getByTestId("matrix-hidden-button"));
    expect(screen.getByTestId("matrix-hidden-list").textContent).toContain("本番デプロイ");
  });
});

describe("属性の項目（Issue #107）", () => {
  const attributeColumns = [
    { columnId: "c1", name: "部署" },
    { columnId: "c2", name: "役割" },
  ];
  const attributeUsers: IamUser[] = [
    { ...users[0]!, attributes: { c1: "開発", c2: "リーダー" } },
    { ...users[1]!, attributes: { c1: "運用" } },
  ];

  function mountWithAttributes(columnsProp: typeof attributeColumns = attributeColumns): void {
    render(
      <AssignmentMatrix
        users={attributeUsers}
        roles={roles}
        assignments={[]}
        locks={{}}
        selectedRoleArns={[]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        attributeColumns={columnsProp}
        onToggleCell={() => {}}
        onToggleRole={() => {}}
      />,
    );
  }

  it("プールの属性の項目と各ユーザの値が出る。値の無いセルは「—」", () => {
    mountWithAttributes();

    expect(screen.getByTestId("attr-column-c1").textContent).toContain("部署");
    expect(screen.getByTestId(`attr-cell-${attributeUsers[0]!.arn}-c2`).textContent).toBe("リーダー");
    expect(screen.getByTestId(`attr-cell-${attributeUsers[1]!.arn}-c2`).textContent).toBe("—");
  });

  it("属性の項目が 0 件（省略）なら、属性の見出しが出ない", () => {
    mountWithAttributes([]);

    expect(document.querySelector('[data-testid^="attr-column-"]')).toBeNull();
  });
});

describe("属性値のテキスト絞り込みと畳み・開き（Issue #107。#106 の拡張）", () => {
  const attributeColumns = [
    { columnId: "c1", name: "部署" },
    { columnId: "c2", name: "役割" },
  ];
  const attributeUsers: IamUser[] = [
    { ...users[0]!, attributes: { c1: "開発", c2: "リーダー" } },
    { ...users[1]!, attributes: { c1: "運用", c2: "メンバー" } },
  ];

  function mount(assignments: Assignment[] = []): { rerender: (next: Assignment[]) => void } {
    const element = (next: Assignment[]): React.JSX.Element => (
      <AssignmentMatrix
        users={attributeUsers}
        roles={roles}
        assignments={next}
        locks={{}}
        selectedRoleArns={[]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        attributeColumns={attributeColumns}
        onToggleCell={() => {}}
        onToggleRole={() => {}}
      />
    );
    const view = render(element(assignments));
    return { rerender: (next) => view.rerender(element(next)) };
  }

  const visibleUsers = (): string[] =>
    Array.from(document.querySelectorAll('[data-testid^="user-row-"]')).map(
      (element) => element.getAttribute("data-testid")!.replace("user-row-", "").split("/").pop()!,
    );
  const type = (value: string): void => {
    fireEvent.change(document.querySelector('[data-testid="matrix-user-filter"] input') as HTMLInputElement, {
      target: { value },
    });
  };

  it("テキスト絞り込みは、畳んでいない属性値にも当たる", () => {
    mount();

    type("運用");

    expect(visibleUsers()).toEqual(["kenji.sato"]);
    expect(screen.getByTestId("matrix-view-status").textContent).toContain("表示 1 / 全 2 行");
  });

  it("畳んだ列の値は照合から外れる。開くと当たるようになる", () => {
    mount();
    fireEvent.click(screen.getByTestId("attr-fold-c1"));

    type("運用");
    expect(visibleUsers()).toEqual([]);

    fireEvent.click(screen.getByTestId("attr-open-c1"));
    expect(visibleUsers()).toEqual(["kenji.sato"]);
  });

  it("テキストが入っているとき、畳み・開きで結果が確定し直る（畳んだ列の値で絞った行は戻る）", () => {
    mount();
    type("運用");
    expect(visibleUsers()).toEqual(["kenji.sato"]);

    fireEvent.click(screen.getByTestId("attr-fold-c1"));

    expect(visibleUsers()).toEqual([]);
  });

  it("テキストが空なら、畳み・開きで行も順序も動かない（D-7。チェック後の再計算をしない）", () => {
    const view = mount([assignment(1, 0, true, true)]);
    fireEvent.click(screen.getByTestId(`role-menu-${roles[0]!.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));
    expect(visibleUsers()).toEqual(["kenji.sato"]);

    // 保存が通ってチェックが外れた状況。
    view.rerender([assignment(1, 0, false, true)]);
    fireEvent.click(screen.getByTestId("attr-fold-c1"));

    expect(visibleUsers()).toEqual(["kenji.sato"]);
  });

  it("畳み・開きは件数の行や列ヘッダの「変更 n」に影響しない", () => {
    mount([assignment(0, 1, true, false)]);

    fireEvent.click(screen.getByTestId("attr-fold-c2"));

    expect(screen.getByTestId("matrix-view-status").textContent).toBe("");
    expect(screen.getByTestId(`role-column-${roles[1]!.arn}`).textContent).toContain("変更 1");
  });

  it("絞り込み欄のプレースホルダーに属性が入る", () => {
    mount();

    const input = document.querySelector('[data-testid="matrix-user-filter"] input') as HTMLInputElement;
    expect(input.getAttribute("placeholder")).toBe("IAMユーザ名・AWSアカウントID・属性で絞り込み");
  });
});

describe("属性のソート・フィルタ（Issue #107）", () => {
  const attributeColumns = [
    { columnId: "c1", name: "部署" },
    { columnId: "c2", name: "役割" },
  ];
  const attrUsers: IamUser[] = ["ayaka.mori", "kenji.sato", "mika.ito"].map((userName, i) => ({
    ...users[0]!,
    userName,
    arn: `arn:aws:iam::${ACCOUNT}:user/${userName}`,
    attributes: ([{ c1: "うま", c2: "リーダー" }, { c1: "あか" }, {}] as Record<string, string>[])[i]!,
  }));

  function mount(assignments: Assignment[] = []): { rerender: (next: Assignment[]) => void } {
    const element = (next: Assignment[]): React.JSX.Element => (
      <AssignmentMatrix
        users={attrUsers}
        roles={roles}
        assignments={next}
        locks={{}}
        selectedRoleArns={[]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        attributeColumns={attributeColumns}
        onToggleCell={() => {}}
        onToggleRole={() => {}}
      />
    );
    const view = render(element(assignments));
    return { rerender: (next) => view.rerender(element(next)) };
  }

  const visibleUsers = (): string[] =>
    Array.from(document.querySelectorAll('[data-testid^="user-row-"]')).map(
      (element) => element.getAttribute("data-testid")!.replace("user-row-", "").split("/").pop()!,
    );
  const choose = (columnId: string, itemId: string): void => {
    fireEvent.click(screen.getByTestId(`attr-menu-${columnId}`));
    fireEvent.click(screen.getByTestId(`column-menu-${itemId}`));
  };

  it("フィルタ: 実在する値で絞れる。件数の行とバッジが出る", () => {
    mount();

    choose("c1", "filter-value-0"); // 値は日本語の並びで あか, うま

    expect(visibleUsers()).toEqual(["kenji.sato"]);
    expect(screen.getByTestId("matrix-view-status").textContent).toContain("表示 1 / 全 3 行");
    expect(screen.getByTestId("attr-badge-c1").textContent).toBe("絞り込み: あか");
  });

  it("フィルタ: 「（未設定）」で値の無いユーザだけが残る。値の無いユーザがいない列には項目が無い", () => {
    mount();

    choose("c1", "filter-unset");
    expect(visibleUsers()).toEqual(["mika.ito"]);

    fireEvent.click(screen.getByTestId("attr-menu-c2"));
    expect(screen.getByTestId("column-menu-filter-unset")).toBeDefined(); // c2 は 2 人が未設定
    fireEvent.keyDown(screen.getByTestId("column-menu"), { key: "Escape" });
  });

  it("ソート: 昇順は日本語の並びで値の無いユーザが最後。降順でも値の無いユーザは最後。解除で元の順", () => {
    mount();

    choose("c1", "sort-asc");
    expect(visibleUsers()).toEqual(["kenji.sato", "ayaka.mori", "mika.ito"]);
    expect(screen.getByTestId("attr-column-c1").getAttribute("aria-sort")).toBe("ascending");

    choose("c1", "sort-desc");
    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato", "mika.ito"]);

    choose("c1", "sort-none");
    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato", "mika.ito"]);
    expect(screen.queryByTestId("attr-badge-c1")).toBeNull();
  });

  it("ソートは 1 列だけ: 属性のソートの後にロール列のソートを付けると属性のバッジが消える", () => {
    mount([{ ...assignment(0, 0, true, true), userArn: attrUsers[2]!.arn }]);
    choose("c1", "sort-asc");
    expect(screen.getByTestId("attr-badge-c1")).toBeDefined();

    fireEvent.click(screen.getByTestId(`role-menu-${roles[0]!.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-sort-checked-first"));

    expect(screen.queryByTestId("attr-badge-c1")).toBeNull();
    expect(screen.getByTestId(`role-badge-${roles[0]!.arn}`).textContent).toContain("↑ チェックあり");
    expect(visibleUsers()).toEqual(["mika.ito", "ayaka.mori", "kenji.sato"]);
  });

  it("属性のフィルタはロール列のフィルタ・テキストと AND", () => {
    mount([assignment(0, 0, true, true), assignment(1, 0, true, true)]);
    choose("c1", "filter-value-0"); // あか → kenji.sato
    fireEvent.click(screen.getByTestId(`role-menu-${roles[0]!.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));
    expect(visibleUsers()).toEqual(["kenji.sato"]);

    fireEvent.change(document.querySelector('[data-testid="matrix-user-filter"] input') as HTMLInputElement, {
      target: { value: "ayaka" },
    });
    expect(visibleUsers()).toEqual([]);
  });

  it("「すべて解除」で属性のフィルタとソートも外れる", () => {
    mount();
    choose("c1", "filter-value-0");
    choose("c2", "sort-asc");

    fireEvent.click(screen.getByTestId("matrix-view-clear"));

    expect(visibleUsers()).toEqual(["ayaka.mori", "kenji.sato", "mika.ito"]);
    expect(screen.queryByTestId("attr-badge-c1")).toBeNull();
    expect(screen.queryByTestId("attr-badge-c2")).toBeNull();
  });

  it("D-7: 属性で絞り込み中にチェックを外しても行は動かない。D-8: 「変更 n」は全行で数える", () => {
    const view = mount([assignment(1, 0, true, true), assignment(0, 1, true, false)]);
    choose("c1", "filter-value-0"); // あか → kenji.sato
    expect(visibleUsers()).toEqual(["kenji.sato"]);

    view.rerender([assignment(1, 0, false, true), assignment(0, 1, true, false)]);

    expect(visibleUsers()).toEqual(["kenji.sato"]);
    expect(screen.getByTestId(`role-column-${roles[1]!.arn}`).textContent).toContain("変更 1");
  });

  it("畳んだ列でもメニューのフィルタは効き続け、細い列に「●」が出る。件数の行に条件が出る", () => {
    mount();
    choose("c1", "filter-value-0");

    fireEvent.click(screen.getByTestId("attr-fold-c1"));

    expect(visibleUsers()).toEqual(["kenji.sato"]);
    expect(screen.getByTestId("attr-dot-c1")).toBeDefined();
    expect(screen.getByTestId("matrix-view-status").textContent).toContain("表示 1 / 全 3 行");
  });
});

describe("絞り込み欄の描き先（Issue #155）", () => {
  const inputOf = (): HTMLInputElement =>
    document.querySelector('[data-testid="matrix-user-filter"] input') as HTMLInputElement;

  /** チェック操作で assignments を更新する親。実際の画面と同じく、操作のたびに再描画させる。 */
  function FilterHarness({ anchor }: { anchor: HTMLElement }): React.JSX.Element {
    const [assignments, setAssignments] = useState<Assignment[]>([assignment(0, 0, false, false)]);
    return (
      <AssignmentMatrix
        users={users}
        roles={roles}
        assignments={assignments}
        locks={{}}
        selectedRoleArns={[]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        onToggleCell={(userArn, roleArn, next) =>
          setAssignments((prev) =>
            prev.map((a) => (a.userArn === userArn && a.roleArn === roleArn ? { ...a, checked: next } : a)),
          )
        }
        onToggleRole={() => {}}
        filterAnchor={anchor}
      />
    );
  }

  it("filterAnchor を渡すと、絞り込み欄はその枠の中に描かれる", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    renderWith({ filterAnchor: anchor });
    expect(anchor.querySelector('[data-testid="matrix-user-filter"]')).not.toBeNull();
    anchor.remove();
  });

  it("読み上げ領域と表示件数は、表の間隔を取る箱（SpaceBetween）の外に置く（Issue #155）", () => {
    renderWith();
    // SpaceBetween は子ごとに間隔を取るので、空の領域を箱の中に置くと表との間が広がる。
    // 表（matrix-scroll）→ グリッドの div → 間隔の子の div → 箱（SpaceBetween）の順。その箱の外に、空の領域を置く。
    const spacingBox = screen.getByTestId("matrix-scroll").parentElement?.parentElement?.parentElement as HTMLElement;
    expect(spacingBox.contains(screen.getByTestId("matrix-view-status"))).toBe(false);
    expect(spacingBox.contains(screen.getByTestId("matrix-hidden-live"))).toBe(false);
  });

  it("filterAnchor が null（枠がまだ無い）のあいだは、絞り込み欄を描かない", () => {
    renderWith({ filterAnchor: null });
    expect(document.querySelector('[data-testid="matrix-user-filter"]')).toBeNull();
  });

  it("チェック操作（再描画）の後も、絞り込み欄の値と同じ要素が残り、フォーカスも残る", () => {
    const anchor = document.createElement("div");
    document.body.appendChild(anchor);
    render(<FilterHarness anchor={anchor} />);
    const before = inputOf();
    fireEvent.change(before, { target: { value: "ayaka" } });
    before.focus();
    fireEvent.click(screen.getByTestId(`cell-${users[0]!.arn}-${roles[0]!.arn}`));
    expect(inputOf()).toBe(before);
    expect(inputOf().value).toBe("ayaka");
    expect(document.activeElement).toBe(before);
    anchor.remove();
  });
});

function renderWith(props: Partial<React.ComponentProps<typeof AssignmentMatrix>> = {}): void {
  render(
    <AssignmentMatrix
      users={users}
      roles={roles}
      assignments={[assignment(0, 1, true, false)]} // ReadOnlyAudit に未反映の変更 1 件
      locks={{}}
      selectedRoleArns={[]}
      savingCells={new Set()}
      toolbarTargetId="matrix-submit-button"
      onToggleCell={() => {}}
      onToggleRole={() => {}}
      {...props}
    />,
  );
}

function hideViaMenu(roleArn: string): void {
  fireEvent.click(screen.getByTestId(`role-menu-${roleArn}`));
  fireEvent.click(screen.getByTestId("column-menu-hide"));
}

describe("列の非表示（Issue #140）", () => {
  const [deploy, audit, billing] = roles;

  it("メニューから隠すと、その列が消え、件数の行に「非表示 1 列（変更あり 1 列）」が出る", () => {
    renderWith();
    expect(screen.queryByTestId("matrix-hidden-button")).toBeNull();

    hideViaMenu(audit!.arn);

    expect(screen.queryByTestId(`role-column-${audit!.arn}`)).toBeNull();
    expect(screen.getByTestId(`role-column-${deploy!.arn}`)).toBeTruthy();
    expect(screen.getByTestId("matrix-hidden-button").textContent).toContain(
      "非表示 1 列（変更あり 1 列）",
    );
  });

  it("変更の無い列を隠したときは「（変更あり …）」を添えない", () => {
    renderWith();
    hideViaMenu(billing!.arn);
    const text = screen.getByTestId("matrix-hidden-button").textContent ?? "";
    expect(text).toContain("非表示 1 列");
    expect(text).not.toContain("変更あり");
  });

  it("一覧を開いて「表示する」で戻せる。一覧には変更あり・条件ありを添える", () => {
    renderWith();
    // 隠す前に、列のフィルタを付ける（隠した列の条件は有効のまま残る。D-11）。
    fireEvent.click(screen.getByTestId(`role-menu-${audit!.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));
    hideViaMenu(audit!.arn);

    fireEvent.click(screen.getByTestId("matrix-hidden-button"));
    const list = screen.getByTestId("matrix-hidden-list");
    expect(list.textContent).toContain("（変更あり）");
    expect(list.textContent).toContain("（条件あり）");

    fireEvent.click(screen.getByTestId(`matrix-hidden-show-${audit!.arn}`));

    expect(screen.getByTestId(`role-column-${audit!.arn}`)).toBeTruthy();
    expect(screen.queryByTestId("matrix-hidden-button")).toBeNull();
  });

  it("「すべて表示」で全部戻る", () => {
    renderWith();
    hideViaMenu(audit!.arn);
    hideViaMenu(billing!.arn);
    fireEvent.click(screen.getByTestId("matrix-hidden-button"));

    fireEvent.click(screen.getByTestId("matrix-hidden-show-all"));

    for (const role of roles) {
      expect(screen.getByTestId(`role-column-${role.arn}`)).toBeTruthy();
    }
  });

  it("Escape で一覧を閉じ、フォーカスをボタンへ戻す", () => {
    renderWith();
    hideViaMenu(audit!.arn);
    const button = screen.getByTestId("matrix-hidden-button");
    fireEvent.click(button);
    expect(screen.getByTestId("matrix-hidden-list")).toBeTruthy();

    fireEvent.keyDown(screen.getByTestId("matrix-hidden-list"), { key: "Escape" });

    expect(screen.queryByTestId("matrix-hidden-list")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("選択中のロールは隠せない（D-5）。メニューの項目が無効で、列は残る", () => {
    renderWith({ selectedRoleArns: [audit!.arn] });
    fireEvent.click(screen.getByTestId(`role-menu-${audit!.arn}`));
    const item = screen.getByTestId("column-menu-hide");
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(screen.getByTestId(`role-column-${audit!.arn}`)).toBeTruthy();
  });

  it("隠したロールの変更も、除外の帯の基準（全ロール）から外れない", () => {
    renderWith({
      locks: {
        [audit!.arn]: {
          roleArn: audit!.arn,
          changeRequestId: "cr-1",
          status: "draft",
          createdAt: "2026-07-31T00:00:00.000Z",
        },
      },
    });
    hideViaMenu(audit!.arn);
    // 除外の帯は列が見えなくても出続ける（FR-4.6）。
    expect(screen.getByTestId("exclusion-banner")).toBeTruthy();
  });

  it("すべての列を隠すと、本体に案内と「すべて表示」を出し、押すと全部戻る", () => {
    renderWith();
    for (const role of roles) hideViaMenu(role.arn);

    const body = screen.getByTestId("matrix-all-hidden");
    expect(body.textContent).toContain("すべての列を隠しています");
    // 最後の列を隠した直後は、案内の「すべて表示」へフォーカスが移る。
    expect(document.activeElement).toBe(screen.getByTestId("matrix-all-hidden-show-all"));

    fireEvent.click(screen.getByTestId("matrix-all-hidden-show-all"));
    for (const role of roles) {
      expect(screen.getByTestId(`role-column-${role.arn}`)).toBeTruthy();
    }
  });

  it("保存した状態がすべて非表示でも、読み込み時にフォーカスを奪わない（隠した直後だけ移す）", () => {
    const controller = {
      hidden: { roleArns: new Set(roles.map((role) => role.arn)), foldedColumnIds: new Set<string>() },
      hideRole: vi.fn(),
      showRole: vi.fn(),
      showAllRoles: vi.fn(),
      toggleFold: vi.fn(),
      sync: vi.fn(),
    };
    renderWith({ hiddenController: controller });

    expect(screen.getByTestId("matrix-all-hidden")).toBeTruthy();
    expect(document.activeElement).not.toBe(screen.getByTestId("matrix-all-hidden-show-all"));
  });

  it("隠した列のフィルタは有効のまま残り、行の絞り込みが効き続ける（D-11）", () => {
    renderWith({ assignments: [assignment(0, 1, true, true), assignment(1, 1, false, false)] });
    fireEvent.click(screen.getByTestId(`role-menu-${audit!.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));
    expect(screen.getByTestId("matrix-view-status").textContent).toContain("表示 1 / 全 2 行");

    hideViaMenu(audit!.arn);

    expect(screen.getByTestId("matrix-view-status").textContent).toContain("表示 1 / 全 2 行");
  });

  it("保存した状態があれば、描画の時点で列が隠れている。現在の列に無い値は数えず、sync で捨てる（D-9）", () => {
    const controller = {
      hidden: {
        roleArns: new Set([audit!.arn, "arn:aws:iam::1:role/Gone"]),
        foldedColumnIds: new Set<string>(),
      },
      hideRole: vi.fn(),
      showRole: vi.fn(),
      showAllRoles: vi.fn(),
      toggleFold: vi.fn(),
      sync: vi.fn(),
    };
    renderWith({ hiddenController: controller });

    expect(screen.queryByTestId(`role-column-${audit!.arn}`)).toBeNull();
    expect(screen.getByTestId("matrix-hidden-button").textContent).toContain("非表示 1 列");
    expect(controller.sync).toHaveBeenCalledWith(
      roles.map((role) => role.arn),
      [],
    );
  });
});
