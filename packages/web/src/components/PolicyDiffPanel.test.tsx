// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type { ChangeRequest, DiffView } from "@rolust/core";
import { localized } from "@rolust/core";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../i18n/index.js";
import { applyDisabled } from "../screens/DiffScreen.js";
import { PolicyDiffPanel, isSelectableForApply } from "./PolicyDiffPanel.js";

/**
 * `PolicyDiffPanel` のユニットテスト（FR-4.2）。
 *
 * 管理外 principal の警告が表示されること、そして**その警告が反映を妨げないこと**を
 * 確かめる。Q22 は「表示のみ」を選び、確認チェックボックスも disabled も採らなかった。
 * 反映側の活性判定（`isSelectableForApply` / `applyDisabled`）に管理外 principal が
 * 関与しないことまで確かめないと、この要件は満たされたことにならない。
 */

const ROLE_ARN = "arn:aws:iam::555566667777:role/DeployProd";
const CR_ID = "cr-0142";

const changeRequest: ChangeRequest = {
  changeRequestId: CR_ID,
  poolId: "platform-team",
  roleArn: ROLE_ARN,
  addUserArns: ["arn:aws:iam::111122223333:user/ayaka.mori"],
  removeUserArns: ["arn:aws:iam::444455556666:user/tomas.ruiz"],
  status: "draft",
  createdAt: "2026-07-31T10:04:00.000Z",
  createdBy: null,
  appliedAt: null,
  appliedBy: null,
  result: null,
};

const warnedView: DiffView = {
  changeRequest,
  diff: {
    roleArn: ROLE_ARN,
    added: ["arn:aws:iam::111122223333:user/ayaka.mori"],
    removed: ["arn:aws:iam::444455556666:user/tomas.ruiz"],
    alreadyPresent: [],
    alreadyAbsent: [],
    changed: true,
    placeholderInjected: false,
    placeholderRemoved: false,
  },
  unmanaged: [
    {
      kind: "AWS",
      value: "arn:aws:iam::999900001111:root",
      statementIndex: 0,
      sid: null,
      effect: "Allow",
    },
    {
      kind: "Service",
      value: "ec2.amazonaws.com",
      statementIndex: 1,
      sid: "AllowEc2",
      effect: "Allow",
    },
  ],
  readError: null,
};

const readErrorView: DiffView = {
  changeRequest: { ...changeRequest, changeRequestId: "cr-0143" },
  diff: null,
  unmanaged: [],
  readError: { errorCode: "AccessDenied", message: "iam:GetRole が拒否されました" },
};

afterEach(cleanup);

describe("PolicyDiffPanel", () => {
  it("FR-4.2: 管理外 principal の警告が表示され、反映対象のチェックが disabled にならない", () => {
    render(
      <PolicyDiffPanel view={warnedView} selected onToggle={() => {}} />,
    );

    const warning = screen.getByTestId(`diff-card-${CR_ID}-unmanaged`);
    expect(warning.textContent).toContain("Rolust 管理外のプリンシパルが 2 件あります");
    expect(warning.textContent).toContain("反映してもこれらは削除されません");
    expect(warning.textContent).toContain("arn:aws:iam::999900001111:root");
    expect(warning.textContent).toContain("ec2.amazonaws.com");

    // 警告は反映を妨げない — カードのチェックボックスは操作可能なままである。
    const checkbox = screen
      .getByTestId(`diff-card-${CR_ID}-select`)
      .querySelector("input");
    expect(checkbox).not.toBeNull();
    expect((checkbox as HTMLInputElement).disabled).toBe(false);

    // 画面側の「選択した n 件を反映」も無効化されない。
    expect(isSelectableForApply(warnedView)).toBe(true);
    expect(applyDisabled([warnedView], new Set([CR_ID]))).toBe(false);
  });

  it("ARN は全文で表示され、省略されない", () => {
    render(<PolicyDiffPanel view={warnedView} selected onToggle={() => {}} />);

    expect(
      screen.getByTestId(
        `diff-card-${CR_ID}-added-arn:aws:iam::111122223333:user/ayaka.mori`,
      ).textContent,
    ).toContain("arn:aws:iam::111122223333:user/ayaka.mori");
    expect(
      screen.getByTestId(
        `diff-card-${CR_ID}-removed-arn:aws:iam::444455556666:user/tomas.ruiz`,
      ).textContent,
    ).toContain("arn:aws:iam::444455556666:user/tomas.ruiz");
    expect(screen.getByTestId(`diff-card-${CR_ID}-arn`).textContent).toBe(ROLE_ARN);
  });

  it("Issue #16: 追加によってプレースホルダを取り除くとき、その旨をカードに示す", () => {
    const view: DiffView = {
      ...warnedView,
      diff: { ...(warnedView.diff as NonNullable<DiffView["diff"]>), placeholderRemoved: true },
    };

    render(<PolicyDiffPanel view={view} selected onToggle={() => {}} />);

    expect(
      screen.getByTestId(`diff-card-${CR_ID}-placeholder-removed`).textContent,
    ).toContain("プレースホルダ（RolustPlaceholder）を削除します");
    expect(screen.queryByTestId(`diff-card-${CR_ID}-placeholder-injected`)).toBeNull();
  });

  it("Issue #172: restore の申請のカードには、IAM を記録に合わせる申請であることを示す", () => {
    const view: DiffView = { ...warnedView, changeRequest: { ...changeRequest, kind: "restore" } };

    render(<PolicyDiffPanel view={view} selected onToggle={() => {}} />);

    expect(screen.getByTestId(`diff-card-${CR_ID}-kind`).textContent).toBe(
      "IAM を記録に合わせるための申請です。",
    );
  });

  it("Issue #172: 通常の申請と adopt の申請のカードには restore の注記を出さない", () => {
    const { rerender } = render(<PolicyDiffPanel view={warnedView} selected onToggle={() => {}} />);
    expect(screen.queryByTestId(`diff-card-${CR_ID}-kind`)).toBeNull();

    const adopt: DiffView = { ...warnedView, changeRequest: { ...changeRequest, kind: "adopt" } };
    rerender(<PolicyDiffPanel view={adopt} selected onToggle={() => {}} />);
    expect(screen.queryByTestId(`diff-card-${CR_ID}-kind`)).toBeNull();
  });

  it("Issue #16: 最後の管理下 principal を外してプレースホルダを挿入するとき、引き受け不能になることを示す", () => {
    const view: DiffView = {
      ...warnedView,
      diff: { ...(warnedView.diff as NonNullable<DiffView["diff"]>), placeholderInjected: true },
    };

    render(<PolicyDiffPanel view={view} selected onToggle={() => {}} />);

    const note = screen.getByTestId(`diff-card-${CR_ID}-placeholder-injected`);
    expect(note.textContent).toContain("プレースホルダ（RolustPlaceholder）を挿入します");
    expect(note.textContent).toContain("この IAMロールは誰も引き受けられません");
    expect(screen.queryByTestId(`diff-card-${CR_ID}-placeholder-removed`)).toBeNull();
  });

  it("プレースホルダが関わらない差分では、プレースホルダの注記を出さない", () => {
    render(<PolicyDiffPanel view={warnedView} selected onToggle={() => {}} />);

    expect(screen.queryByTestId(`diff-card-${CR_ID}-placeholder-removed`)).toBeNull();
    expect(screen.queryByTestId(`diff-card-${CR_ID}-placeholder-injected`)).toBeNull();
  });

  it("エッジケース: 信頼ポリシーの読み取りに失敗したカードは反映対象に選べない", () => {
    render(<PolicyDiffPanel view={readErrorView} selected={false} onToggle={() => {}} />);

    expect(
      screen.getByTestId("diff-card-cr-0143-read-error").textContent,
    ).toContain("AccessDenied");

    const checkbox = screen
      .getByTestId("diff-card-cr-0143-select")
      .querySelector("input");
    expect((checkbox as HTMLInputElement).disabled).toBe(true);

    expect(isSelectableForApply(readErrorView)).toBe(false);
    expect(applyDisabled([readErrorView], new Set(["cr-0143"]))).toBe(true);
  });

  it("エッジケース: 反映失敗の結果には AWS のエラーコードと再反映ボタンが出る（FR-5.5 / FR-5.6）", () => {
    render(
      <PolicyDiffPanel
        view={warnedView}
        selected
        onToggle={() => {}}
        onRetry={() => {}}
        report={{
          changeRequestId: CR_ID,
          roleArn: ROLE_ARN,
          ok: false,
          status: "failed",
          appliedAt: "2026-07-31T10:07:00.000Z",
          errorCode: "AccessDenied",
          message: "iam:UpdateAssumeRolePolicy が拒否されました",
          added: [],
          removed: [],
          warnings: [],
        }}
      />,
    );

    const result = screen.getByTestId(`diff-card-${CR_ID}-result`);
    expect(result.textContent).toContain("AccessDenied");
    expect(screen.getByTestId(`diff-card-${CR_ID}-retry`)).toBeDefined();
    // 結果表示に切り替わったカードには選択チェックボックスを出さない。
    expect(screen.queryByTestId(`diff-card-${CR_ID}-select`)).toBeNull();
  });

  it("別の管理者が反映中（Conflict）の報告には、エラーコードと文言が出る（Issue #121）", () => {
    render(
      <PolicyDiffPanel
        view={warnedView}
        selected
        onToggle={() => {}}
        onRetry={() => {}}
        report={{
          changeRequestId: CR_ID,
          roleArn: ROLE_ARN,
          ok: false,
          status: "draft",
          appliedAt: "2026-10-06T00:00:00.000Z",
          errorCode: "Conflict",
          message: "別の管理者がこの申請を反映中です。しばらくしてから申請履歴で状態を確かめてください。",
          added: [],
          removed: [],
          warnings: [],
        }}
      />,
    );

    const result = screen.getByTestId(`diff-card-${CR_ID}-result`);
    expect(result.textContent).toContain("Conflict");
    expect(result.textContent).toContain("別の管理者がこの申請を反映中です");
  });
});

describe("PolicyDiffPanel の英語の表示（Issue #94）", () => {
  const renderEn = (ui: React.JSX.Element): void => {
    render(
      <LocaleProvider initialLocale="en" storage={null}>
        {ui}
      </LocaleProvider>,
    );
  };

  it("追加・削除されるプリンシパルと管理外 principal の警告が英語になる", () => {
    renderEn(<PolicyDiffPanel view={warnedView} selected onToggle={() => {}} />);

    expect(screen.getByRole("region", { name: "Diff for DeployProd" })).toBeTruthy();
    expect(screen.getByTestId(`diff-card-${CR_ID}-added`).textContent).toContain("Principals to add");
    expect(screen.getByTestId(`diff-card-${CR_ID}-removed`).textContent).toContain("Principals to remove");
    expect(screen.getByTestId(`diff-card-${CR_ID}-select`).textContent).toContain("Include");
    expect(screen.getByTestId(`diff-card-${CR_ID}-unmanaged`).textContent).toContain(
      "There are 2 principals not managed by Rolust. Applying will not remove them.",
    );
  });

  it("管理外 principal が 1 件のときは単数の文になる", () => {
    renderEn(
      <PolicyDiffPanel
        view={{ ...warnedView, unmanaged: warnedView.unmanaged.slice(0, 1) }}
        selected
        onToggle={() => {}}
      />,
    );

    expect(screen.getByTestId(`diff-card-${CR_ID}-unmanaged`).textContent).toContain(
      "There is 1 principal not managed by Rolust. Applying will not remove it.",
    );
  });

  it("プレースホルダの注記と、変化しない項目の注記が英語になる", () => {
    const view: DiffView = {
      ...warnedView,
      diff: {
        ...(warnedView.diff as NonNullable<DiffView["diff"]>),
        placeholderRemoved: true,
        placeholderInjected: true,
        alreadyPresent: ["arn:aws:iam::111122223333:user/a"],
        alreadyAbsent: [],
      },
    };
    renderEn(<PolicyDiffPanel view={view} selected onToggle={() => {}} />);

    expect(screen.getByTestId(`diff-card-${CR_ID}-placeholder-removed`).textContent).toContain(
      "(RolustPlaceholder) will be removed",
    );
    expect(screen.getByTestId(`diff-card-${CR_ID}-placeholder-injected`).textContent).toContain(
      "no one will be able to assume this IAM role",
    );
    expect(screen.getByTestId(`diff-card-${CR_ID}-noop`).textContent).toContain(
      "1 item would not change if applied",
    );
  });

  it("読み取りエラーの本文は localized から英語で出し、エラーコードはそのまま出す", () => {
    renderEn(
      <PolicyDiffPanel
        view={{
          ...readErrorView,
          readError: {
            errorCode: "AccessDenied",
            message: "iam:GetRole が拒否されました",
            localized: localized("diff.readFailed", {}),
          },
        }}
        selected={false}
        onToggle={() => {}}
      />,
    );

    const card = screen.getByTestId("diff-card-cr-0143-read-error");
    expect(card.textContent).toContain("Could not read the current trust policy");
    expect(card.textContent).toContain("Error code: AccessDenied");
    expect(card.textContent).not.toContain("iam:GetRole が拒否されました");
  });

  it("反映の失敗は localized の本文を英語で出し、エラーコードと再反映は英語で出る", () => {
    renderEn(
      <PolicyDiffPanel
        view={warnedView}
        selected
        onToggle={() => {}}
        onRetry={() => {}}
        report={{
          changeRequestId: CR_ID,
          roleArn: ROLE_ARN,
          ok: false,
          status: "failed",
          appliedAt: "2026-07-31T10:07:00.000Z",
          errorCode: "AccessDenied",
          message: "信頼ポリシーの更新に失敗しました",
          localized: localized("apply.updateFailed", {}),
          added: [],
          removed: [],
          warnings: [],
        }}
      />,
    );

    const result = screen.getByTestId(`diff-card-${CR_ID}-result`);
    expect(result.textContent).toContain("Apply failed");
    expect(result.textContent).toContain("AccessDenied: Failed to update the trust policy");
    expect(screen.getByTestId(`diff-card-${CR_ID}-retry`).textContent).toBe("Re-apply this request");
  });

  it("反映中の表示が英語になる", () => {
    renderEn(<PolicyDiffPanel view={warnedView} selected onToggle={() => {}} applying />);

    expect(screen.getByTestId(`diff-card-${CR_ID}-applying`).textContent).toContain("Applying");
  });
});
