// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChangeRequest } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiClientError } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { LocaleProvider } from "../i18n/index.js";
import { formatTimestamp } from "../labels.js";
import { HistoryScreen } from "./HistoryScreen.js";

/**
 * `HistoryScreen` の破棄導線のテスト（FR-4.8 / B-1 の画面側）。
 *
 * 確かめるのは 2 点。どちらも「記録と画面表示が食い違わない」ためのものである。
 *
 * 1. 破棄が失敗しても**必ず再取得する**。破棄が確定した後で落ちたケースを画面からは
 *    区別できないため、古い行を残すと実際は破棄済みの申請に再開・再反映の導線を
 *    提示してしまう。
 * 2. ロールロックが漏れたことは**警告として見える**。黙って成功と表示すると、
 *    新しい申請を作れない理由が利用者に分からない（FR-4.6）。
 *
 * `api-client` だけを差し替え、画面・フック・ルータは本物を通す。
 */

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return {
    ...actual,
    api: {
      listChangeRequests: vi.fn(),
      discardChangeRequest: vi.fn(),
    },
  };
});

const DEPLOY = "arn:aws:iam::555566667777:role/DeployProd";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const CR_ID = "cr-0142";

function requestOf(
  overrides: Partial<ChangeRequest> & Pick<ChangeRequest, "changeRequestId" | "status">,
): ChangeRequest {
  return {
    poolId: "platform-team",
    roleArn: DEPLOY,
    addUserArns: [AYAKA],
    removeUserArns: [],
    createdAt: "2026-07-31T10:04:00.000Z",
    createdBy: null,
    appliedAt: null,
    appliedBy: null,
    result: null,
    ...overrides,
  };
}

const draft: ChangeRequest = {
  changeRequestId: CR_ID,
  poolId: "platform-team",
  roleArn: DEPLOY,
  addUserArns: [AYAKA],
  removeUserArns: [],
  status: "draft",
  createdAt: "2026-07-31T10:04:00.000Z",
  createdBy: null,
  appliedAt: null,
  appliedBy: null,
  result: null,
};

const listChangeRequests = vi.mocked(api.listChangeRequests);
const discardChangeRequest = vi.mocked(api.discardChangeRequest);

/** 一覧の描画を待ち、破棄の確認モーダルを「破棄する」まで進める。 */
async function confirmDiscard(): Promise<void> {
  render(<HistoryScreen highlight={null} />);
  fireEvent.click(await screen.findByTestId(`history-discard-${CR_ID}`));
  fireEvent.click(await screen.findByTestId("discard-confirm"));
}

beforeEach(() => {
  // Date だけを固定する（waitFor・findBy が使うタイマーは本物のまま）。既定の範囲は 2026-07-06 以降になる。
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0));
  listChangeRequests.mockResolvedValue({ changeRequests: [draft] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("見出し行（Issue #155）", () => {
  it("見出しと件数は同じ行にある", async () => {
    render(<HistoryScreen highlight={null} />);
    const heading = screen.getByRole("heading", { level: 1, name: "申請履歴" });
    const counts = await screen.findByTestId("page-heading-counts");
    expect((counts.parentElement as HTMLElement).contains(heading)).toBe(true);
  });
});

describe("申請の破棄（FR-4.8 / 画面 5）", () => {
  it("破棄に失敗しても一覧を再取得する（古い行を残さない）", async () => {
    discardChangeRequest.mockRejectedValue(new Error("DynamoDB の DeleteItem に失敗しました"));

    await confirmDiscard();

    // 失敗の事実は伝える。
    await screen.findByText(/破棄できませんでした/);

    // そのうえで再取得している（初回 + 再読み込みの 2 回）。
    await waitFor(() => {
      expect(listChangeRequests).toHaveBeenCalledTimes(2);
    });
  });

  it("反映中の申請の破棄が 409 のとき、その文言を出して一覧を再取得する（Issue #121）", async () => {
    discardChangeRequest.mockRejectedValue(
      new Error("この申請は別の管理者が反映中です。しばらくしてから、もう一度操作してください。"),
    );

    await confirmDiscard();

    await screen.findByText(/別の管理者が反映中です/);
    await waitFor(() => {
      expect(listChangeRequests).toHaveBeenCalledTimes(2);
    });
  });

  it("破棄は成功したがロックが漏れた場合、警告として表示する", async () => {
    discardChangeRequest.mockResolvedValue({
      changeRequest: { ...draft, status: "discarded" },
      lockReleased: false,
      lockWarning:
        "ロールロックを解放できませんでした（Rate exceeded）。解放されるまでこの IAMロールの新しい申請は作成できません。",
    });

    await confirmDiscard();

    const notice = await screen.findByText(/申請を破棄しました/);
    // 「破棄できませんでした」ではない — 記録どおり破棄は成功している。
    expect(notice.textContent).toContain("新しい申請は作成できません");
    expect(screen.queryByText(/破棄できませんでした/)).toBeNull();
  });

  it("成功時はロックが解けた旨を伝え、一覧を再取得する", async () => {
    discardChangeRequest.mockResolvedValue({
      changeRequest: { ...draft, status: "discarded" },
      lockReleased: true,
      lockWarning: null,
    });

    await confirmDiscard();

    const notice = await screen.findByText(/申請を破棄しました/);
    expect(notice.textContent).toContain("DeployProd");

    await waitFor(() => {
      expect(listChangeRequests).toHaveBeenCalledTimes(2);
    });
  });
});

/**
 * 以下は Step 17-D で追加した分（Test Strategy: Standard の「コンポーネントあたり 5〜8 件」）。
 *
 * 破棄導線の 3 件だけでは、この画面の主張である「状態によって操作を出し分ける」
 * （FR-4.8）と「最初に探すのは今アクションが必要な申請である」が固定されていない。
 */

const failed = requestOf({
  changeRequestId: "cr-0143",
  status: "failed",
  appliedAt: "2026-07-31T11:00:00.000Z",
  result: {
    ok: false,
    errorCode: "AccessDenied",
    message: "UpdateAssumeRolePolicy を拒否されました",
  },
});

const applied = requestOf({
  changeRequestId: "cr-0144",
  status: "applied",
  appliedAt: "2026-07-31T12:00:00.000Z",
});

const discarded = requestOf({ changeRequestId: "cr-0145", status: "discarded" });

describe("申請履歴の一覧（FR-7.5）", () => {
  it("状態ごとの件数を見出しに出す", async () => {
    listChangeRequests.mockResolvedValue({
      changeRequests: [draft, failed, applied, discarded],
    });

    render(<HistoryScreen highlight={null} />);

    const summary = await screen.findByText(/下書き 1 · 失敗 1 · 反映済み 1 · 破棄 1/);
    expect(summary.textContent).toContain("4 件");
  });

  it("下書きは「再開」と「破棄」、失敗は「再反映」と「破棄」を出す", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft, failed] });

    render(<HistoryScreen highlight={null} />);

    await screen.findByTestId(`history-resume-${CR_ID}`);
    expect(screen.getByTestId(`history-discard-${CR_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`history-reapply-${failed.changeRequestId}`)).toBeTruthy();
    expect(screen.getByTestId(`history-discard-${failed.changeRequestId}`)).toBeTruthy();
  });

  it("反映済み・破棄には破棄ボタンを出さない（概念的に存在しない操作）", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [applied, discarded] });

    render(<HistoryScreen highlight={null} />);

    // 無効なボタンを disabled で並べるのではなく、そもそも出さない（FR-4.8）。
    await screen.findByTestId(`history-details-${applied.changeRequestId}`);
    expect(screen.queryByTestId(`history-discard-${applied.changeRequestId}`)).toBeNull();
    expect(screen.queryByTestId(`history-discard-${discarded.changeRequestId}`)).toBeNull();
    expect(screen.queryByTestId(`history-resume-${applied.changeRequestId}`)).toBeNull();
  });

  it("種別のある申請は状態の下に種別を出し、状態の語は変えない。通常の申請には出さない（Issue #172）", async () => {
    const adopt = requestOf({ changeRequestId: "cr-adopt", status: "applied", kind: "adopt" });
    const restore = requestOf({ changeRequestId: "cr-restore", status: "draft", kind: "restore" });
    const normal = requestOf({ changeRequestId: "cr-normal", status: "applied" });
    listChangeRequests.mockResolvedValue({ changeRequests: [adopt, restore, normal] });

    render(<HistoryScreen highlight={null} />);

    await screen.findByTestId("history-status-cr-adopt");
    expect(screen.getByTestId("history-kind-cr-adopt").textContent).toBe(
      "記録の取り込み（AWS は書き換えていません）",
    );
    expect(screen.getByTestId("history-kind-cr-restore").textContent).toBe(
      "乖離の修復（IAM を記録に合わせる）",
    );
    expect(screen.queryByTestId("history-kind-cr-normal")).toBeNull();
    // 状態の語は変えない。adopt でも「反映済み」のまま。
    expect(screen.getByTestId("history-status-cr-adopt").textContent).toContain("反映済み");
    expect(screen.getByTestId("history-status-cr-normal").textContent).toContain("反映済み");
  });

  it("変更の列は出さず、追加・削除の件数は詳細に残る（Issue #128）", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft] });

    render(<HistoryScreen highlight={CR_ID} />);

    await screen.findByTestId(`history-status-${CR_ID}`);
    expect(screen.queryByRole("columnheader", { name: "変更" })).toBeNull();
    expect(screen.queryByTestId(`history-changes-${CR_ID}`)).toBeNull();
    const detail = screen.getByTestId(`history-detail-${CR_ID}`);
    expect(detail.textContent).toContain("追加するプリンシパル（1）");
    expect(detail.textContent).toContain("削除するプリンシパル（0）");
  });

  it("対象の IAMロールのロール名は折り返さない（Issue #128）", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft] });

    render(<HistoryScreen highlight={null} />);

    const roleName = await screen.findByText("DeployProd");
    expect(roleName.style.whiteSpace).toBe("nowrap");
  });

  it("読み込みに失敗したら error 状態を出し、再試行の導線を持つ", async () => {
    listChangeRequests.mockRejectedValue(new Error("DynamoDB の Query に失敗しました"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    render(<HistoryScreen highlight={null} />);

    await screen.findByTestId("history-error");
    expect(screen.getByTestId("history-error-retry")).toBeTruthy();
  });

  it("申請が 1 件も無ければ、マトリクスへの導線つきの空状態を出す", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [] });

    render(<HistoryScreen highlight={null} />);

    await screen.findByTestId("history-empty");
    expect(screen.getByTestId("history-empty-to-matrix")).toBeTruthy();
  });
});

describe("表のヘッダ行の固定（Issue #133）", () => {
  it("一覧の列ヘッダ行は、スクロールしても固定される", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft, failed] });

    render(<HistoryScreen highlight={null} />);

    const table = await screen.findByTestId("history-table");
    expect(table.querySelector('[class*="header-secondary"]')).not.toBeNull();
  });
});

describe("検索条件（FR-7.5 / Issue #109）", () => {
  const billing = requestOf({
    changeRequestId: "cr-0150",
    status: "applied",
    roleArn: "arn:aws:iam::111122223333:role/BillingViewer",
  });

  function typeRole(value: string): void {
    fireEvent.change(screen.getByLabelText("対象の IAMロールで絞り込む"), { target: { value } });
  }

  it("対象の IAMロールの入力で、roleArn の部分一致（大文字小文字を区別しない）に絞る", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft, billing] });
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);

    typeRole("billing");

    expect(screen.queryByTestId(`history-status-${CR_ID}`)).toBeNull();
    expect(screen.getByTestId(`history-status-${billing.changeRequestId}`)).toBeTruthy();
  });

  it("条件があるあいだ「表示 n / 全 m 件」を出し、条件が無ければ出さない", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft, billing] });
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);
    expect(screen.queryByTestId("history-match-count")).toBeNull();

    typeRole("billing");

    expect(screen.getByTestId("history-match-count").textContent).toContain("表示 1 / 全 2 件");
  });

  it("見出しの総件数と状態別内訳は、絞り込んでも全体のまま", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft, billing] });
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);

    typeRole("billing");

    const summary = screen.getByText(/下書き 1 · 失敗 0 · 反映済み 1 · 破棄 0/);
    expect(summary.textContent).toContain("2 件");
  });

  it("条件に一致する申請が 0 件なら、条件をすべて解除する導線つきの空表示を出す", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft, billing] });
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);

    typeRole("no-such-role");

    expect(screen.getByTestId("history-empty").textContent).toContain(
      "条件に一致する申請はありません",
    );
    fireEvent.click(screen.getByTestId("history-clear-filter"));

    expect(screen.getByTestId(`history-status-${CR_ID}`)).toBeTruthy();
    expect(screen.getByTestId(`history-status-${billing.changeRequestId}`)).toBeTruthy();
    expect((screen.getByLabelText("対象の IAMロールで絞り込む") as HTMLInputElement).value).toBe("");
  });

  it("「すべて解除」で条件を戻す", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft, billing] });
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);

    typeRole("billing");
    fireEvent.click(screen.getByTestId("history-clear-all"));

    expect(screen.getByTestId(`history-status-${CR_ID}`)).toBeTruthy();
    expect(screen.queryByTestId("history-match-count")).toBeNull();
  });

  it("作成日に並べて、反映日の日付範囲の入力を出す（Issue #117）", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft] });
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);

    expect(screen.getByTestId("history-applied-range")).toBeTruthy();
    expect(screen.getByText("作成日（日付範囲。下書き・失敗は対象外）")).toBeTruthy();
    expect(screen.getByText("反映日（日付範囲）")).toBeTruthy();
    expect(screen.getByTestId("history-range")).toBeTruthy();
  });

  it("申請が 1 件も無いときは、条件の有無にかかわらずマトリクスへの導線を出す", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [] });
    render(<HistoryScreen highlight={null} />);

    await screen.findByTestId("history-empty-to-matrix");
    expect(screen.queryByTestId("history-clear-filter")).toBeNull();
  });
});

describe("UserPool の表示（Issue #108 で廃止）", () => {
  it("詳細に UserPool の行も、history-pool の要素も出さない（申請 ID だけ）", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft] });
    render(<HistoryScreen highlight={null} />);

    const detail = await screen.findByTestId(`history-detail-${draft.changeRequestId}`);
    expect(detail.textContent).not.toContain("UserPool");
    expect(screen.queryByTestId(`history-pool-${draft.changeRequestId}`)).toBeNull();
  });
});

describe("作成日・反映日の列（Issue #117 / FR-7.5）", () => {
  it("列見出しは「作成日」「反映日」で、作成日・反映日・作成者・反映者の順に並ぶ（変更の列は Issue #128 で廃止）", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft] });
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);

    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.trim());
    expect(headers).toEqual(["状態", "対象の IAMロール", "申請 ID", "作成日", "反映日", "作成者", "反映者", "操作"]);
    expect(screen.queryByText("作成時刻")).toBeNull();
  });

  it("反映日は日時を出し、反映を試みていない行（下書き）は「—」", async () => {
    listChangeRequests.mockResolvedValue({
      changeRequests: [
        requestOf({
          changeRequestId: "cr-applied",
          status: "applied",
          appliedAt: "2026-10-06T00:01:00.000Z",
        }),
        requestOf({ changeRequestId: "cr-draft", status: "draft" }),
      ],
    });
    render(<HistoryScreen highlight={null} />);

    expect((await screen.findByTestId("history-applied-at-cr-applied")).textContent).toBe(
      formatTimestamp("2026-10-06T00:01:00.000Z"),
    );
    expect(screen.getByTestId("history-applied-at-cr-draft").textContent).toBe("—");
  });
});

describe("作成者・反映者の列（Issue #120 / FR-7.5）", () => {
  it("作成者と反映者のユーザ名を出す。実行者なし（既存の申請・未反映）は「—」", async () => {
    listChangeRequests.mockResolvedValue({
      changeRequests: [
        requestOf({
          changeRequestId: "cr-new",
          status: "applied",
          createdBy: { name: "alice", sub: "user-1" },
          appliedAt: "2026-10-06T00:01:00.000Z",
          appliedBy: { name: "bob" },
        }),
        requestOf({ changeRequestId: "cr-old", status: "applied", createdBy: null, appliedBy: null }),
        requestOf({ changeRequestId: "cr-draft", status: "draft", createdBy: { name: "田中" }, appliedBy: null }),
      ],
    });

    render(<HistoryScreen highlight={null} />);

    expect((await screen.findByTestId("history-created-by-cr-new")).textContent).toBe("alice");
    expect(screen.getByTestId("history-applied-by-cr-new").textContent).toBe("bob");
    expect(screen.getByTestId("history-created-by-cr-old").textContent).toBe("—");
    expect(screen.getByTestId("history-applied-by-cr-old").textContent).toBe("—");
    expect(screen.getByTestId("history-created-by-cr-draft").textContent).toBe("田中");
    expect(screen.getByTestId("history-applied-by-cr-draft").textContent).toBe("—");
  });

  it("sub は画面に出さない", async () => {
    listChangeRequests.mockResolvedValue({
      changeRequests: [
        requestOf({ changeRequestId: "cr-1", status: "draft", createdBy: { name: "alice", sub: "sub-secret-id" } }),
      ],
    });

    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId("history-created-by-cr-1");

    expect(screen.queryByText(/sub-secret-id/)).toBeNull();
  });
});

describe("取得する範囲（Issue #116 / FR-7.5）", () => {
  const FROM_ISO = new Date(2026, 6, 6, 0, 0, 0, 0).toISOString();
  const oldDraft = requestOf({
    changeRequestId: "cr-old-draft",
    status: "draft",
    createdAt: new Date(2026, 0, 1).toISOString(),
  });
  const oldApplied = requestOf({
    changeRequestId: "cr-old-applied",
    status: "applied",
    createdAt: new Date(2026, 0, 2).toISOString(),
  });

  it("初期は今日から 3 か月前以降を、createdFrom を付けて取得する", async () => {
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);

    expect(listChangeRequests).toHaveBeenCalledWith({ createdFrom: FROM_ISO });
  });

  it("取得した範囲を見出しの下に注記する", async () => {
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);

    expect(screen.getByTestId("history-range-note").textContent).toBe(
      "作成日 2026-07-06 以降の申請（下書き・失敗は期間によらず）を表示しています",
    );
  });

  it("既定の範囲より古い下書きは出し、古い反映済みは出さない", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [oldDraft, oldApplied] });
    render(<HistoryScreen highlight={null} />);

    await screen.findByTestId("history-status-cr-old-draft");
    expect(screen.queryByTestId("history-status-cr-old-applied")).toBeNull();
  });

  it("既定の範囲のままなら「表示 n / 全 m 件」を出さない", async () => {
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);

    expect(screen.queryByTestId("history-match-count")).toBeNull();
  });

  it("「すべて解除」は他の条件を外し、作成日の範囲は既定に戻す（再取得はしない）", async () => {
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-status-${CR_ID}`);

    fireEvent.change(screen.getByLabelText("対象の IAMロールで絞り込む"), { target: { value: "no-such-role" } });
    fireEvent.click(screen.getByTestId("history-clear-all"));

    expect((screen.getByLabelText("対象の IAMロールで絞り込む") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("history-range-note").textContent).toContain("2026-07-06");
    expect(listChangeRequests).toHaveBeenCalledTimes(1);
  });
});

describe("申請 ID の列と検索条件（Issue #145 / FR-7.5）", () => {
  const FIRST = "cr-ccb630aa-1111-4222-8333-444455556666";
  const SECOND = "cr-0a1b2c3d-1111-4222-8333-444455556666";

  it("全行に先頭 9 文字の短縮 ID を出し、詳細の全文と先頭が一致する", async () => {
    listChangeRequests.mockResolvedValue({
      changeRequests: [
        requestOf({ changeRequestId: FIRST, status: "applied" }),
        requestOf({ changeRequestId: SECOND, status: "draft" }),
      ],
    });
    render(<HistoryScreen highlight={FIRST} />);

    const short = await screen.findByTestId(`history-request-id-${FIRST}`);
    expect(short.textContent).toBe("cr-ccb630…");
    expect(screen.getByTestId(`history-request-id-${SECOND}`).textContent).toBe("cr-0a1b2c…");
    expect(screen.getByTestId(`history-detail-${FIRST}`).textContent).toContain(FIRST);
  });

  it("申請 ID で絞り込める（`cr-` の有無を問わない）。解除で戻る", async () => {
    listChangeRequests.mockResolvedValue({
      changeRequests: [
        requestOf({ changeRequestId: FIRST, status: "applied" }),
        requestOf({ changeRequestId: SECOND, status: "draft" }),
      ],
    });
    render(<HistoryScreen highlight={null} />);
    await screen.findByTestId(`history-request-id-${FIRST}`);

    const input = screen.getByTestId("history-request-id").querySelector("input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "ccb630" } });
    expect(screen.getByTestId(`history-request-id-${FIRST}`)).toBeTruthy();
    expect(screen.queryByTestId(`history-request-id-${SECOND}`)).toBeNull();
    expect(screen.getByTestId("history-match-count").textContent).toContain("表示 1 / 全 2 件");

    fireEvent.click(screen.getByTestId("history-clear-all"));
    expect(screen.getByTestId(`history-request-id-${SECOND}`)).toBeTruthy();
  });
});

describe("英語の表示（Issue #94）", () => {
  const ENGLISH_APPLIED = requestOf({
    changeRequestId: "cr-0146",
    status: "applied",
    appliedAt: "2026-07-31T12:00:00.000Z",
    result: {
      ok: true,
      errorCode: null,
      message: "信頼ポリシーを更新しました（追加 1 / 削除 0）",
      localized: { id: "apply.updated", params: { added: 1, removed: 0 } },
    },
  });
  // `localized` を持たない旧レコード。保存した日本語の message をそのまま出す。
  const OLD_FAILED = requestOf({
    changeRequestId: "cr-0147",
    status: "failed",
    appliedAt: "2026-07-31T11:00:00.000Z",
    result: { ok: false, errorCode: "AccessDenied", message: "UpdateAssumeRolePolicy を拒否されました" },
  });

  function renderEnglish(highlight: string | null = null): void {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        <HistoryScreen highlight={highlight} />
      </LocaleProvider>,
    );
  }

  it("見出し・列の見出し・件数が英語になる（単数形）", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft] });
    renderEnglish();

    expect(screen.getByRole("heading", { level: 1, name: "Request history" })).toBeTruthy();
    const counts = await screen.findByTestId("page-heading-counts");
    expect(counts.textContent).toBe("1 request / Draft 1 · Failed 0 · Applied 0 · Discarded 0");
    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent?.trim());
    expect(headers).toEqual([
      "Status",
      "IAM role",
      "Request ID",
      "Created",
      "Applied",
      "Created by",
      "Applied by",
      "Actions",
    ]);
  });

  it("件数が複数のときは複数形になる", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft, failed] });
    renderEnglish();

    const counts = await screen.findByTestId("page-heading-counts");
    expect(counts.textContent).toBe("2 requests / Draft 1 · Failed 1 · Applied 0 · Discarded 0");
  });

  it("読み込み中の件数と表の文言が英語になる", () => {
    listChangeRequests.mockReturnValue(new Promise(() => {}));
    renderEnglish();

    expect(screen.getByTestId("page-heading-counts").textContent).toBe("— requests");
    expect(screen.getByText("Loading request history")).toBeTruthy();
  });

  it("localized を持つ反映結果は英語で、持たない旧レコードの反映結果は保存した日本語のまま出す", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [ENGLISH_APPLIED, OLD_FAILED] });
    renderEnglish("cr-0146");
    await screen.findByTestId("history-status-cr-0146");

    const appliedDetail = screen.getByTestId("history-detail-cr-0146").textContent ?? "";
    expect(appliedDetail).toContain("Result: OK Updated the trust policy (added 1 / removed 0)");
    expect(appliedDetail).not.toContain("信頼ポリシー");
    expect(appliedDetail).toContain("Request ID: cr-0146");
    expect(appliedDetail).toContain("IAM role ARN: arn:aws:iam::555566667777:role/DeployProd");
    expect(appliedDetail).toContain("Principals to add (1)");
    expect(appliedDetail).toContain("Principals to remove (0)");

    cleanup();
    renderEnglish("cr-0147");
    await screen.findByTestId("history-status-cr-0147");
    const failedDetail = screen.getByTestId("history-detail-cr-0147").textContent ?? "";
    expect(failedDetail).toContain("Result: AccessDenied UpdateAssumeRolePolicy を拒否されました");
  });

  it("日本語では localized があっても現行の日本語の文言が出る", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [ENGLISH_APPLIED] });
    render(<HistoryScreen highlight="cr-0146" />);
    await screen.findByTestId("history-status-cr-0146");

    expect(screen.getByTestId("history-detail-cr-0146").textContent).toContain(
      "反映結果: OK 信頼ポリシーを更新しました（追加 1 / 削除 0）",
    );
  });

  it("状態の絞り込みの選択肢が英語になる", async () => {
    renderEnglish();
    await screen.findByTestId(`history-status-${CR_ID}`);

    const trigger = screen.getByTestId("history-filter").querySelector("button") as HTMLElement;
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);

    // 選択中の項目には Cloudscape の読み上げ用の語（"Selected"）が付くので、先頭の語で比べる。
    const options = screen.getAllByRole("option").map((option) => option.textContent?.trim() ?? "");
    expect(options).toHaveLength(5);
    expect(options[0]).toMatch(/^All/);
    expect(options.slice(1)).toEqual(["Draft", "Failed", "Applied", "Discarded"]);
  });

  it("絞り込みの見出し・説明が英語になり、条件があると件数と解除が英語で出る", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft, failed] });
    renderEnglish();
    await screen.findByTestId(`history-status-${CR_ID}`);

    expect(screen.getByText("Created (date range; does not apply to drafts and failed requests)")).toBeTruthy();
    expect(screen.getByText("Applied (date range)")).toBeTruthy();
    expect(screen.getByText("Request ID (prefix match)")).toBeTruthy();
    expect(screen.getByTestId("history-range-note").textContent).toBe(
      "Showing requests created on or after 2026-07-06 (drafts and failed requests are shown regardless of date)",
    );

    fireEvent.change(screen.getByLabelText("Filter by IAM role"), { target: { value: "Deploy" } });
    expect(screen.getByTestId("history-match-count").textContent).toBe("Showing 2 of 2 requests");
    expect(screen.getByTestId("history-clear-all").textContent).toBe("Clear all");
  });

  it("日付範囲の検証エラーが英語で出る", async () => {
    renderEnglish();
    await screen.findByTestId(`history-status-${CR_ID}`);

    fireEvent.click(screen.getByTestId("history-applied-range").querySelector("button") as HTMLElement);
    const inputs = Array.from(document.querySelectorAll("input")).filter((input) =>
      /YYYY/.test(input.placeholder),
    );
    fireEvent.change(inputs[0] as HTMLInputElement, { target: { value: "2026/09/10" } });
    fireEvent.change(inputs[1] as HTMLInputElement, { target: { value: "2026/09/01" } });
    const apply = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "Apply",
    );
    expect(apply).toBeTruthy();
    fireEvent.click(apply as HTMLElement);

    expect(await screen.findAllByText("The start date must be on or before the end date.")).not.toHaveLength(0);
    expect(document.body.textContent).not.toContain("開始日は終了日より前にしてください");
  });

  it("空状態が英語になる（0 件・条件に一致なし）", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [] });
    renderEnglish();
    const empty = await screen.findByTestId("history-empty");
    expect(empty.textContent).toContain("No requests yet");
    expect(screen.getByTestId("history-empty-to-matrix").textContent).toBe("Go to Role assignments");

    cleanup();
    listChangeRequests.mockResolvedValue({ changeRequests: [draft] });
    renderEnglish();
    await screen.findByTestId(`history-status-${CR_ID}`);
    fireEvent.change(screen.getByLabelText("Filter by IAM role"), { target: { value: "no-such-role" } });
    expect(screen.getByTestId("history-empty").textContent).toContain("No requests match the filters");
    expect(screen.getByTestId("history-clear-filter").textContent).toBe("Clear all filters");
  });

  it("操作の文言（再開・再反映・破棄・詳細）が英語になる", async () => {
    listChangeRequests.mockResolvedValue({ changeRequests: [draft, failed, applied] });
    renderEnglish();

    expect((await screen.findByTestId(`history-resume-${CR_ID}`)).textContent).toBe("Resume");
    expect(screen.getByTestId(`history-reapply-${failed.changeRequestId}`).textContent).toBe("Re-apply");
    expect(screen.getByTestId(`history-discard-${CR_ID}`).textContent).toBe("Discard");
    expect(screen.getByTestId(`history-details-${applied.changeRequestId}`).textContent).toBe("Details");
  });

  it("破棄の確認が英語になり、成功の通知も英語になる", async () => {
    discardChangeRequest.mockResolvedValue({
      changeRequest: { ...draft, status: "discarded" },
      lockReleased: true,
      lockWarning: null,
    });
    renderEnglish();
    fireEvent.click(await screen.findByTestId(`history-discard-${CR_ID}`));

    const modal = await screen.findByTestId("discard-modal");
    expect(modal.textContent).toContain("Discard this request?");
    expect(modal.textContent).toContain(
      'The request stays in the history with the status "Discarded". It is not deleted.',
    );
    expect(modal.textContent).toContain("After you discard it, you can create a new request for DeployProd.");
    expect(screen.getByTestId("discard-cancel").textContent).toBe("Cancel");
    expect(screen.getByTestId("discard-confirm").textContent).toBe("Discard");

    fireEvent.click(screen.getByTestId("discard-confirm"));
    const notice = await screen.findByText(/Request discarded/);
    expect(notice.textContent).toBe("Request discarded. You can now create a new request for DeployProd.");
  });

  it("ロールロックの警告は localizedLockWarning を英語で描画する", async () => {
    discardChangeRequest.mockResolvedValue({
      changeRequest: { ...draft, status: "discarded" },
      lockReleased: false,
      lockWarning: "ロールロックを解放できませんでした（Rate exceeded）。",
      localizedLockWarning: {
        id: "changeRequest.lockReleaseFailed",
        params: { cause: { id: "operator.plain", params: { text: "Rate exceeded" } } },
      },
    });
    renderEnglish();
    fireEvent.click(await screen.findByTestId(`history-discard-${CR_ID}`));
    fireEvent.click(await screen.findByTestId("discard-confirm"));

    const notice = await screen.findByText(/Request discarded/);
    expect(notice.textContent).toBe(
      "Request discarded. Note for DeployProd: The role lock could not be released (Rate exceeded). " +
        "Until it is released, no new request can be created for this role.",
    );
  });

  it("破棄の失敗は describeError を通し、英語の定型文で出る（5xx）", async () => {
    discardChangeRequest.mockRejectedValue(
      new ApiClientError(500, { code: "InternalError", message: "内部エラー", retryable: false }),
    );
    renderEnglish();
    fireEvent.click(await screen.findByTestId(`history-discard-${CR_ID}`));
    fireEvent.click(await screen.findByTestId("discard-confirm"));

    const notice = await screen.findByText(/Could not discard the request/);
    expect(notice.textContent).toBe("Could not discard the request: An internal server error occurred");
  });

  it("読み込みの失敗が英語になる", async () => {
    listChangeRequests.mockRejectedValue(
      new ApiClientError(500, { code: "InternalError", message: "内部エラー", retryable: true }),
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    renderEnglish();

    const panel = await screen.findByTestId("history-error");
    expect(panel.textContent).toContain("Could not load the request history");
    expect(panel.textContent).toContain("An internal server error occurred");
    expect(screen.getByTestId("history-error-retry").textContent).toBe("Retry");
  });

  it("URL のコピーの操作が英語になる", async () => {
    renderEnglish();
    await screen.findByTestId(`history-status-${CR_ID}`);

    const copy = within(screen.getByTestId(`request-link-${CR_ID}`)).getByRole("button");
    expect(copy.getAttribute("aria-label")).toBe("Copy URL");
  });
});
