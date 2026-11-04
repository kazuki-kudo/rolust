import { useCallback, useMemo, useRef, useState } from "react";

import {
  EMPTY_HIDDEN,
  getBrowserStorage,
  loadHidden,
  pruneHidden,
  saveHidden,
  type MatrixHidden,
} from "../matrix-hidden.js";

export interface MatrixHiddenController {
  hidden: MatrixHidden;
  hideRole: (roleArn: string) => void;
  showRole: (roleArn: string) => void;
  showAllRoles: () => void;
  toggleFold: (columnId: string) => void;
  /** 現在の列に無い値を捨てる（D-9）。変化が無ければ何もしない。 */
  sync: (roleArns: Iterable<string>, columnIds: Iterable<string>) => void;
}

/**
 * マトリクスの非表示の状態（Issue #140）。識別子が決まっていれば `localStorage` から読み、変わるたびに保存する。
 * 識別子が `null` の間は、メモリ上の状態だけを持ち、読み書きしない（D-3）。識別子はマウント中に変わらない前提。
 */
export function useMatrixHidden(identity: string | null): MatrixHiddenController {
  const [hidden, setHidden] = useState<MatrixHidden>(() =>
    identity === null ? EMPTY_HIDDEN : loadHidden(getBrowserStorage(), identity),
  );
  const latest = useRef(hidden);

  const commit = useCallback(
    (next: MatrixHidden): void => {
      if (next === latest.current) return;
      latest.current = next;
      setHidden(next);
      if (identity !== null) saveHidden(getBrowserStorage(), identity, next);
    },
    [identity],
  );

  return useMemo(
    () => ({
      hidden,
      hideRole: (roleArn) =>
        commit({
          ...latest.current,
          roleArns: new Set(latest.current.roleArns).add(roleArn),
        }),
      showRole: (roleArn) => {
        const roleArns = new Set(latest.current.roleArns);
        roleArns.delete(roleArn);
        commit({ ...latest.current, roleArns });
      },
      showAllRoles: () => commit({ ...latest.current, roleArns: new Set<string>() }),
      toggleFold: (columnId) => {
        const foldedColumnIds = new Set(latest.current.foldedColumnIds);
        if (!foldedColumnIds.delete(columnId)) foldedColumnIds.add(columnId);
        commit({ ...latest.current, foldedColumnIds });
      },
      sync: (roleArns, columnIds) => commit(pruneHidden(latest.current, roleArns, columnIds)),
    }),
    [hidden, commit],
  );
}
