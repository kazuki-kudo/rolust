/**
 * マトリクスの列ヘッダのホバー（tooltip）の文言（Issue #150 の D-11）。
 *
 * 表示名がある列は、正式なロール名を 1 行目に出す（表示名の正体を確かめるため）。説明があれば続ける。
 * 表示名が無い列は、今までどおり説明だけを出す。何も無ければ `undefined`（`title` を付けない）。
 */
export function roleColumnTitle(column: {
  roleName: string;
  formalRoleName: string;
  description: string | null;
}): string | undefined {
  const lines = column.roleName !== column.formalRoleName ? [column.formalRoleName, column.description] : [column.description];
  const text = lines.filter((line): line is string => line !== null && line !== "").join("\n");
  return text === "" ? undefined : text;
}
