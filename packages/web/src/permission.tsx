import { createContext, useContext } from "react";
import { permits, type Permission } from "@rolust/core";

/**
 * 画面が使う、呼び出した人の権限（Issue #141）。`GET /me` で読んだ値を `App` が配る。
 *
 * これは表示の都合（操作を無効にして理由を出す）にすぎない。拒否は API が行う。
 * Provider が無いときの既定は `apply`（既存の画面のテストを変えないため）。本番は `App` が必ず包み、
 * 権限を読み込めていない間は画面ごと出さないので、この既定が本番で効くことはない。
 */
const PermissionContext = createContext<Permission>("apply");

export function PermissionProvider({
  value,
  children,
}: {
  value: Permission;
  children: React.ReactNode;
}): React.JSX.Element {
  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export function usePermission(): Permission {
  return useContext(PermissionContext);
}

export function useCan(need: "view" | "edit" | "apply"): boolean {
  return permits(usePermission(), need);
}
