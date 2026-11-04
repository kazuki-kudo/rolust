import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";

import type { ApiClientError } from "../api-client.js";
import { describeError, useLocale, useT } from "../i18n/index.js";

/**
 * 取得失敗時に一覧領域と差し替えるエラーパネル（`mockups.md` 各画面の error 状態）。
 *
 * GI-6: AWS / API が返したコードを**そのまま併記する**。Rolust の利用者は IAM の
 * 運用者であり、`AccessDenied` や `NoSuchEntity` は対処に直結する情報である。
 * 平易な説明と併記する形で `ux-guide.md` の「Never show raw error codes」を満たす。
 */

export interface ErrorPanelProps {
  header: string;
  error: ApiClientError;
  onRetry?: () => void;
  testId?: string;
}

export function ErrorPanel({
  header,
  error,
  onRetry,
  testId = "error-panel",
}: ErrorPanelProps): React.JSX.Element {
  const t = useT();
  const { locale } = useLocale();
  return (
    <div data-testid={testId}>
      <Alert
        type="error"
        header={header}
        statusIconAriaLabel={t.error.statusIconAriaLabel}
        action={
          onRetry ? (
            <Button data-testid={`${testId}-retry`} onClick={onRetry}>
              {t.error.retry}
            </Button>
          ) : undefined
        }
      >
        <Box variant="p">{describeError(locale, t, error)}</Box>
        <Box variant="small">
          {t.error.codeLabel}: <code>{error.code}</code>
          {error.retryable ? t.error.retryHint : ""}
        </Box>
      </Alert>
    </div>
  );
}
