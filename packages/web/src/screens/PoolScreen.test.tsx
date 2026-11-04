// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { IamUser, PoolView } from "@rolust/core";
import { buildUserArn } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { navigate } from "../router.js";
import { PoolScreen } from "./PoolScreen.js";

/**
 * 画面 1（FR-7.1）のユニットテスト。
 *
 * この画面は 3 つのモーダルを持ち、そのうち 2 つが入力欄を持つ。`GuardedModal` 単体の
 * テストは「`dirty` が true なら破棄確認を挟む」という分岐を固定しているが、
 * **各モーダルが正しい `dirty` を渡しているか**は未検証だった。ここで埋めるのはその隙間である。
 *
 * 併せて質問 4 = B で足した削除の導線（連鎖削除の告知と失敗時の扱い）を固定する。
 */

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: {
      getPool: vi.fn(),
      addUsers: vi.fn(),
      deleteUser: vi.fn(),
      saveAttributeColumns: vi.fn(),
      saveUserAttributes: vi.fn(),
    },
  };
});

const POOL_ID = "platform-team";
const ACCOUNT = "111122223333";

function user(userName: string): IamUser {
  return {
    poolId: POOL_ID,
    accountId: ACCOUNT,
    userName,
    arn: buildUserArn(ACCOUNT, userName),
    createdAt: "2026-07-30T00:00:00.000Z",
    attributes: {},
  };
}

const ayaka = user("ayaka.mori");
const kenji = user("kenji.sato");

const pool: PoolView = {
  poolId: POOL_ID,
  createdAt: "2026-07-30T00:00:00.000Z",
  users: [ayaka, kenji],
  linkedRoleCount: 0,
  attributeColumns: [],
};

const getPool = vi.mocked(api.getPool);
const addUsers = vi.mocked(api.addUsers);
const deleteUser = vi.mocked(api.deleteUser);

/** Cloudscape の `Input` / `Textarea` は根要素に data-testid を載せる。 */
function fieldOf(testId: string): HTMLInputElement | HTMLTextAreaElement {
  const element = screen.getByTestId(testId);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
    return element;
  }
  const inner = element.querySelector("input, textarea");
  if (!inner) throw new Error(`${testId} の内側に入力欄がありません`);
  return inner as HTMLInputElement | HTMLTextAreaElement;
}

function type(testId: string, value: string): void {
  fireEvent.change(fieldOf(testId), { target: { value } });
}

async function renderScreen(): Promise<void> {
  render(<PoolScreen />);
  await screen.findByTestId("pool-users");
  // 表（pool-users）は読み込み中にも出る。見出しの説明が「IAMユーザ — 件」から件数に変わるのを待って、読み込みの完了を確かめる
  // （待たないと、読み込み後にだけ出る「属性一括編集モード」などを引く直後のテストが、負荷のかかる CI で稀に落ちた）。
  await screen.findByText(/^IAMユーザ \d+ 件/);
}

beforeEach(() => {
  getPool.mockResolvedValue({ pool });
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("見出し行（Issue #155）", () => {
  it("見出しと件数は同じ行にある", async () => {
    await renderScreen();
    const heading = screen.getByRole("heading", { level: 1, name: "IAMユーザ" });
    const counts = screen.getByTestId("page-heading-counts");
    expect((counts.parentElement as HTMLElement).contains(heading)).toBe(true);
  });
});

describe("ユーザプール管理（FR-7.1。Issue #108 で 1 枚の画面にした）", () => {
  it("見出しの説明に IamUser・アカウント・ロールの件数を出し、プールのカード・作成・名前変更・削除のボタンを持たない", async () => {
    getPool.mockResolvedValue({ pool: { ...pool, linkedRoleCount: 5 } });
    await renderScreen();

    // 表（pool-users）は読み込み中にも出るので、見出しの説明は読み込みの完了を待って確かめる（全体実行で稀に落ちた）。
    expect(await screen.findByText("IAMユーザ 2 件 / AWSアカウント 1 / IAMロール 5 件")).toBeTruthy();
    expect(screen.queryByTestId("create-pool-button")).toBeNull();
    expect(screen.queryByTestId(/^pool-card-/)).toBeNull();
    expect(screen.queryByTestId(/^rename-pool-/)).toBeNull();
    expect(screen.queryByTestId(/^delete-pool-/)).toBeNull();
  });

  it("アカウント別の表を描画する", async () => {
    await renderScreen();

    // 登録単位（1 AWSアカウントID + 複数ユーザ名 / C-5）に合わせて 1 行へ束ねる。
    const table = screen.getByTestId("pool-users");
    expect(table.textContent).toContain("ayaka.mori");
    expect(table.textContent).toContain("kenji.sato");
    expect(table.textContent).toContain(ACCOUNT);
  });

  it("読み込みに失敗したら error 状態を出し、再試行の導線を持つ", async () => {
    getPool.mockRejectedValue(new Error("DynamoDB の Query に失敗しました"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<PoolScreen />);

    await screen.findByTestId("pools-error");
    expect(screen.getByTestId("pools-error-retry")).toBeTruthy();
  });
});

describe("カード内のユーザ名の配置（Issue #15）", () => {
  /** 削除ボタンから表の手前まで遡り、最初に見つかった `white-space: nowrap` の祖先を返す。 */
  function nearestNoWrapAncestor(element: HTMLElement): HTMLElement | null {
    let current = element.parentElement;
    while (current && current.tagName !== "TABLE") {
      if (getComputedStyle(current).whiteSpace === "nowrap") return current;
      current = current.parentElement;
    }
    return null;
  }

  it("IAMユーザ名と削除ボタンを、折り返さない 1 つの行にまとめる", async () => {
    // IAMユーザ名の上限の 64 文字。ハイフンは折り返しの候補になる。
    const longName = "ci-deployer-for-platform-engineering-team-ap-northeast-1-prod-01";
    const longUser = user(longName);
    getPool.mockResolvedValue({ pool: { ...pool, users: [longUser] } });

    await renderScreen();

    const line = nearestNoWrapAncestor(screen.getByTestId(`delete-user-${longUser.arn}`));
    expect(line).not.toBeNull();
    expect(line?.textContent).toContain(longName);
  });
});

describe("ユーザ登録モーダルの破棄確認（GI-4）", () => {
  it("入力があるとキャンセルで破棄確認へ切り替わる（dirty = true を渡している）", async () => {
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");

    type("add-users-user-names", "miki.tanaka");
    fireEvent.click(screen.getByTestId("add-users-cancel"));

    await screen.findByTestId("add-users-modal-discard-alert");
  });

  it("登録に成功すると件数つきの通知を出し、一覧を再取得する", async () => {
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");

    type("add-users-account-id", ACCOUNT);
    type("add-users-user-names", "miki.tanaka");
    addUsers.mockResolvedValue({ users: [user("miki.tanaka")], createdCount: 1, skippedCount: 0 });

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-users-submit"));
      await Promise.resolve();
    });

    await screen.findByText("IAMユーザを 1 件登録しました");
    await waitFor(() => {
      expect(getPool).toHaveBeenCalledTimes(2);
    });
  });
});

describe("ユーザ登録モーダルのAWSアカウントID 初期値（Issue #60）", () => {
  const ACCOUNT_2 = "444455556666";

  it("既存ユーザが単一アカウントなら、そのAWSアカウントID が初期値に入る", async () => {
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");

    expect(fieldOf("add-users-account-id").value).toBe(ACCOUNT);
  });

  it("複数アカウントが混在するなら、最後に登録された（createdAt 最大の）ユーザーのAWSアカウントID が入る", async () => {
    getPool.mockResolvedValue({
      pool: {
        ...pool,
        users: [
          { ...ayaka, accountId: ACCOUNT, createdAt: "2026-07-30T00:00:00.000Z" },
          { ...kenji, accountId: ACCOUNT_2, createdAt: "2026-09-01T00:00:00.000Z" },
        ],
      },
    });
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");

    expect(fieldOf("add-users-account-id").value).toBe(ACCOUNT_2);
  });

  it("IamUser が 0 件のプールでは空のまま（現状維持）", async () => {
    getPool.mockResolvedValue({ pool: { ...pool, users: [] } });
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");

    expect(fieldOf("add-users-account-id").value).toBe("");
  });

  it("何も変えずに閉じても破棄確認は出ない（初期値からの変化なし）", async () => {
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");

    fireEvent.click(screen.getByTestId("add-users-cancel"));

    expect(screen.queryByTestId("add-users-modal-discard-alert")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("add-users-modal").className).toMatch(/awsui_hidden/);
    });
  });

  it("初期値を上書きしてから送信すると、上書き後の値で登録される", async () => {
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");

    type("add-users-account-id", ACCOUNT_2);
    type("add-users-user-names", "miki.tanaka");
    addUsers.mockResolvedValue({ users: [user("miki.tanaka")], createdCount: 1, skippedCount: 0 });

    await act(async () => {
      fireEvent.click(screen.getByTestId("add-users-submit"));
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(addUsers).toHaveBeenCalledWith({
        accountId: ACCOUNT_2,
        userNames: ["miki.tanaka"],
      });
    });
  });
});

describe("IAMユーザの削除（質問 4 = B）", () => {
  it("削除確認は入力欄を持たないため、キャンセルで即座に閉じる", async () => {
    await renderScreen();
    fireEvent.click(screen.getByTestId(`delete-user-${ayaka.arn}`));
    await screen.findByTestId("delete-user-confirm");

    fireEvent.click(screen.getByTestId("delete-user-cancel"));

    // 「破棄確認を閉じるための破棄確認」は意味を持たない（dirty = false）。
    expect(screen.queryByTestId("delete-user-modal-discard-alert")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("delete-user-modal").className).toMatch(/awsui_hidden/);
    });
  });

  it("削除すると連鎖削除した割り当て件数を通知し、一覧を再取得する", async () => {
    await renderScreen();
    fireEvent.click(screen.getByTestId(`delete-user-${ayaka.arn}`));
    await screen.findByTestId("delete-user-confirm");

    deleteUser.mockResolvedValue({ arn: ayaka.arn, removedAssignments: 3 });

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-user-confirm"));
      await Promise.resolve();
    });

    await screen.findByText(/ayaka\.mori の登録を解除しました（連鎖削除した割り当て 3 件）/);
    expect(deleteUser).toHaveBeenCalledWith(ayaka.arn);
    await waitFor(() => {
      expect(getPool).toHaveBeenCalledTimes(2);
    });
  });

  it("確認モーダルは、反映済みの割り当てや未反映の申請が残るユーザを削除できないことを伝える（Issue #44）", async () => {
    await renderScreen();
    fireEvent.click(screen.getByTestId(`delete-user-${ayaka.arn}`));
    await screen.findByTestId("delete-user-confirm");

    const modal = screen.getByTestId("delete-user-modal");
    expect(modal.textContent).toContain("信頼ポリシーに反映済みの割り当て");
    expect(modal.textContent).toContain("この IAMユーザを含む未反映の申請");
    // 削除後の反映を前提にした旧来の説明は出さない（その状態では削除を拒否する）。
    expect(modal.textContent).not.toContain("削除したユーザを含む申請を反映すると");
  });

  it("削除に失敗したらモーダルを閉じずエラーを出す（失敗を行方不明にしない）", async () => {
    await renderScreen();
    fireEvent.click(screen.getByTestId(`delete-user-${ayaka.arn}`));
    await screen.findByTestId("delete-user-confirm");

    deleteUser.mockRejectedValue(new Error("DeleteItem に失敗しました"));

    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-user-confirm"));
      await Promise.resolve();
    });

    const error = await screen.findByTestId("delete-user-error");
    expect(error.textContent).toContain("DeleteItem に失敗しました");
    // モーダルは開いたまま（閉じると失敗した事実が行方不明になる）。
    expect(screen.getByTestId("delete-user-modal").className).not.toMatch(/awsui_hidden/);
    expect(getPool).toHaveBeenCalledTimes(1);
  });
});

describe("ロールの紐づけの導線は廃止した（Issue #135）", () => {
  it("ページヘッダのボタンは「ユーザを新規登録」「属性の項目を編集」の順で、「ロールの紐づけ」は無い", async () => {
    await renderScreen();

    expect(screen.queryByTestId("link-roles")).toBeNull();
    expect(screen.queryByText("ロールの紐づけ")).toBeNull();
    const buttons = ["add-users", "edit-attribute-columns"].map((id) => screen.getByTestId(id));
    expect(buttons[0]!.compareDocumentPosition(buttons[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("表のヘッダ行の固定（Issue #133）", () => {
  it("アカウント別の表（属性の項目が 0 件）の列ヘッダ行は、スクロールしても固定される", async () => {
    await renderScreen();

    const table = screen.getByTestId("pool-users");
    expect(table.querySelector('[class*="header-secondary"]')).not.toBeNull();
  });

  it("ユーザ別の表（属性の項目あり）の列ヘッダ行は、スクロールしても固定される", async () => {
    getPool.mockResolvedValue({
      pool: {
        ...pool,
        attributeColumns: [{ columnId: "c-name", name: "名前" }],
        users: [ayaka, kenji],
      },
    });
    await renderScreen();

    const table = screen.getByTestId("pool-users");
    expect(table.querySelector('[class*="header-secondary"]')).not.toBeNull();
  });
});

describe("属性の項目（Issue #61）", () => {
  const COLUMNS = [
    { columnId: "c-name", name: "名前" },
    { columnId: "c-role", name: "役割" },
  ];
  const ayakaWithAttributes: IamUser = { ...ayaka, attributes: { "c-name": "森 彩花", "c-role": "管理者" } };
  const poolWithColumns: PoolView = {
    ...pool,
    attributeColumns: COLUMNS,
    users: [ayakaWithAttributes, kenji],
  };

  it("属性の項目が 0 件のプールの表は今のまま（AWSアカウントID ごとに 1 行）で、属性の列も「属性を編集」も出ない（Review Focus 5）", async () => {
    await renderScreen();

    const table = screen.getByTestId("pool-users");
    expect(table.textContent).toContain("IAMユーザ名");
    expect(screen.queryByTestId(`edit-user-attributes-${ayaka.arn}`)).toBeNull();
    // 1 AWSアカウント 1 行: AWSアカウントID の行は 1 つ。
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
  });

  it("属性の項目があるプールは 1 ユーザ 1 行になり、列見出しと値を出す。値の無いセルは「—」", async () => {
    getPool.mockResolvedValue({ pool: poolWithColumns });
    await renderScreen();

    const table = screen.getByTestId("pool-users");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(2);
    expect(table.textContent).toContain("名前");
    expect(table.textContent).toContain("役割");
    expect(screen.getByTestId(`attr-${ayaka.arn}-c-name`).textContent).toBe("森 彩花");
    expect(screen.getByTestId(`attr-${kenji.arn}-c-name`).textContent).toBe("—");
  });

  it("ユーザが 0 件のプールは、属性の項目の有無にかかわらず「まだ IAMユーザがいません」を出す", async () => {
    getPool.mockResolvedValue({ pool: { ...poolWithColumns, users: [] } });
    await renderScreen();
    expect(screen.getByTestId("pool-users-empty").textContent).toContain("まだ IAMユーザがありません");
    expect(screen.getByTestId("pool-empty-add-users").textContent).toBe("ユーザを新規登録");

    cleanup();
    getPool.mockResolvedValue({ pool: { ...pool, users: [] } });
    await renderScreen();
    expect(screen.getByTestId("pool-users-empty").textContent).toContain("まだ IAMユーザがありません");
    expect(screen.getByTestId("pool-empty-add-users").textContent).toBe("ユーザを新規登録");
  });

  it("1 ユーザ 1 行の表にも削除ボタンがあり、既存の削除の導線（確認モーダル）を開く", async () => {
    getPool.mockResolvedValue({ pool: poolWithColumns });
    await renderScreen();

    fireEvent.click(screen.getByTestId(`delete-user-${ayaka.arn}`));

    expect(screen.getByTestId("delete-user-modal")).toBeTruthy();
  });

  it("「属性の項目を編集」は一覧の列を初期値にモーダルを開き、保存すると通知して一覧を再取得する", async () => {
    getPool.mockResolvedValue({ pool: poolWithColumns });
    vi.mocked(api.saveAttributeColumns).mockResolvedValue({ columns: COLUMNS });
    await renderScreen();
    getPool.mockClear();

    fireEvent.click(screen.getByTestId("edit-attribute-columns"));
    expect(fieldOf("attribute-column-name-0").value).toBe("名前");
    fireEvent.change(fieldOf("attribute-column-name-0"), { target: { value: "氏名" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("attribute-columns-submit"));
      await Promise.resolve();
    });

    expect(api.saveAttributeColumns).toHaveBeenCalledWith([
      { columnId: "c-name", name: "氏名" },
      { columnId: "c-role", name: "役割" },
    ]);
    await waitFor(() => expect(getPool).toHaveBeenCalled());
    expect(screen.getByText("属性の項目を保存しました")).toBeTruthy();
  });

  it("最初の属性の項目を作ると（0 件から）、次の一覧から 1 ユーザ 1 行の表になる", async () => {
    vi.mocked(api.saveAttributeColumns).mockResolvedValue({ columns: [COLUMNS[0]!] });
    await renderScreen();

    fireEvent.click(screen.getByTestId("edit-attribute-columns"));
    fireEvent.click(screen.getByTestId("attribute-columns-add"));
    fireEvent.change(fieldOf("attribute-column-name-0"), { target: { value: "名前" } });
    getPool.mockResolvedValue({ pool: { ...poolWithColumns, attributeColumns: [COLUMNS[0]!] } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("attribute-columns-submit"));
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId(`edit-user-attributes-${ayaka.arn}`)).toBeTruthy());
  });

  it("「属性を編集」はそのユーザの値を初期値にモーダルを開き、保存すると通知して一覧を再取得する", async () => {
    getPool.mockResolvedValue({ pool: poolWithColumns });
    vi.mocked(api.saveUserAttributes).mockResolvedValue({ user: ayakaWithAttributes });
    await renderScreen();
    getPool.mockClear();

    fireEvent.click(screen.getByTestId(`edit-user-attributes-${ayaka.arn}`));
    expect(fieldOf("user-attribute-c-name").value).toBe("森 彩花");
    fireEvent.change(fieldOf("user-attribute-c-role"), { target: { value: "開発" } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("user-attributes-submit"));
      await Promise.resolve();
    });

    expect(api.saveUserAttributes).toHaveBeenCalledWith(ayaka.arn, { "c-name": "森 彩花", "c-role": "開発" });
    await waitFor(() => expect(getPool).toHaveBeenCalled());
    expect(screen.getByText("ayaka.mori の属性を保存しました")).toBeTruthy();
  });
});

describe("ユーザ登録モーダルの CSV 入力（Issue #98）", () => {
  const poolWithColumns: PoolView = {
    ...pool,
    attributeColumns: [
      { columnId: "c1", name: "所属" },
      { columnId: "c2", name: "役割" },
    ],
  };

  async function openAddUsers(): Promise<void> {
    getPool.mockResolvedValue({ pool: poolWithColumns });
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");
  }

  const switchToCsv = (): void => {
    fireEvent.click(within(screen.getByTestId("add-users-mode")).getByText("CSV"));
  };
  const switchToSingle = (): void => {
    fireEvent.click(within(screen.getByTestId("add-users-mode")).getByText("1 件ずつ"));
  };
  const submit = async (): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByTestId("add-users-submit"));
      await Promise.resolve();
    });
  };

  it("CSV に切り替えると、入力欄の 1 行目に、必須の列名とプールの属性の項目名のヘッダが入っている（Issue #207）", async () => {
    await openAddUsers();

    switchToCsv();

    await screen.findByTestId("add-users-csv");
    expect(fieldOf("add-users-csv").value).toBe("ユーザ名,所属,役割");
  });

  it("説明には、ヘッダを繰り返さず、データ行の例だけを出す（Issue #207）", async () => {
    await openAddUsers();

    switchToCsv();

    await screen.findByTestId("add-users-csv");
    const help = screen.getByTestId("add-users-csv-help").textContent ?? "";
    expect(help).toContain("ayaka.mori,値1,値2");
    expect(help).not.toContain("ユーザ名,所属,役割");
  });

  it("属性の項目が 0 件のプールでは、ヘッダは必須の列名だけ（Issue #207）", async () => {
    getPool.mockResolvedValue({ pool: pool });
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");

    switchToCsv();

    await screen.findByTestId("add-users-csv");
    expect(fieldOf("add-users-csv").value).toBe("ユーザ名");
  });

  it("項目名にカンマや引用符があっても、ヘッダの初期値に 2 行目を足してそのまま登録できる（往復。Issue #207）", async () => {
    getPool.mockResolvedValue({
      pool: {
        ...pool,
        attributeColumns: [
          { columnId: "c1", name: "部署,課" },
          { columnId: "c2", name: 'a"b' },
        ],
      },
    });
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");
    type("add-users-account-id", ACCOUNT);
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    const header = fieldOf("add-users-csv").value;
    expect(header).toBe('ユーザ名,"部署,課","a""b"');
    type("add-users-csv", `${header}\nmiki.tanaka,開発,x`);
    addUsers.mockResolvedValue({ users: [user("miki.tanaka")], createdCount: 1, skippedCount: 0 });

    await submit();

    await screen.findByText("IAMユーザを 1 件登録しました");
    expect(addUsers).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      users: [{ userName: "miki.tanaka", attributes: { "部署,課": "開発", 'a"b': "x" } }],
    });
  });

  it("入力を直してからモードを切り替えて戻っても、ヘッダで上書きしない（Issue #207）", async () => {
    await openAddUsers();
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    type("add-users-csv", "ユーザ名,所属,役割\nmiki.tanaka,開発,");

    switchToSingle();
    await screen.findByTestId("add-users-user-names");
    switchToCsv();
    await screen.findByTestId("add-users-csv");

    expect(fieldOf("add-users-csv").value).toBe("ユーザ名,所属,役割\nmiki.tanaka,開発,");
  });

  it("入力を空にしてからモードを切り替えて戻っても、空のまま（勝手に入れ直さない。Issue #207）", async () => {
    await openAddUsers();
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    type("add-users-csv", "");

    switchToSingle();
    await screen.findByTestId("add-users-user-names");
    switchToCsv();
    await screen.findByTestId("add-users-csv");

    expect(fieldOf("add-users-csv").value).toBe("");
  });

  it("閉じて開き直すと、直した入力は破棄され、ヘッダの初期値に戻る（Issue #207）", async () => {
    await openAddUsers();
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    type("add-users-csv", "ユーザ名\nmiki.tanaka");
    fireEvent.click(screen.getByTestId("add-users-cancel"));
    fireEvent.click(await screen.findByTestId("add-users-modal-discard-confirm"));
    await waitFor(() => {
      expect(screen.getByTestId("add-users-modal").className).toMatch(/awsui_hidden/);
    });

    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");
    switchToCsv();
    await screen.findByTestId("add-users-csv");

    expect(fieldOf("add-users-csv").value).toBe("ユーザ名,所属,役割");
  });

  it("プールの読み込みが終わる前に開いても、触っていなければ、読み込み後に属性の項目名のヘッダへ追随し、破棄確認も出ない（Issue #207）", async () => {
    let resolvePool!: (value: { pool: PoolView }) => void;
    getPool.mockReturnValue(
      new Promise((resolve) => {
        resolvePool = resolve;
      }),
    );
    render(<PoolScreen />);
    fireEvent.click(await screen.findByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    expect(fieldOf("add-users-csv").value).toBe("ユーザ名");

    await act(async () => {
      resolvePool({ pool: poolWithColumns });
      await Promise.resolve();
    });

    await waitFor(() => expect(fieldOf("add-users-csv").value).toBe("ユーザ名,所属,役割"));
    // AWSアカウントID の初期値（Issue #60）も、読み込み後に追随する。
    expect(fieldOf("add-users-account-id").value).toMatch(/^\d{12}$/);
    fireEvent.click(screen.getByTestId("add-users-cancel"));
    expect(screen.queryByTestId("add-users-modal-discard-alert")).toBeNull();
  });

  it("読み込みが終わる前に入力を始めていたら、読み込み後も、その入力を上書きしない（Issue #207）", async () => {
    let resolvePool!: (value: { pool: PoolView }) => void;
    getPool.mockReturnValue(
      new Promise((resolve) => {
        resolvePool = resolve;
      }),
    );
    render(<PoolScreen />);
    fireEvent.click(await screen.findByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    type("add-users-csv", "ユーザ名\nmiki.tanaka");

    await act(async () => {
      resolvePool({ pool: poolWithColumns });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByTestId("add-users-csv-help")).toBeTruthy());
    expect(fieldOf("add-users-csv").value).toBe("ユーザ名\nmiki.tanaka");
  });

  it("ヘッダの初期値に触れずに閉じても、破棄確認は出ない（Issue #207）", async () => {
    await openAddUsers();
    switchToCsv();
    await screen.findByTestId("add-users-csv");

    fireEvent.click(screen.getByTestId("add-users-cancel"));

    expect(screen.queryByTestId("add-users-modal-discard-alert")).toBeNull();
    await waitFor(() => {
      expect(screen.getByTestId("add-users-modal").className).toMatch(/awsui_hidden/);
    });
  });

  it("ヘッダだけのまま登録しようとすると、ユーザが 1 行も無いというエラーで、送信しない（Issue #207）", async () => {
    await openAddUsers();
    type("add-users-account-id", ACCOUNT);
    switchToCsv();
    await screen.findByTestId("add-users-csv");

    await submit();

    expect((await screen.findByTestId("add-users-csv-errors")).textContent).toContain("登録するユーザの行がありません");
    expect(addUsers).not.toHaveBeenCalled();
  });

  it("モードを切り替えても、AWSアカウントID と両方の入力が残る", async () => {
    await openAddUsers();
    type("add-users-account-id", ACCOUNT);
    type("add-users-user-names", "miki.tanaka");

    switchToCsv();
    await screen.findByTestId("add-users-csv");
    expect(fieldOf("add-users-account-id").value).toBe(ACCOUNT);
    type("add-users-csv", "ユーザ名,所属\nmiki.tanaka,開発");

    switchToSingle();
    await screen.findByTestId("add-users-user-names");
    expect(fieldOf("add-users-user-names").value).toBe("miki.tanaka");
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    expect(fieldOf("add-users-csv").value).toBe("ユーザ名,所属\nmiki.tanaka,開発");
  });

  it("不正な CSV は行番号つきでエラーを出し、送信しない", async () => {
    await openAddUsers();
    type("add-users-account-id", ACCOUNT);
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    type("add-users-csv", "ユーザ名,所属\nmiki.tanaka,開発\nbad name,運用");

    await submit();

    const errors = await screen.findByTestId("add-users-csv-errors");
    expect(errors.textContent).toContain("3 行目");
    expect(addUsers).not.toHaveBeenCalled();
  });

  it("エラーは blur か送信を試みるまで出さない（GI-1）", async () => {
    await openAddUsers();
    switchToCsv();
    await screen.findByTestId("add-users-csv");

    type("add-users-csv", "ユーザ名,部署\nmiki.tanaka,開発");

    expect(screen.queryByTestId("add-users-csv-errors")).toBeNull();
    fireEvent.blur(fieldOf("add-users-csv"));
    expect((await screen.findByTestId("add-users-csv-errors")).textContent).toContain("部署");
  });

  it("成功すると、属性つきの行（列名 → 値）で送り、登録件数と変更なし件数を通知する", async () => {
    await openAddUsers();
    type("add-users-account-id", ACCOUNT);
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    type("add-users-csv", "ユーザ名,所属,役割\nmiki.tanaka,開発,リーダー\nayaka.mori,運用,");
    addUsers.mockResolvedValue({ users: [user("miki.tanaka"), ayaka], createdCount: 1, skippedCount: 1 });

    await submit();

    await screen.findByText("IAMユーザを 1 件登録しました（登録済みのため変更なし 1 件）");
    expect(addUsers).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      users: [
        { userName: "miki.tanaka", attributes: { 所属: "開発", 役割: "リーダー" } },
        { userName: "ayaka.mori", attributes: { 所属: "運用" } },
      ],
    });
  });

  it("サーバーのエラーは送信エラーに出し、同じ CSV をそのまま再送できると添える", async () => {
    await openAddUsers();
    type("add-users-account-id", ACCOUNT);
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    type("add-users-csv", "ユーザ名\nmiki.tanaka");
    addUsers.mockRejectedValue(new Error("DynamoDB の PutItem に失敗しました"));

    await submit();

    expect((await screen.findByTestId("add-users-modal")).textContent).toContain("そのまま再送できます");
  });

  it("CSV の入力があるとキャンセルで破棄確認へ切り替わる（dirty）", async () => {
    await openAddUsers();
    switchToCsv();
    await screen.findByTestId("add-users-csv");

    type("add-users-csv", "ユーザ名\nmiki.tanaka");
    fireEvent.click(screen.getByTestId("add-users-cancel"));

    await screen.findByTestId("add-users-modal-discard-alert");
  });

  it("属性の項目が 0 件のプールでは、ユーザ名だけの CSV を送れる", async () => {
    getPool.mockResolvedValue({ pool: pool });
    await renderScreen();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");
    type("add-users-account-id", ACCOUNT);
    switchToCsv();
    await screen.findByTestId("add-users-csv");
    type("add-users-csv", "ユーザ名\nmiki.tanaka");
    addUsers.mockResolvedValue({ users: [user("miki.tanaka")], createdCount: 1, skippedCount: 0 });

    await submit();

    await screen.findByText("IAMユーザを 1 件登録しました");
    expect(addUsers).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      users: [{ userName: "miki.tanaka", attributes: {} }],
    });
  });
});

describe("IAMユーザの絞り込みとソート（Issue #104）", () => {
  const OTHER_ACCOUNT = "444455556666";
  const COLUMNS = [
    { columnId: "c-name", name: "名前" },
    { columnId: "c-role", name: "役割" },
  ];
  function member(accountId: string, userName: string, attributes: Record<string, string> = {}): IamUser {
    return { ...user(userName), accountId, arn: buildUserArn(accountId, userName), attributes };
  }
  const ayakaA = member(ACCOUNT, "ayaka.mori", { "c-name": "森 彩花", "c-role": "管理者" });
  const kenjiA = member(ACCOUNT, "kenji.sato", { "c-name": "佐藤 健二", "c-role": "開発" });
  const danaB = member(OTHER_ACCOUNT, "dana.okafor", { "c-role": "開発" });
  const ryoB = member(OTHER_ACCOUNT, "ryo.abe", { "c-name": "阿部 涼", "c-role": "開発" });
  const withColumns: PoolView = { ...pool, attributeColumns: COLUMNS, users: [kenjiA, ryoB, danaB, ayakaA] };
  const withoutColumns: PoolView = { ...pool, attributeColumns: [], users: [kenjiA, ryoB, danaB, ayakaA] };

  /** 表に出ているユーザ名を、上から順に返す。 */
  function shownNames(): string[] {
    const text = screen.getByTestId("pool-users").textContent ?? "";
    return [...text.matchAll(/[a-z]+\.[a-z]+/g)].map((match) => match[0]);
  }

  function filterBy(value: string): void {
    fireEvent.change(fieldOf("pool-filter"), { target: { value } });
  }

  /** 列見出しの並べ替え操作（Cloudscape は見出しのセルに role="button" を持つ）。 */
  function clickHeader(label: string): void {
    const header = within(screen.getByTestId("pool-users"))
      .getAllByRole("columnheader")
      .find((cell) => cell.textContent?.trim() === label);
    if (!header) throw new Error(`${label} の列見出しがありません`);
    fireEvent.click(header.querySelector("[role='button']") ?? header);
  }

  it("既定の並びはAWSアカウントID、ユーザ名の昇順で、絞り込み欄は空", async () => {
    getPool.mockResolvedValue({ pool: withColumns });
    await renderScreen();

    expect(shownNames()).toEqual(["ayaka.mori", "kenji.sato", "dana.okafor", "ryo.abe"]);
    expect(fieldOf("pool-filter").value).toBe("");
  });

  it("テキストでユーザ名・AWSアカウントID・属性値に部分一致で絞り込み、件数を出す", async () => {
    getPool.mockResolvedValue({ pool: withColumns });
    await renderScreen();

    filterBy("開発");
    expect(shownNames()).toEqual(["kenji.sato", "dana.okafor", "ryo.abe"]);
    expect(screen.getByTestId("pool-users").textContent).toContain("3 件の一致");

    filterBy("SATO");
    expect(shownNames()).toEqual(["kenji.sato"]);

    filterBy(OTHER_ACCOUNT);
    expect(shownNames()).toEqual(["dana.okafor", "ryo.abe"]);
  });

  it("列見出しで昇順・降順・解除の順に並べ替える（ユーザ名）", async () => {
    getPool.mockResolvedValue({ pool: withColumns });
    await renderScreen();

    clickHeader("IAMユーザ名");
    expect(shownNames()).toEqual(["ayaka.mori", "dana.okafor", "kenji.sato", "ryo.abe"]);
    clickHeader("IAMユーザ名");
    expect(shownNames()).toEqual(["ryo.abe", "kenji.sato", "dana.okafor", "ayaka.mori"]);
    clickHeader("IAMユーザ名");
    expect(shownNames()).toEqual(["ayaka.mori", "kenji.sato", "dana.okafor", "ryo.abe"]);
  });

  it("属性の項目でも並べ替え、値の無いユーザは降順でも最後に置く", async () => {
    getPool.mockResolvedValue({ pool: withColumns });
    await renderScreen();

    clickHeader("名前");
    expect(shownNames()).toEqual(["ryo.abe", "kenji.sato", "ayaka.mori", "dana.okafor"]);
    clickHeader("名前");
    expect(shownNames()).toEqual(["ayaka.mori", "kenji.sato", "ryo.abe", "dana.okafor"]);
  });

  it("絞り込みと並べ替えは同時に効く", async () => {
    getPool.mockResolvedValue({ pool: withColumns });
    await renderScreen();

    filterBy("開発");
    clickHeader("IAMユーザ名");
    clickHeader("IAMユーザ名");
    expect(shownNames()).toEqual(["ryo.abe", "kenji.sato", "dana.okafor"]);
  });

  it("一致が 0 件なら「条件に合う IAMユーザがありません」を出し、「条件をクリア」で全件に戻す", async () => {
    getPool.mockResolvedValue({ pool: withColumns });
    await renderScreen();

    filterBy("tanaka");
    const empty = screen.getByTestId("pool-filter-empty");
    expect(empty.textContent).toContain("条件に合う IAMユーザがありません");
    // ユーザ 0 件の空表示とは別物。
    expect(screen.queryByTestId("pool-users-empty")).toBeNull();

    fireEvent.click(screen.getByTestId("pool-filter-clear"));
    expect(fieldOf("pool-filter").value).toBe("");
    expect(shownNames()).toHaveLength(4);
  });

  it("ユーザが 0 件のときは従来の空表示のままで、絞り込みの空表示は出ない", async () => {
    getPool.mockResolvedValue({ pool: { ...withColumns, users: [] } });
    await renderScreen();

    expect(screen.getByTestId("pool-users-empty").textContent).toContain("まだ IAMユーザがありません");
    expect(screen.queryByTestId("pool-filter-empty")).toBeNull();
  });

  describe("属性の項目が 0 件のアカウント別の表", () => {
    it("先にユーザを絞ってから束ねる（一致したユーザだけが行に残り、全員消えた行は出ない）", async () => {
      getPool.mockResolvedValue({ pool: withoutColumns });
      await renderScreen();

      // 'k' を含むのは ayaka.mori・kenji.sato・dana.okafor。ryo.abe は含まないので 2 つ目のアカウントの行から消える。
      filterBy("k");
      expect(shownNames()).toEqual(["ayaka.mori", "kenji.sato", "dana.okafor"]);
      expect(screen.getByTestId("pool-users").querySelectorAll("tbody tr")).toHaveLength(2);

      // 2 つ目のアカウントのユーザが全員消えたら、その行ごと出ない。
      filterBy("mori");
      expect(shownNames()).toEqual(["ayaka.mori"]);
      expect(screen.getByTestId("pool-users").querySelectorAll("tbody tr")).toHaveLength(1);
    });

    it("並べ替えられるのは「AWSアカウント」列だけで、降順は行の並びだけを逆にする", async () => {
      getPool.mockResolvedValue({ pool: withoutColumns });
      await renderScreen();

      clickHeader("AWSアカウント");
      clickHeader("AWSアカウント");
      expect(shownNames()).toEqual(["dana.okafor", "ryo.abe", "ayaka.mori", "kenji.sato"]);

      const userNameHeader = within(screen.getByTestId("pool-users"))
        .getAllByRole("columnheader")
        .find((cell) => cell.textContent?.trim() === "IAMユーザ名");
      expect(userNameHeader?.getAttribute("aria-sort")).toBeNull();
      expect(userNameHeader?.querySelector("[role='button']")).toBeNull();
    });

    it("一致が 0 件なら絞り込みの空表示を出す", async () => {
      getPool.mockResolvedValue({ pool: withoutColumns });
      await renderScreen();

      filterBy("tanaka");
      expect(screen.getByTestId("pool-filter-empty")).toBeTruthy();
    });
  });

  it("ユーザを削除して一覧を再取得しても、絞り込みの条件は残る", async () => {
    getPool.mockResolvedValue({ pool: withColumns });
    deleteUser.mockResolvedValue({ arn: danaB.arn, removedAssignments: 0 });
    await renderScreen();

    filterBy("開発");
    fireEvent.click(screen.getByTestId(`delete-user-${danaB.arn}`));
    getPool.mockResolvedValue({ pool: { ...withColumns, users: [kenjiA, ryoB, ayakaA] } });
    await act(async () => {
      fireEvent.click(screen.getByTestId("delete-user-confirm"));
      await Promise.resolve();
    });

    await waitFor(() => expect(shownNames()).toEqual(["kenji.sato", "ryo.abe"]));
    expect(fieldOf("pool-filter").value).toBe("開発");
  });
});

describe("属性の編集モード（Issue #103）", () => {
  const COLUMNS = [
    { columnId: "c-name", name: "名前" },
    { columnId: "c-role", name: "役割" },
  ];
  const ayakaE: IamUser = { ...ayaka, attributes: { "c-name": "森 彩花", "c-role": "管理者" } };
  const kenjiE: IamUser = { ...kenji, attributes: { "c-role": "開発" } };
  const withColumns: PoolView = { ...pool, attributeColumns: COLUMNS, users: [ayakaE, kenjiE] };
  const saveUserAttributes = vi.mocked(api.saveUserAttributes);

  const inputOf = (u: IamUser, columnId: string): HTMLInputElement =>
    fieldOf(`attr-input-${u.arn}-${columnId}`) as HTMLInputElement;
  const edit = (u: IamUser, columnId: string, value: string): void => {
    fireEvent.change(inputOf(u, columnId), { target: { value } });
  };
  const disabled = (testId: string): boolean => {
    const element = screen.getByTestId(testId);
    return (
      element.hasAttribute("disabled") ||
      element.getAttribute("aria-disabled") === "true" ||
      element.querySelector("button[disabled]") !== null
    );
  };
  async function enterEditMode(): Promise<void> {
    getPool.mockResolvedValue({ pool: withColumns });
    await renderScreen();
    fireEvent.click(screen.getByTestId("edit-mode-start"));
  }
  /** 保存の呼び出しを受けて、渡された属性をそのまま保存済みとして返す。 */
  function echoSave(): void {
    saveUserAttributes.mockImplementation(async (arn, attributes) => ({
      user: { ...(withColumns.users.find((u) => u.arn === arn) as IamUser), attributes },
    }));
  }
  const click = async (testId: string): Promise<void> => {
    await act(async () => {
      fireEvent.click(screen.getByTestId(testId));
      await Promise.resolve();
    });
  };

  beforeEach(() => {
    saveUserAttributes.mockReset();
  });

  it("属性の項目が 0 件のプールには「属性一括編集モード」を出さない", async () => {
    await renderScreen();
    expect(screen.queryByTestId("edit-mode-start")).toBeNull();
  });

  it("属性の項目があれば「属性一括編集モード」を出し、押すまで属性のセルは入力欄ではない", async () => {
    getPool.mockResolvedValue({ pool: withColumns });
    await renderScreen();
    expect(screen.getByTestId("edit-mode-start").textContent).toContain("属性一括編集モード");
    expect(screen.queryByTestId(`attr-input-${ayakaE.arn}-c-name`)).toBeNull();
    expect(screen.getByTestId(`attr-${ayakaE.arn}-c-name`).textContent).toBe("森 彩花");
  });

  it("編集モードでは属性のセルが入力欄になり、ほかの更新系の操作は無効、キャンセルと保存が出る", async () => {
    await enterEditMode();

    expect(inputOf(ayakaE, "c-name").value).toBe("森 彩花");
    expect(inputOf(kenjiE, "c-name").value).toBe("");
    expect(inputOf(kenjiE, "c-role").getAttribute("aria-label")).toBe("kenji.sato の 役割");
    for (const testId of [
      "add-users",
      "edit-attribute-columns",
      `edit-user-attributes-${ayakaE.arn}`,
      `delete-user-${ayakaE.arn}`,
    ]) {
      expect(disabled(testId)).toBe(true);
    }
    expect(screen.queryByTestId("edit-mode-start")).toBeNull();
    expect(screen.getByTestId("edit-mode-cancel")).toBeTruthy();
    // 変更が無いので保存は押せない。
    expect(disabled("edit-mode-save")).toBe(true);
  });

  it("primary のボタンは 1 画面に 1 つ（GI-9）。編集モードでは「保存」が唯一の primary になる", async () => {
    const primaries = (): string[] =>
      [...document.querySelectorAll("button")]
        // 閉じているモーダルのボタンも DOM に残るので、ダイアログの外（画面本体）だけを数える。
        .filter((button) => /variant-primary/.test(button.className) && !button.closest("[role='dialog']"))
        .map((button) => button.getAttribute("data-testid") ?? "");
    getPool.mockResolvedValue({ pool: withColumns });
    await renderScreen();
    expect(primaries()).toEqual(["add-users"]);

    fireEvent.click(screen.getByTestId("edit-mode-start"));
    edit(kenjiE, "c-name", "佐藤 健二");
    expect(primaries()).toEqual(["edit-mode-save"]);
  });

  it("変更したセルの数を「変更 n 件」と「保存（n 件）」に出す。元の値に戻すと数えない", async () => {
    await enterEditMode();

    edit(kenjiE, "c-name", "佐藤 健二");
    edit(kenjiE, "c-role", "開発リーダー");
    expect(screen.getByTestId("edit-mode-status").textContent).toContain("変更 2 件");
    expect(screen.getByTestId("edit-mode-save").textContent).toContain("保存（2 件）");
    expect(disabled("edit-mode-save")).toBe(false);

    edit(kenjiE, "c-role", "開発");
    expect(screen.getByTestId("edit-mode-status").textContent).toContain("変更 1 件");
  });

  it("保存は変更のあったユーザだけに、属性を丸ごと（保存済み + 下書き）で送る。全件成功なら編集モードを抜けて通知し、値は再取得なしで入れ替わる", async () => {
    echoSave();
    await enterEditMode();
    getPool.mockClear();

    edit(kenjiE, "c-name", "佐藤 健二");
    await click("edit-mode-save");

    await screen.findByText("1 人の属性を保存しました");
    expect(saveUserAttributes).toHaveBeenCalledTimes(1);
    expect(saveUserAttributes).toHaveBeenCalledWith(kenjiE.arn, { "c-name": "佐藤 健二", "c-role": "開発" });
    expect(screen.queryByTestId("edit-mode-save")).toBeNull();
    expect(screen.getByTestId(`attr-${kenjiE.arn}-c-name`).textContent).toBe("佐藤 健二");
    expect(getPool).not.toHaveBeenCalled();
  });

  it("空にしたセルは未設定として送る（属性から外す）", async () => {
    echoSave();
    await enterEditMode();

    edit(ayakaE, "c-role", "");
    await click("edit-mode-save");

    await screen.findByText("1 人の属性を保存しました");
    expect(saveUserAttributes).toHaveBeenCalledWith(ayakaE.arn, { "c-name": "森 彩花" });
    expect(screen.getByTestId(`attr-${ayakaE.arn}-c-role`).textContent).toBe("—");
  });

  it("128 文字を超える値は、保存を押しても送らず、セルにエラーを出して編集モードのまま", async () => {
    echoSave();
    await enterEditMode();

    edit(kenjiE, "c-name", "あ".repeat(129));
    await click("edit-mode-save");

    expect(saveUserAttributes).not.toHaveBeenCalled();
    expect(screen.getByTestId(`attr-cell-error-${kenjiE.arn}-c-name`).textContent).toContain("128");
    expect(inputOf(kenjiE, "c-name").getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByTestId("edit-mode-save")).toBeTruthy();
  });

  describe("一部だけ失敗したとき", () => {
    const danaE: IamUser = { ...user("dana.okafor"), attributes: {} };
    const three: PoolView = { ...withColumns, users: [ayakaE, danaE, kenjiE] };

    async function savePartially(): Promise<void> {
      getPool.mockResolvedValue({ pool: three });
      saveUserAttributes.mockImplementation(async (arn, attributes) => {
        if (arn === danaE.arn) throw new Error("IAMユーザが見つかりません");
        return { user: { ...(three.users.find((u) => u.arn === arn) as IamUser), attributes } };
      });
      await renderScreen();
      fireEvent.click(screen.getByTestId("edit-mode-start"));
      edit(kenjiE, "c-name", "佐藤 健二");
      edit(danaE, "c-role", "開発");
      await click("edit-mode-save");
      await screen.findByTestId("attr-save-alert");
    }

    it("成功したユーザは確定し、失敗したユーザの行だけ下書きと理由を残して、編集モードに留まる", async () => {
      await savePartially();

      expect(screen.getByTestId("attr-save-alert").textContent).toContain(
        "1 人の属性を保存しました。1 人を保存できませんでした。",
      );
      expect(screen.getByTestId(`attr-row-status-${kenjiE.arn}`).textContent).toBe("保存済み");
      expect(screen.getByTestId(`attr-row-status-${danaE.arn}`).textContent).toContain("IAMユーザが見つかりません");
      expect(inputOf(danaE, "c-role").value).toBe("開発");
      expect(inputOf(danaE, "c-role").getAttribute("aria-invalid")).toBe("true");
      // 確定した分は変更の数から外れる。
      expect(screen.getByTestId("edit-mode-status").textContent).toContain("変更 1 件");
    });

    it("「失敗した 1 人を再送」は、失敗したユーザだけをもう一度送り、成功したら編集モードを抜ける", async () => {
      await savePartially();
      saveUserAttributes.mockClear();
      saveUserAttributes.mockImplementation(async (arn, attributes) => ({
        user: { ...(three.users.find((u) => u.arn === arn) as IamUser), attributes },
      }));

      await click("attr-save-retry");

      await screen.findByText("1 人の属性を保存しました");
      expect(saveUserAttributes).toHaveBeenCalledTimes(1);
      expect(saveUserAttributes).toHaveBeenCalledWith(danaE.arn, { "c-role": "開発" });
      expect(screen.queryByTestId("edit-mode-save")).toBeNull();
    });
  });

  it("保存の同時実行は 4 件までにする", async () => {
    const many: PoolView = {
      ...withColumns,
      users: Array.from({ length: 9 }, (_, i) => ({ ...user(`user${i}`), attributes: {} })),
    };
    getPool.mockResolvedValue({ pool: many });
    let running = 0;
    let peak = 0;
    saveUserAttributes.mockImplementation(async (arn, attributes) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
      return { user: { ...(many.users.find((u) => u.arn === arn) as IamUser), attributes } };
    });
    await renderScreen();
    fireEvent.click(screen.getByTestId("edit-mode-start"));
    for (const u of many.users) edit(u, "c-role", "開発");
    await click("edit-mode-save");

    await screen.findByText("9 人の属性を保存しました");
    expect(saveUserAttributes).toHaveBeenCalledTimes(9);
    expect(peak).toBe(4);
  });

  describe("キャンセルと離脱（GI-4）", () => {
    it("変更が無ければ、キャンセルはすぐ編集モードを抜ける", async () => {
      await enterEditMode();
      fireEvent.click(screen.getByTestId("edit-mode-cancel"));
      expect(screen.queryByTestId("attr-discard-modal")).toBeNull();
      expect(screen.getByTestId("edit-mode-start")).toBeTruthy();
    });

    it("変更があるキャンセルは破棄確認を挟み、「編集に戻る」で下書きを残し、「破棄」で元の値に戻って抜ける", async () => {
      await enterEditMode();
      edit(kenjiE, "c-name", "佐藤 健二");

      fireEvent.click(screen.getByTestId("edit-mode-cancel"));
      expect(screen.getByTestId("attr-discard-modal").textContent).toContain("保存していない変更が 1 件あります");
      fireEvent.click(screen.getByTestId("attr-discard-back"));
      expect(inputOf(kenjiE, "c-name").value).toBe("佐藤 健二");

      fireEvent.click(screen.getByTestId("edit-mode-cancel"));
      fireEvent.click(screen.getByTestId("attr-discard-confirm"));
      expect(screen.getByTestId("edit-mode-start")).toBeTruthy();
      expect(screen.getByTestId(`attr-${kenjiE.arn}-c-name`).textContent).toBe("—");
      expect(saveUserAttributes).not.toHaveBeenCalled();
    });

    it("変更があるとき、アプリ内の遷移は止めて確認を出す。「編集に戻る」で留まり、「破棄して移動」で遷移する", async () => {
      await enterEditMode();
      edit(kenjiE, "c-name", "佐藤 健二");

      act(() => navigate("/roles"));
      expect(window.location.pathname).toBe("/");
      expect(screen.getByTestId("attr-discard-modal").textContent).toContain("別の画面へ移動しようとしました");
      fireEvent.click(screen.getByTestId("attr-discard-back"));
      expect(window.location.pathname).toBe("/");
      expect(inputOf(kenjiE, "c-name").value).toBe("佐藤 健二");

      act(() => navigate("/roles"));
      fireEvent.click(screen.getByTestId("attr-discard-confirm"));
      expect(window.location.pathname).toBe("/roles");
    });

    it("変更が無ければ、アプリ内の遷移は止めない", async () => {
      await enterEditMode();
      act(() => navigate("/roles"));
      expect(window.location.pathname).toBe("/roles");
    });

    it("画面を離れたあとは、ガードが外れて遷移できる", async () => {
      await enterEditMode();
      edit(kenjiE, "c-name", "佐藤 健二");
      cleanup();
      act(() => navigate("/roles"));
      expect(window.location.pathname).toBe("/roles");
    });

    it("変更があるとき、タブを閉じる・再読込には beforeunload の警告を出す。変更が無ければ出さない", async () => {
      await enterEditMode();
      const clean = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(clean);
      expect(clean.defaultPrevented).toBe(false);

      edit(kenjiE, "c-name", "佐藤 健二");
      const dirty = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(dirty);
      expect(dirty.defaultPrevented).toBe(true);
    });
  });

  it("編集モード中も絞り込みは効き、保存済みの値で行を選ぶ（入力中の値では選ばない）", async () => {
    await enterEditMode();
    edit(kenjiE, "c-name", "ひみつ");
    fireEvent.change(fieldOf("pool-filter"), { target: { value: "ひみつ" } });
    expect(screen.getByTestId("pool-filter-empty")).toBeTruthy();
  });
});
