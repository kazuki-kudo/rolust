import { createContext, useContext } from "react";
import type { Actor } from "@rolust/core";

/**
 * 画面が使う、呼び出した管理者の識別子（Issue #140。`GET /me` の `actor`）。
 *
 * 表示の好み（マトリクスの非表示の状態）を管理者ごとに分けるキーに使う。`sub` は変わらない ID なので優先し、
 * `auth_mode=basic` では `name`（Authorization のユーザ名）。読み込めていない間・Provider が無いときは `null`。
 */
const ActorContext = createContext<string | null>(null);

export function identityOf(actor: Actor | null): string | null {
  return actor?.sub ?? actor?.name ?? null;
}

export function ActorProvider({
  value,
  children,
}: {
  value: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return <ActorContext.Provider value={value}>{children}</ActorContext.Provider>;
}

export function useActorKey(): string | null {
  return useContext(ActorContext);
}
