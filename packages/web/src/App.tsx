import { Suspense, useCallback, useEffect } from "react";
import Alert from "@cloudscape-design/components/alert";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";
import Spinner from "@cloudscape-design/components/spinner";
import type { MeResponse } from "@rolust/core";

import { api } from "./api-client.js";
import { AppShell } from "./components/AppShell.js";
import { ErrorPanel } from "./components/ErrorPanel.js";
import { NoPermission } from "./components/NoPermission.js";
import { ScreenErrorBoundary } from "./components/ScreenErrorBoundary.js";
import { useAsync } from "./hooks/useAsync.js";
import { lazyScreen } from "./lazy-screen.js";
import { ActorProvider, identityOf } from "./actor.js";
import { useT } from "./i18n/index.js";
import { PermissionProvider } from "./permission.js";
import { navigate, useRoute } from "./router.js";
import { ROUTES } from "./routes.js";

/**
 * 経路と画面の対応（DF-5 / C-2）。
 *
 * FR-7.4（`/requests?ids=<csv>`）はクエリから状態を復元する。ブラウザの再読み込みと
 * 戻る操作で同じ画面に復帰できることが FR-4.7（セッションをまたいだ下書き再開）の
 * 実装上の担保である。
 *
 * ## ルート単位の遅延読み込み（質問 6 = B / 質問 7 = C）
 *
 * 5 画面を `React.lazy` で分割し、初回バンドルから画面固有コードを外す。ルータは自前実装
 * （`router.tsx`）のまま変えない — 経路が 5 つしかなく、依存の軽さのほうが NFR-4 に効く。
 *
 * **`Suspense` は画面本体だけを包み、`AppShell` のナビゲーションは外側に残す。**
 * 画面切り替えのたびにナビゲーションが消えると、そこにフォーカスがあった場合に
 * 行き先が失われる（`interaction-spec.md` Focus management）。
 *
 * **画面チャンクを読み込めないときは `ScreenErrorBoundary` が再読込を案内する**（Issue #4、
 * `interaction-spec.md` GI-11）。SPA の反映では名前の変わった旧チャンクが destroy されるため、
 * 反映の前から開いていたタブで未読込の画面へ移ると `import()` が失敗する。`key={route.path}` で
 * 画面を移るたびに状態を消し、読み込み済みの別の画面へはそのまま移れるようにする。
 */

const PoolScreen = lazyScreen(async () => ({
  default: (await import("./screens/PoolScreen.js")).PoolScreen,
}));
const RolesScreen = lazyScreen(async () => ({
  default: (await import("./screens/RolesScreen.js")).RolesScreen,
}));
const MatrixScreen = lazyScreen(async () => ({
  default: (await import("./screens/MatrixScreen.js")).MatrixScreen,
}));
const DiffScreen = lazyScreen(async () => ({
  default: (await import("./screens/DiffScreen.js")).DiffScreen,
}));
const HistoryScreen = lazyScreen(async () => ({
  default: (await import("./screens/HistoryScreen.js")).HistoryScreen,
}));

/**
 * 権限（`GET /me`）を読んでから画面を出す（Issue #141）。読み込み中・失敗中に、操作できる状態で画面を出さない。
 * 失敗は再試行を案内する。権限なし（`none`）は `AppBody` が案内に差し替える（API は参照も 403 にする）。
 */
export function App(): React.JSX.Element {
  const load = useCallback(() => api.getMe(), []);
  const { state, reload } = useAsync(load);
  const t = useT();

  if (state.status === "loading") {
    return (
      <Box padding="l" data-testid="permission-loading">
        <div role="status" aria-live="polite">
          <Spinner /> {t.app.checkingPermission}
        </div>
      </Box>
    );
  }
  if (state.status === "error") {
    return (
      <Box padding="l">
        <ErrorPanel
          testId="permission-error"
          header={t.app.permissionCheckFailed}
          error={state.error}
          onRetry={reload}
        />
      </Box>
    );
  }
  return (
    <PermissionProvider value={state.data.permission}>
      <ActorProvider value={identityOf(state.data.actor)}>
        <AppBody none={state.data.permission === "none"} authMode={state.data.authMode} />
      </ActorProvider>
    </PermissionProvider>
  );
}

function AppBody({
  none,
  authMode,
}: {
  none: boolean;
  authMode: MeResponse["authMode"];
}): React.JSX.Element {
  const route = useRoute();

  // ルート直下は最初の画面（ユーザプール管理）へ寄せる。
  useEffect(() => {
    if (route.path === "/" || route.path === "") navigate(ROUTES.pool);
  }, [route.path]);

  return (
    <AppShell path={route.path} authMode={authMode}>
      {/*
        fallback が置き換えるのは画面本体だけである。`AppShell` は外側に残るため、
        ナビゲーションとスキップリンクは画面の読み込み中も DOM に残り続ける。
      */}
      <ScreenErrorBoundary key={route.path}>
        <Suspense fallback={<ScreenFallback />}>
          {none ? <NoPermission /> : <Screen path={route.path} query={route.query} />}
        </Suspense>
      </ScreenErrorBoundary>
    </AppShell>
  );
}

/** 画面チャンクの取得中に出す待機表示。`role="status"` で読み上げに載せる。 */
function ScreenFallback(): React.JSX.Element {
  const t = useT();
  return (
    <Box padding="l" data-testid="screen-loading">
      <div role="status" aria-live="polite">
        <Spinner /> {t.app.loadingScreen}
      </div>
    </Box>
  );
}

function Screen({
  path,
  query,
}: {
  path: string;
  query: URLSearchParams;
}): React.JSX.Element {
  const t = useT();
  switch (path) {
    case "/":
    case "":
    case ROUTES.pool:
      return <PoolScreen />;
    case ROUTES.roles:
      return <RolesScreen />;
    case ROUTES.matrix:
      return <MatrixScreen />;
    case ROUTES.requests:
      return <DiffScreen query={query} />;
    case ROUTES.history:
      return <HistoryScreen highlight={query.get("highlight")} />;
    default:
      return (
        <div data-testid="route-not-found">
          <Alert
            type="warning"
            header={t.app.routeNotFoundHeader}
            action={
              <Button
                data-testid="route-not-found-home"
                onClick={() => navigate(ROUTES.pool)}
              >
                {t.app.routeNotFoundHome}
              </Button>
            }
          >
            {path}
          </Alert>
        </div>
      );
  }
}
