/**
 * 移行 CLI が読むテーブル名（Issue #36）。
 *
 * 欠けた変数はすべて名指しする。同じ名前を 2 つに入れると別々のテーブルのはずのアイテムが
 * 1 本に混ざるので拒む。値は `terraform -chdir=infra output -raw <state_table_name など>` で確かめられる。
 */
export function readTableNames<K extends string>(
  env: NodeJS.ProcessEnv,
  vars: Record<K, string>,
): { ok: true; names: Record<K, string> } | { ok: false; message: string } {
  const names = {} as Record<K, string>;
  const missing: string[] = [];
  for (const [key, variable] of Object.entries(vars) as [K, string][]) {
    const value = env[variable]?.trim();
    if (value) names[key] = value;
    else missing.push(variable);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      message: `環境変数 ${missing.join("・")} を設定してください（値は terraform -chdir=infra output で確かめられます）`,
    };
  }
  if (new Set(Object.values(names)).size !== Object.keys(names).length) {
    return { ok: false, message: `環境変数 ${Object.values(vars).join("・")} には別々のテーブル名を設定してください` };
  }
  return { ok: true, names };
}
