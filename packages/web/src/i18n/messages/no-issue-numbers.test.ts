import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * 利用者に見える文言に、Issue の番号を入れない（Issue #209）。
 *
 * Issue の番号は、利用者には何を指すか分からない。画面と API の文言のカタログ（日英）を対象にする。
 * 値を実行して走査すると、引数を取る文言（関数・テンプレートリテラル）が漏れるので、ソースの文字列を読む。
 * コメントは開発者向けなので除く。運用者が Lambda のログで読む起動時エラー（`packages/api/src/config.ts`）は
 * 対象外で、カタログのディレクトリだけを見る。
 */

const here = dirname(fileURLToPath(import.meta.url));
const CORE_MESSAGES = join(here, "..", "..", "..", "..", "core", "src", "messages");

/** `.ts` のソースのうち、テストを除くカタログのファイル。 */
function catalogFiles(): string[] {
  const dirs = [join(here, "ja"), join(here, "en")];
  const web = dirs.flatMap((dir) => readdirSync(dir).map((name) => join(dir, name)));
  const core = [join(CORE_MESSAGES, "ja.ts"), join(CORE_MESSAGES, "en.ts")];
  return [...web, ...core].filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"));
}

/**
 * ブロックコメントと行コメントを除く。URL の `//` は、直前が空白でないので残る。
 * 報告する行番号が元のファイルと合うよう、ブロックコメントの改行は残す。
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, ""))
    .replace(/(^|\s)\/\/.*$/gm, "$1");
}

describe("利用者向けの文言に Issue の番号を入れない（Issue #209）", () => {
  it("カタログのファイルを見つけている（走査の対象が空で通らない）", () => {
    expect(catalogFiles().length).toBeGreaterThan(20);
  });

  it("日英のカタログ（web と core）の文字列に `Issue #数字` が無い", () => {
    const offenders = catalogFiles().flatMap((file) =>
      stripComments(readFileSync(file, "utf8"))
        .split("\n")
        .map((text, index) => ({ file, line: index + 1, text }))
        .filter(({ text }) => /Issue\s*#\d+/.test(text))
        .map(({ file: f, line }) => `${f.slice(here.length - "messages".length)}:${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it("コメントの除去が、文字列を巻き込まない（走査の取りこぼしを防ぐ）", () => {
    const sample = [
      '  a: "x（Issue #1）", // 行コメント Issue #2',
      '  b: "https://example.com/Issue #3",',
      "  /* Issue #4 */ c: `y（Issue #5）`,",
    ].join("\n");
    const hits = stripComments(sample).match(/Issue\s*#\d+/g);
    expect(hits).toEqual(["Issue #1", "Issue #3", "Issue #5"]);
  });
});
