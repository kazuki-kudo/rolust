import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

/**
 * 移行スクリプト（src/migrations/split-tables-cli.ts）をバンドルして実行する。
 *
 * 出力は dist/cli/（.gitignore の dist/ に入る）。@aws-sdk/* はリポジトリの node_modules から読む。
 * 引数（--apply）は同じプロセスの process.argv として CLI に渡る。
 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(packageRoot, "dist", "cli", "migrate-split-tables.mjs");

await build({
  entryPoints: [resolve(packageRoot, "src", "migrations", "split-tables-cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["@aws-sdk/*"],
  logLevel: "warning",
});

await import(pathToFileURL(outfile).href);
