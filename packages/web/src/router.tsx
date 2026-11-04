import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * 最小のクライアントルータ（C-2 / DF-5）。
 *
 * 画面遷移はクライアント側で行う。ライブラリを足さないのは、
 * 経路が 5 つしかなく、NFR-4（第三者が README と Terraform でセットアップできる）に
 * 効く依存の軽さのほうが価値が高いためである。
 *
 * FR-4.7（セッションをまたいだ下書き再開）のため、FR-7.4 は
 * `/requests?ids=<csv>` で状態を復元できる（MQ-2）。
 */

const NAVIGATION_EVENT = "rolust:navigate";

export interface Route {
  path: string;
  query: URLSearchParams;
}

function currentRoute(): Route {
  return {
    path: window.location.pathname || "/",
    query: new URLSearchParams(window.location.search),
  };
}

/**
 * 離脱ガード（Issue #103）。未保存の入力がある画面が、アプリ内の遷移を止めて確認を挟むために登録する。
 *
 * 止めるなら true を返し、確認が済んだら渡された `proceed` を呼ぶ（そのとき遷移する）。止めないなら false を返す。
 * ブラウザの戻る・進む操作と、`replaceRoute` は対象外（タブを閉じる・再読込は画面側の `beforeunload` が担う）。
 */
export type NavigationGuard = (to: string, proceed: () => void) => boolean;

let navigationGuard: NavigationGuard | null = null;

/** ガードを登録（`null` で解除）する。戻り値は、その登録だけを外す関数（あとから登録されたガードは外さない）。 */
export function setNavigationGuard(guard: NavigationGuard | null): () => void {
  navigationGuard = guard;
  return () => {
    if (navigationGuard === guard) navigationGuard = null;
  };
}

/** 画面遷移する。ブラウザの戻る操作と再読み込みで同じ画面へ復帰できる。 */
export function navigate(to: string): void {
  const go = (): void => {
    window.history.pushState({}, "", to);
    window.dispatchEvent(new Event(NAVIGATION_EVENT));
  };
  if (navigationGuard?.(to, go)) return;
  go();
}

/** 履歴を増やさずに URL を置き換える（モーダルの開閉など、戻る操作で辿らせない遷移）。 */
export function replaceRoute(to: string): void {
  window.history.replaceState({}, "", to);
  window.dispatchEvent(new Event(NAVIGATION_EVENT));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => currentRoute());

  useEffect(() => {
    const sync = (): void => setRoute(currentRoute());
    window.addEventListener("popstate", sync);
    window.addEventListener(NAVIGATION_EVENT, sync);
    return () => {
      window.removeEventListener("popstate", sync);
      window.removeEventListener(NAVIGATION_EVENT, sync);
    };
  }, []);

  return route;
}

/** リンクの onFollow に渡すハンドラ。既定の遷移を止めてクライアント側で遷移する。 */
export function useNavigateTo(to: string): (event?: { preventDefault(): void }) => void {
  return useCallback(
    (event?: { preventDefault(): void }) => {
      event?.preventDefault();
      navigate(to);
    },
    [to],
  );
}

/** `/requests?ids=a,b` の ids を配列で読む（MQ-2）。 */
export function useRequestIds(query: URLSearchParams): string[] {
  return useMemo(() => {
    const raw = query.get("ids");
    if (!raw) return [];
    return [...new Set(raw.split(",").map((id) => id.trim()).filter(Boolean))];
  }, [query]);
}
