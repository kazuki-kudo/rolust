import type { ImportPlan } from "../services/role-import.js";

/**
 * 登録済みで紐づいていない IAM ロールを、固定プールに紐づける（Issue #135 D-5）。
 *
 * ロールの紐づけを廃止して「登録したロールは常に紐づく」にしたので、廃止の前に紐づけを外していた登録済みのロールを、
 * 登録と同じ書き込み（信頼ポリシーの取り込み → 末尾の紐づけ）で紐づける。IamRole は既にあるので書かない。
 * 何度実行しても同じ結果になる（取り込みは同じ値の書き直し、紐づけは既存なら何もしない）。
 *
 * dry-run（既定）は対象を列挙するだけで、信頼ポリシーも読まず、何も書かない。
 */

export interface LinkRegisteredDeps {
  /** 登録済みのロールの ARN。 */
  listRoleArns(): Promise<string[]>;
  /** 固定プールに紐づいたロールの ARN。 */
  listLinkedArns(): Promise<string[]>;
  /** ロールの信頼ポリシーを読み、取り込む IAM ユーザを決める（読めなければ投げる）。 */
  readPlan(roleArn: string): Promise<ImportPlan>;
  /** 取り込み（IamUser → Assignment）と、末尾への紐づけを書く。 */
  link(plan: ImportPlan): Promise<void>;
}

export interface LinkRegisteredReport {
  apply: boolean;
  unlinked: string[];
  linked: string[];
  failures: { roleArn: string; message: string }[];
}

export async function linkRegisteredRoles(
  deps: LinkRegisteredDeps,
  options: { apply: boolean },
): Promise<LinkRegisteredReport> {
  const [roleArns, linkedArns] = await Promise.all([deps.listRoleArns(), deps.listLinkedArns()]);
  const linked = new Set(linkedArns);
  const unlinked = roleArns.filter((roleArn) => !linked.has(roleArn));
  const report: LinkRegisteredReport = { apply: options.apply, unlinked, linked: [], failures: [] };
  if (!options.apply) return report;

  for (const roleArn of unlinked) {
    try {
      await deps.link(await deps.readPlan(roleArn));
      report.linked.push(roleArn);
    } catch (error) {
      report.failures.push({ roleArn, message: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

export function formatLinkReport(report: LinkRegisteredReport, options: { apply: boolean }): string[] {
  if (report.unlinked.length === 0) return ["書く対象はありません（登録済みのロールは、すべて紐づいています）"];
  const lines = [
    `${options.apply ? "" : "[dry-run] "}紐づいていない登録済みのロール: ${report.unlinked.length} 件`,
    ...report.unlinked.map((roleArn) => `  - ${roleArn}`),
  ];
  if (!options.apply) {
    lines.push("何も書き込んでいません。--apply で、信頼ポリシーを読んで取り込み、紐づけます。");
    return lines;
  }
  lines.push(`紐づけた: ${report.linked.length} 件`);
  for (const failure of report.failures) {
    lines.push(`失敗（再実行できます）: ${failure.roleArn}: ${failure.message}`);
  }
  return lines;
}

export function linkRegisteredExitCode(report: LinkRegisteredReport): number {
  return report.failures.length > 0 ? 1 : 0;
}
