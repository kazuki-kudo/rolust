import { describe, expect, it, vi } from "vitest";

import type { ImportPlan } from "../services/role-import.js";
import type { LinkRegisteredDeps } from "./link-registered-roles.js";
import { formatLinkReport, linkRegisteredExitCode, linkRegisteredRoles } from "./link-registered-roles.js";

const A = "arn:aws:iam::111122223333:role/a";
const B = "arn:aws:iam::111122223333:role/b";
const C = "arn:aws:iam::111122223333:role/c";

function deps(overrides: Partial<LinkRegisteredDeps> = {}): LinkRegisteredDeps & { writes: string[] } {
  const writes: string[] = [];
  return {
    writes,
    listRoleArns: async () => [A, B, C],
    listLinkedArns: async () => [A],
    readPlan: async (roleArn): Promise<ImportPlan> => ({ roleArn, userArns: [] }),
    link: async (plan) => {
      writes.push(plan.roleArn);
    },
    ...overrides,
  };
}

describe("linkRegisteredRoles（Issue #135 D-5。登録済みで紐づいていないロールを紐づける）", () => {
  it("dry-run（既定）は、対象を列挙するだけで、何も書かない（信頼ポリシーも読まない）", async () => {
    const d = deps();
    const readPlan = vi.fn(d.readPlan);

    const report = await linkRegisteredRoles({ ...d, readPlan }, { apply: false });

    expect(report.unlinked).toEqual([B, C]);
    expect(report.linked).toEqual([]);
    expect(d.writes).toEqual([]);
    expect(readPlan).not.toHaveBeenCalled();
  });

  it("--apply は、紐づいていないロールだけを、信頼ポリシーの取り込みつきで紐づける。すでに紐づいたロールには触れない", async () => {
    const d = deps();

    const report = await linkRegisteredRoles(d, { apply: true });

    expect(d.writes).toEqual([B, C]);
    expect(report.linked).toEqual([B, C]);
    expect(report.failures).toEqual([]);
  });

  it("信頼ポリシーを読めないロールは、何も書かずに失敗として集め、ほかのロールは続ける", async () => {
    const d = deps({
      readPlan: async (roleArn) => {
        if (roleArn === B) throw new Error("AccessDenied");
        return { roleArn, userArns: [] };
      },
    });

    const report = await linkRegisteredRoles(d, { apply: true });

    expect(d.writes).toEqual([C]);
    expect(report.failures).toEqual([{ roleArn: B, message: "AccessDenied" }]);
    expect(linkRegisteredExitCode(report)).toBe(1);
  });

  it("書き込みの失敗も失敗として集める", async () => {
    const d = deps({
      link: async () => {
        throw new Error("Rate exceeded");
      },
    });

    const report = await linkRegisteredRoles(d, { apply: true });

    expect(report.linked).toEqual([]);
    expect(report.failures.map((failure) => failure.roleArn)).toEqual([B, C]);
  });

  it("対象が無ければ「書く対象はありません」と報告し、終了コード 0（再実行しても同じ）", async () => {
    const report = await linkRegisteredRoles(deps({ listLinkedArns: async () => [A, B, C] }), { apply: true });

    expect(formatLinkReport(report, { apply: true })).toEqual([expect.stringContaining("書く対象はありません")]);
    expect(linkRegisteredExitCode(report)).toBe(0);
  });
});
