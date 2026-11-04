# ユーザプールの表示名と、割り当て可能な IAM ロールの紐づけ — 設計

- 日付: 2026-09-25
- Issue: #17（表示名）、#19（割り当て可能なロールの紐づけ）
- ブランチ: `feat/17-19-pool-edit`
- 状態: spec 承認済み（2026-09-25）
- 画面案: Design キャンバス「Rolust プール編集と紐づけ」（https://claude.ai/artifact/HbMCoCPkYaPZFpv519eGaE 、非公開）

## 1. 背景と目的

### 依頼の内容

- **#17**: ユーザプールの名前を後から変えたい。
- **#19**: ユーザプールごとに「割り当て可能な IAM ロール」を紐づけ、マトリクスにはそのロールだけを出したい。紐づけの編集はユーザプールの編集画面に置く。

### 前提（現状）

- `poolId` はプールの識別子であり、DynamoDB のパーティションキー（`POOL#<poolId>`）でもある。配下の IamUser・Assignment のキーと ChangeRequest の `poolId` が参照するため、変えると全件の書き換えと凍結入力（FR-4.5）との衝突が起きる（Issue #17）。
- IamRole はプールに従属しない全体の一覧（`pk = ROLE`）で、マトリクス（`GET /pools/:poolId/matrix`）は登録済みの全ロールを列に出す（`docs/design/requirements.md` の FR-3.1 と Data Model の補足）。
- CRUD Lambda の DynamoDB 権限は GetItem・PutItem・UpdateItem・DeleteItem・Query・BatchGetItem の 6 つ（`infra/main.tf` の `dynamodb_policy`）。
- デプロイ済みの環境に、既存のプールとロールがある。

### 成功基準

1. 表示名を変えると、ユーザプールの一覧・マトリクスのプール選択・申請履歴に反映される。識別子（`poolId`）は変わらない。
2. マトリクスの列が、そのプールに紐づけたロールだけになる。
3. 紐づけを外しても、AWS の信頼ポリシーに残る権限がどのマトリクスからも見えなくなる状態が生まれない（外せない条件は 2 の D-2）。
4. 移行の後、既存のプールのマトリクスの列が移行前と同じになる。
5. IAM ポリシー（`infra/`）を変えない。

## 2. 決定事項

| ID | 事項 | 決定 | 出所 |
|---|---|---|---|
| D-1 | 紐づけが 0 件のプール | マトリクスの列は 0 件（表示なし）。既存のプールには登録済みの全ロールを紐づける移行を 1 度だけ行う | 依頼者の選択（2026-09-24、Issue #19 の推奨） |
| D-2 | 紐づけを外すときに割り当てが残っている場合 | 拒否する。拒否の条件は、そのプールでそのロールの交点に `checked` または `reflected` のものが 1 件でもあるとき、またはそのロールのロールロックを持つ申請がそのプールから作ったものであるとき。どちらも無ければ、紐づけと一緒に残骸の交点（`checked` も `reflected` も false）を消す | 依頼者の選択（2026-09-24）。連鎖削除（Issue #19 の推奨）は、反映済みの権限を信頼ポリシーに残したままマトリクスから見えなくするため採らなかった |
| D-3 | 編集画面の形 | モーダル。表示名と紐づけをまとめて保存する | 依頼者の選択（2026-09-24） |
| D-4 | 移行の実行方法 | 反映の直後に運用者が一度だけ実行するスクリプト。既定は dry-run | 依頼者の選択（2026-09-24） |
| D-5 | 表示名の規則 | 任意。前後の空白を除いて 1〜64 文字、制御文字は不可、空なら未設定（画面は `poolId` を出す）。一意性は求めない。設定はプール作成時ではなく編集モーダルだけで行う | 導出: Issue #17 の「任意、未設定なら `poolId` を表示」「1〜64 文字など」「`poolId` は補助表示」「編集はユーザプールの編集画面から行う」。一意でなくても、選択の場面で `poolId` を併記するため取り違えない |
| D-6 | ロール登録後の紐づけ | ロール登録のモーダルではプールを選ばせない。登録成功の通知で、ユーザプールの編集で紐づけるよう案内する | 導出: Issue #19 の「編集画面: 登録済みロール一覧からチェックして紐づける」 |
| D-7 | 保存の API | 表示名と紐づけを 1 つの API（`PUT /pools/:poolId/settings`）で置き換える。Issue の案（`PATCH /pools/:poolId` と `PUT /pools/:poolId/roles`）から変えた | 2 回に分けると「表示名だけ保存できた」途中の状態が生まれるため（設計 2 で承認） |
| D-8 | 書き込み方 | トランザクションも `BatchWriteItem` も使わず 1 件ずつ書く。代わりに「すべて検証してから書く」順にする | IAM ポリシーを変えないため（成功基準 5、設計 1 で承認） |
| D-9 | 画面の見た目 | Design キャンバスの 6 枚のとおり | 依頼者の承認（2026-09-25） |

## 3. 設計

### 3.1 データモデルとテーブル設計

**UserPool**

- `@rolust/core` の `UserPool` に `displayName: string | null` を足す。`PoolView` と `MatrixView.pool` はこれを引き継ぐ。
- プールの META 項目（`pk = POOL#<poolId>`, `sk = META`）に 2 つの属性を持たせる。
  - `displayName`: 表示名。未設定なら属性を持たない（読み出しでは `null`）。
  - `roleLinksInitializedAt`: 移行済みの印（ISO 8601）。新しいコードで作るプールは、作成時にこの印を付ける（紐づけは 0 件）。移行スクリプトだけが読む。

**PoolRoleLink（新規）**

| 属性 | 値 |
|---|---|
| `pk` | `POOL#<poolId>` |
| `sk` | `ROLE#<roleArn>` |
| `itemType` | `PoolRoleLink` |
| `poolId`・`roleArn`・`createdAt` | — |

プールのパーティションの中に置くので、プールの紐づけは `begins_with(sk, "ROLE#")` の Query 1 本で引ける。Scan は使わない（NFR-1 / NFR-2）。紐づけはプールからロールへの多対多の関係であり、ロールをプールに従属させるものではない。

**アクセスパターン（`TABLE-DESIGN.md` の末尾に追加）**

| # | 用途 | 操作 |
|---|---|---|
| 12 | プールの紐づけ一覧 | Query `pk = POOL#<id>` / `begins_with(sk, "ROLE#")` |
| 13 | 紐づけの追加・解除 | PutItem（`attribute_not_exists(pk)`）/ DeleteItem |
| 14 | 表示名の更新・移行の印 | UpdateItem `pk = POOL#<id>`, `sk = META` |

**書き込み方（D-8）**: 1 件ずつ書く。保存が途中で失敗したときは、書けた件数と失敗を `StorageError`（502、再試行可）で返し、画面はサーバから最新の状態を読み直す。テーブルは PITR が有効（`infra/dynamodb.tf`）。

### 3.2 API と検証

すべて CRUD 系統で、AWS は呼ばない。

| API | 変更 | 中身 |
|---|---|---|
| `GET /pools` | 拡張 | 各 `PoolView` に `displayName` |
| `GET /pools/:poolId/settings` | 新設 | `PoolSettingsView`（下記） |
| `PUT /pools/:poolId/settings` | 新設 | 本文 `{ displayName: string \| null, roleArns: string[] }`。表示名と紐づけの集合を置き換える |
| `GET /pools/:poolId/matrix` | 変更 | `roles` を「紐づけ済み、かつ登録済み」に絞る。`locks` もそのロールだけ |
| `PUT /pools/:poolId/assignments` | 変更 | 紐づけていないロールは `ConflictError`（409）で拒否 |
| `POST /change-requests` | 変更 | 紐づけていないロールを理由 `not-linked` で除外する（`ExcludedRole.reason` に追加。判定の順は `not-registered` → `not-linked` → `no-changes` → ロールロック） |
| `GET /change-requests` | 拡張 | `ChangeRequestsResponse` に `poolNames: Record<string, string \| null>`（存在するプールの `poolId` → 表示名） |

**`PoolSettingsView`**

```ts
interface PoolSettingsView {
  pool: UserPool;                 // displayName を含む
  roles: PoolRoleOption[];        // 登録済みの全ロール
}
interface PoolRoleOption extends IamRole {
  linked: boolean;
  unlinkBlocker: UnlinkBlocker | null;  // 紐づけ済みで外せないときだけ
}
type UnlinkBlocker =
  | { reason: "assigned"; assignedCount: number }          // checked または reflected の交点の数
  | { reason: "unreflected-request"; changeRequestId: string };
```

外せない理由の判定（D-2）:

- **assigned**: そのプールの Assignment（アクセスパターン 3）のうち、そのロールで `checked || reflected` のものの数が 1 以上。
- **unreflected-request**: そのロールのロールロック（アクセスパターン 6）があり、ロックを持つ ChangeRequest（アクセスパターン 9）の `poolId` がこのプール。FR-4.6 により未反映の申請はロールごとに 1 件なので、この判定で漏れは無い。

**`PUT .../settings` の順序**（`GET` も含め、プールが無ければ既存の `requirePool` で 404）

1. **入力の検証（400）**: 表示名を `@rolust/core` の検証関数で正規化する（D-5、`field: "displayName"`）。`roleArns` は配列で、各要素がロールの ARN で、登録済みであること（`field: "roleArns"`）。重複は 1 件に畳む。
2. **差分**: 今の紐づけと比べて、足すロールと外すロールを出す。
3. **外す側の検証（409）**: 外すロールごとに外せない理由を判定し、1 件でもあれば**何も書かずに** `ConflictError` を返す。文言は GI-6 に従い、ロールごとに何が・なぜ・どう直すかを書く。例: 「DeployProd の紐づけを外せません。このプールにそのロールの割り当て（3 件）が残っています。マトリクスでチェックを外し、申請して反映してから外してください。」「IncidentResponder の紐づけを外せません。このプールから作った未反映の申請（cr-…）があります。反映するか、申請履歴で破棄してから外してください。」
4. **書き込み**: 表示名の更新 → 紐づけの追加 → 外すロールの紐づけと残骸の交点の削除。
5. **応答（200）**: 保存後の `PoolSettingsView` と、`{ added, removed }` の件数。

検証（手順 3）と書き込み（手順 4）の間に別の操作で交点がチェックされると、そのロールの紐づけを外した後に交点が残りうる。1 人の管理者が使う poc であり、この窓は受容する。残った交点は、マトリクスに列が無いので操作されず、紐づけ直せば再び見える。

**操作の場での検証**（`CLAUDE.md` の原則）: 紐づけていないロールは、マトリクスに出さないだけでなく、割り当ての保存と申請の作成の API でも拒否・除外する。画面を経由しない呼び出しでも、紐づけの外に割り当てが作られないようにするため。

反映（Apply）の経路は変えない。D-2 により、未反映の申請があるロールは紐づけを外せないため、反映が紐づけの外の交点の `reflected` を動かすことは無い。

### 3.3 画面

画面案は Design キャンバスの 6 枚（冒頭のリンク）。見た目は Cloudscape に似せた近似であり、実装は Cloudscape の部品の標準の描画に従う。

**画面 1（ユーザプール）** — `packages/web/src/screens/PoolsScreen.tsx`

- カードの見出しは表示名（未設定なら `poolId`）。表示名があるときは `poolId` を補助として併記する。
- 「このプールにユーザを登録」の隣に「編集」ボタン（`data-testid="edit-pool-<poolId>"`）。
- 編集モーダルは新しいファイル（`packages/web/src/screens/EditPoolModal.tsx`）に置く。`PoolsScreen.tsx` が既に 650 行あるため。
  - `GuardedModal` を使い、すべての閉じ経路で破棄確認を挟む（GI-4）。`dirty` は「表示名の入力が読み込み時と違う」または「選択の集合が読み込み時と違う」。
  - 開くと `GET .../settings` を読む。読み込み中はモーダルの中にスピナー、失敗したらモーダルの中に `ErrorPanel` と再試行。
  - 表示名: `Input`。説明に「空にすると識別子 `<poolId>` を表示します。1〜64 文字」。検証は blur 時と送信時（GI-1）。識別子は読み取り専用で添える。
  - 割り当て可能なロール: 埋め込みの `Table`、`selectionType="multi"`、`isItemDisabled`（`unlinkBlocker` があるロール）、列はロール名・AWS アカウント・状態。状態の列には外せない理由（「外せません — 割り当て N 件が残っています」「外せません — 未反映の申請があります」）。見出しに「紐づけ n / m 件」。
  - ロールが 1 件も登録されていないときは、表の代わりに IAM ロール管理（画面 2）へのリンク。
  - 保存: ボタンは保存中に「保存中」（GI-7）。成功ならモーダルを閉じて「<表示名> を保存しました（紐づけ 追加 n 件 / 解除 m 件）」を通知し、一覧を読み直す。400 / 409 ならモーダルを開いたまま中にエラーを出し、入力は保持する。502 ならエラーを出し、設定を読み直してフォームをそろえ直す。
- `/pools?edit=<poolId>` で開くと、そのプールの編集モーダルを開いた状態で表示する。閉じたら `edit` を URL から外す。

**画面 2（IAM ロール）**: 登録成功の通知に「マトリクスに出すには、ユーザプールの編集で紐づけてください」を添える（D-6）。

**画面 3（割り当てマトリクス）**

- プール選択欄: ラベルは表示名（未設定なら `poolId`）、説明は表示名があれば「`<poolId>` · IamUser n 件」、無ければ「IamUser n 件」。
- 紐づけが 0 件のとき: マトリクスを描かず、「このプールに紐づけた IAM ロールがありません」と「このプールを編集」（`/pools?edit=<poolId>` へ）を出す。今の「IamRole が 0 件のとき」の導線を置き換える。
- 除外理由 `not-linked` の文言は「このプールに紐づいていません」（`packages/web/src/labels.ts`）。

**画面 5（申請履歴）**: 詳細の「UserPool:」を「<表示名>（`<poolId>`）」にする。`poolNames` に無い、または `null` のプールは `poolId` だけ。

**表示名の出し方**: `poolLabel({ poolId, displayName })`（表示名が無ければ `poolId`）を `packages/web/src/labels.ts` に 1 か所置き、画面 1・3・5 と通知から使う。

### 3.4 移行スクリプト

- 処理本体は `packages/api/src/migrations/pool-role-links.ts`（ユニットテスト対象）、コマンドの入口は薄くする。起動は `npm run migrate:pool-role-links --workspace @rolust/api`（`-- --apply` で書き込み）。ビルドの手段は plan で決める（新しい依存は足さない。`esbuild` は既にある）。
- 設定はテーブル名（`ROLUST_TABLE_NAME`、値は `terraform output dynamodb_table_name`）と、AWS の標準の認証情報チェーン（`AWS_PROFILE`・`AWS_REGION`）だけ。今の `loadConfig` は管理対象タグも必須にしているので、移行では使わない。移行用の DynamoDB ストアがテーブル名とリージョンを引数で受ける（plan で具体化。`loadConfig` を分けてリポジトリ側を切り替えると、Lambda がタグの設定漏れで起動時に止まる fail fast が弱まるため）。
- 動き:
  - dry-run（既定）: 印（`roleLinksInitializedAt`）の無いプールと、それぞれに紐づける予定のロール数を表示する。何も書かない。
  - `--apply`: 印の無いプールごとに、登録済みの全ロールの紐づけを `attribute_not_exists(pk)` 付きで足し、最後にそのプールへ印を付ける。途中で失敗したら、そのプールには印を付けずに止め、失敗を表示する（再実行で続きから直る）。
  - 印の付いたプールは飛ばすので、何度実行しても結果は変わらず、移行後に絞り込んだ紐づけを全ロールに戻さない。
- 旧版のコードは紐づけの項目を読まない（ユーザと割り当ての Query は `USER#` / `ASSIGN#` の接頭辞で絞っている。plan で全箇所を確かめる）。コードを前の版へ戻せば元の見え方に戻る。

### 3.5 テスト

アプリのコード（`packages/`）は TDD。

- **core**: 表示名の検証関数（前後の空白の除去、1〜64 文字、制御文字、空なら `null`）。
- **api**:
  - リポジトリ: 紐づけの一覧・追加・削除、表示名の更新、作成時の印。
  - `GET .../settings`: 外せない理由の判定（`assigned` の件数、`unreflected-request` はこのプールの申請だけ、他プールの申請では外せる）。
  - `PUT .../settings`: 400 の検証、409 のときに 1 件も書かないこと、成功時に紐づけの追加・削除と残骸の交点の削除、`checked` または `reflected` の交点は消さないこと、502 の返し方。
  - マトリクスの列の絞り込み、割り当ての保存の 409、申請作成の `not-linked`、`poolNames`。
  - 移行: dry-run では書かないこと、`--apply` は印の無いプールだけを対象にすること、2 回目は何もしないこと、途中の失敗で印を付けないこと。
- **web**: 編集モーダル（読み込み・エラーと再試行・無効な行と理由・破棄確認・保存の成功 / 409 / 502）、`/pools?edit=` で開くこと、カードの見出し、マトリクスの選択欄と紐づけ 0 件、申請履歴の表示名、ロール登録の通知、除外理由の文言。

### 3.6 反映と実測（plan の最後のタスク）

モックでは確かめきれない 2 点（DynamoDB の条件式が実際に通るか、本番のデータに対する移行の結果）を実測する。terraform apply と本番データへの書き込みの直前に、それぞれ依頼者の承認を得る。

1. README の手順で反映する（`npm run build` と terraform apply）。#27（PR #30）をまだ反映していなければ、この反映に含まれるので、PR #30 の手順書の実測も行う。
2. **退避**: `aws dynamodb create-backup` でテーブルのバックアップを取る（既存の実データを書き換えるため。`CLAUDE.md` のテスト方針）。移行前のプールごとのマトリクスの列（ロール ARN の集合）を記録する。
3. 移行を dry-run → `--apply` → もう一度 dry-run（対象 0 件）の順に実行する。
4. **一致の確認**: 既存のプールすべてで、紐づけの件数が登録済みのロールの件数と一致し、マトリクスの列が手順 2 の記録と一致すること。
5. **画面での確認**: 編集モーダルで、割り当てが残るロールの行が無効になっていること、それを `PUT .../settings` で外そうとすると 409 が返り何も変わらないこと、割り当ての無いロールは外せてマトリクスから消えること、表示名が画面 1・3・5 に出ること。
6. **片付けと一致の確認**: 手順 5 で変えた紐づけと表示名を元に戻し、手順 2 の記録と一致することを確かめる。

### 3.7 範囲の外と後続への申し送り

- 範囲の外: プールの削除（#18）、ロールの削除（#22）、プール作成時の表示名の入力、カードへの紐づけ件数の表示。
- **#18 への申し送り**: プールを削除するときは、プールのパーティションの `ROLE#` 項目（紐づけ）も消す。
- **#22 への申し送り**: ロールを削除するときは、全プールの `ROLE#<roleArn>` 項目を消す。ロールから紐づけを引く索引は無いので、プールごとに GetItem / DeleteItem する（Scan は使わない）。D-2 と同じく、割り当てや未反映の申請が残るプールがあれば拒否するかを #22 で決める。

## 4. 正本への反映

各文書の冒頭に追記注記（日付・Issue・変更の全体像）を置き、各箇所に来歴（「Issue #17 / #19 により 2026-09-25 訂正／追記」）を付ける。

**覆す**

- `requirements.md`
  - FR-3.1: 列は「登録済み IamRole」から「そのプールに紐づけた IamRole」へ。
  - Data Model の補足「IamRole は UserPool に従属しない。FR-3.1 のマトリクスは登録済み IamRole の全件を列に取る……IamRole から特定の UserPool への参照は持たない」: 従属しない点は保ち、UserPool 側がロールへの紐づけ（多対多）を持つことに改める。
  - FR-7.3 の要件文「行 = IamUser・列 = IamRole」に「（そのプールに紐づけたもの）」を添える。
- `mockups.md` 画面 3 の 5 状態の empty: 「IamRole が 0 件のとき……FR-7.2 への導線」を「紐づけが 0 件のとき……プールの編集への導線」へ。

**足す**

- `requirements.md`: Data Model の UserPool の主要属性に「表示名（任意）」。FR-1 の末尾に FR-1.6（表示名の変更、D-5）と FR-1.7（割り当て可能なロールの紐づけと、外すときの拒否条件、D-2）。FR-7.1 の要件文に「表示名と割り当て可能なロールの編集」。トレーサビリティの FR-1.1 – FR-1.5 の行を FR-1.7 までに広げ、出所に Issue #17 / #19 を足す。
- `mockups.md`: 画面 1（見出しの表示名、「編集」ボタン、編集モーダルの設計判断と 5 状態）、画面 2（登録の通知）、画面 3（選択欄）、画面 5（UserPool の表示）。
- `interaction-spec.md`: FR-7.1（「編集」、モーダルの保存と閉じ経路、`/pools?edit=`、入力検証の表に表示名）、FR-7.3（選択欄、紐づけ 0 件、除外理由 `not-linked`）、FR-7.5（UserPool の表示）。
- `design-system-mapping.md`: FR-7.1（編集モーダル: `Modal`・`Form`・`FormField`・`Input`・`Table` の `selectionType="multi"` と `isItemDisabled`）、FR-7.3（`Select` の `description`）。
- `packages/api/TABLE-DESIGN.md`: キー設計の表に `PoolRoleLink`、UserPool の行に `displayName`・`roleLinksInitializedAt`、アクセスパターン 12〜14、移行の節。
- README: 移行の手順（反映の直後に一度だけ）と、「できること」の表への追記。

**該当なし**

- `iam-policy-design-note.md`: IAM ポリシーを変えない（D-8）。
