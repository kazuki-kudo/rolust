import { app } from "./en/app.js";
import { common } from "./en/common.js";
import { diff } from "./en/diff.js";
import { error } from "./en/error.js";
import { exclusion } from "./en/exclusion.js";
import { history } from "./en/history.js";
import { kind } from "./en/kind.js";
import { matrix } from "./en/matrix.js";
import { matrixGrid } from "./en/matrixGrid.js";
import { permission } from "./en/permission.js";
import { pool } from "./en/pool.js";
import { roles } from "./en/roles.js";
import { shell } from "./en/shell.js";
import { status } from "./en/status.js";
import type { Messages } from "./ja.js";

/** 英語のカタログ。領域ごとのファイル（`en/<領域>.ts`）を束ねる。`ja` と同じ形でなければ `tsc` が落ちる。用語は PR 1 の plan の用語対応に従う。 */
export const en: Messages = {
  app,
  common,
  diff,
  error,
  exclusion,
  history,
  kind,
  matrix,
  matrixGrid,
  permission,
  pool,
  roles,
  shell,
  status,
};
