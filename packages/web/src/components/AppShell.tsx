import { useEffect, useState } from "react";
import Alert from "@cloudscape-design/components/alert";
import AppLayout from "@cloudscape-design/components/app-layout";
import Box from "@cloudscape-design/components/box";
import ButtonDropdown from "@cloudscape-design/components/button-dropdown";
import TopNavigation from "@cloudscape-design/components/top-navigation";
import {
  colorBorderDividerDefault,
  colorTextTopNavigationTitle,
  fontSizeHeadingM,
  fontWeightHeadingM,
} from "@cloudscape-design/design-tokens";
import type { Locale, MeResponse } from "@rolust/core";

import { useLocale, useT } from "../i18n/index.js";
import { navigate } from "../router.js";
import { NAV_ITEMS } from "../routes.js";

/**
 * アプリケーションシェル — トップナビゲーションとページ枠（`mockups.md` § 情報アーキテクチャ）。
 *
 * ナビは 4 項目（ユーザプール / IAMロール / IAMロール割り当て / 申請履歴）。
 * **FR-7.4 差分確認・反映はナビ項目を持たない**（`routes.ts` の `NAV_ITEMS` を参照）。
 *
 * **`TopNavigation` の使い方**（`design-system-mapping.md` のトップナビゲーションの行。当初は
 * 対応表からの逸脱だったが、Issue #26 で正本をこの実装に合わせた）: `utilities` は設定オブジェクトの
 * 配列であり `data-testid` を載せられない（ステージ本文 Critical Rules が全インタラクティブ
 * 要素に要求する）。また現在地の表現手段も持たない。そこで `TopNavigation` の
 * `children`（custom content）スロットを使い、バーの外枠は Cloudscape に委ねたまま、
 * 中身のリンクを自前で描く。`utilities` を使わないという対応表の記述とも整合する。
 *
 * DF-3: デスクトップ専用（1024px 以上）。それ未満では非対応である旨だけを表示する。
 */

const DESKTOP_MIN_WIDTH = 1024;

/** 言語名は、表示中の言語に関わらず各言語の表記で出す（カタログに置かない）。 */
const LOCALE_NAMES: Record<Locale, string> = {
  // eslint-disable-next-line no-restricted-syntax -- 言語名は各言語で表記する
  ja: "日本語",
  en: "English",
};

/** 項目の `lang` は、スクリーンリーダーが言語名をその言語の発音で読むため。 */
const LOCALE_ITEMS = (Object.keys(LOCALE_NAMES) as Locale[]).map((id) => ({ id, text: LOCALE_NAMES[id], lang: id }));

/**
 * 画面上端に固定する（Issue #133）。`AppLayout` は `headerSelector` のナビが固定である前提で、
 * 表の固定ヘッダ（`stickyHeader`）の位置をナビの高さだけ下げる。固定でないとナビが流れ去った後も
 * 上端に隙間が残り、スクロール中の行がそこを通り抜ける。z-index は Cloudscape の固定ヘッダより上。
 */
const topNavStyle: React.CSSProperties = {
  position: "sticky",
  top: 0,
  zIndex: 1002,
};

const barStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "1.5rem",
  padding: "0 1rem",
  minHeight: "3rem",
};

/**
 * 製品名（ROLUST）。右隣の画面名と見分けがつくように、Cloudscape の identity タイトルと同じ見た目
 * （見出し M のサイズ・太さ、トップナビのタイトル色）にし、右に縦線で区切る（Issue #225）。
 * 値はすべてデザイントークンで、色はこのアプリの独自の色を持たない。
 *
 * `TopNavigation` に `children` を渡すと `identity` は無視される（開発時に警告が出る）ので、
 * ブランドは `identity` ではなく、この `<span>` で描く。
 */
const brandStyle: React.CSSProperties = {
  fontSize: fontSizeHeadingM,
  fontWeight: fontWeightHeadingM,
  letterSpacing: "0.08em",
  color: colorTextTopNavigationTitle,
  lineHeight: "2rem",
  paddingRight: "1.25rem",
  borderRight: `1px solid ${colorBorderDividerDefault}`,
};

const linkBaseStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: "0.25rem 0",
  font: "inherit",
  cursor: "pointer",
  color: "inherit",
  borderBottom: "2px solid transparent",
};

export interface AppShellProps {
  /** 現在のパス。ナビの現在地表示に使う。 */
  path: string;
  /**
   * 認証方式（Issue #160）。`cognito` のときだけ、ログアウトのリンクを出す。無い（読み込み前・古い API）なら出さない。
   */
  authMode?: MeResponse["authMode"];
  children: React.ReactNode;
}

/** 1024px 以上か。`window.innerWidth` を使う（`matchMedia` 不在の環境でも動く）。 */
function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState<boolean>(
    () => typeof window === "undefined" || window.innerWidth >= DESKTOP_MIN_WIDTH,
  );

  useEffect(() => {
    const sync = (): void => setIsDesktop(window.innerWidth >= DESKTOP_MIN_WIDTH);
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, []);

  return isDesktop;
}

export function AppShell({ path, authMode, children }: AppShellProps): React.JSX.Element {
  const isDesktop = useIsDesktop();
  const t = useT();
  const { locale, setLocale } = useLocale();

  return (
    <>
      <div id="rolust-top-nav" style={topNavStyle}>
        <TopNavigation>
          <div style={barStyle}>
            <span style={brandStyle} data-testid="brand">
              ROLUST
            </span>
            <nav aria-label={t.shell.mainNavigation}>
              <ul
                style={{
                  display: "flex",
                  gap: "1.25rem",
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                }}
              >
                {NAV_ITEMS.map((item) => {
                  const current = path === item.path;
                  return (
                    <li key={item.path}>
                      <a
                        href={item.path}
                        data-testid={item.testId}
                        aria-current={current ? "page" : undefined}
                        style={{
                          ...linkBaseStyle,
                          fontWeight: current ? 700 : 400,
                          borderBottomColor: current ? "currentColor" : "transparent",
                        }}
                        onClick={(event) => {
                          // 修飾キー付きのクリックはブラウザ既定（別タブ等）に委ねる。
                          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
                          event.preventDefault();
                          navigate(item.path);
                        }}
                      >
                        {t.shell.nav[item.labelKey]}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </nav>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "1rem" }}>
              <div data-testid="locale-switch">
                <ButtonDropdown
                  // 見える文字（現在の言語名）をアクセシブルな名前に含める（WCAG 2.5.3。音声操作の「English」を拾えるように）。
                  ariaLabel={`${t.shell.languageLabel}: ${LOCALE_NAMES[locale]}`}
                  items={LOCALE_ITEMS}
                  onItemClick={({ detail }) => {
                    if (detail.id === "ja" || detail.id === "en") setLocale(detail.id);
                  }}
                >
                  {LOCALE_NAMES[locale]}
                </ButtonDropdown>
              </div>
              {authMode === "cognito" && (
                // 画面遷移にする。ルーターの navigate を通すと、Cookie を消す /logout の応答を受けられない。
                <a href="/logout" data-testid="logout-link" style={linkBaseStyle}>
                  {t.shell.logout}
                </a>
              )}
            </div>
          </div>
        </TopNavigation>
      </div>

      <AppLayout
        headerSelector="#rolust-top-nav"
        navigationHide
        toolsHide
        // "table" は Cloudscape の既定でコンテンツ幅が 100%（上限なし）。"default" は既定の上限 1280px がかかる（Issue #155 の実測）。
        contentType="table"
        content={
          isDesktop ? (
            children
          ) : (
            <div data-testid="viewport-unsupported">
              <Alert type="info" header={t.shell.desktopOnlyHeader}>
                <Box variant="p">{t.shell.desktopOnlyBody}</Box>
              </Alert>
            </div>
          )
        }
      />
    </>
  );
}
