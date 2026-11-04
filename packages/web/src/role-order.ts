/** `arn` を隣と入れ替える。端なら同じ並びを返す（Issue #100 の `moveInOrder` を画面 2 へ移した。Issue #135）。 */
export function moveInOrder(order: readonly string[], arn: string, delta: -1 | 1): string[] {
  const index = order.indexOf(arn);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= order.length) return [...order];
  const next = [...order];
  [next[index], next[target]] = [next[target] as string, next[index] as string];
  return next;
}

/** 位置が変わったロールの件数（編集モードの「変更 n 件」「保存（n 件）」）。 */
export function orderChangeCount(initial: readonly string[], current: readonly string[]): number {
  return current.filter((arn, index) => initial[index] !== arn).length;
}
