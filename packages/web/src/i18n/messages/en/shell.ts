import type { Messages } from "../ja.js";

export const shell: Messages["shell"] = {
  nav: {
    pool: "IAM users",
    roles: "IAM roles",
    matrix: "Role assignments",
    history: "Request history",
  },
  mainNavigation: "Main navigation",
  logout: "Log out",
  // eslint-disable-next-line no-restricted-syntax -- 言語切替の ARIA ラベルは、どちらの言語の利用者にも読めるよう両言語を併記する（ja と同じ値）。
  languageLabel: "言語 / Language",
  desktopOnlyHeader: "Use a desktop browser (1024px or wider)",
  desktopOnlyBody:
    "The role assignments screen is a wide table, and its columns are hard to read on a narrow screen. Rolust is desktop-only.",
};
