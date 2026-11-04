import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

// Issue #94: 画面の文言は i18n のカタログ（packages/web/src/i18n/messages/ja.ts と ja/<領域>.ts）に置く。
// 例外はカタログ（ja.ts・ja/**）、テスト、testing/**、build/**（ビルドの道具。Issue #187）、と個別の eslint-disable だけ。
const JAPANESE = "[\\u3000-\\u30ff\\u4e00-\\u9fff\\uff00-\\uffef]";
const NO_JAPANESE_LITERAL_MESSAGE =
  "画面の文言は packages/web/src/i18n/messages のカタログに置く（Issue #94）。コメントは対象外。";

/**
 * ESLint flat config.
 *
 * org.md `## Code Style` に従い、linter の設定をコードスタイルの正とする。
 * 型情報つきリント（projectService）は使わない — poc の規模では実行時間に見合わず、
 * `npm run typecheck`（tsc）が型の健全性を別途担保する。
 */
export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/.terraform/**",
      ".claude/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // `.mjs` を含める — ビルドスクリプト（packages/*/scripts/build.mjs）が
    // Node のグローバル（console 等）を使うため、この設定ブロックの対象に入れる。
    files: ["**/*.{ts,tsx,js,mjs}"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: ["error", "smart"],
      "no-implicit-coercion": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
    },
  },
  {
    files: ["packages/web/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["packages/web/src/**/*.{ts,tsx}"],
    ignores: [
      "packages/web/src/**/*.test.{ts,tsx}",
      "packages/web/src/testing/**",
      // ビルドの道具（Vite のプラグイン）。画面の文言ではなく、ビルドのエラーと THIRD-PARTY-NOTICES.txt の本文（Issue #187）。
      "packages/web/src/build/**",
      "packages/web/src/i18n/messages/ja.ts",
      "packages/web/src/i18n/messages/ja/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "error",
        { selector: `Literal[value=/${JAPANESE}/]`, message: NO_JAPANESE_LITERAL_MESSAGE },
        { selector: `TemplateElement[value.cooked=/${JAPANESE}/]`, message: NO_JAPANESE_LITERAL_MESSAGE },
        { selector: `JSXText[value=/${JAPANESE}/]`, message: NO_JAPANESE_LITERAL_MESSAGE },
      ],
    },
  },
);
