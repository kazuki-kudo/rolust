import { Component } from "react";
import type { ReactNode } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";

import { useT } from "../i18n/index.js";
import { ScreenLoadError } from "../lazy-screen.js";

/**
 * 画面チャンクを読み込めなかったときに、画面の本体の位置で再読込を案内する
 * （Issue #4、`interaction-spec.md` GI-11）。
 *
 * SPA の反映では名前の変わった旧チャンクが destroy されるため、反映の前から開いていた
 * タブがまだ読み込んでいない画面へ移ると `import()` が失敗する。ここが無いと React の
 * ツリー全体が外れて画面が真っ白になる。
 *
 * - **自動では再読込しない。** 何が起きたかを見せ、本物の障害で再読込を繰り返さないため。
 * - **`ScreenLoadError` だけを受け止める。** 描画中のバグを「新しい版」の案内で覆い隠さない。
 * - `App.tsx` が `key={route.path}` を付けるので、画面を移ると状態が消える。
 *
 * ErrorBoundary は React の仕様上クラスでしか書けない。
 */

export interface ScreenErrorBoundaryProps {
  children: ReactNode;
  /** 既定は `window.location.reload()`。jsdom では差し替えられないため、テストが渡す。 */
  onReload?: () => void;
}

interface State {
  caught: boolean;
  error: unknown;
}

export class ScreenErrorBoundary extends Component<ScreenErrorBoundaryProps, State> {
  override state: State = { caught: false, error: undefined };

  static getDerivedStateFromError(error: unknown): State {
    return { caught: true, error };
  }

  override render(): ReactNode {
    const { caught, error } = this.state;
    if (!caught) return this.props.children;
    if (!(error instanceof ScreenLoadError)) throw error;

    const onReload = this.props.onReload ?? (() => window.location.reload());
    return <ScreenLoadErrorAlert error={error} onReload={onReload} />;
  }
}

/** クラスのエラー境界は `useT` を呼べないため、描画する部分を関数コンポーネントに分ける。 */
function ScreenLoadErrorAlert({ error, onReload }: { error: Error; onReload: () => void }): React.JSX.Element {
  const t = useT();
  return (
    <div data-testid="screen-load-error">
      <Alert
        type="error"
        header={t.error.screenLoadHeader}
        statusIconAriaLabel={t.error.statusIconAriaLabel}
        action={
          <Button data-testid="screen-load-error-reload" onClick={onReload}>
            {t.error.reload}
          </Button>
        }
      >
        <Box variant="p">{t.error.screenLoadBody}</Box>
        <Box variant="small">{error.message}</Box>
      </Alert>
    </div>
  );
}
