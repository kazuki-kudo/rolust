import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { errorMessagesJa } from "./index.js";

const here = fileURLToPath(new URL(".", import.meta.url));

/** `packages/core/src` と `packages/api/src` の、テストと messages 以外のソースを集める。 */
function sources(root: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    if (statSync(path).isDirectory()) {
      if (name === "messages" || name === "node_modules") continue;
      found.push(...sources(path));
    } else if (path.endsWith(".ts") && !path.endsWith(".test.ts")) {
      found.push(path);
    }
  }
  return found;
}

describe("カタログの ID の使用", () => {
  const roots = [join(here, ".."), join(here, "../../../api/src")];
  const text = roots.flatMap(sources).map((path) => readFileSync(path, "utf8")).join("\n");

  // `operator.plain` は `plainMessage()`（messages の中）経由で使うので、文字列としては現れない。
  const ids = Object.keys(errorMessagesJa).filter((id) => id !== "operator.plain");

  it.each(ids)("%s は、messages の外のソースで使われている", (id) => {
    expect(text.includes(`"${id}"`), `${id} がどこからも使われていない`).toBe(true);
  });

  it("api と core のソースは、SPA に届くエラーを文字列で作っていない", () => {
    const offenders: string[] = [];
    for (const path of roots.flatMap(sources)) {
      const body = readFileSync(path, "utf8");
      // `new ValidationError("…")` のように、最初の引数が文字列リテラル・テンプレートのもの。
      const pattern = /new (ValidationError|NotFoundError|ConflictError|StorageError|TrustPolicyParseError|InvalidStateTransitionError)\(\s*[`"]/g;
      if (pattern.test(body)) offenders.push(relative(process.cwd(), path));
    }
    expect(offenders).toEqual([]);
  });
});
