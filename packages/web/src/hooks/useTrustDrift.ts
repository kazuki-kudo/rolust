import { useCallback, useRef, useState } from "react";
import type { DriftResponse } from "@rolust/core";

import { api } from "../api-client.js";
import type { ApiClientError } from "../api-client.js";
import { toApiError } from "./useAsync.js";

/**
 * 乖離の確認の状態（FR-4.9。Issue #170）。
 *
 * 画面の描画では走らせず、`run()` を呼んだときだけ API を 1 回呼ぶ（D-1: 結果は保存せず、この状態にだけ持つ。
 * 画面を離れる・再読み込みで消える）。失敗を空の結果に畳まない（`error` を持つ）。
 */
export type DriftState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: ApiClientError }
  | { status: "success"; data: DriftResponse };

export interface UseTrustDriftResult {
  state: DriftState;
  /** 確認を実行する。確認中の再呼び出しは何もしない（API を 1 回だけ呼ぶ）。 */
  run: () => Promise<void>;
  /** 結果・エラーを消す（サマリの「閉じる」）。 */
  clear: () => void;
}

export function useTrustDrift(): UseTrustDriftResult {
  const [state, setState] = useState<DriftState>({ status: "idle" });
  // 状態の更新は非同期なので、連打の判定は ref で持つ（同じ描画の間の 2 回目の呼び出しを確実に弾く）。
  const running = useRef(false);

  const run = useCallback(async (): Promise<void> => {
    if (running.current) return;
    running.current = true;
    setState({ status: "loading" });
    try {
      const data = await api.getDrift();
      setState({ status: "success", data });
    } catch (cause) {
      setState({ status: "error", error: toApiError(cause) });
    } finally {
      running.current = false;
    }
  }, []);

  const clear = useCallback((): void => setState({ status: "idle" }), []);

  return { state, run, clear };
}
