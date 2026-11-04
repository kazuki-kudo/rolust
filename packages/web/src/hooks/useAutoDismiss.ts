import { useEffect, useRef } from "react";

/**
 * GI-5: 成功通知は 5 秒で自動的に消す。
 *
 * **成功通知だけ**が対象である。警告・エラーの通知は自動では消さない —
 * 見落とすと利用者が状態を誤解するためである（呼び出し側が `token` に
 * `null` を渡すことで対象外にする）。
 *
 * `token` は「今表示している通知」を表す値。値が変われば計時をやり直し、
 * `null` になれば計時を止める。呼び出し側は通知を出すたびに**新しい参照**を
 * 作ること（同じ文字列を再表示すると計時が引き継がれる）。
 */
export const SUCCESS_NOTICE_TTL_MS = 5000;

export function useAutoDismiss(
  token: unknown,
  dismiss: () => void,
  ttlMs: number = SUCCESS_NOTICE_TTL_MS,
): void {
  // dismiss は毎レンダー新しい関数になりうる。ref 経由で読むことで、
  // 「レンダーのたびにタイマーが張り直されて永遠に消えない」のを防ぐ。
  const latest = useRef(dismiss);
  latest.current = dismiss;

  useEffect(() => {
    if (token === null || token === undefined) return;

    const timer = setTimeout(() => latest.current(), ttlMs);
    // GI-5「ページ遷移で消さない」— アンマウント時に dismiss は呼ばず、
    // 未発火のタイマーを捨てるだけにする。
    return () => clearTimeout(timer);
  }, [token, ttlMs]);
}
