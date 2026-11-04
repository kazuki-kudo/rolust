// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { navigate, setNavigationGuard } from "./router.js";

/**
 * ルーターの離脱ガード（Issue #103）。未保存の入力がある画面が、アプリ内の遷移を止めて確認を挟む。
 * ガードが無ければ今までどおり遷移する。
 */

afterEach(() => {
  setNavigationGuard(null);
  window.history.replaceState({}, "", "/");
});

describe("navigate と離脱ガード", () => {
  it("ガードが無ければそのまま遷移する", () => {
    navigate("/roles");
    expect(window.location.pathname).toBe("/roles");
  });

  it("ガードが false を返したら（止めない）遷移する", () => {
    const guard = vi.fn(() => false);
    setNavigationGuard(guard);
    navigate("/matrix");
    expect(guard).toHaveBeenCalledWith("/matrix", expect.any(Function));
    expect(window.location.pathname).toBe("/matrix");
  });

  it("ガードが true を返したら遷移しない。渡された proceed を呼ぶと、そのとき遷移する", () => {
    let proceed: (() => void) | null = null;
    setNavigationGuard((_to, go) => {
      proceed = go;
      return true;
    });
    navigate("/history");
    expect(window.location.pathname).toBe("/");
    proceed!();
    expect(window.location.pathname).toBe("/history");
  });

  it("解除すると、また普通に遷移する。解除の関数も使える", () => {
    const remove = setNavigationGuard(() => true);
    navigate("/roles");
    expect(window.location.pathname).toBe("/");
    remove();
    navigate("/roles");
    expect(window.location.pathname).toBe("/roles");
  });

  it("古いガードの解除は、あとから登録したガードを外さない", () => {
    const removeFirst = setNavigationGuard(() => true);
    setNavigationGuard(() => true);
    removeFirst();
    navigate("/roles");
    expect(window.location.pathname).toBe("/");
  });
});
