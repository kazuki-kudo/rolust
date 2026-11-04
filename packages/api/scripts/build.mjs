import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/**
 * Lambda 用のバンドルを作る。
 *
 * - 出力は CommonJS の `index.js`。Lambda のハンドラ指定は `index.handler`。
 * - `@aws-sdk/*` は外部化する。Node.js 24.x ランタイムが SDK v3 を同梱しており、
 *   バンドルに含めると起動時間とパッケージサイズが無駄に増える。
 * - Terraform の `archive_file` がこの `dist/<name>` ディレクトリを zip 化する。
 */

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const outRoot = resolve(packageRoot, "dist");

const entries = [
  { name: "crud", entry: "src/lambda/crud.ts" },
  { name: "diff", entry: "src/lambda/diff.ts" },
  { name: "apply", entry: "src/lambda/apply.ts" },
];

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const { name, entry } of entries) {
  await build({
    entryPoints: [resolve(packageRoot, entry)],
    outfile: resolve(outRoot, name, "index.js"),
    bundle: true,
    platform: "node",
    target: "node24",
    format: "cjs",
    sourcemap: false,
    minify: false,
    external: ["@aws-sdk/*"],
    logLevel: "info",
  });
}

console.log(`[rolust] Lambda バンドルを ${outRoot} に出力しました`);
