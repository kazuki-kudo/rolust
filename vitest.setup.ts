// 既存のルートのテストは権限を問わない。API の権限判定（Issue #141）は ROLUST_AUTH_MODE を必須にするので、
// 既定は全権限の basic にする。権限のテストは vi.stubEnv で明示的に切り替える。
process.env.ROLUST_AUTH_MODE ??= "basic";

/**
 * Vitest のグローバルセットアップ。
 *
 * jsdom には ResizeObserver / matchMedia がないが、AWS Cloudscape の一部部品が
 * これらを参照する。存在しない場合のみ最小の実装を補う（実ブラウザの挙動は代替しない）。
 * node 環境のテストでは何もしない。
 */
if (typeof window !== "undefined") {
  if (typeof globalThis.ResizeObserver === "undefined") {
    globalThis.ResizeObserver = class ResizeObserverStub {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    } as unknown as typeof ResizeObserver;
  }

  if (typeof window.matchMedia !== "function") {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }

  if (typeof window.scrollTo !== "function") {
    window.scrollTo = (() => {}) as unknown as typeof window.scrollTo;
  }
}
