import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { build } from "esbuild";

/**
 * 登録済みで紐づいていないロールの紐づけ（src/migrations/link-registered-roles-cli.ts。Issue #135 D-5）を、
 * バンドルして実行する。`migrate-split-tables.mjs` と同じ作り。
 *
 * 出力は dist/cli/（.gitignore の dist/ に入る）。@aws-sdk/* はリポジトリの node_modules から読む。
 * 引数（--apply）は同じプロセスの process.argv として CLI に渡る。
 */
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outfile = resolve(packageRoot, "dist", "cli", "migrate-link-registered-roles.mjs");

await build({
  entryPoints: [resolve(packageRoot, "src", "migrations", "link-registered-roles-cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["@aws-sdk/*"],
  logLevel: "warning",
});

await import(pathToFileURL(outfile).href);
