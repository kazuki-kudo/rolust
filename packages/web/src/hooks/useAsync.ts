import { useCallback, useEffect, useState } from "react";

import { ApiClientError } from "../api-client.js";

/**
 * 非同期読み込みの状態管理。
 *
 * `mockups.md` が全画面に課す 5 状態のうち loading / error / success を担う
 * （empty と partial は取得したデータの中身から画面側が判定する）。
 *
 * **失敗を空データに畳まない**。`{ status: "error" }` を明示的に持つことで、
 * 「0 件」と「読み込めなかった」が画面上で区別される。
 */

export type AsyncState<T> =
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "success"; data: T };

/** 想定外の例外も `ApiClientError` に揃える。握り潰さず、画面の error 状態へ運ぶ。 */
export function toApiError(cause: unknown): ApiClientError {
  if (cause instanceof ApiClientError) return cause;
  return new ApiClientError(0, {
    code: "UnexpectedError",
    message: cause instanceof Error ? cause.message : String(cause),
    retryable: false,
  });
}

export interface UseAsyncResult<T> {
  state: AsyncState<T>;
  /** 再取得する（error 状態の再試行ボタン、および更新後の再読み込みに使う）。 */
  reload: () => void;
  /** 取得済みデータを局所的に差し替える（セル単位保存など、全件再取得が過剰な場合）。 */
  patch: (updater: (current: T) => T) => void;
}

/**
 * @param load 取得処理。**`useCallback` で安定させたものを渡すこと**
 *   （毎レンダー新しい関数を渡すと取得が止まらなくなる）。
 */
export function useAsync<T>(load: () => Promise<T>): UseAsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    load()
      .then((data) => {
        if (!cancelled) setState({ status: "success", data });
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // 記録したうえで画面へ渡す。どちらか片方だけにしない。
        // eslint-disable-next-line no-restricted-syntax -- 開発者向けのログ。画面には出ない
        console.error("[rolust] データの取得に失敗しました", cause);
        setState({ status: "error", error: toApiError(cause) });
      });

    return () => {
      cancelled = true;
    };
  }, [load, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  const patch = useCallback((updater: (current: T) => T) => {
    setState((current) =>
      current.status === "success"
        ? { status: "success", data: updater(current.data) }
        : current,
    );
  }, []);

  return { state, reload, patch };
}
