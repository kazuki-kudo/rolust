import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

// Cloudscape のグローバルスタイル。ページ地・タイポグラフィ・リセットを与える。
// 各コンポーネントは自身のスタイルを同梱するため、読み込むのはこの 1 本だけでよい。
import "@cloudscape-design/global-styles/index.css";
// GI-8: `prefers-reduced-motion: reduce` の打ち消し。Cloudscape のスタイルより後に読む。
import "./reduced-motion.css";

import { App } from "./App.js";
import { LocaleProvider } from "./i18n/index.js";
import { syncReducedMotionPreference } from "./reduced-motion.js";

/**
 * SPA のエントリポイント（C-2 / DF-5）。
 *
 * ダークモード（`applyMode`）は poc では扱わない（`design-system-mapping.md`
 * § Design Tokens）。トークン参照に閉じているため、将来クラスを付けるだけで対応できる。
 */

// GI-8: OS の「動きを減らす」設定を Cloudscape の `disableMotion()` へ伝える。
// 解除関数は捨てる — 購読はページの生存期間そのものである。
syncReducedMotionPreference();
const container = document.getElementById("root");
if (!container) {
  // 握り潰さない。index.html の #root が失われたことに気づかずに白画面になるのを防ぐ。
  // eslint-disable-next-line no-restricted-syntax -- 開発者向けの例外（利用者には出ない）。画面の文言ではないのでカタログに置かない。
  throw new Error("マウント先の #root 要素が見つかりません（index.html を確認してください）");
}

createRoot(container).render(
  <StrictMode>
    <LocaleProvider>
      <App />
    </LocaleProvider>
  </StrictMode>,
);
