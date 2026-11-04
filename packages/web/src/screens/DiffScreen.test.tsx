// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ApplyReport, ChangeRequest, DiffView } from "@rolust/core";
import { buildRoleArn, buildUserArn, localized } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { LocaleProvider } from "../i18n/index.js";
import { PermissionProvider } from "../permission.js";
import { DiffScreen } from "./DiffScreen.js";

/**
 * 画面 4（FR-7.4）のユニットテスト。
 *
 * 主目的は Step 17-B のカード単位ローディング（質問 6 = C / 質問 8 = A）である。
 * 固定するのは次の 3 点で、いずれも「1 レスポンスに畳んでいた頃には表現できなかった」
 * 挙動である。
 *
 * 1. カードごとに独立した loading を持つ（先に届いたカードから描画される）
 * 2. 1 件の失敗が他のカードの描画を止めない
 * 3. **読み込みが完了したカードだけ**が初期選択に入る（中身を見る前に反映ボタンが
 *    活性化しない）
 *
 * `api-client` だけを差し替え、画面・フック・Cloudscape は本物を通す。
 */

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: {
      getDiff: vi.fn(),
      applyChangeRequests: vi.fn(),
    },
  };
});

const POOL = "platform-team";
const ROLE_ACCOUNT = "555566667777";
const USER_ACCOUNT = "111122223333";
const AYAKA = buildUserArn(USER_ACCOUNT, "ayaka.mori");
const DEPLOY = buildRoleArn(ROLE_ACCOUNT, "RolustManaged-DeployProd");
const AUDIT = buildRoleArn(ROLE_ACCOUNT, "RolustManaged-ReadOnlyAudit");

function changeRequest(id: string, roleArn: string): ChangeRequest {
  return {
    changeRequestId: id,
    poolId: POOL,
    roleArn,
    addUserArns: [AYAKA],
    removeUserArns: [],
    status: "draft",
    createdAt: "2026-07-31T10:04:00.000Z",
    createdBy: null,
    appliedAt: null,
    appliedBy: null,
    result: null,
  };
}

/** 読み取りに成功したカード。 */
function readable(id: string, roleArn: string): DiffView {
  return {
    changeRequest: changeRequest(id, roleArn),
    diff: {
      roleArn,
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
}

/** 信頼ポリシーの読み取りに失敗したカード（差分を描けないため選択できない）。 */
function unreadable(id: string, roleArn: string): DiffView {
  return {
    changeRequest: changeRequest(id, roleArn),
    diff: null,
    unmanaged: [],
    readError: { errorCode: "AccessDenied", message: "GetRole を拒否されました" },
  };
}

function report(id: string, roleArn: string, ok: boolean): ApplyReport {
  return {
    changeRequestId: id,
    roleArn,
    ok,
    status: ok ? "applied" : "failed",
    appliedAt: "2026-07-31T11:00:00.000Z",
    errorCode: ok ? null : "AccessDenied",
    message: ok ? "信頼ポリシーを更新しました" : "UpdateAssumeRolePolicy を拒否されました",
    added: ok ? [AYAKA] : [],
    removed: [],
    warnings: [],
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const getDiff = vi.mocked(api.getDiff);
const applyChangeRequests = vi.mocked(api.applyChangeRequests);

/** id ごとの未解決 Promise。テストが 1 件ずつ解決してカードの独立性を観測する。 */
let pending: Map<string, Deferred<DiffView | null>>;

function renderScreen(ids: string[]): void {
  pending = new Map(ids.map((id) => [id, deferred<DiffView | null>()]));
  getDiff.mockImplementation((id: string) => {
    const entry = pending.get(id);
    if (!entry) throw new Error(`想定外の id が要求されました: ${id}`);
    return entry.promise;
  });
  render(<DiffScreen query={new URLSearchParams(`ids=${ids.join(",")}`)} />);
}

/** 1 件のカードを解決する。React の state 更新を act で包む。 */
async function settle(id: string, value: DiffView | null): Promise<void> {
  await act(async () => {
    pending.get(id)?.resolve(value);
    await Promise.resolve();
  });
}

async function fail(id: string, cause: Error): Promise<void> {
  await act(async () => {
    pending.get(id)?.reject(cause);
    await Promise.resolve();
  });
}

beforeEach(() => {
  // 失敗経路は console.error を通る。テスト出力を汚さないために黙らせる
  // （握り潰しの検証ではないので、呼ばれた回数は問わない）。
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(cleanup);

describe("見出し行（Issue #155）", () => {
  it("見出しと件数は同じ行にある", () => {
    renderScreen(["cr-1"]);
    const heading = screen.getByRole("heading", { level: 1, name: "差分確認・反映" });
    const counts = screen.getByTestId("page-heading-counts");
    expect((counts.parentElement as HTMLElement).contains(heading)).toBe(true);
  });
});

describe("カード単位のローディング（FR-7.4 / 質問 8 = A）", () => {
  it("id ごとに 1 件で並列に呼び、未着のカードは読み込み中のまま描画する", async () => {
    renderScreen(["cr-1", "cr-2"]);

    // `GET /diff?ids=<csv>` の 1 回呼びではなく、id ごとに 1 回ずつ呼ぶ。
    await waitFor(() => {
      expect(getDiff).toHaveBeenCalledTimes(2);
    });
    expect(getDiff).toHaveBeenCalledWith("cr-1");
    expect(getDiff).toHaveBeenCalledWith("cr-2");

    expect(screen.getByTestId("diff-loading-cr-1")).toBeTruthy();
    expect(screen.getByTestId("diff-loading-cr-2")).toBeTruthy();

    await settle("cr-1", readable("cr-1", DEPLOY));

    // 先に届いた 1 件だけが差分カードになり、残りは読み込み中のままである。
    await screen.findByTestId("diff-card-cr-1");
    expect(screen.queryByTestId("diff-loading-cr-1")).toBeNull();
    expect(screen.getByTestId("diff-loading-cr-2")).toBeTruthy();
  });

  it("1 件の取得が失敗しても他のカードは描画され続ける", async () => {
    renderScreen(["cr-1", "cr-2"]);

    await fail("cr-1", new Error("Rate exceeded"));
    await settle("cr-2", readable("cr-2", AUDIT));

    // 失敗したカードは自分の位置にエラーとして残り、再試行の導線を持つ。
    await screen.findByTestId("diff-error-cr-1");
    expect(screen.getByTestId("diff-error-cr-1-retry")).toBeTruthy();
    // 隣のカードは通常どおり描画されている。
    expect(screen.getByTestId("diff-card-cr-2")).toBeTruthy();
  });

  it("失敗したカードだけを再試行でき、他のカードを読み直さない", async () => {
    renderScreen(["cr-1", "cr-2"]);

    await fail("cr-1", new Error("Rate exceeded"));
    await settle("cr-2", readable("cr-2", AUDIT));
    await screen.findByTestId("diff-error-cr-1");

    const retryDeferred = deferred<DiffView | null>();
    pending.set("cr-1", retryDeferred);
    fireEvent.click(screen.getByTestId("diff-error-cr-1-retry"));

    await screen.findByTestId("diff-loading-cr-1");
    await settle("cr-1", readable("cr-1", DEPLOY));
    await screen.findByTestId("diff-card-cr-1");

    // 再試行したのは失敗した 1 件だけ（初回 2 回 + 再試行 1 回）。
    expect(getDiff).toHaveBeenCalledTimes(3);
  });

  it("見つからない申請は、全件が解決してから警告帯にまとめて出す", async () => {
    renderScreen(["cr-1", "cr-2"]);

    await settle("cr-1", null);
    // まだ 1 件が読み込み中の間は「見つからなかった」と断定しない。
    expect(screen.queryByTestId("diff-missing")).toBeNull();

    await settle("cr-2", readable("cr-2", AUDIT));

    const missing = await screen.findByTestId("diff-missing");
    expect(missing.textContent).toContain("cr-1");
  });
});

describe("反映対象の初期選択（Step 17-B）", () => {
  it("読み込みが完了したカードだけが初期選択に入る", async () => {
    renderScreen(["cr-1", "cr-2"]);

    // 2 件とも未着の時点では反映できない。
    const button = screen.getByTestId("diff-apply-selected");
    expect(button.textContent).toContain("選択した 0 件を反映");

    await settle("cr-1", readable("cr-1", DEPLOY));
    await waitFor(() => {
      expect(screen.getByTestId("diff-apply-selected").textContent).toContain(
        "選択した 1 件を反映",
      );
    });

    // 後から届いたカードも自動的に選択へ加わる（利用者の操作を待たない）。
    await settle("cr-2", readable("cr-2", AUDIT));
    await waitFor(() => {
      expect(screen.getByTestId("diff-apply-selected").textContent).toContain(
        "選択した 2 件を反映",
      );
    });
  });

  it("信頼ポリシーを読み取れなかったカードは選択に入らない（警告ではなく読み取り失敗）", async () => {
    renderScreen(["cr-1", "cr-2"]);

    await settle("cr-1", readable("cr-1", DEPLOY));
    await settle("cr-2", unreadable("cr-2", AUDIT));

    await screen.findByTestId("diff-card-cr-2-read-error");
    expect(screen.getByTestId("diff-apply-selected").textContent).toContain(
      "選択した 1 件を反映",
    );
  });

  it("利用者が外した選択は、後から届いたカードの追加で復活しない", async () => {
    renderScreen(["cr-1", "cr-2"]);

    await settle("cr-1", readable("cr-1", DEPLOY));
    await screen.findByTestId("diff-card-cr-1");

    fireEvent.click(screen.getByTestId("diff-card-cr-1-select").querySelector("input")!);
    await waitFor(() => {
      expect(screen.getByTestId("diff-apply-selected").textContent).toContain(
        "選択した 0 件を反映",
      );
    });

    await settle("cr-2", readable("cr-2", AUDIT));
    await waitFor(() => {
      // 追加されたのは cr-2 の 1 件だけ。外した cr-1 は選択に戻らない。
      expect(screen.getByTestId("diff-apply-selected").textContent).toContain(
        "選択した 1 件を反映",
      );
    });
  });
});

describe("反映結果の提示（FR-5.4 / GI-5）", () => {
  it("全件成功のサマリは 5 秒で自動的に消える", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderScreen(["cr-1"]);
      await settle("cr-1", readable("cr-1", DEPLOY));
      await screen.findByTestId("diff-card-cr-1");

      applyChangeRequests.mockResolvedValue({
        reports: [report("cr-1", DEPLOY, true)],
        total: 1,
        applied: 1,
      });
      fireEvent.click(screen.getByTestId("diff-apply-selected"));

      await screen.findByText("1 件中 1 件を反映しました。");

      await act(async () => {
        vi.advanceTimersByTime(5000);
        await Promise.resolve();
      });
      expect(screen.queryByText("1 件中 1 件を反映しました。")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("一部失敗のサマリは自動で消さず、ロール単位の結果を残す（FR-5.4）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      renderScreen(["cr-1", "cr-2"]);
      await settle("cr-1", readable("cr-1", DEPLOY));
      await settle("cr-2", readable("cr-2", AUDIT));
      await screen.findByTestId("diff-card-cr-2");

      applyChangeRequests.mockResolvedValue({
        reports: [report("cr-1", DEPLOY, true), report("cr-2", AUDIT, false)],
        total: 2,
        applied: 1,
      });
      fireEvent.click(screen.getByTestId("diff-apply-selected"));

      await screen.findByText("2 件中 1 件を反映しました。");

      await act(async () => {
        vi.advanceTimersByTime(30000);
        await Promise.resolve();
      });

      // どのロールが未反映かを読み取る前に消えてはならない。
      expect(screen.getByText("2 件中 1 件を反映しました。")).toBeTruthy();
      // 成否はロール単位で個別に識別できる。
      expect(screen.getByTestId("diff-card-cr-1-status").textContent).toContain("反映済み");
      expect(screen.getByTestId("diff-card-cr-2-status").textContent).toContain("失敗");
      expect(screen.getByTestId("diff-card-cr-2-retry")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("一括反映そのものが失敗したら、個々の成否は不明である旨を出す", async () => {
    renderScreen(["cr-1"]);
    await settle("cr-1", readable("cr-1", DEPLOY));
    await screen.findByTestId("diff-card-cr-1");

    applyChangeRequests.mockRejectedValue(new Error("ネットワークに接続できません"));
    fireEvent.click(screen.getByTestId("diff-apply-selected"));

    const error = await screen.findByTestId("diff-apply-error");
    expect(error.textContent).toContain("申請履歴で確認してください");
  });
});

describe("空の状態", () => {
  it("ids が空なら読み込みを行わず、空状態を出す", async () => {
    renderScreen([]);

    await screen.findByTestId("diff-empty");
    expect(getDiff).not.toHaveBeenCalled();
  });
});

describe("英語の表示（Issue #94）", () => {
  function renderEn(ids: string[], permission?: "view"): void {
    pending = new Map(ids.map((id) => [id, deferred<DiffView | null>()]));
    getDiff.mockImplementation((id: string) => {
      const entry = pending.get(id);
      if (!entry) throw new Error(`想定外の id が要求されました: ${id}`);
      return entry.promise;
    });
    const screenEl = <DiffScreen query={new URLSearchParams(`ids=${ids.join(",")}`)} />;
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        {permission ? <PermissionProvider value={permission}>{screenEl}</PermissionProvider> : screenEl}
      </LocaleProvider>,
    );
  }

  /** 1 件を反映して、その結果（`overrides` を重ねた報告）が出るまで待つ。 */
  async function applyOne(overrides: Partial<ApplyReport>): Promise<void> {
    renderEn(["cr-1"]);
    await settle("cr-1", readable("cr-1", DEPLOY));
    await screen.findByTestId("diff-card-cr-1");
    const ok = overrides.ok ?? true;
    applyChangeRequests.mockResolvedValue({
      reports: [{ ...report("cr-1", DEPLOY, ok), ...overrides }],
      total: 1,
      applied: ok ? 1 : 0,
    });
    fireEvent.click(screen.getByTestId("diff-apply-selected"));
    await screen.findByTestId("diff-card-cr-1-result");
  }

  it("見出し・戻るリンク・読み込み中の件数・反映ボタンが英語になる", () => {
    renderEn(["cr-1", "cr-2"]);

    expect(screen.getByRole("heading", { level: 1, name: "Review and apply" })).toBeTruthy();
    expect(screen.getByTestId("diff-back-to-matrix").textContent).toBe("← Back to Role assignments");
    expect(screen.getByTestId("page-heading-counts").textContent).toBe("Loading 0 / 2 requests");
    expect(screen.getByTestId("diff-apply-selected").textContent).toContain("Apply 0 selected requests");
    expect(screen.getByTestId("diff-loading-cr-1").textContent).toContain("Loading the current trust policy");
  });

  it("差分のカードで、追加・削除されるプリンシパルが英語で出る", async () => {
    renderEn(["cr-1"]);
    await settle("cr-1", readable("cr-1", DEPLOY));
    const card = await screen.findByTestId("diff-card-cr-1");

    expect(card.getAttribute("aria-label")).toBe("Diff for RolustManaged-DeployProd");
    expect(screen.getByTestId("diff-card-cr-1-added").textContent).toContain("Principals to add");
    expect(screen.getByTestId("diff-card-cr-1-added").textContent).toContain(AYAKA);
    expect(screen.getByTestId("diff-card-cr-1-removed").textContent).toContain("Principals to remove");
    expect(screen.getByTestId("diff-card-cr-1-removed").textContent).toContain("(none)");
    expect(screen.getByTestId("diff-card-cr-1-select").textContent).toContain("Include");
    expect(screen.getByTestId("page-heading-counts").textContent).toMatch(/^1 request \/ created /);
    expect(screen.getByTestId("diff-apply-selected").textContent).toContain("Apply 1 selected request");
  });

  it("管理外プリンシパルの警告が英語になる", async () => {
    renderEn(["cr-1"]);
    await settle("cr-1", {
      ...readable("cr-1", DEPLOY),
      unmanaged: [
        { kind: "AWS", value: "arn:aws:iam::999900001111:root", statementIndex: 0, sid: null, effect: "Allow" },
        { kind: "Service", value: "ec2.amazonaws.com", statementIndex: 1, sid: null, effect: "Deny" },
      ],
    });
    const warning = await screen.findByTestId("diff-card-cr-1-unmanaged");

    expect(warning.textContent).toContain(
      "There are 2 principals not managed by Rolust. Applying will not remove them.",
    );
    expect(warning.textContent).toContain("arn:aws:iam::999900001111:root");
    expect(warning.textContent).toContain("(Service / Deny)");
  });

  it("読み取りエラーのカードは、localized から英語の本文を出し、エラーコードはそのまま出す", async () => {
    renderEn(["cr-1"]);
    await settle("cr-1", {
      ...unreadable("cr-1", DEPLOY),
      readError: {
        errorCode: "AccessDenied",
        message: "GetRole を拒否されました",
        localized: localized("diff.readFailed", {}),
      },
    });
    const card = await screen.findByTestId("diff-card-cr-1-read-error");

    expect(card.textContent).toContain("Could not read the current trust policy");
    expect(card.textContent).toContain("Error code: AccessDenied");
    expect(card.textContent).not.toContain("GetRole を拒否されました");
  });

  it("読み取りエラーに localized が無い旧応答は、message をそのまま出す", async () => {
    renderEn(["cr-1"]);
    await settle("cr-1", unreadable("cr-1", DEPLOY));
    const card = await screen.findByTestId("diff-card-cr-1-read-error");

    expect(card.textContent).toContain("GetRole を拒否されました");
  });

  it("取得に失敗したカードは英語になり、複数ならまとめて再試行を出す", async () => {
    renderEn(["cr-1", "cr-2"]);
    await fail("cr-1", new Error("Rate exceeded"));
    await fail("cr-2", new Error("Rate exceeded"));

    const panel = await screen.findByTestId("diff-error-cr-1");
    expect(panel.textContent).toContain("Could not load request cr-1");
    expect(screen.getByTestId("diff-reload-all").textContent).toBe("Could not load 2 requests — retry all");
  });

  it("見つからない申請と空の状態が英語になる", async () => {
    renderEn(["cr-1", "cr-2"]);
    await settle("cr-1", null);
    await settle("cr-2", readable("cr-2", AUDIT));
    const missing = await screen.findByTestId("diff-missing");
    expect(missing.textContent).toContain("1 request was not found");

    cleanup();
    renderEn([]);
    const empty = await screen.findByTestId("diff-empty");
    expect(empty.textContent).toContain("No requests are waiting to be applied");
    expect(empty.textContent).toContain("All the requests this URL points to have been applied or discarded.");
    expect(screen.getByTestId("diff-empty-to-matrix").textContent).toBe("Go to Role assignments");
  });

  it("反映の成功: localized の本文・件数・サマリ・状態が英語になる", async () => {
    await applyOne({
      message: "信頼ポリシーを更新しました（追加 1 件 / 削除 0 件）",
      localized: localized("apply.updated", { added: 1, removed: 0 }),
      added: [AYAKA],
      removed: [],
    });

    const result = screen.getByTestId("diff-card-cr-1-result");
    expect(result.textContent).toContain("Updated the trust policy (added 1 / removed 0)");
    expect(screen.getByTestId("diff-card-cr-1-result-counts").textContent).toBe("1 added / 0 removed");
    expect(screen.getByTestId("diff-card-cr-1-status").textContent).toContain("Applied");
    await screen.findByText("Applied 1 of 1 request.");
  });

  it("反映の失敗: localized の本文は英語、AWS のエラーコードはそのまま、再反映の導線も英語", async () => {
    await applyOne({
      ok: false,
      status: "failed",
      errorCode: "AccessDenied",
      message: "信頼ポリシーの更新に失敗しました",
      localized: localized("apply.updateFailed", {}),
      added: [],
      removed: [],
    });

    const result = screen.getByTestId("diff-card-cr-1-result");
    expect(result.textContent).toContain("Apply failed");
    expect(result.textContent).toContain("AccessDenied: Failed to update the trust policy");
    expect(result.textContent).not.toContain("信頼ポリシーの更新に失敗しました");
    expect(screen.getByTestId("diff-card-cr-1-retry").textContent).toBe("Re-apply this request");
    expect(screen.getByTestId("diff-card-cr-1-status").textContent).toContain("Failed");
    await screen.findByText("Applied 0 of 1 request.");
  });

  it("実在しない IAM ユーザで反映が失敗したとき（Issue #208）: 英語で「IAM に存在しない」と直し方を出し、AWS のコードと原文は残る", async () => {
    const arn = "arn:aws:iam::111122223333:user/rolust-ghost-does-not-exist";
    const raw = `Invalid principal in policy: "AWS":"${arn}"`;
    await applyOne({
      ok: false,
      status: "failed",
      errorCode: "MalformedPolicyDocumentException",
      message: "（日本語の本文。画面は localized から描画する）",
      localized: localized("iam.invalidPrincipalUser", { userArn: arn, detail: raw }),
      added: [],
      removed: [],
    });

    const text = screen.getByTestId("diff-card-cr-1-result").textContent ?? "";
    expect(text).toContain("MalformedPolicyDocumentException: ");
    expect(text).toContain(`The IAM user ${arn} does not exist in IAM`);
    expect(text).toContain("Create the user in IAM, then re-apply this request.");
    expect(text).toContain("discard this request in the request history");
    expect(text).toContain(`(AWS message: ${raw})`);
    expect(text).not.toContain("日本語の本文");
  });

  it("warnings は localizedWarnings から英語で描画する", async () => {
    await applyOne({
      message: "信頼ポリシーを更新しました（追加 1 件 / 削除 0 件）",
      localized: localized("apply.updated", { added: 1, removed: 0 }),
      warnings: ["信頼ポリシーは更新しましたが、マトリクスの反映済み状態 3 件を更新できませんでした"],
      localizedWarnings: [localized("apply.baselineFailed", { count: 3 })],
    });

    expect(screen.getByTestId("diff-card-cr-1-result-warning-0").textContent).toBe(
      "The trust policy was updated, but 3 applied states in the matrix could not be updated",
    );
  });

  it("localizedWarnings が無い旧応答は、warnings をそのまま出す", async () => {
    await applyOne({ warnings: ["旧応答の警告 A", "旧応答の警告 B"] });

    expect(screen.getByTestId("diff-card-cr-1-result-warning-0").textContent).toBe("旧応答の警告 A");
    expect(screen.getByTestId("diff-card-cr-1-result-warning-1").textContent).toBe("旧応答の警告 B");
  });

  it("localizedWarnings の長さが warnings と違うときは、並びを信用せず warnings を出す", async () => {
    await applyOne({
      warnings: ["警告 A", "警告 B"],
      localizedWarnings: [localized("apply.baselineFailed", { count: 3 })],
    });

    expect(screen.getByTestId("diff-card-cr-1-result-warning-0").textContent).toBe("警告 A");
    expect(screen.getByTestId("diff-card-cr-1-result-warning-1").textContent).toBe("警告 B");
  });

  it("一括反映そのものの失敗は、英語の案内を添える", async () => {
    renderEn(["cr-1"]);
    await settle("cr-1", readable("cr-1", DEPLOY));
    await screen.findByTestId("diff-card-cr-1");

    applyChangeRequests.mockRejectedValue(new Error("Network down"));
    fireEvent.click(screen.getByTestId("diff-apply-selected"));

    const error = await screen.findByTestId("diff-apply-error");
    expect(error.textContent).toContain("Could not run the apply");
    expect(error.textContent).toContain(
      "Network down (Check the request history to see which IAM roles were applied.)",
    );
  });

  it("権限が足りないときの反映ボタンの無効の理由が英語になる", async () => {
    renderEn(["cr-1"], "view");
    await settle("cr-1", readable("cr-1", DEPLOY));
    await screen.findByTestId("diff-card-cr-1");

    const button = screen.getByTestId("diff-apply-selected");
    expect(button.getAttribute("aria-disabled") === "true" || button.hasAttribute("disabled")).toBe(true);
    fireEvent.mouseEnter(button);
    fireEvent.focus(button);
    expect(
      within(document.body).getAllByText('This action requires the "apply" permission').length,
    ).toBeGreaterThan(0);
  });
});
