/** 権限の名前（`need` ごと）。`@rolust/core` の `PERMISSION_LABELS` と同じ語。 */
const labels = { view: "参照", edit: "作成", apply: "反映" };

export const permission = {
  labels,
  required: (need: "view" | "edit" | "apply") => `この操作には「${labels[need]}」の権限が必要です`,
  noPermissionHeader: "操作できる権限がありません",
  noPermissionBody:
    "このアカウントには、参照・作成・反映のどの権限も付いていません。管理者に、権限の付与を依頼してください。",
};
