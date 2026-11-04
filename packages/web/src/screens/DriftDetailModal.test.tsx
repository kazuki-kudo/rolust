// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ChangeRequest, Permission, RepairResponse, TrustDriftView } from "@rolust/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, ApiClientError } from "../api-client.js";
import type * as ApiClientModule from "../api-client.js";
import { PermissionProvider } from "../permission.js";
import { isBlocked } from "../testing/blocked.js";
import { DriftDetailModal } from "./DriftDetailModal.js";

vi.mock("../api-client.js", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiClientModule>();
  return { ...actual, api: { restoreDrift: vi.fn(), adoptDrift: vi.fn() } };
});

const restoreDrift = vi.mocked(api.restoreDrift);
const adoptDrift = vi.mocked(api.adoptDrift);

const ROLE = "arn:aws:iam::555566667777:role/ReadOnlyAudit";
const AYAKA = "arn:aws:iam::111122223333:user/ayaka.mori";
const BOB = "arn:aws:iam::111122223333:user/bob";

function view(overrides: Partial<TrustDriftView>): TrustDriftView {
  return { roleArn: ROLE, status: "drift", missing: [], extra: [], unmanaged: [], readError: null, ...overrides };
}

beforeEach(() => {
  restoreDrift.mockReset();
  adoptDrift.mockReset();
});

afterEach(cleanup);

describe("乖離の詳細モーダル（FR-4.9）", () => {
  it("view が null なら何も出さない", () => {
    render(<DriftDetailModal roleName="ReadOnlyAudit" view={null} onDismiss={() => {}} onRepaired={() => {}} />);

    expect(screen.queryByTestId("drift-detail-modal")).toBeNull();
  });

  it("足りない・余分を ARN で列挙し、管理外は別枠に出す", () => {
    render(
      <DriftDetailModal
        roleName="ReadOnlyAudit"
        view={view({
          missing: [AYAKA],
          extra: [BOB],
          unmanaged: [
            { kind: "Service", value: "lambda.amazonaws.com", statementIndex: 0, sid: null, effect: "Allow" },
            { kind: "AWS", value: "arn:aws:iam::999900001111:user/x", statementIndex: 1, sid: null, effect: "Deny" },
          ],
        })}
        onDismiss={() => {}}
        onRepaired={() => {}}
      />,
    );

    expect(screen.getByText("ReadOnlyAudit の信頼ポリシーの乖離")).toBeTruthy();
    expect(screen.getByTestId("drift-missing").textContent).toContain(AYAKA);
    expect(screen.getByTestId("drift-extra").textContent).toContain(BOB);
    const unmanaged = screen.getByTestId("drift-unmanaged").textContent ?? "";
    expect(unmanaged).toContain("lambda.amazonaws.com");
    expect(unmanaged).toContain("（Deny）");
  });

  it("足りない・余分が無い側は「なし」を出す", () => {
    render(<DriftDetailModal roleName="R" view={view({ missing: [AYAKA] })} onDismiss={() => {}} onRepaired={() => {}} />);

    expect(screen.getByTestId("drift-extra").textContent).toContain("なし");
  });

  it("読み取り失敗はエラーコードと文言を出す（GI-6）", () => {
    render(
      <DriftDetailModal
        roleName="R"
        view={view({ status: "readError", readError: { errorCode: "AccessDenied", message: "アクセスが拒否されました" } })}
        onDismiss={() => {}}
        onRepaired={() => {}}
      />,
    );

    expect(screen.getByTestId("drift-read-error").textContent).toContain("AccessDenied");
    expect(screen.getByTestId("drift-read-error").textContent).toContain("アクセスが拒否されました");
    expect(screen.queryByTestId("drift-missing")).toBeNull();
  });

  it("「閉じる」で onDismiss を呼ぶ", () => {
    const onDismiss = vi.fn();
    render(<DriftDetailModal roleName="R" view={view({ missing: [AYAKA] })} onDismiss={onDismiss} onRepaired={() => {}} />);

    fireEvent.click(screen.getByTestId("drift-detail-close"));

    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

/** 乖離を直す 2 操作（Issue #172。FR-4.10・FR-4.11）。 */
describe("乖離を直す操作（Issue #172）", () => {
  const driftView = view({ missing: [AYAKA], extra: [BOB] });

  function repair(overrides: Partial<RepairResponse>): RepairResponse {
    return { outcome: "no-drift", changeRequest: null, exclusion: null, failures: [], ...overrides };
  }
  function renderModal(options: { permission?: Permission; view?: TrustDriftView } = {}) {
    const onDismiss = vi.fn();
    const onRepaired = vi.fn();
    const modal = (
      <DriftDetailModal
        roleName="ReadOnlyAudit"
        view={options.view ?? driftView}
        onDismiss={onDismiss}
        onRepaired={onRepaired}
      />
    );
    render(
      options.permission === undefined ? modal : <PermissionProvider value={options.permission}>{modal}</PermissionProvider>,
    );
    return { onDismiss, onRepaired };
  }
  /** Cloudscape の Button は testid を外側の要素に付けることがあるので、実際の button を引く。 */
  function buttonOf(testId: string): HTMLElement {
    const element = screen.getByTestId(testId);
    return element.tagName === "BUTTON" ? element : (element.querySelector("button") ?? element);
  }
  function press(testId: string): void {
    fireEvent.click(buttonOf(testId));
  }

  it("乖離のあるロールに 2 つのボタンが出る。読み取り失敗・一致のロールには出ない", () => {
    renderModal();
    expect(screen.getByTestId("drift-restore").textContent).toContain("IAM を記録に合わせる（申請を作成）");
    expect(screen.getByTestId("drift-adopt").textContent).toContain("記録を IAM に合わせる");
    cleanup();

    renderModal({
      view: view({ status: "readError", readError: { errorCode: "AccessDenied", message: "拒否されました" } }),
    });
    expect(screen.queryByTestId("drift-restore")).toBeNull();
    expect(screen.queryByTestId("drift-adopt")).toBeNull();
    cleanup();

    renderModal({ view: view({ status: "match" }) });
    expect(screen.queryByTestId("drift-restore")).toBeNull();
    expect(screen.queryByTestId("drift-adopt")).toBeNull();
  });

  it("2 つのボタンの意味を、どちらを正とするかとともに添える", () => {
    renderModal();
    const text = screen.getByTestId("drift-detail-modal").textContent ?? "";
    expect(text).toContain("Rolust の記録を正として、IAM の信頼ポリシーを戻します");
    expect(text).toContain("IAM の信頼ポリシーを正として、Rolust の記録を更新します");
  });

  it.each(["none", "view"] as const)(
    "権限 %s では 2 つとも無効で、押しても API を呼ばず、理由が出る",
    async (permission) => {
      renderModal({ permission });

      for (const id of ["drift-restore", "drift-adopt"]) {
        expect(isBlocked(buttonOf(id)), id).toBe(true);
        press(id);
      }
      expect(restoreDrift).not.toHaveBeenCalled();
      expect(screen.queryByTestId("drift-adopt-confirm")).toBeNull();

      fireEvent.focus(buttonOf("drift-restore"));
      fireEvent.mouseEnter(buttonOf("drift-restore"));
      await waitFor(() => expect(document.body.textContent).toContain("この操作には「作成」の権限が必要です"));
    },
  );

  it("edit があれば有効（apply でなくてよい）", () => {
    renderModal({ permission: "edit" });
    for (const id of ["drift-restore", "drift-adopt"]) {
      expect(isBlocked(buttonOf(id)), id).toBe(false);
    }
  });

  it("「IAM を記録に合わせる」: API を 1 回呼び、created で画面 4 へ遷移する", async () => {
    restoreDrift.mockResolvedValue(
      repair({ outcome: "created", changeRequest: { changeRequestId: "cr-0200" } as ChangeRequest }),
    );
    window.history.pushState({}, "", "/roles");
    const { onRepaired } = renderModal();

    press("drift-restore");

    await waitFor(() => expect(window.location.pathname).toBe("/requests"));
    expect(window.location.search).toContain("cr-0200");
    expect(restoreDrift).toHaveBeenCalledTimes(1);
    expect(restoreDrift).toHaveBeenCalledWith(ROLE);
    expect(adoptDrift).not.toHaveBeenCalled();
    expect(onRepaired).not.toHaveBeenCalled();
  });

  it("restore が no-drift なら再確認を促し、遷移しない", async () => {
    restoreDrift.mockResolvedValue(repair({ outcome: "no-drift" }));
    window.history.pushState({}, "", "/roles");
    renderModal();

    press("drift-restore");

    const notice = await screen.findByTestId("drift-repair-notice");
    expect(notice.textContent).toContain("乖離はなくなっていました");
    expect(notice.textContent).toContain("信頼ポリシーを確認");
    expect(window.location.pathname).toBe("/roles");
  });

  it("restore が excluded なら未反映の申請の ID を出し、遷移しない", async () => {
    restoreDrift.mockResolvedValue(
      repair({ outcome: "excluded", exclusion: { reason: "draft", changeRequestId: "cr-0142" } }),
    );
    window.history.pushState({}, "", "/roles");
    renderModal();

    press("drift-restore");

    const notice = await screen.findByTestId("drift-repair-notice");
    expect(notice.textContent).toContain("未反映の申請（下書き: cr-0142）があるため実行できません");
    expect(window.location.pathname).toBe("/roles");
  });

  it("「記録を IAM に合わせる」: 押しても API を呼ばず、確認モーダルに取り込む・外す ARN と上書きの警告を出す", async () => {
    renderModal();
    expect(screen.queryByTestId("drift-adopt-confirm")).toBeNull();

    press("drift-adopt");

    const confirm = await screen.findByTestId("drift-adopt-confirm");
    expect(adoptDrift).not.toHaveBeenCalled();
    // 取り込む = 余分（IAM にいて記録にいない）、外す = 足りない（記録にいて IAM にいない）
    expect(within(screen.getByTestId("drift-adopt-list-adopt")).getByText(BOB)).toBeTruthy();
    expect(within(screen.getByTestId("drift-adopt-list-drop")).getByText(AYAKA)).toBeTruthy();
    expect(screen.getByTestId("drift-adopt-list-adopt").textContent).not.toContain(AYAKA);
    expect(screen.getByTestId("drift-adopt-list-drop").textContent).not.toContain(BOB);
    expect(confirm.textContent).toContain("未反映の編集（チェックの変更）は上書きされます");
    expect(confirm.textContent).toContain("AWS の信頼ポリシーは書き換えません");
  });

  it("確認モーダルのキャンセルは API を呼ばずに閉じ、詳細モーダルは残る", async () => {
    renderModal();
    press("drift-adopt");
    await screen.findByTestId("drift-adopt-confirm");

    press("drift-adopt-cancel");

    await waitFor(() => expect(screen.queryByTestId("drift-adopt-confirm")).toBeNull());
    expect(adoptDrift).not.toHaveBeenCalled();
    expect(screen.getByTestId("drift-detail-modal")).toBeTruthy();
  });

  it("確認中もダイアログは 1 枚だけ（GI-10: モーダルは入れ子にしない）。確認は同じモーダルの本文に出る", async () => {
    renderModal();
    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);

    press("drift-adopt");
    const confirm = await screen.findByTestId("drift-adopt-confirm");

    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
    // 確認は詳細モーダルの中にあり、乖離の一覧（フォーカスの置き場）はアンマウントされない
    expect(within(screen.getByTestId("drift-detail-modal")).getByTestId("drift-adopt-confirm")).toBe(confirm);
    expect(screen.getByTestId("drift-missing")).toBeTruthy();
    expect(screen.getByTestId("drift-extra")).toBeTruthy();
    // フッターは確認用に替わる（「閉じる」は出ない）
    expect(screen.queryByTestId("drift-detail-close")).toBeNull();
    expect(screen.getByTestId("drift-adopt-cancel")).toBeTruthy();
    // 確認中は 2 つの操作を押せない（確認を飛ばして restore を走らせない）
    expect(isBlocked(buttonOf("drift-restore"))).toBe(true);
    expect(isBlocked(buttonOf("drift-adopt"))).toBe(true);
  });

  it("確認の Escape・×・背景クリックは確認だけを閉じ、API を呼ばず、詳細モーダルは閉じない", async () => {
    const { onDismiss } = renderModal();
    const openConfirm = async (): Promise<void> => {
      press("drift-adopt");
      await screen.findByTestId("drift-adopt-confirm");
    };
    const expectBackToDetail = async (): Promise<void> => {
      await waitFor(() => expect(screen.queryByTestId("drift-adopt-confirm")).toBeNull());
      expect(onDismiss).not.toHaveBeenCalled();
      expect(adoptDrift).not.toHaveBeenCalled();
      expect(screen.getByTestId("drift-detail-modal")).toBeTruthy();
      expect(screen.getByTestId("drift-detail-close")).toBeTruthy();
      expect(isBlocked(buttonOf("drift-adopt"))).toBe(false);
    };

    // Escape（Cloudscape はダイアログ内の keydown で拾う）
    await openConfirm();
    fireEvent.keyDown(screen.getByTestId("drift-adopt-cancel"), { key: "Escape", code: "Escape", keyCode: 27 });
    await expectBackToDetail();

    // ×（dismiss ボタン）
    await openConfirm();
    fireEvent.click(document.querySelector<HTMLElement>("button[class*=dismiss-control]") as HTMLElement);
    await expectBackToDetail();

    // 背景クリック（overlay = ダイアログの root）
    await openConfirm();
    const overlay = screen.getByTestId("drift-detail-modal");
    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    await expectBackToDetail();
  });

  it("確認中でなければ、Escape・「閉じる」は詳細モーダルを閉じる", () => {
    const { onDismiss } = renderModal();

    fireEvent.keyDown(screen.getByTestId("drift-adopt"), { key: "Escape", code: "Escape", keyCode: 27 });
    expect(onDismiss).toHaveBeenCalledTimes(1);

    press("drift-detail-close");
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("確認へ入るとフォーカスはキャンセルへ、戻るとフォーカスは起点の「記録を IAM に合わせる」へ移る", async () => {
    renderModal();
    press("drift-adopt");
    await screen.findByTestId("drift-adopt-confirm");

    await waitFor(() => expect(document.activeElement).toBe(buttonOf("drift-adopt-cancel")));

    press("drift-adopt-cancel");
    await waitFor(() => expect(document.activeElement).toBe(buttonOf("drift-adopt")));
  });

  it("確認の実行ボタンは primary ではない（破壊的操作）", async () => {
    renderModal();
    press("drift-adopt");
    await screen.findByTestId("drift-adopt-confirm");

    const button = buttonOf("drift-adopt-confirm-run");
    expect(button.className).not.toMatch(/variant-primary/);
    expect(button.className).toMatch(/variant-normal/);
  });

  it("確認で実行すると API を 1 回呼び、adopted なら onRepaired で知らせる", async () => {
    // 件数は、画面の確認結果ではなくサーバの応答（実際に書いた集合）の追加・削除の合計（2 + 1）。
    adoptDrift.mockResolvedValue(
      repair({
        outcome: "adopted",
        changeRequest: { changeRequestId: "cr-0201", addUserArns: [AYAKA, BOB], removeUserArns: ["arn:x"] } as ChangeRequest,
      }),
    );
    const { onRepaired } = renderModal();
    press("drift-adopt");
    await screen.findByTestId("drift-adopt-confirm");

    press("drift-adopt-confirm-run");

    await waitFor(() => expect(onRepaired).toHaveBeenCalledTimes(1));
    expect(onRepaired).toHaveBeenCalledWith(ROLE, 3);
    expect(adoptDrift).toHaveBeenCalledTimes(1);
    expect(adoptDrift).toHaveBeenCalledWith(ROLE);
    expect(restoreDrift).not.toHaveBeenCalled();
  });

  it("adopt が excluded なら理由と申請 ID を出し、onRepaired を呼ばない", async () => {
    adoptDrift.mockResolvedValue(
      repair({ outcome: "excluded", exclusion: { reason: "failed", changeRequestId: "cr-0150" } }),
    );
    const { onRepaired } = renderModal();
    press("drift-adopt");
    await screen.findByTestId("drift-adopt-confirm");

    press("drift-adopt-confirm-run");

    const notice = await screen.findByTestId("drift-repair-notice");
    expect(notice.textContent).toContain("未反映の申請（失敗: cr-0150）があるため実行できません");
    expect(onRepaired).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByTestId("drift-adopt-confirm")).toBeNull());
  });

  it("adopt の failures は ARN を列挙して再実行を促し、モーダルを閉じない", async () => {
    adoptDrift.mockResolvedValue(
      repair({ outcome: "adopted", failures: [{ userArn: BOB, message: "書き込みに失敗しました" }] }),
    );
    const { onRepaired, onDismiss } = renderModal();
    press("drift-adopt");
    await screen.findByTestId("drift-adopt-confirm");

    press("drift-adopt-confirm-run");

    const partial = await screen.findByTestId("drift-repair-partial");
    expect(partial.textContent).toContain(BOB);
    expect(partial.textContent).toContain("書き込みに失敗しました");
    expect(partial.textContent).toContain("もう一度実行すると");
    expect(onRepaired).not.toHaveBeenCalled();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByTestId("drift-detail-modal")).toBeTruthy();
  });

  it("API の失敗はモーダル内にエラーコードとともに出す（GI-6）", async () => {
    restoreDrift.mockRejectedValue(
      new ApiClientError(403, { code: "Forbidden", message: "この操作を行う権限がありません", retryable: false }),
    );
    const { onRepaired } = renderModal();

    press("drift-restore");

    const error = await screen.findByTestId("drift-repair-error");
    expect(error.textContent).toContain("この操作を行う権限がありません");
    expect(error.textContent).toContain("エラーコード");
    expect(error.textContent).toContain("Forbidden");
    expect(onRepaired).not.toHaveBeenCalled();
    // 失敗のあとは、もう一度押せる
    expect(isBlocked(buttonOf("drift-restore"))).toBe(false);
  });

  it("adopt の API 失敗も確認モーダルを閉じ、詳細モーダルにエラーコードを出す", async () => {
    adoptDrift.mockRejectedValue(new ApiClientError(500, { code: "InternalError", message: "boom", retryable: true }));
    renderModal();
    press("drift-adopt");
    await screen.findByTestId("drift-adopt-confirm");

    press("drift-adopt-confirm-run");

    expect((await screen.findByTestId("drift-repair-error")).textContent).toContain("InternalError");
    await waitFor(() => expect(screen.queryByTestId("drift-adopt-confirm")).toBeNull());
  });

  it("契約外の応答（created なのに changeRequest が null）は黙って捨てず、エラーとして出す", async () => {
    restoreDrift.mockResolvedValue(repair({ outcome: "created", changeRequest: null }));
    window.history.pushState({}, "", "/roles");
    renderModal();

    press("drift-restore");

    const error = await screen.findByTestId("drift-repair-error");
    expect(error.textContent).toContain("UnexpectedResponse");
    expect(window.location.pathname).toBe("/roles");
    // 失敗のあとは、もう一度押せる
    expect(isBlocked(buttonOf("drift-restore"))).toBe(false);
  });

  it("契約外の応答（excluded なのに exclusion が null・知らない outcome）もエラーとして出し、onRepaired を呼ばない", async () => {
    restoreDrift.mockResolvedValueOnce(repair({ outcome: "excluded", exclusion: null }));
    const { onRepaired } = renderModal();
    press("drift-restore");
    expect((await screen.findByTestId("drift-repair-error")).textContent).toContain("UnexpectedResponse");

    restoreDrift.mockResolvedValueOnce(repair({ outcome: "future-outcome" as RepairResponse["outcome"] }));
    press("drift-restore");
    await waitFor(() => expect(restoreDrift).toHaveBeenCalledTimes(2));
    expect((await screen.findByTestId("drift-repair-error")).textContent).toContain("UnexpectedResponse");
    expect(onRepaired).not.toHaveBeenCalled();
  });

  it("契約外の応答（adopted なのに changeRequest が null）は、成功として onRepaired を呼ばずエラーとして出す", async () => {
    adoptDrift.mockResolvedValue(repair({ outcome: "adopted", changeRequest: null }));
    const { onRepaired } = renderModal();
    press("drift-adopt");
    await screen.findByTestId("drift-adopt-confirm");

    press("drift-adopt-confirm-run");

    expect((await screen.findByTestId("drift-repair-error")).textContent).toContain("UnexpectedResponse");
    expect(onRepaired).not.toHaveBeenCalled();
  });

  it("restore の実行中は 2 つのボタンとも無効で、二重に押しても API は 1 回", async () => {
    let resolve: (value: RepairResponse) => void = () => {};
    restoreDrift.mockReturnValue(
      new Promise<RepairResponse>((r) => {
        resolve = r;
      }),
    );
    renderModal();

    press("drift-restore");
    press("drift-restore");
    press("drift-adopt");

    await waitFor(() => expect(isBlocked(buttonOf("drift-adopt"))).toBe(true));
    expect(isBlocked(buttonOf("drift-restore"))).toBe(true);
    expect(restoreDrift).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("drift-adopt-confirm")).toBeNull();

    await act(async () => resolve(repair({ outcome: "no-drift" })));
    await screen.findByTestId("drift-repair-notice");
    expect(isBlocked(buttonOf("drift-restore"))).toBe(false);
  });

  it("adopt の実行中に確認の実行ボタンを二重に押しても API は 1 回", async () => {
    let resolve: (value: RepairResponse) => void = () => {};
    adoptDrift.mockReturnValue(
      new Promise<RepairResponse>((r) => {
        resolve = r;
      }),
    );
    renderModal();
    press("drift-adopt");
    await screen.findByTestId("drift-adopt-confirm");

    press("drift-adopt-confirm-run");
    press("drift-adopt-confirm-run");

    expect(adoptDrift).toHaveBeenCalledTimes(1);
    await act(async () => resolve(repair({ outcome: "adopted" })));
  });
});
