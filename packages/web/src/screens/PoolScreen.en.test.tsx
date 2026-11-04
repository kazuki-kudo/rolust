// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { IamUser, PoolView } from "@rolust/core";
import { buildUserArn, localized } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiClientError } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { LocaleProvider, useLocale } from "../i18n/index.js";
import { navigate } from "../router.js";
import { PoolScreen } from "./PoolScreen.js";

/** 画面 1（IAM users）を英語で描く（Issue #94）。日本語の挙動は `PoolScreen.test.tsx` が守る。 */

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

const ACCOUNT = "111122223333";

function user(userName: string, attributes: Record<string, string> = {}): IamUser {
  return {
    poolId: "platform-team",
    accountId: ACCOUNT,
    userName,
    arn: buildUserArn(ACCOUNT, userName),
    createdAt: "2026-07-30T00:00:00.000Z",
    attributes,
  };
}

const COLUMNS = [
  { columnId: "c-name", name: "Name" },
  { columnId: "c-role", name: "Role" },
];
const ayaka = user("ayaka.mori", { "c-name": "Ayaka Mori", "c-role": "Admin" });
const kenji = user("kenji.sato", { "c-role": "Dev" });
const plain: PoolView = {
  poolId: "platform-team",
  createdAt: "2026-07-30T00:00:00.000Z",
  users: [user("ayaka.mori"), user("kenji.sato")],
  linkedRoleCount: 3,
  attributeColumns: [],
};
const withColumns: PoolView = { ...plain, attributeColumns: COLUMNS, users: [ayaka, kenji] };

const getPool = vi.mocked(api.getPool);
const addUsers = vi.mocked(api.addUsers);
const deleteUser = vi.mocked(api.deleteUser);
const saveAttributeColumns = vi.mocked(api.saveAttributeColumns);
const saveUserAttributes = vi.mocked(api.saveUserAttributes);

/** 言語を切り替えるボタン（Provider の外に出せない言語切り替えの代わり）。 */
function Switch(): React.JSX.Element {
  const { setLocale } = useLocale();
  return (
    <button type="button" data-testid="to-ja" onClick={() => setLocale("ja")}>
      ja
    </button>
  );
}

async function renderEn(data: PoolView = plain): Promise<void> {
  getPool.mockResolvedValue({ pool: data });
  render(
    <LocaleProvider initialLocale="en" storage={null}>
      <PoolScreen />
      <Switch />
    </LocaleProvider>,
  );
  await screen.findByText(/^IAM users \d+/);
}

function fieldOf(testId: string): HTMLInputElement | HTMLTextAreaElement {
  const element = screen.getByTestId(testId);
  if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element;
  return element.querySelector("input, textarea") as HTMLInputElement | HTMLTextAreaElement;
}

function type(testId: string, value: string): void {
  fireEvent.change(fieldOf(testId), { target: { value } });
}

async function click(testId: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId(testId));
    await Promise.resolve();
    await Promise.resolve();
  });
}

const JAPANESE = /[\u3000-\u30ff\u4e00-\u9fff\uff00-\uffef]/;

/** 画面全体に日本語が残っていないこと（利用者のデータを除く）。 */
function expectNoJapanese(root: Element = document.body): void {
  expect(root.textContent ?? "").not.toMatch(JAPANESE);
}

function thTexts(testId: string): string[] {
  return [...(screen.getByTestId(testId).querySelector("thead tr")?.querySelectorAll("th") ?? [])].map(
    (th) => th.textContent?.trim() ?? "",
  );
}

beforeEach(() => {
  getPool.mockReset();
  addUsers.mockReset();
  deleteUser.mockReset();
  saveAttributeColumns.mockReset();
  saveUserAttributes.mockReset();
});

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});

describe("画面 1 の英語の表示（Issue #94）", () => {
  it("見出し・件数・主操作・表の見出し・絞り込みが英語になる", async () => {
    getPool.mockReturnValue(new Promise(() => {}));
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <PoolScreen />
      </LocaleProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "IAM users" })).toBeTruthy();
    expect(screen.getByTestId("page-heading-counts").textContent).toBe("IAM users — / AWS accounts — / IAM roles —");
    cleanup();

    await renderEn();
    expect(screen.getByTestId("page-heading-counts").textContent).toBe("IAM users 2 / AWS accounts 1 / IAM roles 3");
    expect(screen.getByTestId("add-users").textContent).toBe("Register new user");
    expect(screen.getByTestId("edit-attribute-columns").textContent).toBe("Edit attribute columns");
    expect(thTexts("pool-users")).toEqual(["AWS account", "IAM user name"]);
    expect(screen.getByRole("button", { name: `Unregister ayaka.mori` })).toBeTruthy();

    const filter = fieldOf("pool-filter");
    expect(filter.getAttribute("placeholder")).toBe("Filter by AWS account ID, IAM user name, or attribute value");
    expect(filter.getAttribute("aria-label")).toBe("Filter IAM users");
    type("pool-filter", "ayaka");
    expect(document.body.textContent).toContain("1 match (of 2)");
    type("pool-filter", "a");
    expect(document.body.textContent).toContain("2 matches (of 2)");
    type("pool-filter", "zzz");
    expect(screen.getByTestId("pool-filter-empty").textContent).toContain("No IAM users match the filter");
    expect(screen.getByTestId("pool-filter-clear").textContent).toBe("Clear filter");
    expectNoJapanese();
  });

  it("ユーザが 0 件の案内が英語になる", async () => {
    await renderEn({ ...plain, users: [] });
    expect(screen.getByTestId("pool-users-empty").textContent).toContain("No IAM users yet");
    expect(screen.getByTestId("pool-empty-add-users").textContent).toBe("Register new user");
    expectNoJapanese();
  });

  it("属性の項目がある表の見出し・セル・操作が英語になる", async () => {
    await renderEn(withColumns);
    expect(thTexts("pool-users")).toEqual(["AWS account", "IAM user name", "Name", "Role", "Actions"]);
    expect(screen.getByTestId(`attr-${kenji.arn}-c-name`).textContent).toBe("—");
    expect(screen.getByTestId(`edit-user-attributes-${ayaka.arn}`).textContent).toBe("Edit attributes");
    expect(screen.getByTestId(`delete-user-${ayaka.arn}`).textContent).toBe("Unregister");
    expect(screen.getByRole("button", { name: "Edit attributes of ayaka.mori" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unregister ayaka.mori" })).toBeTruthy();
    expect(screen.getByTestId("edit-mode-start").textContent).toBe("Bulk edit attributes");
    expectNoJapanese();
  });

  it("読み込みの失敗は localized を英語に描画し、見出しも英語になる", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getPool.mockRejectedValue(
      new ApiClientError(404, {
        code: "NotFound",
        message: "ロールは登録されていません",
        localized: { id: "role.notRegistered", params: { roleArn: "arn:aws:iam::111122223333:role/R" } },
      }),
    );
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <PoolScreen />
      </LocaleProvider>,
    );
    const panel = await screen.findByTestId("pools-error");
    expect(panel.textContent).toContain("Could not load the IAM users");
    expect(panel.textContent).toContain("The IAM role is not registered");
    expectNoJapanese(panel);
  });
});

describe("ユーザ登録モーダル（1 件ずつ）", () => {
  async function open(): Promise<void> {
    await renderEn();
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");
  }

  it("見出し・欄・検証・プレビュー・ボタンが英語になる", async () => {
    await open();
    const modal = screen.getByTestId("add-users-modal");
    expect(modal.textContent).toContain("Register new user");
    expect(modal.textContent).toContain("Registration method");
    expect(modal.textContent).toContain("One at a time");
    expect(modal.textContent).toContain("AWS account ID");
    expect(modal.textContent).toContain("IAM user names");
    expect(modal.textContent).toContain(
      "One name per line. Leading and trailing spaces and blank lines are ignored, and duplicates are merged into one.",
    );
    expect(modal.textContent).toContain("Derived ARN (first user)");
    expect(screen.getByTestId("add-users-cancel").textContent).toBe("Cancel");
    expect(screen.getByTestId("add-users-submit").textContent).toBe("Register");

    type("add-users-account-id", "123");
    type("add-users-user-names", "bad name!");
    await click("add-users-submit");
    expect(modal.textContent).toContain("AWS account ID must be 12 digits");
    expect(modal.textContent).toContain("IAM user name contains characters that are not allowed: bad name!");

    type("add-users-account-id", "");
    type("add-users-user-names", "");
    await click("add-users-submit");
    expect(modal.textContent).toContain("AWS account ID is required");
    expect(modal.textContent).toContain("Enter at least one IAM user name");

    type("add-users-account-id", ACCOUNT);
    type("add-users-user-names", "miki.tanaka");
    expect(screen.getByTestId("add-users-arn-preview").textContent).toBe(buildUserArn(ACCOUNT, "miki.tanaka"));
    expectNoJapanese(modal);
  });

  it("登録の成功通知は件数の単数・複数を出し分ける", async () => {
    await open();
    type("add-users-account-id", ACCOUNT);
    type("add-users-user-names", "miki.tanaka");
    addUsers.mockResolvedValue({ users: [], createdCount: 1, skippedCount: 0 });
    await click("add-users-submit");
    await screen.findByText("1 IAM user registered");

    cleanup();
    await open();
    type("add-users-account-id", ACCOUNT);
    type("add-users-user-names", "miki.tanaka\nrei.ono");
    addUsers.mockResolvedValue({ users: [], createdCount: 2, skippedCount: 1 });
    await click("add-users-submit");
    await screen.findByText("2 IAM users registered (1 already registered; unchanged)");

    cleanup();
    await open();
    type("add-users-account-id", ACCOUNT);
    type("add-users-user-names", "miki.tanaka\nrei.ono");
    addUsers.mockResolvedValue({ users: [], createdCount: 1, skippedCount: 2 });
    await click("add-users-submit");
    await screen.findByText("1 IAM user registered (2 already registered; unchanged)");
  });

  it("登録の失敗（localized）を英語で出し、モーダルは閉じない", async () => {
    await open();
    type("add-users-account-id", ACCOUNT);
    type("add-users-user-names", "miki.tanaka");
    addUsers.mockRejectedValue(
      new ApiClientError(400, {
        code: "ValidationError",
        message: "各ユーザは JSON オブジェクトで指定してください",
        localized: localized("csv.userNotObject", {}),
      }),
    );
    await click("add-users-submit");
    expect(screen.getByTestId("add-users-modal").textContent).toContain("Each user must be an object");
    expectNoJapanese(screen.getByTestId("add-users-modal"));
  });
});

describe("ユーザ登録モーダル（CSV）", () => {
  async function openCsv(data: PoolView = withColumns): Promise<void> {
    await renderEn(data);
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");
    fireEvent.click(screen.getByText("CSV"));
    await screen.findByTestId("add-users-csv");
  }

  it("形式の説明と例が英語になり、ヘッダは入力欄に初期入力される（Issue #207）", async () => {
    await openCsv();
    // CSV のヘッダ「ユーザ名」は、CSV の仕様として固定の日本語（core の CSV_USER_NAME_HEADER）。
    const help = screen.getByTestId("add-users-csv-help").textContent ?? "";
    expect(help).toContain("The header row is already filled in as the first row.");
    expect(help).toContain('A "ユーザ名" column (the IAM user name) is required');
    expect(help).toContain("Separate columns with commas, up to 500 rows at a time.");
    expect(help).toContain("IAM users that are already registered are not changed.");
    expect(help).toContain("If any row is invalid, nothing is registered.");
    expect(help).toContain("ayaka.mori,value1,value2");
    expect(help).not.toContain("ユーザ名,Name,Role");
    expect(help.replaceAll("ユーザ名", "")).not.toMatch(JAPANESE);
    expect(fieldOf("add-users-csv").value).toBe("ユーザ名,Name,Role");
  });

  it("構文エラー（UserCsvError.localized）は「Line n: 」つきで英語になり、入力が空なら案内が出る", async () => {
    await openCsv();
    type("add-users-csv", "");
    fireEvent.blur(fieldOf("add-users-csv"));
    expect(screen.getByTestId("add-users-csv-errors").textContent).toBe("Enter the CSV");

    type("add-users-csv", "ユーザ名,Dept\nmiki.tanaka,Dev");
    fireEvent.blur(fieldOf("add-users-csv"));
    const errors = screen.getByTestId("add-users-csv-errors").textContent ?? "";
    expect(errors).toContain('Line 1: The column "Dept" is not an attribute column of this pool');
    expect(errors).toContain('"Edit attribute columns"');
    expect(errors.replaceAll("ユーザ名", "")).not.toMatch(JAPANESE);

    type("add-users-csv", 'ユーザ名,Role\nmiki.tanaka,"Dev');
    expect(screen.getByTestId("add-users-csv-errors").textContent).toBe("Line 2: A quote is not closed");

    type("add-users-csv", "ユーザ名\nbad name 1\nbad name 2");
    expect(screen.getByTestId("add-users-csv-errors").querySelectorAll("li")).toHaveLength(2);
  });

  it("エラーが多いときの「ほか n 件」は複数形を出し分ける", async () => {
    await openCsv();
    const rows = (count: number): string =>
      "ユーザ名\n" + Array.from({ length: count }, (_, i) => `bad name ${i}`).join("\n");
    fireEvent.blur(fieldOf("add-users-csv"));
    type("add-users-csv", rows(51));
    expect(screen.getByTestId("add-users-csv-errors").textContent).toMatch(/and 1 more error$/);
    type("add-users-csv", rows(52));
    expect(screen.getByTestId("add-users-csv-errors").textContent).toMatch(/and 2 more errors$/);
  });

  it("サーバのエラー（localized の csv.rowError）は英語で出し、再送の案内を添える", async () => {
    await openCsv();
    type("add-users-account-id", ACCOUNT);
    type("add-users-csv", "ユーザ名,Name,Role\nmiki.tanaka,A,B");
    addUsers.mockRejectedValue(
      new ApiClientError(400, {
        code: "ValidationError",
        message: "1 行目: 日本語",
        localized: localized("csv.rowError", { position: 1, cause: localized("csv.duplicateUserName", { name: "miki.tanaka" }) }),
      }),
    );
    await click("add-users-submit");
    const text = screen.getByTestId("add-users-modal").textContent ?? "";
    expect(text).toContain(
      'Row 1: The user name "miki.tanaka" is duplicated (You can resend the same CSV as is. IAM users that are already registered are not changed.)',
    );
  });

  it("5xx で localized が無いサーバのエラーは、定型の英語になる", async () => {
    await openCsv();
    type("add-users-account-id", ACCOUNT);
    type("add-users-csv", "ユーザ名,Name,Role\nmiki.tanaka,A,B");
    addUsers.mockRejectedValue(new ApiClientError(502, { code: "StorageError", message: "DynamoDB の PutItem に失敗しました" }));
    await click("add-users-submit");
    const text = screen.getByTestId("add-users-modal").textContent ?? "";
    expect(text).toContain("An internal server error occurred (You can resend the same CSV as is.");
    expect(text.replaceAll("ユーザ名", "")).not.toMatch(JAPANESE);
  });
});

describe("属性の項目を編集モーダル", () => {
  async function open(): Promise<void> {
    await renderEn(withColumns);
    fireEvent.click(screen.getByTestId("edit-attribute-columns"));
    await screen.findByTestId("attribute-column-name-0");
  }

  it("見出し・説明・ARIA ラベル・削除の警告が英語になる", async () => {
    await open();
    const modal = screen.getByTestId("attribute-columns-modal");
    expect(modal.textContent).toContain("Edit attribute columns");
    expect(modal.textContent).toContain(
      "Columns that can hold a value for each IAM user. Up to 10 columns. Column names must be unique within the pool.",
    );
    expect(screen.getByTestId("attribute-columns-add").textContent).toBe("Add column");
    expect(screen.getByTestId("attribute-column-remove-0").textContent).toBe("Remove");
    expect(screen.getByRole("textbox", { name: "Name of column 1" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove column 1 (Name)" })).toBeTruthy();
    expect(screen.getByTestId("attribute-columns-cancel").textContent).toBe("Cancel");
    expect(screen.getByTestId("attribute-columns-submit").textContent).toBe("Save");

    await click("attribute-column-remove-0");
    expect(screen.getByTestId("attribute-columns-delete-warning").textContent).toBe(
      'Removing "Name" hides the values in that column. Even if you recreate it with the same name, the values do not come back.',
    );
    await click("attribute-column-remove-0");
    expect(screen.getByTestId("attribute-columns-delete-warning").textContent).toBe(
      'Removing "Name", "Role" hides the values in those columns. Even if you recreate them with the same name, the values do not come back.',
    );
    expectNoJapanese(modal);
  });

  it("検証エラー（ValidationError.localized）と保存の失敗が英語になる", async () => {
    await open();
    type("attribute-column-name-0", "   ");
    await click("attribute-columns-submit");
    expect(screen.getByTestId("attribute-columns-modal").textContent).toContain("Enter a column name");

    type("attribute-column-name-0", "Role");
    await click("attribute-columns-submit");
    expect(screen.getByTestId("attribute-columns-modal").textContent).toContain('The column name "Role" is duplicated');

    type("attribute-column-name-0", "Team");
    saveAttributeColumns.mockRejectedValue(
      new ApiClientError(409, { code: "Conflict", message: "競合しました", localized: localized("attribute.tooManyColumns", { max: 10 }) }),
    );
    await click("attribute-columns-submit");
    expect(screen.getByTestId("attribute-columns-modal").textContent).toContain("A pool can have at most 10 attribute columns");
    expectNoJapanese(screen.getByTestId("attribute-columns-modal"));
  });

  it("保存の成功通知が英語になる", async () => {
    await open();
    saveAttributeColumns.mockResolvedValue({ columns: COLUMNS });
    await click("attribute-columns-submit");
    await screen.findByText("Saved the attribute columns");
  });
});

describe("属性を編集モーダル", () => {
  async function open(): Promise<void> {
    await renderEn(withColumns);
    fireEvent.click(screen.getByTestId(`edit-user-attributes-${ayaka.arn}`));
    await screen.findByTestId("user-attribute-c-name");
  }

  it("見出し・説明・検証・保存の通知が英語になる", async () => {
    await open();
    const modal = screen.getByTestId("user-attributes-modal");
    expect(modal.textContent).toContain("Edit attributes");
    expect(modal.textContent).toContain("IAM user");
    expect(modal.textContent).toContain("Leave empty to unset. Up to 128 characters.");
    expect(screen.getByTestId("user-attributes-cancel").textContent).toBe("Cancel");
    expect(screen.getByTestId("user-attributes-submit").textContent).toBe("Save");

    type("user-attribute-c-name", "x".repeat(129));
    fireEvent.blur(fieldOf("user-attribute-c-name"));
    expect(modal.textContent).toContain("Values must be 128 characters or fewer");

    type("user-attribute-c-name", "ok");
    saveUserAttributes.mockRejectedValue(
      new ApiClientError(404, { code: "NotFound", message: "IAMユーザが見つかりません", localized: localized("attribute.unknownColumn", { columnId: "c-x" }) }),
    );
    await click("user-attributes-submit");
    expect(modal.textContent).toContain("Unknown attribute column: c-x");
    expectNoJapanese(modal);

    saveUserAttributes.mockResolvedValue({ user: { ...ayaka, attributes: { "c-name": "ok" } } });
    await click("user-attributes-submit");
    await screen.findByText("Saved the attributes of ayaka.mori");
  });
});

describe("登録の解除", () => {
  it("確認モーダル・通知・失敗が英語になる", async () => {
    await renderEn();
    fireEvent.click(screen.getByTestId(`delete-user-${plain.users[0]!.arn}`));
    const modal = screen.getByTestId("delete-user-modal");
    expect(modal.textContent).toContain("Unregister the IAM user?");
    expect(modal.textContent).toContain(`${plain.users[0]!.arn} will be unregistered.`);
    expect(modal.textContent).toContain(
      "All assignments of this IAM user (the checks in Role assignments) are also removed. The IAM user in AWS is not deleted.",
    );
    expect(modal.textContent).toContain("The contents of added and removed users recorded in existing requests do not change.");
    expect(modal.textContent).toContain(
      "It cannot be unregistered while it has an applied assignment or is included in an unapplied request. " +
        "Even if unregistered, it would remain in the trust policy and no longer be visible in the matrix.",
    );
    expect(screen.getByTestId("delete-user-cancel").textContent).toBe("Cancel");
    expect(screen.getByTestId("delete-user-confirm").textContent).toBe("Unregister");
    expectNoJapanese(modal);

    deleteUser.mockRejectedValueOnce(
      new ApiClientError(409, { code: "Conflict", message: "x", localized: localized("csv.usersEmpty", {}) }),
    );
    await click("delete-user-confirm");
    expect(screen.getByTestId("delete-user-error").textContent).toContain("Specify at least one user to register");

    deleteUser.mockResolvedValue({ removedAssignments: 1 } as never);
    await click("delete-user-confirm");
    await screen.findByText("Unregistered ayaka.mori (1 assignment removed with it)");
  });

  it("連鎖削除の件数は複数形を出し分ける", async () => {
    await renderEn();
    fireEvent.click(screen.getByTestId(`delete-user-${plain.users[0]!.arn}`));
    deleteUser.mockResolvedValue({ removedAssignments: 3 } as never);
    await click("delete-user-confirm");
    await screen.findByText("Unregistered ayaka.mori (3 assignments removed with it)");
  });
});

describe("属性の編集モード", () => {
  const edit = (u: IamUser, columnId: string, value: string): void => type(`attr-input-${u.arn}-${columnId}`, value);

  async function start(): Promise<void> {
    await renderEn(withColumns);
    fireEvent.click(screen.getByTestId("edit-mode-start"));
  }

  it("バー・入力欄の ARIA・件数・エラー・保存が英語になる", async () => {
    await start();
    expect(screen.getByTestId("edit-mode-status").textContent).toBe("Editing 0 changes");
    expect(screen.getByTestId("edit-mode-cancel").textContent).toBe("Cancel");
    expect(screen.getByTestId("edit-mode-save").textContent).toBe("Save (0 changes)");
    expect(screen.getByRole("textbox", { name: "Name of ayaka.mori" })).toBeTruthy();

    edit(kenji, "c-name", "Kenji Sato");
    expect(screen.getByTestId("edit-mode-status").textContent).toBe("Editing 1 change");
    expect(screen.getByTestId("edit-mode-save").textContent).toBe("Save (1 change)");

    edit(ayaka, "c-role", "x".repeat(129));
    fireEvent.blur(fieldOf(`attr-input-${ayaka.arn}-c-role`));
    expect(screen.getByTestId(`attr-cell-error-${ayaka.arn}-c-role`).textContent).toBe(
      "Values must be 128 characters or fewer",
    );
    expectNoJapanese();
  });

  it("成功の通知と、一部だけ失敗したときの警告・行の状態が英語になる", async () => {
    await start();
    edit(kenji, "c-name", "Kenji Sato");
    edit(ayaka, "c-role", "Boss");
    saveUserAttributes.mockImplementation(async (arn, attributes) => {
      if (arn === ayaka.arn) {
        throw new ApiClientError(404, { code: "NotFound", message: "IAMユーザが見つかりません", localized: localized("attribute.unknownColumn", { columnId: "c-role" }) });
      }
      return { user: { ...kenji, attributes } };
    });
    await click("edit-mode-save");
    await screen.findByTestId("attr-save-alert");
    const alert = screen.getByTestId("attr-save-alert").textContent ?? "";
    expect(alert).toContain(
      "Saved the attributes of 1 user. Could not save 1 user. Check the reason shown on each row that was not saved, then retry.",
    );
    expect(screen.getByTestId("attr-save-retry").textContent).toBe("Retry the 1 user that failed");
    expect(screen.getByTestId(`attr-row-status-${kenji.arn}`).textContent).toBe("Saved");
    expect(screen.getByTestId(`attr-row-status-${ayaka.arn}`).textContent).toBe(
      "Could not save: Unknown attribute column: c-role",
    );
    expectNoJapanese();

    saveUserAttributes.mockImplementation(async (_arn, attributes) => ({ user: { ...ayaka, attributes } }));
    await click("attr-save-retry");
    await screen.findByText("Saved the attributes of 1 user");
  });

  it("破棄の確認（キャンセル・遷移）が英語になり、開いたまま言語を切り替えると追随する", async () => {
    await start();
    edit(kenji, "c-name", "Kenji Sato");

    fireEvent.click(screen.getByTestId("edit-mode-cancel"));
    let modal = screen.getByTestId("attr-discard-modal");
    expect(modal.textContent).toContain("Discard your input?");
    expect(modal.textContent).toContain("You have 1 unsaved change. This cannot be undone once discarded.");
    expect(screen.getByTestId("attr-discard-back").textContent).toBe("Back to editing");
    expect(screen.getByTestId("attr-discard-confirm").textContent).toBe("Discard");
    expectNoJapanese(modal);
    fireEvent.click(screen.getByTestId("attr-discard-back"));

    act(() => navigate("/roles"));
    modal = screen.getByTestId("attr-discard-modal");
    expect(modal.textContent).toContain("You tried to go to another screen.");
    expect(screen.getByTestId("attr-discard-confirm").textContent).toBe("Discard and leave");

    // 確認を開いたまま日本語に切り替えると、理由と確定ボタンも日本語になる。
    fireEvent.click(screen.getByTestId("to-ja"));
    await waitFor(() => expect(screen.getByTestId("attr-discard-confirm").textContent).toBe("破棄して移動"));
    expect(screen.getByTestId("attr-discard-modal").textContent).toContain("別の画面へ移動しようとしました。");
  });
});

describe("登録の失敗の再送ヒントは、送信時のモードに付く（現在のモードに追従しない）", () => {
  const RETRY_EN = "You can resend the same CSV as is.";
  const RETRY_JA = "同じ CSV をそのまま再送できます";
  const failure = (): ApiClientError =>
    new ApiClientError(400, {
      code: "ValidationError",
      message: "登録するユーザを 1 件以上指定してください",
      localized: localized("csv.usersEmpty", {}),
    });

  async function openModal(): Promise<void> {
    await renderEn(withColumns);
    fireEvent.click(screen.getByTestId("add-users"));
    await screen.findByTestId("add-users-user-names");
  }
  const modalText = (): string => screen.getByTestId("add-users-modal").textContent ?? "";

  it("「1 件ずつ」で失敗してから CSV に切り替えても、ヒントは付かない（英語・日本語）", async () => {
    await openModal();
    type("add-users-account-id", ACCOUNT);
    type("add-users-user-names", "miki.tanaka");
    addUsers.mockRejectedValue(failure());
    await click("add-users-submit");
    expect(modalText()).toContain("Specify at least one user to register");
    expect(modalText()).not.toContain(RETRY_EN);

    fireEvent.click(screen.getByText("CSV"));
    await screen.findByTestId("add-users-csv");
    expect(modalText()).toContain("Specify at least one user to register");
    expect(modalText()).not.toContain(RETRY_EN);

    // 言語を切り替えても、エラーの文は追随し、ヒントは付かないまま。
    fireEvent.click(screen.getByTestId("to-ja"));
    await waitFor(() => expect(modalText()).not.toContain("Specify at least one user to register"));
    expect(modalText()).toContain("登録するユーザを 1 件以上指定してください");
    expect(modalText()).not.toContain(RETRY_JA);
  });

  it("CSV で失敗してから「1 件ずつ」に切り替えても、ヒントは残る（英語・日本語）", async () => {
    await openModal();
    type("add-users-account-id", ACCOUNT);
    fireEvent.click(screen.getByText("CSV"));
    await screen.findByTestId("add-users-csv");
    type("add-users-csv", "ユーザ名,Name,Role\nmiki.tanaka,A,B");
    addUsers.mockRejectedValue(failure());
    await click("add-users-submit");
    expect(modalText()).toContain(`Specify at least one user to register (${RETRY_EN}`);

    fireEvent.click(screen.getByText("One at a time"));
    await screen.findByTestId("add-users-user-names");
    expect(modalText()).toContain(`Specify at least one user to register (${RETRY_EN}`);

    fireEvent.click(screen.getByTestId("to-ja"));
    await waitFor(() => expect(modalText()).toContain(RETRY_JA));
    expect(modalText()).toContain("登録するユーザを 1 件以上指定してください（" + RETRY_JA);
    expect(modalText()).not.toContain(RETRY_EN);
  });
});
