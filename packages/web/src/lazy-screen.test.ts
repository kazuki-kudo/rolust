import { describe, expect, it } from "vitest";

import { ScreenLoadError, wrapScreenLoad } from "./lazy-screen.js";

/**
 * 画面チャンクの読み込み失敗を `ScreenLoadError` に包むことのテスト（Issue #4、GI-11）。
 *
 * 反映で旧チャンクが消えると、開いたままのタブの `import()` は失敗する。失敗の場所で
 * 見分けるので、ブラウザごとに違うエラー文言には依存しない。
 */
describe("wrapScreenLoad", () => {
  it("読み込みが失敗すると ScreenLoadError で拒否し、元のエラーを cause に持つ", async () => {
    const original = new TypeError("Failed to fetch dynamically imported module");
    const load = wrapScreenLoad(() => Promise.reject(original));

    const error: unknown = await load().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ScreenLoadError);
    expect((error as ScreenLoadError).cause).toBe(original);
    expect((error as ScreenLoadError).message).toBe(
      "Failed to fetch dynamically imported module",
    );
    expect((error as ScreenLoadError).name).toBe("ScreenLoadError");
  });

  it("元のエラーが Error でなくても文言が空にならない", async () => {
    const load = wrapScreenLoad(() => Promise.reject("network down"));

    const error: unknown = await load().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ScreenLoadError);
    expect((error as ScreenLoadError).message).toBe("network down");
  });

  it("読み込みが成功すればそのまま返す", async () => {
    const module = { default: () => null };
    const load = wrapScreenLoad(() => Promise.resolve(module));

    await expect(load()).resolves.toBe(module);
  });
});
