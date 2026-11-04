import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

import { thirdPartyNotices } from "./src/build/third-party-notices.js";

/**
 * SPA のビルド設定（C-2 / DF-5）。
 *
 * 出力を S3 に置き CloudFront で配信する。API は同一オリジンの `/api/*` に
 * ルーティングされるため、本番のベース URL 設定は不要。
 * ローカル開発で別オリジンの API を叩く場合のみ `VITE_ROLUST_API_BASE_URL` を使う。
 *
 * ## チャンク分割（質問 6 = B / 質問 7 = C）
 *
 * `@cloudscape-design/*` と `react` / `react-dom` をそれぞれ独立チャンクへ分ける。
 * 5 画面すべてが Cloudscape を import しているため、初回描画のバイト総量はこの分離では
 * ほとんど減らない。**狙いはアプリ側の更新時にベンダチャンクがブラウザキャッシュから
 * 再利用されること**である（画面コードを直してもベンダのハッシュが変わらない）。
 * 初回バンドルから画面固有コードを外すのは `App.tsx` の `React.lazy` の役割であり、
 * 両者は目的が異なるため併用する。
 *
 * `build.chunkSizeWarningLimit` は**引き上げない**。警告を消すために閾値を動かすと、
 * 次に本当に太ったときに気付けなくなる。
 *
 * ## 第三者のライセンス（Issue #187）
 *
 * `thirdPartyNotices()` が、バンドルに取り込んだ第三者のパッケージのライセンスと NOTICE を
 * `dist/THIRD-PARTY-NOTICES.txt` に出力する。`dist` は S3 に置かれ、Release の tarball にも入る。
 */
export default defineConfig({
  plugins: [react(), thirdPartyNotices()],
  build: {
    outDir: "dist",
    sourcemap: false,
    rollupOptions: {
      output: {
        /**
         * `id` はモジュールの解決済みパス。node_modules 配下のパッケージ名で振り分ける。
         *
         * 戻り値 `undefined` は「既定の分割に任せる」を意味する。ここで拾わなかった
         * 依存を無理にひとまとめにすると、片方だけ更新されたときに両方が失効する。
         */
        manualChunks(id: string): string | undefined {
          if (!id.includes("node_modules")) return undefined;
          // 正規化してから照合する（Windows の `\` を含むパスでも同じ判定になる）。
          const path = id.replace(/\\/g, "/");
          if (path.includes("/node_modules/@cloudscape-design/")) return "cloudscape";
          if (
            /\/node_modules\/(react|react-dom|scheduler)\//.test(path)
          ) {
            return "react";
          }
          return undefined;
        },
      },
    },
  },
});
