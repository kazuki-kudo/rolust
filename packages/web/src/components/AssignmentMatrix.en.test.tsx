// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Assignment, AttributeColumn, IamRole, IamUser, RoleLock } from "@rolust/core";
import { afterEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../i18n/index.js";
import { AssignmentMatrix } from "./AssignmentMatrix.js";

/** 画面 3 のマトリクスの部品を英語で描く（Issue #94）。日本語の挙動は `AssignmentMatrix.test.tsx` が守る。 */

const ACCOUNT = "111122223333";
const ROLE_ACCOUNT = "555566667777";

const columns: AttributeColumn[] = [{ columnId: "c1", name: "Team" }];

const users: IamUser[] = [
  { name: "ayaka.mori", team: "Dev" },
  { name: "kenji.sato", team: "" },
].map(({ name, team }) => ({
  poolId: "p",
  accountId: ACCOUNT,
  userName: name,
  arn: `arn:aws:iam::${ACCOUNT}:user/${name}`,
  createdAt: "2026-07-30T00:00:00.000Z",
  attributes: (team === "" ? {} : { c1: team }) as Record<string, string>,
}));

const roles: IamRole[] = ["Deploy", "Audit", "Billing"].map((roleName) => ({
  accountId: ROLE_ACCOUNT,
  roleName,
  arn: `arn:aws:iam::${ROLE_ACCOUNT}:role/${roleName}`,
  description: null,
  displayName: null,
  color: null,
  createdAt: "2026-07-30T00:00:00.000Z",
}));

const assignments: Assignment[] = [
  { poolId: "p", userArn: users[0]!.arn, roleArn: roles[0]!.arn, checked: true, reflected: false, updatedAt: "x" },
  { poolId: "p", userArn: users[0]!.arn, roleArn: roles[1]!.arn, checked: true, reflected: false, updatedAt: "x" },
  { poolId: "p", userArn: users[1]!.arn, roleArn: roles[0]!.arn, checked: false, reflected: true, updatedAt: "x" },
];

const locks: Record<string, RoleLock> = {
  [roles[1]!.arn]: { roleArn: roles[1]!.arn, changeRequestId: "cr-1", status: "failed", createdAt: "x" },
};

function renderEn(extra: { roles?: IamRole[]; users?: IamUser[] } = {}): void {
  render(
    <LocaleProvider initialLocale="en" storage={null}>
      <AssignmentMatrix
        attributeColumns={columns}
        users={extra.users ?? users}
        roles={extra.roles ?? roles}
        assignments={assignments}
        locks={locks}
        selectedRoleArns={[roles[0]!.arn]}
        savingCells={new Set()}
        toolbarTargetId="matrix-submit-button"
        onToggleCell={() => {}}
        onToggleRole={() => {}}
        onRegisterRoles={() => {}}
      />
    </LocaleProvider>,
  );
}

afterEach(cleanup);

describe("AssignmentMatrix の英語の表示（Issue #94）", () => {
  it("表の見出し・列の操作・差分記号・除外の列が英語になる", () => {
    renderEn();

    expect(screen.getByTestId("assignment-matrix-table").querySelector("caption")?.textContent).toContain(
      "Use the arrow keys to move between cells",
    );
    expect(screen.getByText("IAM user \\ IAM role")).toBeTruthy();
    expect(screen.getByTestId(`role-select-${roles[0]!.arn}`).getAttribute("aria-label")).toBe(
      "Include Deploy in the request",
    );
    expect(screen.getByTestId(`role-select-${roles[0]!.arn}`).parentElement?.textContent).toBe(
      "Include in request (2 changes)",
    );
    expect(screen.getByTestId(`role-chip-${roles[1]!.arn}`).getAttribute("aria-label")).toBe(
      "Audit: cannot be requested because there is 1 failed request",
    );
    expect(screen.getByTestId(`role-chip-${roles[1]!.arn}`).textContent).toBe("Failed");
    expect(screen.getByTestId(`role-nochange-${roles[2]!.arn}`).textContent).toBe("No changes");
    expect(screen.getByTestId(`cell-marker-${users[1]!.arn}-${roles[0]!.arn}`).textContent).toBe("−Remove");
    expect(screen.getByTestId("attr-fold-c1").getAttribute("aria-label")).toBe("Collapse the Team column");
    expect(screen.getByTestId("matrix-legend").textContent).toBe(
      '+ Add / − Remove / Columns marked "Draft" or "Failed" cannot be requested because they have an unapplied request',
    );
    expect(screen.getByTestId("exclusion-banner").textContent).toContain("1 IAM role was excluded from the request");
  });

  it("列のメニューとバッジが英語になり、絞り込みの件数が単数・複数に従う", () => {
    renderEn();

    fireEvent.click(screen.getByTestId(`role-menu-${roles[0]!.arn}`));
    expect(screen.getByTestId("column-menu").getAttribute("aria-label")).toBe("Sort and filter Deploy");
    expect(screen.getByTestId("column-menu-sort-checked-first").textContent).toContain("Checked first");
    expect(screen.getByTestId("column-menu-filter-changed").textContent).toContain("Has unapplied changes");
    expect(screen.getByTestId("column-menu-hide").getAttribute("aria-disabled")).toBe("true");
    expect(screen.getByText("A column included in the request cannot be hidden")).toBeTruthy();
    fireEvent.click(screen.getByTestId("column-menu-filter-checked"));

    expect(screen.getByTestId(`role-badge-${roles[0]!.arn}`).textContent).toBe("Filter: Checked");
    expect(screen.getByTestId("matrix-view-status").textContent).toContain("Showing 1 of 2 rows");
    expect(screen.getByTestId("matrix-view-clear").textContent).toBe("Clear all");

    fireEvent.click(screen.getByTestId("attr-menu-c1"));
    expect(screen.getByTestId("column-menu-filter-value-0").textContent).toContain("Dev (1)");
    expect(screen.getByTestId("column-menu-filter-unset").textContent).toContain("(unset) (1)");
    fireEvent.click(screen.getByTestId("column-menu-sort-desc"));
    expect(screen.getByTestId("attr-badge-c1").textContent).toBe("↓ Descending");
  });

  it("列を隠すと、読み上げと再表示の一覧が英語になる", () => {
    renderEn();

    fireEvent.click(screen.getByTestId(`role-menu-${roles[2]!.arn}`));
    fireEvent.click(screen.getByTestId("column-menu-hide"));

    expect(screen.getByTestId("matrix-hidden-live").textContent).toBe("The Billing column is hidden");
    const button = screen.getByTestId("matrix-hidden-button");
    expect(button.textContent).toBe("1 hidden column ▾");
    expect(button.getAttribute("aria-label")).toBe("1 hidden column. Open the list to show columns");
    fireEvent.click(button);
    expect(screen.getByTestId("matrix-hidden-list").getAttribute("aria-label")).toBe("Hidden columns");
    expect(screen.getByTestId(`matrix-hidden-show-${roles[2]!.arn}`).textContent).toBe("Show");
    expect(screen.getByTestId("matrix-hidden-show-all").textContent).toBe("Show all");
    fireEvent.click(screen.getByTestId(`matrix-hidden-show-${roles[2]!.arn}`));
    expect(screen.getByTestId("matrix-hidden-live").textContent).toBe("The Billing column is shown");
  });

  it("ユーザが 0 件の案内が英語になる", () => {
    renderEn({ users: [] });

    const empty = screen.getByTestId("matrix-empty");
    expect(empty.textContent).toContain("The matrix cannot be displayed");
    expect(empty.textContent).toContain("No IAM users are registered. Register them on the IAM users screen.");
  });
});
