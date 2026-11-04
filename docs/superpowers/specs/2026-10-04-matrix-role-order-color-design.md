# 割り当てマトリクスの列（IAM ロール）の並べ替えと背景色 — 設計

- 日付: 2026-10-04
- Issue: #100（#91 から分割した、保存を伴う 2 項目）
- ブランチ: `feat/100-matrix-role-order-color`
- 状態: spec レビュー待ち

## 1. 背景と目的

割り当てマトリクス（`docs/design/` の画面 3）の列は、プールに紐づけた IAM ロールである。いまの列順は ARN の昇順で固定で、利用者が変えられない。ロールが増えると、よく使う列を左に寄せたり、系統ごとに色で見分けたりしたくなる。#91 の分割で、保存を伴うこの 2 項目を本 Issue に回した。

- **列の並べ替え**: プールごとに、紐づけたロールの列順を決められるようにする。操作は「ロールの紐づけ」モーダルに置く（Issue の案。依頼者の決定 2026-10-04）。
- **列の背景色**: ロールごとに背景色を付けられるようにする。固定パレットから選ぶ。編集はロール一覧画面に置く（依頼者の決定 2026-10-04）。

Basic 認証は共有 1 アカウントで利用者を区別できないので、どちらも**全体共通**で保存する。

### 成功基準

1. 「ロールの紐づけ」モーダルで、紐づけるロールの並び順を「上へ / 下へ」ボタンで変えて保存でき、保存後にマトリクスの列がその順に並ぶ。キーボードだけで操作できる。
2. 新しく紐づけたロールは、列の末尾に付く。紐づけを外して付け直すと、末尾に付く。
3. 並び順を持たない既存の紐づけ（本変更の前に作ったもの）は、これまでどおり ARN 昇順で並び、データの移行は要らない。モーダルを開くと、いまのマトリクスと同じ順で並び順のリストが出る。
4. ロール一覧画面で、ロールの背景色をパレットの 8 色か「なし」から選んで保存できる。色名は文字でも見える。
5. 色を付けたロールの列は、マトリクスで列全体（ヘッダとセル）に同じ色が付く。色が付いていても、ロール名・チェックボックス・差分記号（`+`／`−`）の文字のコントラスト比が 4.5:1 以上である（パレットの全色を機械判定する）。
6. 並び順の保存も色の保存も、AWS へ書き込まず、ChangeRequest を作らず、未反映の申請があるロールでも行える。
7. `PUT /pools/:poolId/roles` の既存の挙動（拒否の条件・取り込み・解除時の削除・応答の形）を変えない。`PATCH /roles` の説明だけの既存の呼び出しも変えない。
8. 実行ロールの IAM 権限を変えない（状態テーブルへの既存の `UpdateItem` だけを使う）。

## 2. 決定事項

| ID | 事項 | 決定 | 出所 |
|---|---|---|---|
| D-1 | 保存の範囲 | 並び順も色も全体共通 | Issue #100 本文。Basic 認証が共有 1 アカウントで利用者を区別できない |
| D-2 | 並び順の保存先 | `PoolRoleLink` の任意の `position`（0 始まりの整数）。未設定なら属性を持たない | Issue #100 の案。ロールは高々 1 プールにしか紐づかない（FR-1.7）ので、「プール内の順序」としてロールごとに一意に決まる |
| D-3 | 色の保存先 | `IamRole` の任意の `color`（パレットの ID）。未設定（「なし」）なら属性を持たない | Issue #100 の案。色はプールに依らないロール自身の属性で、紐づけを外しても残る |
| D-4 | 色の指定方法 | 固定パレット 8 色＋「なし」 | 依頼者の決定（2026-10-04）。コントラストを色ごとに固定でき、API は enum の検証だけで済む |
| D-5 | 並べ替えの保存の経路 | 既存の `PUT /pools/:poolId/roles` に相乗りする。送る `roleArns` の配列順を並び順とする | 依頼者の決定（2026-10-04）。未保存の確認（GI-4）・502 のときの読み直し・単一の保存ボタンをそのまま使える。API の経路を増やさず、紐づけの保存との競合の扱いも足さずに済む |
| D-6 | 並べ替えの操作 | 「上へ / 下へ」ボタン。ドラッグは採らない | 導出: キーボードと支援技術で操作できる（`frontend.md` の a11y）。Cloudscape に並べ替えの公開部品が無い |
| D-7 | 色の編集の場所 | ロール一覧画面の行から開くモーダル（説明の編集 `EditRoleDescriptionModal` と同じ形） | 依頼者の決定（2026-10-04）。説明と同じ IamRole の属性は、同じ画面で編集する |
| D-8 | 色の API | `PATCH /roles?arn=` の本文に `color`（ID または `null`）を足す。`description` と `color` は少なくとも一方を要し、無い項目は変えない | 導出: 同じ IamRole の属性の更新で、経路を増やさない。いまは `description` が必須なので、説明だけの呼び出しは変わらない |
| D-9 | 新規の紐づけの位置 | 末尾（保存の配列の順どおり。モーダルは、新しく選んだロールを並び順のリストの末尾に足す） | 導出: 既存の列を動かさない |
| D-10 | 並び順を持たない紐づけの扱い | 読み取りで、`position` を持つものの後ろに、ARN 昇順で並べる。移行はしない。その紐づけは、次にそのプールで保存したとき、最終の順に合わせて `position` を書く | 導出: `PoolRoleLink` は件数が少なく、移行の要る一括書き込みは `TransactWriteItems` が無い実行ロールでは重い。読み取りの既定が従来の ARN 順と同じなので、画面は変わらない |
| D-11 | `position` の同値 | 2 つの保存が競合して同じ値を持ったときは、ARN 昇順で決める。値の欠番・重複は許す | 導出: 楽観ロックを足さない。最終書き込みが勝つ（`CLAUDE.md` の決定済みの仕様、ChangeRequest などと同様の、共有 1 アカウントでの競合の扱い） |
| D-12 | 重複する ARN | 既存どおり、先頭を残して重複を除く（400 にしない） | 既存の `savePoolRoles` が `new Set(roleArns)` で除いている。挙動を変えない |
| D-13 | 並び順の書き込みの順 | 既存の手順の最後（手順 4.6）。足すロールの `position` は、手順 4.2 の `putRoleLink` で紐づけと同時に書く | 導出: 紐づけが最後に書かれる性質（取り込みが揃ってからマトリクスに出る）を保つ。手順 4.6 の失敗は、既存の途中失敗と同じ 502 で、再保存で直る（冪等） |
| D-14 | 並び順の読み取りの場所 | `listRoleLinks` が `position` 順に返す。呼び出し側（申請の作成・プール削除・ユーザ削除・ロールの持ち主の判定）は、集合として使うだけなので変わらない | 導出: 並び順を使うのはマトリクスとモーダルだけ。ほかは順序に依存しない |
| D-15 | 色の表示（Issue #105 により 2026-10-04 訂正。色はヘッダの行だけに付け、セルには付けない。差分記号の専用色 `ROLE_DIFF_*` は削除。訂正前は下記） | 列全体（ヘッダとセル）に同じ淡色。選択中の列のヘッダは既存の選択色（`--color-background-item-selected`）を優先し、セルは色のまま | 導出: 選択（申請に含める）は操作の状態で、装飾の色より優先する。固定したヘッダは背景が不透明でなければ行が透けるので、不透明な色にする |
| D-16 | 色だけに頼らない | 色はロールの識別に使わない（ロール名が常にヘッダにある）。色名は、ロール一覧の「背景色」列とモーダルの文字で出す。スクリーンリーダーには、列の色を読み上げさせない | 導出: 色は装飾で、情報を担わない（M-3.4・`frontend.md` の a11y と同じ趣旨）。色名の文字を一覧に出せば、色を見分けられない人も、どのロールがどの色かを把握できる |
| D-17 | テーマ | ライトテーマだけを扱う | `main.tsx` と `design-system-mapping.md` が、ダークモードを poc では扱わないとしている |
| D-18 | パレットの置き場 | `packages/core/src/role-color.ts` | 導出: API が ID を検証し、画面が色を描くので、両方が読む定数・判定関数は `packages/core` に置く |
| D-19 | 追加する ID | FR-2.5（ロールの色）・FR-3.4（列の並びと色の表示）。FR-1.7 は追記 | `CLAUDE.md`「追加は末尾」。FR-1.7 の要件文は覆さない（並び順を足すだけ） |

## 3. 設計

### 3.1 データ（`packages/core`・`packages/api/TABLE-DESIGN.md`）

**パレット（`packages/core/src/role-color.ts`）**

```ts
export const ROLE_COLORS = [
  { id: "red",    name: "赤",   background: "#fbd9d9" },
  { id: "orange", name: "橙",   background: "#fde5cc" },
  { id: "yellow", name: "黄",   background: "#fbf2c0" },
  { id: "green",  name: "緑",   background: "#d6f0d3" },
  { id: "teal",   name: "青緑", background: "#cdeeee" },
  { id: "blue",   name: "青",   background: "#d3e5fb" },
  { id: "purple", name: "紫",   background: "#e5d9f7" },
  { id: "pink",   name: "桃",   background: "#f9d9ea" },
] as const;
export type RoleColorId = (typeof ROLE_COLORS)[number]["id"];
export const ROLE_TEXT_COLOR = "#000716"; // Cloudscape のライトテーマの本文色（コントラスト判定の基準）
export function isRoleColorId(value: unknown): value is RoleColorId;
export function roleColorOf(id: RoleColorId | null): { id; name; background } | null;
export function contrastRatio(foreground: string, background: string): number; // WCAG 2.x の相対輝度
```

- 背景色の実際の値は、上の `contrastRatio` を使うテストが全色で 4.5:1 以上であることを確かめる（成功基準 5）。値は、テストが赤になったときだけ調整する。
- 差分記号の色（`--color-text-status-success` `#037f0c`、`--color-text-status-error` `#d91515`）も、各背景に対して 4.5:1 を確かめる。満たさない色の組があれば、その記号だけ文字色を濃くする（plan で実測して決める）。

**型**

- `IamRole` に `color: RoleColorId | null` を足す（`description` と同じ形。未設定は `null`）。
- `PoolRolesView` に `linkedOrder: string[]` を足す（このプールに紐づけたロールの ARN を、列の順に並べたもの。登録済みのロールだけ）。`roles`（登録済みの全ロール）は ARN 昇順のままにする。
- `MatrixView.roles` は、`position` 順（D-10）に返す。型は変えない。

**DynamoDB（状態テーブル。`TABLE-DESIGN.md` に追記する）**

- `PoolRoleLink` に任意の `position`（数値）。未設定なら属性を持たない。
- `IamRole` に任意の `color`（文字列。パレットの ID）。未設定なら属性を持たない。
- アクセスパターンを足す。
  - **25（並び順の保存）**: 紐づけを足すときは、#13 の `PutItem`（`attribute_not_exists(pk)`）に `position` を含める。すでに紐づいていて順位が変わるロールは `UpdateItem SET position = :p`（条件 `attribute_exists(pk)`。条件に外れたら、読んだ後に外されたので、何もせず次へ）。書くのは、保存後の順位が読んだ値と違うものだけ。
  - **26（ロールの色の更新）**: `UpdateItem pk = ROLE`, `sk = ROLE#<roleArn>`（`attribute_exists(pk)`）。#18 の説明の更新と同じ形で、色の有無で `SET` / `REMOVE` を切り替える。
- 読み取り（#12 の Query）は変わらず、アプリ側で `position` 昇順→無いものは ARN 昇順に並べる。`Scan` は使わない。

### 3.2 API（`packages/api`）

- **`repository/pool-role-link.ts`**
  - `listRoleLinkEntries(poolId): { roleArn; position: number | null }[]` を足す（並び順の判定に使う）。
  - `listRoleLinks(poolId)` は、それを並べた ARN の配列を返す（D-10・D-14）。
  - `putRoleLink(poolId, roleArn, now, position)` に `position` の引数を足す。
  - `setRoleLinkPosition(poolId, roleArn, position): Promise<boolean>` を足す。条件に外れたら `false`（呼び出し側は無視する）。
- **`services/pool-roles-service.ts`**
  - `getPoolRoles` が `linkedOrder` を返す。
  - `savePoolRoles` は、`requested`（重複を除いた配列の順）の添字を、そのロールの最終の `position` とする。
    - 手順 4.2: `putRoleLink` に `position` を渡す。
    - 手順 4.6（新設）: 手順 4.5 の後に、紐づけを保つロール（`current ∩ wanted`）の `position` が最終の添字と違えば `setRoleLinkPosition` で書く（D-13）。
  - 拒否（409）の判定・取り込み・応答の形は変えない。
- **`handlers/matrix.ts`**: `linkedRoles` を `linkedArns` の順に並べる（`roles.filter(...)` の ARN 順をやめる）。
- **`repository/role.ts`**: `RoleItem` と `toIamRole` に `color` を足す。`updateRoleColor(roleArn, color: RoleColorId | null)` を足す（#26。`updateRoleDescription` と同じ形）。
- **`services/role-description-service.ts`**: 説明の保存はそのまま。色は `services/role-color-service.ts`（`saveRoleColor`。ロールが無ければ `requireRole` が 404、読んだ後に削除されていれば条件付き更新が 404）に分ける。
- **`handlers/roles.ts` の `PATCH /roles`**: 本文に `description` か `color` の少なくとも一方を要する（どちらも無ければ 400）。`color` は `isRoleColorId` か `null` だけを受け、それ以外は 400。両方あれば、説明、色の順に保存する。応答は `{ role }`（`color` を含む）。
- **`GET /roles`・`GET /pools/:poolId/roles`**: `toIamRole` が `color` を含むので、応答に出る。

### 3.3 画面（`packages/web`）

**ロールの紐づけモーダル（`LinkRolesModal`）**

- 状態に、選択中のロールの並び順 `order: string[]` を足す。初期値は `linkedOrder`（読み込むたびに選択と同じく、サーバの状態にそろえる）。
- ロールのチェックを入れたら `order` の末尾に足し、外したら取り除く（D-9）。
- テーブルの下に、「並び順」のリスト（選択中のロールが 2 件以上のときだけ）を出す。各行に、ロール名と「上へ」「下へ」ボタン（先頭の「上へ」と末尾の「下へ」は無効。`aria-label` は「<ロール名> を上へ」）。
- ボタンで動かした後は、動かしたロールの同じ向きのボタンへフォーカスを戻す（行の入れ替えで DOM が動くため。端に着いて無効になったときは、反対向きのボタン）。位置の変化を `aria-live="polite"` で読み上げる（「<ロール名> を 3 番目に移動しました」）。
- 「保存」で送る配列は、`order`（`selected` の集合ではなく順序つき）。
- 「未保存の変更」の判定（GI-4）と、フッタの変更の要約は、集合の差に加えて、並び順の変更（`order` が `linkedOrder` を選択の範囲に絞った順と違う）を数える。要約の文言は「未保存の変更 n 件（紐づけ a / 解除 b / 並び順の変更あり）」とする。
- 割り当てが残るロールの解除の確認（GI-4）は変えない。

**ロール一覧画面（`RolesScreen`）**

- 「背景色」列を足す（Issue #100 の実装に合わせて 2026-10-04 訂正。訂正前は「色」列）。色が付いているロールは、見本の四角（背景色、枠線つき）と色名。無いロールは「—」。
- 説明の編集（`edit-role-description-<arn>`）と並べて、「編集」ボタン（`edit-role-color-<arn>`。aria-label は「<ロール名> の背景色を編集」）を置く（同じ来歴で訂正。訂正前は「色を編集」）。
- `EditRoleColorModal`（新規）: ロール名と、パレットの 8 色と「なし」を `Tiles`（ラジオ。各タイルは見本と色名）で選ぶ。「保存」で `PATCH /roles?arn=` に `{ color }` を送る。変更が無ければ「保存」を押せない。保存したらモーダルを閉じて、一覧を読み直す。失敗はモーダルに出して閉じない（`EditRoleDescriptionModal` と同じ）。

**マトリクス（`AssignmentMatrix`・`MatrixGrid`）**

- `MatrixColumn` に `color` を足す。`MatrixGrid` は、色のある列のヘッダと各セルの背景に `roleColorOf(color).background` を使う（D-15）。選択中のヘッダは既存の選択色を使い、セルは色のまま。
- 列の順は、`MatrixView.roles` の順（サーバが `position` 順に返す）。画面側では並べ替えない。
- 色のある列のヘッダで、ロール名の `title`・`aria-label` に色名を足さない（D-16）。
- 絞り込み・ソートのメニュー（#91）・ヘッダの固定・ローミング tabindex は変えない。

**`api-client.ts`**: `savePoolRoles` は引数を順序つきの配列として扱う（型は `string[]` のまま）。`updateRoleColor(arn, color)` を足す。

### 3.4 正本への反映（本 spec の必須節）

| 文書 | 反映 |
|---|---|
| `docs/design/requirements.md` | 冒頭に追記注記（日付・Issue #100・変更の全体像）。FR-1.7 に並び順を追記（既存の要件文は変えない）。FR-2.5（ロールの背景色）と FR-3.4（列の並びと色の表示）を足す。FR-7.2（色の編集）と FR-7.3（並び順の編集・列の色）を更新する。トレーサビリティ（FR-1.1 – FR-1.7、FR-2.1 – FR-2.5、FR-3.1 – FR-3.4 の行）に Issue #100 を足す。Data Model の IamRole の属性に `color` を足す |
| `docs/design/mockups.md` | 画面 1 のロールの紐づけモーダル（並び順のリスト）、画面 2（色の列と編集モーダル）、画面 3（列の色）を更新する |
| `docs/design/interaction-spec.md` | 並び順のボタンのフォーカスと読み上げ、色の編集モーダルのキーボード、マトリクスの色と a11y の扱いを足す |
| `docs/design/design-system-mapping.md` | 並び順のリストと色のタイル（`Tiles`）の部品の対応を足す。ダークモードを扱わないので、色もライトだけであることを注記する |
| `packages/api/TABLE-DESIGN.md` | 冒頭に追記注記。PoolRoleLink・IamRole の属性、アクセスパターン 25・26 を足す。#12 に並び順の読み取りを足す |
| `docs/design/iam-policy-design-note.md` | **なし**。状態テーブルへの `UpdateItem` は、表示名の更新（#14）・説明の更新（#18）で既に許可している。実行ロールの権限は変わらない（`infra/main.tf` の実行ロールに `dynamodb:UpdateItem` があることを、2026-10-04 に確かめた） |
| `README.md` | 機能の説明に列順・色の記述があれば更新する（plan で grep して決める。なければ「なし」） |
| 覆す ID | **なし**（FR の要件文は覆さない。追記と追加だけ） |

### 3.5 対象外

- 列のドラッグによる並べ替え（D-6）。マトリクスの列ヘッダからの並べ替え（モーダルだけ）。
- 自由な色の指定、ダークモードの色（D-4・D-17）。
- ユーザごとの並び順・色（D-1）。
- 色と並び順の変更履歴・申請への記録（AWS へ書き込まないので、ChangeRequest は作らない）。
- ユーザ行（IamUser）の並べ替え・色。

## 4. テスト方針

アプリコードは TDD で書く（失敗するテストを先に書き、失敗を確かめてから実装する）。

- **core**: `role-color` — 全色の背景に対する `ROLE_TEXT_COLOR` と差分記号の色のコントラスト比、`isRoleColorId`、`roleColorOf`、`contrastRatio` の既知値。
- **api リポジトリ・サービス**（DynamoDB はモック）:
  - `listRoleLinks` が `position` 順→ARN 順で返すこと、`position` を持たないものだけでも従来どおり ARN 順であること。
  - `savePoolRoles` が、新規の紐づけに `position` を持たせること、保つロールの順位が変わるときだけ `setRoleLinkPosition` を呼ぶこと、順位が変わらなければ書かないこと、重複を除くこと、読んだ後に外された紐づけ（条件に外れた）を無視すること。
  - 既存の拒否・取り込み・解除の回帰（`pool-roles-service.test.ts` の既存を壊さない）。
  - `getPoolRoles` が `linkedOrder` を返すこと。
  - 色の保存（`role-color-service`）が、設定・解除・ロールが無いときの 404 を扱うこと。
  - `matrix` のハンドラが列を `position` 順に返すこと。
- **api ハンドラ**: `PATCH /roles` が、説明だけ・色だけ・両方・どちらも無い（400）・不正な色（400）・色の `null`（解除）を扱うこと。`PUT /pools/:poolId/roles` が、配列の順を保存の順位にすること。
- **web**: `LinkRolesModal`（並び順のリスト・ボタンの無効化・移動後のフォーカス・新規選択の末尾・並び順だけの変更が「変更あり」・保存で順序つきの配列を送る）、`EditRoleColorModal`・`RolesScreen`（色の列・保存・失敗）、`MatrixGrid`（列とセルに色が付く・選択中のヘッダの色・色名が `aria-label` に出ない）。
- **モックの限界**: DynamoDB の条件式（`attribute_exists(pk)` で更新が拒否される経路）と、保存後の順序の読み直しは、モックでは原理的に検証できない。既存の統合テスト（`real-iam.integration.test.ts`）は実 IAM だけを対象にし、実 DynamoDB を使わない（2026-10-04 に確認）。統合テストは足さず、5 章の本番の実測で確かめる。
- **文書**は TDD の例外とし、grep などの機械的な判定で確かめる（FR-1.7・FR-2.5・FR-3.4 の追記が `requirements.md` とトレーサビリティの両方にあること、`TABLE-DESIGN.md` にアクセスパターン 25・26 があること）。
- push の前に、`CLAUDE.md` の CI と同じ検査（gitleaks、依存を変えたら npm audit）をローカルで実行する。`infra/` は変えない見込みなので、trivy は変えたときだけ。

## 5. 反映と実測

- **反映**: Lambda のコードが変わる（`infra/` の構成は変えない見込み）。plan の最終タスクに、README の手順による `terraform apply`（jump-admin / ap-northeast-1。`cd.yml` は反映しない。`cd-config.md` D-7）と実測を含める。
- **実測の対象**: 検証用のプールで、次を確かめる（ヘッドレス Playwright で、SSM（us-east-1）から取った Basic 認証を使う）。
  1. 「ロールの紐づけ」で並び順を変えて保存し、マトリクスの列が変わり、読み直しても保たれる。
  2. ロール一覧で色を付けて保存し、マトリクスの列に色が付き、ヘッダの固定・ソート・フィルタのメニューが使える。
  3. CloudTrail に、`UpdateAssumeRolePolicy` などの IAM の書き込みが無い（us-east-1。`AttributeKey=EventName` で引き、自分の `GetRole` が現れてから判断する。`shell-and-aws-cli.md`）。
- **検証用のリソース**: 管理対象のロール 3 本は常に jump-account に紐づく（1 ロール 1 プール。FR-1.7）ので、並び順の実測には、依頼者の承認を得て、検証用の IAM ロールを 2 本新規作成し、検証用のプールに紐づける。色はロール 1 本に付けて外すだけなので、検証用のロールを使う。終わったら、DynamoDB の登録（プール・ユーザ・紐づけ・持ち主・ロール）と IAM ロールを消す。承認が得られないときだけ、管理対象のロールを使う。その場合は、実測の前に各プールの紐づけの `position` と各ロールの `color` を退避し、実測の後に退避した値へ戻して（`position` が元から無かった紐づけは `REMOVE`）、復元後の一致を確かめる。本番は依頼者も同時に触るので、実測は短く行う。
- **手順書**: 依頼者が実測を引き取れるよう、plan の成果物として、画面の操作と確認項目（上の 1・2・3 と復元）の手順書を `docs/superpowers/plans/` に残す。

## 6. 影響範囲とリスク

- **既存データ**: 属性を足すだけで、移行は要らない（D-10）。`position` を持たないプールは、マトリクスの列順が従来と同じ（ARN 昇順）。
- **並行する保存**: 2 人が同じプールの順序を同時に保存すると、最後の書き込みが勝つ（D-11）。順序は表示だけの設定で、AWS の状態に影響しない。
- **書き込みの途中失敗**: 手順 4.6 の途中の失敗は 502（一部だけ保存された可能性）。順序が一部だけ変わっても、再保存で最終の順に直る。紐づけや割り当ては、この手順より前に確定している。
- **`PATCH /roles` の契約変更**: `description` を必須でなくする。既存のクライアント（web）は、説明を常に送るので影響しない。
- **色とヘッダの固定**: ヘッダの背景は不透明なので、縦スクロールで行が透けない。固定の高さの計算（#91 の D-13）は変えない。
