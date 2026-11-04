/**
 * 色の見本（Issue #100）。装飾なので読み上げない（色名は隣の文字で出す）。
 */
export function ColorSwatch({ background }: { background: string }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: "1rem",
        height: "1rem",
        marginRight: "0.5rem",
        verticalAlign: "middle",
        background,
        border: "1px solid var(--color-border-divider-default, #d1d5db)",
      }}
    />
  );
}
