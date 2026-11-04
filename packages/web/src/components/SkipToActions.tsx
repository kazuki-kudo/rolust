import type { CSSProperties } from "react";

import { useT } from "../i18n/index.js";

/**
 * SkipToActions — マトリクスを飛ばしてツールバーの主アクションへフォーカスを移す
 * スキップリンク（`interaction-spec.md` の component spec / a11y M-1.4）。
 *
 * 必要な理由（AN-3）: マトリクスは矢印キー移動により Tab 停止点が 1 つになるが、
 * マトリクスに入った状態からツールバーへ戻る動線は存在しない。
 * このリンクはマトリクスに入る**前**に迂回路を与える。
 *
 * Cloudscape に相当部品がないため自前実装（`design-system-mapping.md` Component Inventory）。
 */

export interface SkipToActionsProps {
  /** フォーカスを移す先の要素 id（ツールバーの「申請を作成」ボタン）。 */
  targetId: string;
  label?: string;
}

/**
 * `display: none` にはしない — フォーカス不能になりスキップリンクとして機能しない。
 * `clip-path` で視覚的にだけ隠す。
 */
const hiddenStyle: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
  border: 0,
};

const visibleStyle: CSSProperties = {
  position: "absolute",
  zIndex: 100,
  padding: "0.5rem 0.75rem",
  background: "var(--color-background-container-content, #ffffff)",
  color: "var(--color-text-link-default, #0972d3)",
  border: "2px solid var(--color-border-item-focused, #0972d3)",
  borderRadius: 4,
  whiteSpace: "nowrap",
};

export function SkipToActions({
  targetId,
  label,
}: SkipToActionsProps): React.JSX.Element {
  const t = useT();
  return (
    <a
      href={`#${targetId}`}
      data-testid="skip-to-actions"
      className="rolust-skip-link"
      style={hiddenStyle}
      onFocus={(event) => Object.assign(event.currentTarget.style, visibleStyle)}
      onBlur={(event) => {
        event.currentTarget.removeAttribute("style");
        Object.assign(event.currentTarget.style, hiddenStyle);
      }}
      onClick={(event) => {
        event.preventDefault();
        // ハッシュ遷移だけではフォーカスが移らないブラウザがあるため明示的に呼ぶ。
        document.getElementById(targetId)?.focus();
      }}
    >
      {label ?? t.common.skipToActions}
    </a>
  );
}
