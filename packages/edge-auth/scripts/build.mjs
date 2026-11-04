import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

/**
 * Lambda@Edge 用のバンドルを作る。
 *
 * viewer-request に関連付ける関数はパッケージサイズが **1 MB まで**という制限がある。
 * `@aws-sdk/client-ssm` をバンドルすると確実に超えるため外部化する
 * （nodejs24.x ランタイムが SDK v3 を同梱している）。
 */

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const outDir = resolve(packageRoot, "dist");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(packageRoot, "src/index.ts")],
  outfile: resolve(outDir, "index.js"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "cjs",
  sourcemap: false,
  minify: false,
  external: ["@aws-sdk/*"],
  logLevel: "info",
});

console.log(`[rolust] Lambda@Edge バンドルを ${outDir} に出力しました`);
