import { app } from "./ja/app.js";
import { common } from "./ja/common.js";
import { diff } from "./ja/diff.js";
import { error } from "./ja/error.js";
import { exclusion } from "./ja/exclusion.js";
import { history } from "./ja/history.js";
import { kind } from "./ja/kind.js";
import { matrix } from "./ja/matrix.js";
import { matrixGrid } from "./ja/matrixGrid.js";
import { permission } from "./ja/permission.js";
import { pool } from "./ja/pool.js";
import { roles } from "./ja/roles.js";
import { shell } from "./ja/shell.js";
import { status } from "./ja/status.js";

/**
 * 日本語のカタログ。型の正本（`Messages = typeof ja`）。領域ごとのファイル（`ja/<領域>.ts`）を束ねるだけにする。
 * 埋め込み値と単数・複数は関数で書く。文言は、移行前の画面の文言と一字一句同じにする。
 */
export const ja = {
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

export type Messages = typeof ja;
