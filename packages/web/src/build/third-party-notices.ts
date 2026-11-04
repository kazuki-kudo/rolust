import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { Plugin } from "vite";

/**
 * SPA に取り込んだ第三者のコードのライセンスと NOTICE を、1 つの文書に集める（Issue #187）。
 *
 * MIT・BSD・Apache-2.0 は、コードを配るときに著作権表示と許諾文を添えることを求め、Apache-2.0 は
 * NOTICE の内容も求める。バンドルにはそれが残らないので、ビルドで実際に取り込んだパッケージ
 * （`chunk.modules` に現れた `node_modules` 配下のもの）から、`THIRD-PARTY-NOTICES.txt` を作って
 * `dist` に置く。依存の木ではなくバンドルの実際から作るのは、取り込まれなかったパッケージまで
 * 載せて、配っていないものの表示を並べないため。
 *
 * ライセンスのファイルが無いパッケージが 1 つでもあればビルドを失敗させる。表示の義務を
 * 満たせないまま配ってしまうことを防ぐため。
 */

export interface PackageNotice {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly licenseText: string;
  readonly noticeText: string | undefined;
}

const MARKER = "/node_modules/";
const LICENSE_FILE = /^(licen[sc]e|copying)(?:[-_][a-z0-9_-]+)?(?:\.(?:md|txt))?$/i;
const NOTICE_FILE = /^notice(?:\.(?:md|txt))?$/i;

/**
 * モジュールの ID から、属するパッケージのルートを返す。`node_modules` の外なら `undefined`。
 *
 * 入れ子の `node_modules` は内側のパッケージを返す。Vite の仮想モジュールの接頭辞（`\0`）と
 * クエリは取り除き、区切り文字は `/` に揃える（Windows のパスでも同じ判定になる）。
 */
export function packageRootOf(moduleId: string): string | undefined {
  const withoutQuery = moduleId.replace(/^\0/, "").split("?")[0] ?? "";
  const id = withoutQuery.split("\\").join("/");
  const at = id.lastIndexOf(MARKER);
  if (at < 0) return undefined;
  const rest = id.slice(at + MARKER.length).split("/");
  const first = rest[0];
  if (!first) return undefined;
  const name = first.startsWith("@") ? `${first}/${rest[1] ?? ""}` : first;
  return id.slice(0, at + MARKER.length) + name;
}

/** モジュールの ID の集まりから、パッケージのルートを重複なく、名前順に集める。 */
export function collectPackageRoots(moduleIds: Iterable<string>): string[] {
  const roots = new Set<string>();
  for (const id of moduleIds) {
    const root = packageRootOf(id);
    if (root !== undefined) roots.add(root);
  }
  return [...roots].sort();
}

function normalizeText(text: string): string {
  return text.replace(/\r\n?/g, "\n").trim();
}

function declaredLicense(manifest: Record<string, unknown>): string {
  const license = manifest["license"];
  if (typeof license === "string") return license;
  if (license !== null && typeof license === "object") {
    const type = (license as Record<string, unknown>)["type"];
    if (typeof type === "string") return type;
  }
  return "(not declared)";
}

/**
 * パッケージのルートから、名前・版・ライセンス・ライセンス全文・NOTICE を読む。
 * ライセンスのファイルが無ければ、名前と版を示して失敗する。
 */
export function readPackageNotice(root: string): PackageNotice {
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
  const name = String(manifest["name"] ?? root);
  const version = String(manifest["version"] ?? "0.0.0");

  const files = readdirSync(root).sort();
  const licenseFiles = files.filter((f) => LICENSE_FILE.test(f));
  if (licenseFiles.length === 0) {
    throw new Error(
      `ライセンスのファイルが無い第三者のパッケージがバンドルに入っている: ${name}@${version}（${root}）`,
    );
  }
  const licenseText = licenseFiles
    .map((f) => normalizeText(readFileSync(join(root, f), "utf8")))
    .join("\n\n");

  const noticeFiles = files.filter((f) => NOTICE_FILE.test(f));
  const noticeText =
    noticeFiles.length === 0
      ? undefined
      : noticeFiles.map((f) => normalizeText(readFileSync(join(root, f), "utf8"))).join("\n\n");

  return { name, version, license: declaredLicense(manifest), licenseText, noticeText };
}

const RULE = "=".repeat(80);

const HEADER = [
  "THIRD-PARTY NOTICES",
  "",
  "この文書は、Rolust の管理画面（SPA）に含まれる第三者のソフトウェアと、そのライセンスの全文です。",
  "This file lists the third-party software included in the Rolust console (SPA), with the full text of their licenses.",
].join("\n");

/** パッケージを名前順に並べ、`THIRD-PARTY-NOTICES.txt` の本文を作る。改行は LF で、末尾は改行 1 つ。 */
export function renderNotices(notices: readonly PackageNotice[]): string {
  const sorted = [...notices].sort((a, b) =>
    a.name === b.name ? a.version.localeCompare(b.version) : a.name < b.name ? -1 : 1,
  );
  const blocks = sorted.map((n) => {
    const lines = [RULE, `${n.name}@${n.version}`, `License: ${n.license}`, "", n.licenseText];
    if (n.noticeText !== undefined) lines.push("", "NOTICE:", n.noticeText);
    return lines.join("\n");
  });
  return `${[HEADER, ...blocks].join("\n\n")}\n`;
}

/** ビルドで取り込んだ第三者のパッケージの一覧を、`THIRD-PARTY-NOTICES.txt` として出力する Vite のプラグイン。 */
export function thirdPartyNotices(): Plugin {
  return {
    name: "rolust-third-party-notices",
    apply: "build",
    generateBundle(_options, bundle) {
      const ids: string[] = [];
      for (const output of Object.values(bundle)) {
        if (output.type === "chunk") ids.push(...Object.keys(output.modules));
      }

      const byKey = new Map<string, PackageNotice>();
      for (const root of collectPackageRoots(ids)) {
        let notice: PackageNotice;
        try {
          notice = readPackageNotice(root);
        } catch (e) {
          this.error(e instanceof Error ? e.message : String(e));
        }
        const key = `${notice.name}@${notice.version}`;
        if (!byKey.has(key)) byKey.set(key, notice);
      }

      this.emitFile({
        type: "asset",
        fileName: "THIRD-PARTY-NOTICES.txt",
        source: renderNotices([...byKey.values()]),
      });
    },
  };
}
