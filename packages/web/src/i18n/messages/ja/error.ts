export const error = {
  network: (detail: string) => `サーバに接続できませんでした: ${detail}`,
  requestFailed: (status: number) => `API 呼び出しに失敗しました (HTTP ${status})`,
  server: "サーバ内部でエラーが発生しました",
  codeLabel: "エラーコード",
  retryHint: "（時間をおいて再試行してください）",
  retry: "再試行",
  statusIconAriaLabel: "エラー",
  screenLoadHeader: "画面を読み込めませんでした",
  screenLoadBody: "新しい版が反映されたか、通信が途切れた可能性があります。ページを再読込してください。",
  reload: "再読込",
};
