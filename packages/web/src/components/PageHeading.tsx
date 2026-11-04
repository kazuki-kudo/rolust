import type { ReactNode } from "react";
import Box from "@cloudscape-design/components/box";
import Header from "@cloudscape-design/components/header";

export interface PageHeadingProps {
  /** 見出し（h1）。 */
  title: string;
  /** 見出しと同じ行に出す件数の文言。省略すると出さない。 */
  counts?: string;
  /** 右端の操作。省略すると出さない。 */
  actions?: ReactNode;
}

/**
 * 画面の見出し行（Issue #155）。見出し・件数・操作を 1 行に並べ、件数を見出しの下に出さない。
 * Cloudscape の `Header` は `description` を見出しの下に出すため、件数は使わず自前の行に置く。
 * 狭い幅では行を折り返す。
 */
export function PageHeading({ title, counts, actions }: PageHeadingProps): React.JSX.Element {
  return (
    <div
      data-testid="page-heading"
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        flexWrap: "wrap",
        gap: "0.5rem 1rem",
      }}
    >
      {/* 見出しと件数は折り返さない（件数が見出しの下へ落ちるのを防ぐ。実測で確かめた。Issue #155）。狭い幅では外側の行が折り返す。 */}
      <div style={{ display: "flex", alignItems: "baseline", flexWrap: "nowrap", gap: "0.5rem 1rem" }}>
        <Header variant="h1">{title}</Header>
        {counts !== undefined && (
          // 件数は縮めず、折り返さない。縮むと 2 行に割れる（実測で確かめた。Issue #155）。
          <span data-testid="page-heading-counts" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>
            <Box variant="span" color="text-body-secondary">
              {counts}
            </Box>
          </span>
        )}
      </div>
      {actions !== undefined && <div>{actions}</div>}
    </div>
  );
}
