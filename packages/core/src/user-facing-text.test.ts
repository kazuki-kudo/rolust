import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * 利用者に見える文言に要件 ID を含めない（Issue #95 / `interaction-spec.md` GI-12）。
 *
 * 要件 ID（`FR-3.2` など）は設計文書（`docs/design/`）を参照するための記号で、利用者には意味が無い。
 * ID が指す内容は、必要なら平易な言葉で書く。コメント・テスト名・テーブル設計の ID は設計との対応に使うので対象外。
 *
 * 画面の文言と API・設定のエラー文言は、ソースを TypeScript の AST で読み、文字列リテラル・テンプレート・JSX テキストだけを
 * 見る（コメントは AST に現れないので除かれる）。Terraform は、コメントを除いた本文（`error_message`・`description` を含む）と、
 * 利用者が書き写す `terraform.tfvars.example` の全文を見る。
 */

const REQUIREMENT_ID = /\b(?:NFR|FR|GI|MQ|OQ)-\d/;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

interface Finding {
  location: string;
  text: string;
}

/** ソースの文字列リテラル・テンプレート・JSX テキストのうち、要件 ID を含むものを返す。 */
function findIdsInSource(source: string, fileName: string): Finding[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const findings: Finding[] = [];

  const visit = (node: ts.Node): void => {
    const text =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
        ? node.text
        : null;
    if (text !== null && REQUIREMENT_ID.test(text)) {
      const { line } = file.getLineAndCharacterOfPosition(node.getStart(file));
      findings.push({ location: `${fileName}:${line + 1}`, text: text.trim().slice(0, 80) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

/**
 * Terraform のコメント（`#`・`//`・行頭から始まるブロックコメント）を除いた本文に要件 ID が残る行を返す。行番号は保つ。
 *
 * ブロックコメントは行頭のものだけを見る。`#` コメントや文字列の中の `role/*` を、ブロックコメントの開始と取り違えないため。
 */
function findIdsInTerraform(source: string, fileName: string): Finding[] {
  const body = source
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, (block) => block.replace(/[^\n]/g, ""))
    // CRLF のファイルがある（`.` は `\r` に一致しないので、行末の `\r` を先に落とす）。
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(#|\/\/).*$/, "").replace(/\s(#|\/\/)\s.*$/, ""));
  return body.flatMap((line, index) =>
    REQUIREMENT_ID.test(line) ? [{ location: `${fileName}:${index + 1}`, text: line.trim().slice(0, 80) }] : [],
  );
}

function listFiles(dir: string, accept: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "dist") return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(path, accept);
    return accept(entry.name) ? [path] : [];
  });
}

describe("要件 ID の検出（検出器そのものの検証）", () => {
  it("文字列リテラル・テンプレート・JSX の本文と属性の ID を検出する", () => {
    const source = [
      'const a = "保証が外れます（FR-3.2）";',
      "const b = `NFR-1 を満たしません ${a}`;",
      "const c = <div title=\"GI-4 の確認\">MQ-4 のとおり</div>;",
    ].join("\n");

    expect(findIdsInSource(source, "sample.tsx").map((f) => f.location)).toEqual([
      "sample.tsx:1",
      "sample.tsx:2",
      "sample.tsx:3",
      "sample.tsx:3",
    ]);
  });

  it("コメント（行・ブロック・JSX）の ID は検出しない", () => {
    const source = [
      "// FR-3.2 の保証",
      "/* GI-7: 進行形にする */",
      "const c = <div>{/* FR-4.6 のロック */}画面の文言</div>;",
    ].join("\n");

    expect(findIdsInSource(source, "sample.tsx")).toEqual([]);
  });

  it("ID に見えるだけの語（OFFR-1・FRAME-2 など）は検出しない", () => {
    expect(findIdsInSource('const a = "OFFR-1 と FRAME-2";', "sample.ts")).toEqual([]);
  });

  it("Terraform は、コメントを除いた本文（description・error_message）の ID を検出する", () => {
    const source = [
      "# FR-3.2 の保証。`role/*` を含むコメント（ブロックコメントの開始と取り違えない）",
      "/* NFR-4 のため（ブロックコメント）",
      "   FR-6.1 */",
      'variable "x" {',
      '  description = "Basic 認証（FR-6.1）"', // 4 行目ではなく 5 行目
      '  default     = "a" # FR-2.1（行末コメント）',
      "}",
    ].join("\n");

    expect(findIdsInTerraform(source, "x.tf").map((f) => f.location)).toEqual(["x.tf:5"]);
  });
});

describe("要件 ID の検出（CRLF）", () => {
  it("CRLF の Terraform でも、コメントを除いて本文の ID だけを検出する", () => {
    const source = ["# FR-3.2（コメント）", 'description = "FR-6.1"', "}"].join("\r\n");

    expect(findIdsInTerraform(source, "x.tf").map((f) => f.location)).toEqual(["x.tf:2"]);
  });
});

describe("利用者に見える文言に要件 ID を含めない（Issue #95 / GI-12）", () => {
  const sources = ["web", "api", "core", "edge-auth"].flatMap((pkg) =>
    listFiles(
      join(ROOT, "packages", pkg, "src"),
      (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !name.endsWith(".d.ts"),
    ),
  );

  it("検査の対象を取りこぼしていない", () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  it("画面・API・設定の文言（packages の src）", () => {
    const findings = sources.flatMap((path) =>
      findIdsInSource(readFileSync(path, "utf8"), relative(ROOT, path)),
    );
    expect(findings).toEqual([]);
  });

  it("Terraform の description・error_message など（infra の *.tf、コメントを除く）", () => {
    const files = listFiles(join(ROOT, "infra"), (name) => name.endsWith(".tf"));
    expect(files.length).toBeGreaterThan(5);
    const findings = files.flatMap((path) =>
      findIdsInTerraform(readFileSync(path, "utf8"), relative(ROOT, path)),
    );
    expect(findings).toEqual([]);
  });

  it("利用者が書き写す terraform.tfvars.example は全文", () => {
    const path = join(ROOT, "infra", "terraform.tfvars.example");
    const findings = readFileSync(path, "utf8")
      .split(/\r?\n/)
      .flatMap((line, index) => (REQUIREMENT_ID.test(line) ? [{ location: `${relative(ROOT, path)}:${index + 1}`, text: line.trim() }] : []));
    expect(findings).toEqual([]);
  });
});
