import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectPackageRoots,
  packageRootOf,
  readPackageNotice,
  renderNotices,
  thirdPartyNotices,
  type PackageNotice,
} from "./third-party-notices.js";

/**
 * SPA に取り込んだ第三者のコードのライセンスと NOTICE を、1 つの文書に集める処理のテスト（Issue #187）。
 *
 * MIT・BSD・Apache-2.0 は、コードを配るときに著作権表示と許諾文を添えることを求める。
 * バンドルにはそれが残らないので、ビルドで実際に取り込んだパッケージから文書を作る。
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rolust-notices-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** node_modules 配下にパッケージを作り、その場所を返す。 */
function makePackage(
  name: string,
  files: Record<string, string>,
  manifest: Record<string, unknown> = {},
): string {
  const root = join(dir, "node_modules", ...name.split("/"));
  mkdirSync(root, { recursive: true });
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name, version: "1.2.3", license: "MIT", ...manifest }),
  );
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  return root;
}

describe("packageRootOf", () => {
  it("node_modules 配下のモジュールから、パッケージのルートを返す", () => {
    expect(packageRootOf("/repo/node_modules/react/cjs/react.production.js")).toBe(
      "/repo/node_modules/react",
    );
  });

  it("スコープ付きパッケージは、スコープを含めてルートにする", () => {
    expect(packageRootOf("/repo/node_modules/@dnd-kit/core/dist/core.esm.js")).toBe(
      "/repo/node_modules/@dnd-kit/core",
    );
  });

  it("入れ子の node_modules は、内側のパッケージを返す", () => {
    expect(
      packageRootOf("/repo/node_modules/a/node_modules/b/index.js"),
    ).toBe("/repo/node_modules/a/node_modules/b");
  });

  it("Windows の区切り文字（\\）でも同じ判定になる", () => {
    expect(packageRootOf("C:\\repo\\node_modules\\@babel\\runtime\\helpers\\x.js")).toBe(
      "C:/repo/node_modules/@babel/runtime",
    );
  });

  it("Vite の仮想モジュールの接頭辞（\\0）とクエリを取り除く", () => {
    expect(packageRootOf("\0/repo/node_modules/clsx/dist/clsx.m.js?commonjs-es-import")).toBe(
      "/repo/node_modules/clsx",
    );
  });

  it("node_modules の外（Rolust 自身のコード）は対象にしない", () => {
    expect(packageRootOf("/repo/packages/web/src/App.tsx")).toBeUndefined();
    expect(packageRootOf("\0vite/preload-helper.js")).toBeUndefined();
  });
});

describe("collectPackageRoots", () => {
  it("同じパッケージを 1 つにまとめ、名前順に並べる", () => {
    const roots = collectPackageRoots([
      "/r/node_modules/react/index.js",
      "/r/node_modules/@a/x/index.js",
      "/r/node_modules/react/jsx-runtime.js",
      "/r/packages/web/src/App.tsx",
    ]);

    expect(roots).toEqual(["/r/node_modules/@a/x", "/r/node_modules/react"]);
  });
});

describe("readPackageNotice", () => {
  it("名前・版・ライセンス・ライセンス全文を読む", () => {
    const root = makePackage("left-pad", { LICENSE: "MIT License\r\n\r\nCopyright (c) A\r\n" });

    const notice = readPackageNotice(root);

    expect(notice).toEqual({
      name: "left-pad",
      version: "1.2.3",
      license: "MIT",
      licenseText: "MIT License\n\nCopyright (c) A",
      noticeText: undefined,
    });
  });

  it("LICENSE.md・license など、大文字小文字と拡張子の違いを許す", () => {
    expect(readPackageNotice(makePackage("a", { "LICENSE.md": "md" })).licenseText).toBe("md");
    expect(readPackageNotice(makePackage("b", { license: "lower" })).licenseText).toBe("lower");
    expect(readPackageNotice(makePackage("c", { "LICENSE.txt": "txt" })).licenseText).toBe("txt");
  });

  it("NOTICE があれば読む", () => {
    const root = makePackage(
      "cloud",
      { LICENSE: "Apache License", NOTICE: "Cloud\nCopyright Amazon\n" },
      { license: "Apache-2.0" },
    );

    expect(readPackageNotice(root).noticeText).toBe("Cloud\nCopyright Amazon");
  });

  it("package.json の license がオブジェクトでも、type を使う", () => {
    const root = makePackage("old", { LICENSE: "x" }, { license: { type: "BSD-3-Clause" } });

    expect(readPackageNotice(root).license).toBe("BSD-3-Clause");
  });

  it("license が宣言されていなくても、ファイルがあれば読む", () => {
    const root = makePackage("nodecl", { LICENSE: "x" }, { license: undefined });

    expect(readPackageNotice(root).license).toBe("(not declared)");
  });

  it("ライセンスのファイルが無ければ、パッケージの名前と版を示して失敗する", () => {
    const root = makePackage("nolicense", { "README.md": "readme" });

    expect(() => readPackageNotice(root)).toThrow(/nolicense@1\.2\.3/);
  });
});

describe("renderNotices", () => {
  const react: PackageNotice = {
    name: "react",
    version: "19.0.0",
    license: "MIT",
    licenseText: "MIT License\n\nCopyright (c) Meta",
    noticeText: undefined,
  };
  const cloud: PackageNotice = {
    name: "@cloudscape-design/components",
    version: "3.0.1",
    license: "Apache-2.0",
    licenseText: "Apache License\nVersion 2.0",
    noticeText: "Cloudscape\nCopyright Amazon",
  };

  it("パッケージを名前順に並べ、名前・版・ライセンス・全文を載せる", () => {
    const text = renderNotices([react, cloud]);

    expect(text.indexOf("@cloudscape-design/components@3.0.1")).toBeGreaterThan(-1);
    expect(text.indexOf("@cloudscape-design/components@3.0.1")).toBeLessThan(
      text.indexOf("react@19.0.0"),
    );
    expect(text).toContain("License: MIT");
    expect(text).toContain("License: Apache-2.0");
    expect(text).toContain("MIT License\n\nCopyright (c) Meta");
  });

  it("NOTICE があるパッケージにだけ、NOTICE の節を載せる", () => {
    const text = renderNotices([react, cloud]);

    expect(text).toContain("Cloudscape\nCopyright Amazon");
    expect(text.match(/^NOTICE:$/gm)).toHaveLength(1);
  });

  it("冒頭に、この文書が何かを日本語と英語で書く", () => {
    const text = renderNotices([react]);

    expect(text).toMatch(/^THIRD-PARTY NOTICES\n/);
    expect(text).toContain("第三者");
    expect(text).toContain("third-party");
  });

  it("改行は LF で、末尾は改行 1 つで終わる", () => {
    const text = renderNotices([react, cloud]);

    expect(text).not.toContain("\r");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });
});

describe("thirdPartyNotices（Vite のプラグイン）", () => {
  function run(moduleIds: string[]): { emitted: { fileName: string; source: string }[] } {
    const emitted: { fileName: string; source: string }[] = [];
    const plugin = thirdPartyNotices();
    const hook = plugin.generateBundle as (
      this: unknown,
      options: unknown,
      bundle: unknown,
    ) => void;
    const context = {
      emitFile: (file: { fileName: string; source: string }) => emitted.push(file),
      error: (message: string) => {
        throw new Error(message);
      },
    };
    const modules = Object.fromEntries(moduleIds.map((id) => [id, {}]));
    hook.call(
      context,
      {},
      {
        "assets/app.js": { type: "chunk", modules },
        "assets/app.css": { type: "asset" },
      },
    );
    return { emitted };
  }

  it("取り込んだパッケージの一覧を THIRD-PARTY-NOTICES.txt として出力する", () => {
    const react = makePackage("react", { LICENSE: "React license" });
    const clsx = makePackage("clsx", { LICENSE: "Clsx license" });

    const { emitted } = run([
      join(react, "index.js"),
      join(clsx, "dist", "clsx.js"),
      join(dir, "packages", "web", "src", "App.tsx"),
    ]);

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.fileName).toBe("THIRD-PARTY-NOTICES.txt");
    expect(emitted[0]?.source).toContain("react@1.2.3");
    expect(emitted[0]?.source).toContain("clsx@1.2.3");
    expect(emitted[0]?.source).toContain("React license");
  });

  it("同じ名前と版のパッケージが複数の場所にあっても、1 つだけ載せる", () => {
    const top = makePackage("dup", { LICENSE: "Dup license" });
    const nested = join(dir, "node_modules", "a", "node_modules", "dup");
    mkdirSync(nested, { recursive: true });
    writeFileSync(
      join(nested, "package.json"),
      JSON.stringify({ name: "dup", version: "1.2.3", license: "MIT" }),
    );
    writeFileSync(join(nested, "LICENSE"), "Dup license");

    const { emitted } = run([join(top, "index.js"), join(nested, "index.js")]);

    expect(emitted[0]?.source.match(/^dup@1\.2\.3$/gm)).toHaveLength(1);
  });

  it("ライセンスのファイルが無いパッケージがあれば、ビルドを失敗させる", () => {
    const bad = makePackage("nolicense", {});

    expect(() => run([join(bad, "index.js")])).toThrow(/nolicense@1\.2\.3/);
  });
});
