import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

/**
 * 画面チャンクを読み込めなかったことを表すエラー（Issue #4、`interaction-spec.md` GI-11）。
 *
 * SPA の反映では名前の変わった旧チャンクが S3 から destroy される（`deployment-strategy.md`
 * § SPA の更新順序が持つ不整合）。反映の前から開いていたタブがまだ読み込んでいない画面へ
 * 移ると `import()` が失敗する。`ScreenErrorBoundary` はこの型だけを受け止めて再読込を案内する。
 */
export class ScreenLoadError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "ScreenLoadError";
  }
}

/** 読み込みの拒否を `ScreenLoadError` に包む。失敗の場所で見分け、ブラウザの文言には依存しない。 */
export function wrapScreenLoad<T>(load: () => Promise<T>): () => Promise<T> {
  return () =>
    load().catch((error: unknown) => {
      throw new ScreenLoadError(error);
    });
}

/** `React.lazy` の代わりに使う。読み込みの失敗が `ScreenLoadError` になる。 */
export function lazyScreen<P extends object>(
  load: () => Promise<{ default: ComponentType<P> }>,
): LazyExoticComponent<ComponentType<P>> {
  return lazy(wrapScreenLoad(load));
}
