import { useCallback, useEffect, useMemo, useState } from "react";
import type { AttributeColumn, IamUser } from "@rolust/core";

import { api } from "../api-client.js";
import type { ApiClientError } from "../api-client.js";
import { describeError, useLocale, useT } from "../i18n/index.js";
import {
  cellError,
  cellValue,
  changedCellCount,
  hasInvalidCell,
  pendingChanges,
  runWithLimit,
  setDraft,
  type AttributeDrafts,
} from "../pool-attribute-edit.js";
import { setNavigationGuard } from "../router.js";
import { toApiError } from "./useAsync.js";

/**
 * IAMユーザ画面（画面 1）の属性の編集モード（Issue #103）。
 *
 * 編集モードの間、属性のセルを入力欄にして下書きを持ち、「保存」で変更のあったユーザの属性を
 * `PUT /pool/users/attributes` へ 1 ユーザずつ（同時 4 件まで）送る。一括の API は無い。
 * 一部だけ失敗したときは、成功したユーザを確定し、失敗したユーザの行だけを編集中のまま残す。
 *
 * 未保存の下書きがあるときは、キャンセル・アプリ内の遷移（ルーターの離脱ガード）・タブを閉じる／
 * 再読込（`beforeunload`）のどれでも、黙って捨てない（GI-4）。ブラウザの戻る・進む操作は止められない。
 */

/** 同時に送る数。20 並列の削除で失敗が出た経験から、控えめにする。 */
export const SAVE_CONCURRENCY = 4;

/**
 * 編集モードの破棄確認。理由と確定ボタンの文言は文字列で持たず、種類だけを持つ（画面が描画のたびに選んだ言語で引く。
 * 確認を開いたまま言語を切り替えても追随する）。
 */
export interface DiscardPrompt {
  /** `navigate` はアプリ内の遷移（理由を添える）、`cancel` はキャンセルの確認（理由は無い）。 */
  kind: "cancel" | "navigate";
  /** 破棄を確定したときの処理。 */
  confirm: () => void;
}

export interface UseAttributeEditModeOptions {
  users: readonly IamUser[];
  columns: readonly AttributeColumn[];
  /** 保存に成功したユーザを、画面の保持するデータへ反映する（再取得はしない）。 */
  onUserSaved: (user: IamUser) => void;
  /** 全件の保存が済んで編集モードを抜けるときの通知。`count` はそのときの保存の人数。 */
  onAllSaved: (count: number) => void;
}

export function useAttributeEditMode({ users, columns, onUserSaved, onAllSaved }: UseAttributeEditModeOptions) {
  const t = useT();
  const { locale } = useLocale();
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<AttributeDrafts>({});
  const [saving, setSaving] = useState(false);
  /** ユーザの ARN → 失敗の理由。API のエラーのまま持ち、描画のたびに選んだ言語で文にする。 */
  const [failures, setFailures] = useState<Record<string, ApiClientError>>({});
  /** 今回の編集モードで保存が済んだユーザ。 */
  const [saved, setSaved] = useState<Record<string, true>>({});
  /** 直近の保存の結果（一部だけ失敗したときに警告を出す）。 */
  const [partial, setPartial] = useState<{ saved: number; failed: number } | null>(null);
  /** 値のエラーを出すセル（blur したセル。保存を押したら全セル）。 */
  const [shown, setShown] = useState<Record<string, true> | "all">({});
  const [discard, setDiscard] = useState<DiscardPrompt | null>(null);

  const changedCells = useMemo(() => changedCellCount(users, columns, drafts), [users, columns, drafts]);
  const dirty = editing && changedCells > 0;

  const exit = useCallback((): void => {
    setEditing(false);
    setDrafts({});
    setFailures({});
    setSaved({});
    setPartial(null);
    setShown({});
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
    setDrafts({});
    setFailures({});
    setSaved({});
    setPartial(null);
    setShown({});
  };

  const cancel = (): void => {
    if (!dirty) {
      exit();
      return;
    }
    setDiscard({ kind: "cancel", confirm: exit });
  };

  const setCell = (user: IamUser, columnId: string, value: string): void => {
    setDrafts((current) => setDraft(current, user, columnId, value));
    setFailures(({ [user.arn]: _failed, ...rest }) => rest);
    setSaved(({ [user.arn]: _saved, ...rest }) => rest);
  };

  const blurCell = (user: IamUser, columnId: string): void => {
    setShown((current) => (current === "all" ? current : { ...current, [`${user.arn}|${columnId}`]: true }));
  };

  /** 変更のあったユーザを送る。再送も同じ操作（保存済みのユーザは下書きが無く、対象にならない）。 */
  const save = async (): Promise<void> => {
    if (hasInvalidCell(users, columns, drafts)) {
      setShown("all");
      return;
    }
    const changes = pendingChanges(users, columns, drafts);
    if (changes.length === 0) return;

    setSaving(true);
    setPartial(null);
    const results = await runWithLimit(changes, SAVE_CONCURRENCY, (change) =>
      api.saveUserAttributes(change.user.arn, change.attributes),
    );

    const savedArns: string[] = [];
    const failed: Record<string, ApiClientError> = {};
    results.forEach((result, index) => {
      const { user } = changes[index] as (typeof changes)[number];
      if (result.status === "fulfilled") {
        savedArns.push(user.arn);
        onUserSaved(result.value.user);
      } else {
        failed[user.arn] = toApiError(result.reason);
      }
    });

    setSaving(false);
    setDrafts((current) => Object.fromEntries(Object.entries(current).filter(([arn]) => !savedArns.includes(arn))));
    setSaved((current) => ({ ...current, ...Object.fromEntries(savedArns.map((arn) => [arn, true as const])) }));
    setFailures(failed);

    const failedCount = Object.keys(failed).length;
    if (failedCount === 0) {
      exit();
      onAllSaved(savedArns.length);
    } else {
      setPartial({ saved: savedArns.length, failed: failedCount });
    }
  };

  /** セルの値のエラー（blur したセル・保存を押したあとの全セル）。出さないときは null。 */
  const errorOf = (user: IamUser, columnId: string): string | null => {
    const visible = shown === "all" || shown[`${user.arn}|${columnId}`] === true;
    return visible ? cellError(cellValue(user, drafts, columnId), locale) : null;
  };

  /** 失敗したユーザの行で、下書きのあるセルを無効の表示にする。 */
  const failedCell = (user: IamUser, columnId: string): boolean =>
    failures[user.arn] !== undefined && drafts[user.arn]?.[columnId] !== undefined;

  return {
    editing,
    saving,
    changedCells,
    dirty,
    failures: Object.fromEntries(
      Object.entries(failures).map(([arn, failure]) => [arn, describeError(locale, t, failure)]),
    ) as Record<string, string>,
    saved,
    partial,
    discard,
    start,
    cancel,
    save,
    setCell,
    blurCell,
    errorOf,
    failedCell,
    valueOf: (user: IamUser, columnId: string): string => cellValue(user, drafts, columnId),
    closeDiscard: (): void => setDiscard(null),
  };
}
