import { useEffect, useRef, useState } from "react";
import Box from "@cloudscape-design/components/box";
import Button from "@cloudscape-design/components/button";

import { useT } from "../i18n/index.js";

export interface HiddenColumnItem {
  roleArn: string;
  roleName: string;
  /** 未反映の変更がある（隠していても、申請には入らないことを伝える）。 */
  changed: boolean;
  /** フィルタ・ソートの条件が付いている（隠した列でも行の絞り込みが効いている）。 */
  conditioned: boolean;
}

export interface HiddenColumnsStatusProps {
  items: HiddenColumnItem[];
  onShow: (roleArn: string) => void;
  onShowAll: () => void;
}

/**
 * 件数の行の「非表示 n 列」と、再表示の一覧（Issue #140。spec D-6・D-8・D-11）。
 * 一覧はボタンの直下に絶対配置で開く（ポータルにしない。スクロールで閉じる必要が無いため）。
 * 外側の押下と Escape で閉じ、Escape ではフォーカスをボタンへ戻す。
 */
export function HiddenColumnsStatus({
  items,
  onShow,
  onShowAll,
}: HiddenColumnsStatusProps): React.JSX.Element | null {
  const t = useT();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent): void => {
      if (wrapRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  // 最後の 1 件を戻して一覧が空になったら閉じる。
  useEffect(() => {
    if (items.length === 0) setOpen(false);
  }, [items.length]);

  if (items.length === 0) return null;

  const changedCount = items.filter((item) => item.changed).length;
  const summary = t.matrix.hiddenColumns.summary(items.length, changedCount);

  return (
    <span ref={wrapRef} style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={buttonRef}
        type="button"
        data-testid="matrix-hidden-button"
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={t.matrix.hiddenColumns.openListAriaLabel(summary)}
        style={{
          font: "inherit",
          cursor: "pointer",
          background: "transparent",
          border: 0,
          padding: 0,
          textDecoration: "underline",
        }}
        onClick={() => setOpen((current) => !current)}
      >
        {summary} ▾
      </button>
      {open && (
        <div
          role="group"
          aria-label={t.matrix.hiddenColumns.groupAriaLabel}
          data-testid="matrix-hidden-list"
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.stopPropagation();
            setOpen(false);
            buttonRef.current?.focus();
          }}
          style={{
            position: "absolute",
            zIndex: 1000,
            left: 0,
            top: "100%",
            marginTop: 4,
            minWidth: 300,
            padding: "0.5rem",
            background: "var(--color-background-container-content, #ffffff)",
            border: "1px solid var(--color-border-divider-default, #d1d5db)",
            borderRadius: 4,
            boxShadow: "0 4px 8px rgba(0, 0, 0, 0.15)",
          }}
        >
          {items.map((item) => (
            <div
              key={item.roleArn}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "0.75rem",
                padding: "0.125rem 0",
              }}
            >
              <span>
                {item.roleName}
                {item.changed && (
                  <Box variant="small" display="inline">
                    {" "}
                    {t.matrix.hiddenColumns.changed}
                  </Box>
                )}
                {item.conditioned && (
                  <Box variant="small" display="inline">
                    {" "}
                    {t.matrix.hiddenColumns.conditioned}
                  </Box>
                )}
              </span>
              <Button
                data-testid={`matrix-hidden-show-${item.roleArn}`}
                onClick={() => onShow(item.roleArn)}
              >
                {t.matrix.hiddenColumns.show}
              </Button>
            </div>
          ))}
          <div style={{ paddingTop: "0.25rem" }}>
            <Button data-testid="matrix-hidden-show-all" onClick={onShowAll}>
              {t.matrix.hiddenColumns.showAll}
            </Button>
          </div>
        </div>
      )}
    </span>
  );
}
