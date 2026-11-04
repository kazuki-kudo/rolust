import type { RepairResponse, TrustDriftView } from "@rolust/core";
import { useRef, useState } from "react";

import { ApiClientError, api } from "../api-client.js";
import { useT } from "../i18n/index.js";
import { navigate } from "../router.js";
import { requestsPath } from "../routes.js";
import { toApiError } from "./useAsync.js";

export type DriftRepairBusy = "restore" | "adopt" | null;

export interface DriftRepair {
  busy: DriftRepairBusy;
  notice: string | null;
  error: ApiClientError | null;
  failures: RepairResponse["failures"];
  /** 「記録を IAM に合わせる」の確認を開いているか。 */
  confirming: boolean;
  openConfirm: () => void;
  closeConfirm: () => void;
  run: (kind: "restore" | "adopt") => Promise<void>;
}

/**
 * 乖離を直す 2 操作の状態と実行（Issue #172。FR-4.10・FR-4.11）。
 *
 * 状態を `DriftDetailModal` に持ち上げているのは、確認（本文の警告とフッターのボタン）と 2 つの操作の両方が
 * 同じ状態を見るため。確認は 2 枚目のモーダルにしない（GI-10）。
 */
export function useDriftRepair(
  view: TrustDriftView,
  onRepaired: (roleArn: string, count: number) => void,
): DriftRepair {
  const t = useT();
  const m = t.roles.drift.repair;
  const [busy, setBusy] = useState<DriftRepairBusy>(null);
  // state は次の描画まで反映されないので、同じ描画の間の二重押しはこの ref で確実に弾く。
  const running = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [failures, setFailures] = useState<RepairResponse["failures"]>([]);
  const [confirming, setConfirming] = useState(false);

  async function run(kind: "restore" | "adopt"): Promise<void> {
    if (running.current) return;
    running.current = true;
    setBusy(kind);
    setNotice(null);
    setError(null);
    setFailures([]);
    try {
      const response = kind === "restore" ? await api.restoreDrift(view.roleArn) : await api.adoptDrift(view.roleArn);
      if (response.outcome === "no-drift") {
        setNotice(m.noDrift);
      } else if (response.outcome === "excluded" && response.exclusion !== null) {
        setNotice(m.excluded(response.exclusion.reason, response.exclusion.changeRequestId));
      } else if (response.outcome === "created" && response.changeRequest !== null) {
        navigate(requestsPath([response.changeRequest.changeRequestId]));
      } else if (response.outcome === "adopted" && response.failures.length > 0) {
        setFailures(response.failures);
      } else if (response.outcome === "adopted" && response.changeRequest !== null) {
        // 件数は、サーバが実際に書いた集合（監査の申請）から数える。確認時の画面の結果は、確認から実行までの間に古くなりうる。
        const { addUserArns, removeUserArns } = response.changeRequest;
        onRepaired(view.roleArn, addUserArns.length + removeUserArns.length);
      } else {
        // 契約外の応答（outcome に対して本体が無い・知らない outcome）を、黙って捨てない。エラーの表示場所に出す。
        console.error("[rolust] unexpected drift repair response", response);
        setError(new ApiClientError(500, { code: "UnexpectedResponse", message: "Unexpected repair response" }));
      }
    } catch (cause) {
      setError(toApiError(cause));
    } finally {
      running.current = false;
      setBusy(null);
      setConfirming(false);
    }
  }

  return {
    busy,
    notice,
    error,
    failures,
    confirming,
    openConfirm: () => setConfirming(true),
    // 実行中に閉じると、実行しているのに確認が消えてしまう。実行が終わる（finally）まで閉じない。
    closeConfirm: () => {
      if (!running.current) setConfirming(false);
    },
    run,
  };
}
