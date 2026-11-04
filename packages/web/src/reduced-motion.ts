import { disableMotion } from "@cloudscape-design/global-styles";

/**
 * GI-8 の後半 — `prefers-reduced-motion: reduce` を Cloudscape へ明示的に伝える。
 *
 * `disableMotion(disabled)` は `@cloudscape-design/global-styles` が公開している
 * 公式 API で、`<body>` に `awsui-motion-disabled` クラスを付け外しする。
 * Cloudscape の各コンポーネントの scoped CSS がこのクラスを見てアニメーションと
 * トランジションを無効化する（`applyMode` / `applyDensity` と同じ仕組み）。
 *
 * コンポーネントの多くは `@media (prefers-reduced-motion: reduce)` も自前で持つが、
 * すべてではない（例: `Spinner`）。CSS 側の打ち消し（`reduced-motion.css`）と
 * この API 呼び出しの両方を入れて、経路を Cloudscape の実装差に依存させない。
 *
 * OS 設定は実行中に変わりうるため、初期値の反映だけでなく変更にも追従する。
 */

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * OS の「動きを減らす」設定を購読し、Cloudscape のモーションを追従させる。
 *
 * @returns 購読を解除する関数。SPA のエントリでは呼ばれない（ページ終了まで購読する）。
 */
export function syncReducedMotionPreference(): () => void {
  // `matchMedia` を持たない環境（SSR や古い実行環境）では何もしない。
  // 例外を投げると SPA 全体がマウントされなくなり、影響が症状に見合わない。
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  const apply = (matches: boolean): void => disableMotion(matches);

  apply(query.matches);

  const listener = (event: MediaQueryListEvent): void => apply(event.matches);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
