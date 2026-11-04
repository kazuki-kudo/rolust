/**
 * ボタン・チェックボックスが操作できない状態か。Cloudscape の `Button` は `disabledReason` があると、
 * `disabled` ではなく `aria-disabled="true"` で無効を表す（フォーカスできて理由が読める）ので、両方を見る。
 */
export function isBlocked(element: HTMLElement): boolean {
  return (
    (element as HTMLButtonElement | HTMLInputElement).disabled === true ||
    element.getAttribute("aria-disabled") === "true"
  );
}
