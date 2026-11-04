/**
 * IAMロール割り当ての「非表示の状態」の保存（Issue #140。spec D-1〜D-4・D-9・D-10）。
 *
 * 保存するのは、非表示のロール列と、畳んだ属性の項目だけ。ソート・フィルタ・絞り込み欄・並び順は
 * 保存しない（#91・#100・#104 の決定）。保存先はブラウザの `localStorage`（管理者ごと）。
 * React に依存しない純粋な関数だけを置く。
 */

export interface MatrixHidden {
  /** 非表示のロール ARN。 */
  roleArns: ReadonlySet<string>;
  /** 畳んだ属性の項目の `columnId`。 */
  foldedColumnIds: ReadonlySet<string>;
}

export const EMPTY_HIDDEN: MatrixHidden = {
  roleArns: new Set<string>(),
  foldedColumnIds: new Set<string>(),
};

const KEY_PREFIX = "rolust:matrix-hidden:v1:";

export function hiddenKey(identity: string): string {
  return `${KEY_PREFIX}${identity}`;
}

/** `localStorage` へのアクセスは、無効化・プライベートウィンドウで投げることがある。 */
export function getBrowserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch (cause) {
    // eslint-disable-next-line no-restricted-syntax -- 開発者向けのログ。画面には出ない
    console.warn("[rolust] localStorage を使えません。非表示の状態は保存しません", cause);
    return null;
  }
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

export function loadHidden(storage: Pick<Storage, "getItem"> | null, identity: string): MatrixHidden {
  if (storage === null) return EMPTY_HIDDEN;
  try {
    const raw = storage.getItem(hiddenKey(identity));
    if (raw === null) return EMPTY_HIDDEN;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      // eslint-disable-next-line no-restricted-syntax -- 開発者向けのログ。画面には出ない
      console.warn("[rolust] 保存した非表示の状態の形が不正です。空で始めます");
      return EMPTY_HIDDEN;
    }
    const record = parsed as Record<string, unknown>;
    return {
      roleArns: new Set(strings(record["roleArns"])),
      foldedColumnIds: new Set(strings(record["foldedColumnIds"])),
    };
  } catch (cause) {
    // eslint-disable-next-line no-restricted-syntax -- 開発者向けのログ。画面には出ない
    console.warn("[rolust] 保存した非表示の状態を読めませんでした。空で始めます", cause);
    return EMPTY_HIDDEN;
  }
}

export function saveHidden(
  storage: Pick<Storage, "setItem"> | null,
  identity: string,
  hidden: MatrixHidden,
): void {
  if (storage === null) return;
  try {
    storage.setItem(
      hiddenKey(identity),
      JSON.stringify({
        roleArns: [...hidden.roleArns].sort(),
        foldedColumnIds: [...hidden.foldedColumnIds].sort(),
      }),
    );
  } catch (cause) {
    // eslint-disable-next-line no-restricted-syntax -- 開発者向けのログ。画面には出ない
    console.warn("[rolust] 非表示の状態を保存できませんでした", cause);
  }
}

/** 現在の列（ロール ARN・属性の `columnId`）に無い値を捨てる（D-9）。変化が無ければ同じ参照を返す。 */
export function pruneHidden(
  hidden: MatrixHidden,
  roleArns: Iterable<string>,
  columnIds: Iterable<string>,
): MatrixHidden {
  const knownRoles = new Set(roleArns);
  const knownColumns = new Set(columnIds);
  const roles = [...hidden.roleArns].filter((arn) => knownRoles.has(arn));
  const folded = [...hidden.foldedColumnIds].filter((id) => knownColumns.has(id));
  if (roles.length === hidden.roleArns.size && folded.length === hidden.foldedColumnIds.size) {
    return hidden;
  }
  return { roleArns: new Set(roles), foldedColumnIds: new Set(folded) };
}

/** 選択中のロール（申請に含める列）は隠せない（D-5）。 */
export function canHideRole(roleArn: string, selected: ReadonlySet<string>): boolean {
  return !selected.has(roleArn);
}
