import { useCallback, useEffect, useMemo, useState } from "react";
import type { RoleView } from "@rolust/core";

import { api } from "../api-client.js";
import type { ApiClientError } from "../api-client.js";
import { describeError, useLocale, useT } from "../i18n/index.js";
import { moveInOrder, orderChangeCount } from "../role-order.js";
import { setNavigationGuard } from "../router.js";
import type { DiscardPrompt } from "./useAttributeEditMode.js";
import { toApiError } from "./useAsync.js";

/**
 * 画面 2（IAMロール）の並び順の編集モード（FR-2.6。Issue #135）。
 *
 * 編集モードの間、行に「上へ」「下へ」を出して下書きの並びを持ち、「保存」で全登録ロールの ARN を列順で
 * `PUT /roles/order` へ 1 回で送る。保存に失敗したら編集モードに留まり、下書きを捨てない。
 *
 * 未保存の下書きがあるときは、キャンセル・アプリ内の遷移（ルーターの離脱ガード）・タブを閉じる／再読込
 * （`beforeunload`）のどれでも、黙って捨てない（GI-4。`useAttributeEditMode` と同じ。ブラウザの戻る・進む操作は
 * 止められない）。
 */

export interface UseRoleOrderEditModeOptions {
  /** サーバが返した列順のロール。 */
  roles: readonly RoleView[];
  /** 保存に成功したとき。`count` は保存した変更件数。呼び出し側が通知と一覧の読み直しを行う。 */
  onSaved: (count: number) => void;
}

export function useRoleOrderEditMode({ roles, onSaved }: UseRoleOrderEditModeOptions) {
  const t = useT();
  const { locale } = useLocale();
  const [editing, setEditing] = useState(false);
  const [order, setOrder] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  // 失敗は API のエラーのまま持ち、描画のたびに選んだ言語で文にする（言語を切り替えても追随する）。
  const [saveError, setSaveError] = useState<ApiClientError | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [discard, setDiscard] = useState<DiscardPrompt | null>(null);

  const initial = useMemo(() => roles.map((role) => role.arn), [roles]);
  const changeCount = useMemo(() => orderChangeCount(initial, order), [initial, order]);
  const dirty = editing && changeCount > 0;
  const roleNameOf = useMemo(() => new Map(roles.map((role) => [role.arn, role.roleName] as const)), [roles]);

  const exit = useCallback((): void => {
    setEditing(false);
    setOrder([]);
    setSaveError(null);
    setAnnouncement("");
    setDiscard(null);
  }, []);

  // アプリ内の遷移（ルーターの離脱ガード）と、タブを閉じる・再読込（beforeunload）。
  useEffect(() => {
    if (!dirty) return undefined;
    const removeGuard = setNavigationGuard((_to, proceed) => {
      setDiscard({
        kind: "navigate",
        confirm: () => {
          exit();
          proceed();
        },
      });
      return true;
    });
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      removeGuard();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [dirty, exit]);

  const start = (): void => {
    setEditing(true);
    setOrder(initial);
    setSaveError(null);
    setAnnouncement("");
  };

  const cancel = (): void => {
    if (!dirty) {
      exit();
      return;
    }
    setDiscard({ kind: "cancel", confirm: exit });
  };

  const move = (arn: string, direction: "up" | "down"): void => {
    const next = moveInOrder(order, arn, direction === "up" ? -1 : 1);
    setOrder(next);
    setAnnouncement(t.roles.moved(roleNameOf.get(arn) ?? arn, next.indexOf(arn) + 1));
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.reorderRoles(order);
      const count = changeCount;
      exit();
      onSaved(count);
    } catch (cause) {
      setSaveError(toApiError(cause));
    } finally {
      setSaving(false);
    }
  };

  return {
    editing,
    saving,
    order,
    changeCount,
    dirty,
    error: saveError === null ? null : describeError(locale, t, saveError),
    announcement,
    discard,
    start,
    cancel,
    move,
    save,
    closeDiscard: (): void => setDiscard(null),
  };
}
