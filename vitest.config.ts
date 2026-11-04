import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * ワークスペース横断の Vitest 設定。
 *
 * 既定の環境は `node`。DOM を要するテスト（packages/web）は各ファイル冒頭の
 * `// @vitest-environment jsdom` で個別に切り替える。
 *
 * `*.integration.test.ts` は**除外する**。実 AWS を呼ぶテストであり、
 * `npm run test` が資格情報の有無に依存してはならないため。実行は
 * `npm run test:integration`（`vitest.integration.config.ts`）から行う。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["packages/*/src/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    clearMocks: true,
    restoreMocks: true,

    /**
     * 既定の 5 秒から延ばす（Issue #199 により 2026-10-25 追記）。
     *
     * `packages/web` の画面テスト（jsdom + Cloudscape）は、並行実行やカバレッジの計測で
     * 遅い環境だと 5 秒に届かないことがある。落ちるファイルと件数が実行ごとに変わり、
     * 単独で走らせると通る——assertion の失敗ではなく、待ち時間の不足である。
     *
     * タイムアウトは assertion ではないので、延ばしても検査は弱くならない。逆に、
     * 揺れたまま放置すると「赤は本物か」を毎回人が判断することになり、
     * CI（と手元の `ci-local.sh`）の判定が信用できなくなる。
     */
    testTimeout: 30_000,

    /**
     * カバレッジは**計測して表示するだけ**であり、合否ゲートではない
     * （ci-pipeline (3.7) の Q2 = A）。したがって `thresholds` を意図的に置かない。
     *
     * 現行コードは poc スコープ・Test Strategy: Minimal の下で承認済みであり、
     * 後から別の基準で失格にしないための判断である。数値は CI のジョブサマリに
     * 出して推移を見えるようにする。
     */
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "text", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: [
        "**/*.test.{ts,tsx}",
        "**/*.integration.test.ts",
        "**/testing/**",
        "**/*.d.ts",
      ],
    },
  },
});
