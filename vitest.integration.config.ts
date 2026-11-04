import { defineConfig } from "vitest/config";

/**
 * 統合テスト専用の Vitest 設定。
 *
 * `*.integration.test.ts` **だけ**を対象にする。これらは AWS SDK をスタブせず、
 * 実 AWS の IAM API を呼ぶ。したがって:
 *
 * - 既定の `npm run test`（`vitest.config.ts`）からは除外されている
 * - `ROLUST_INTEGRATION=1` を明示しない限り、各ファイルの `describe.skipIf` で
 *   全件スキップされる（設定を間違えても実 AWS を叩かない二重の歯止め）
 * - 対象ロールの信頼ポリシーを書き換えるため、直列実行とする
 *
 * ```bash
 * source .local/rolust.env   # 環境変数は必須（雛形は .local/rolust.env.example。Issue #176）
 * ROLUST_INTEGRATION=1 npm run test:integration
 * ```
 */
export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.integration.test.ts"],
    environment: "node",
    // 同じロールの信頼ポリシーを順に書き換えるため、並行実行してはならない。
    fileParallelism: false,
    sequence: { concurrent: false },
    // 実 AWS の往復と IAM の結果整合を見込む。
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
