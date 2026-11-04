# DynamoDB を状態テーブルと申請テーブルの 2 本に分ける — 設計

- 日付: 2026-09-27
- Issue: #36
- ブランチ: `feat/36-split-tables`
- 状態: spec レビュー待ち

## 1. 背景と目的

DynamoDB は単一テーブル `rolust` に、現在の状態（UserPool・IamUser・Assignment・PoolRoleLink・IamRole・RoleLinkOwner）と申請（ChangeRequest・RoleLock）が同居している（`packages/api/TABLE-DESIGN.md`）。コンソールやエクスポートで状態と申請履歴を別々に見られ、退避・復元・作り直しをテーブル単位で分けられるようにする（見通しと運用のしやすさ）。権限の分離は目的に含まない。

### 成功基準

1. 状態と申請が別々のテーブルに保存され、画面 1〜5 がこれまでどおり動く（デプロイ先で実測する）。
2. 旧 `rolust` の状態のアイテムが `rolust-state` にすべてコピーされ、種別ごとの件数が一致する（運用者の Scan で数える）。
3. 旧 `rolust` テーブルが削除されている。削除前の on-demand バックアップがある。
4. CI（lint・型・テスト・Terraform 検証・plan-guard・trivy・gitleaks）が通る。
5. 画面と API の振る舞いは変えない。Lambda の DynamoDB の Action は変えず、`dynamodb:Scan` は引き続き付与しない。

## 2. 決定事項

| ID | 事項 | 決定 | 出所 |
|---|---|---|---|
| D-1 | テーブルの分け方 | 2 本とも新しい名前で作り直す（C 案）。`rolust-state` に UserPool・IamUser・Assignment・PoolRoleLink・IamRole・RoleLinkOwner、`rolust-change-requests` に ChangeRequest・RoleLock | Issue #36（brainstorming で合意）。RoleLinkOwner は Issue の列挙に無いが、紐づけの不変条件（TABLE-DESIGN.md「ロールの持ち主」）の片割れなので紐づけと同じ状態テーブルに置く（導出: テーブル単位で作り直したときに不変条件が崩れないようにする。RoleLock を申請と同居させる Issue の理由と同じ） |
| D-2 | データの扱い | 申請（ChangeRequest・RoleLock）は移行せず捨てる。状態のアイテムだけをコピーし、件数を突き合わせてから旧テーブルを削除する | Issue #36 |
| D-3 | キー設計 | 今のまま引き継ぐ。申請テーブルには GSI を作らず、ChangeRequest の `gsi1pk`/`gsi1sk` を書くのをやめる。アクセスパターン 10 は欠番。状態テーブルは UserPool 一覧のため `gsi1` を残す | Issue #36（叩き台）。アクセスパターン 10 は未実装で、どこからも読んでいない |
| D-4 | 命名 | Terraform 変数 `state_table_name`（既定 `rolust-state`）/ `change_request_table_name`（既定 `rolust-change-requests`）、環境変数 `ROLUST_STATE_TABLE_NAME` / `ROLUST_CHANGE_REQUEST_TABLE_NAME`、出力 `state_table_name` / `change_request_table_name`。`table_name`・`ROLUST_TABLE_NAME`・`dynamodb_table_name` は廃止 | Issue #36（叩き台） |
| D-5 | テーブル名の渡し方 | `ApiConfig` に `stateTableName` と `changeRequestTableName` を持たせ、リポジトリのファイルごとに使うテーブルを決める（`repository/change-request.ts` だけが申請テーブル） | 依頼者の承認（2026-09-27、A 案）。リポジトリはエンティティ単位のファイルに分かれており、振り分けがファイル境界と一致する |
| D-6 | 旧い環境変数 | `ROLUST_TABLE_NAME` が設定されていたら、「廃止された」と伝えて起動時に落とす | 依頼者の承認（2026-09-27）。旧い設定のまま空のテーブルを見るより原因が早く分かる（`config.ts` の fail fast の方針と同じ） |
| D-7 | 反映の順序 | 1 回の `terraform apply`（旧テーブルは `removed`・`destroy = false` で管理から外す）→ 直後にコピー。コピーが終わるまでの数分は画面が空に見えるので操作しない | 依頼者の選択（2026-09-27）。`-target` の 2 段は画面が空にならない代わりに書き込みの取りこぼしと plan-guard の 2 回化を招く |
| D-8 | コピーの方法 | コピー CLI（`migrate:split-tables`）が既存のアクセスパターンで状態のアイテムを辿り、`attribute_not_exists(pk)` の条件付き PutItem で書く。Scan を使わない | Issue #36（叩き台）、依頼者の承認（2026-09-27） |
| D-9 | 件数の突き合わせ | 運用者が `aws dynamodb scan --select COUNT` を itemType ごとと総数で旧テーブルと `rolust-state` にかけて比べる | 依頼者の選択（2026-09-27）。コピーと別の経路で全件を数えるので、アクセスパターンから辿れないアイテムがあっても取りこぼしとして見つかる。Scan を禁じているのはアプリと Lambda の実行ロール（NFR-1 / NFR-2、`iam-policy-design-note.md` 3.4）で、運用者が一度だけ行う検証は対象外と読む |
| D-10 | 既存の移行スクリプト（#19・#35） | 2 変数で動くように直す。移行ストアは状態テーブルと申請テーブルを別々に受ける | 依頼者の選択（2026-09-27） |
| D-11 | 旧テーブルを削除するまでの切り戻し | PR の revert をマージし、`terraform import aws_dynamodb_table.rolust rolust` で旧テーブルを管理に戻してから plan → plan-guard → apply。新テーブル 2 本は destroy され、反映後に書いた変更は失われる。削除後はバックアップから `rolust` を復元してから同じ操作をする | 依頼者の承認（2026-09-27） |
| D-12 | `removed` ブロックの存続 | 旧テーブルを消した後も残す | 導出: state に旧テーブルが残る別環境（第三者の古いデプロイ）でも、apply が旧テーブルを destroy せずに管理から外すだけにするため |

## 3. 設計

### 3.1 テーブル

| テーブル | エンティティ | GSI |
|---|---|---|
| `rolust-state` | UserPool・IamUser・Assignment・PoolRoleLink・IamRole・RoleLinkOwner | `gsi1`（UserPool 一覧。`gsi1pk = POOLS`） |
| `rolust-change-requests` | ChangeRequest・RoleLock | なし |

キー（`pk`/`sk`）とアイテムの形は変えない。ChangeRequest から `gsi1pk`/`gsi1sk` を除く（作成時の PutItem と、状態を変える UpdateItem の `#gsi1sk`）。PITR・SSE（AWS 管理キー）・PAY_PER_REQUEST は 2 本とも今と同じ。

RoleLock を ChangeRequest と同じテーブルに置くのは、「未反映の申請があればロックもある」（FR-4.6）という対応を 1 テーブルに閉じ、テーブル単位で作り直しても破れないようにするためである。

1 つのリクエストが 2 本のテーブルを読むことがある（紐づけの解除・IamUser の削除の可否の判定で、状態の Assignment と申請側のロールロック・申請を読む。アクセスパターン 11 など）。どちらも読み取りで、書き込みの原子性の範囲は今と変わらない（TransactWriteItems を使わない）。

### 3.2 アプリ（`packages/api`）

- `config.ts`: `ApiConfig.tableName` を `stateTableName` と `changeRequestTableName` に分ける。`ROLUST_STATE_TABLE_NAME` と `ROLUST_CHANGE_REQUEST_TABLE_NAME` はどちらも必須（前後の空白は落とし、空は未設定と同じ）。`ROLUST_TABLE_NAME` が設定されていたら `ConfigurationError`（廃止された旨と、新しい 2 変数の名前を伝える）。
- `ddb/client.ts`: `batchGetAll(tableName, operation, keys, failureMessage)` とテーブル名を引数で受ける。ロールロック（アクセスパターン 6）は申請テーブル、持ち主（アクセスパターン 15）は状態テーブル。
- リポジトリ: `repository/change-request.ts` は `changeRequestTableName`、ほか（`pool`・`assignment`・`role`・`pool-role-link`・`role-link-owner`）は `stateTableName` を使う。
- `ddb/keys.ts`: キーは変えない。`changeRequestGsi1Pk`・`changeRequestGsi1Sk` を削除し、冒頭のコメントの「単一テーブル」を直す。
- 移行ストア `migrations/dynamo-migration-store.ts`: `createDynamoMigrationStore({ stateTableName, changeRequestTableName }, region, client?)`。ロールロックと申請の BatchGet は申請テーブル、ほかは状態テーブル。`pool-role-links-cli.ts`・`role-link-owners-cli.ts` は 2 変数を読み、欠ければ終了コード 2（今と同じ）。#19 の移行は状態テーブルしか使わないが、ストアの形をそろえるため 2 変数とも要求する。
- **状態のコピー（新規）**: `migrations/split-tables.ts`（純粋な処理）・`migrations/split-tables-store.ts`（DynamoDB のストア）・`migrations/split-tables-cli.ts`・`scripts/migrate-split-tables.mjs`、npm スクリプト `migrate:split-tables`。
  - 入力: `ROLUST_LEGACY_TABLE_NAME`（旧 `rolust`）と `ROLUST_STATE_TABLE_NAME`。欠ければ終了コード 2。同じ名前なら終了コード 2。
  - 辿り方（旧テーブルから。Query は `LastEvaluatedKey` を最後まで辿る）: (1) GSI1 `gsi1pk = POOLS` でプールの一覧、(2) 各プールの `pk = POOL#<id>` を sk の接頭辞で絞らず全件（META・USER#・ASSIGN#・ROLE#）、(3) `pk = ROLE` の全件、(4) (3) のロールの `ROLELINK#<arn>` / `OWNER` を BatchGet（100 件ずつ、未処理のキーは `batchGetAllWith` で再要求し、読み切れなければ失敗）。
  - 書き込み（`--apply` のとき）: アイテムをそのまま（属性を加工せず）`attribute_not_exists(pk)` の条件付き PutItem で状態テーブルへ書く。条件で失敗したものは「既存」として数え、上書きしない。途中で失敗したら止めて表示し、終了コード 1。再実行すれば既存を飛ばして続きから書く。
  - dry-run（既定）: 何も書かず、種別（itemType）ごとの「旧テーブルで見つけた件数」「書く件数（状態テーブルに無いもの）」「既存」を表示する。dry-run でも書く件数を出すため、見つけたアイテムのキーで状態テーブルを BatchGetItem する（100 件ずつ、`batchGetAllWith`）。
  - 出力の最後に、種別ごとの件数を運用者が Scan の件数と比べられる形で表示する。
  - 使わないもの: Scan・`BatchWriteItem`・`TransactWriteItems`。
- テスト: `testing/ddb-mock.ts` は `ROLUST_STATE_TABLE_NAME = "rolust-state-test"` と `ROLUST_CHANGE_REQUEST_TABLE_NAME = "rolust-change-requests-test"` を設定し、`ROLUST_TABLE_NAME` を消す。`TableName` を検証している既存のテストは、エンティティに対応するテーブル名を検証するように直す。各リポジトリについて、送り先のテーブルを検証するテストを少なくとも 1 件ずつ持つ。コピーは、既存の移行と同じくメモリ上のストアで純粋な処理を、`aws-sdk-client-mock` でストアを検証する。

### 3.3 infra（Terraform）

- `dynamodb.tf`: `aws_dynamodb_table.state`（`var.state_table_name`、`gsi1` あり）と `aws_dynamodb_table.change_requests`（`var.change_request_table_name`、GSI なし・属性は `pk`/`sk` のみ）。旧テーブルは次で管理から外す。

  ```hcl
  removed {
    from = aws_dynamodb_table.rolust
    lifecycle {
      destroy = false
    }
  }
  ```

- `main.tf` の `dynamodb_policy`: Sid を `RolustTables` にし、Resource を `aws_dynamodb_table.state.arn`・`"${aws_dynamodb_table.state.arn}/index/*"`・`aws_dynamodb_table.change_requests.arn` にする。Action は変えない。
- `lambda.tf`: `ROLUST_STATE_TABLE_NAME` と `ROLUST_CHANGE_REQUEST_TABLE_NAME` を渡し、`ROLUST_TABLE_NAME` を渡さない。
- `variables.tf`・`terraform.tfvars.example`・`terraform.tfvars`: `table_name` を廃止し、2 変数を足す。`outputs.tf`: `dynamodb_table_name` を廃止し、`state_table_name` と `change_request_table_name` を足す。
- plan-guard のルールは変えない（`cicd-pipeline.md` の Y-2 は対象のアドレスだけ書き換える）。
- 検証: `terraform fmt -check`・`terraform validate`・trivy。実環境の plan で、旧テーブルが forget（destroy ではない）、新テーブル 2 本が create、Lambda 3 本とポリシー 3 本が update in-place であることを確かめ、plan-guard を通す。

### 3.4 反映の手順（README に節「状態テーブルと申請テーブルへの分割（Issue #36、一度だけ）」を足す）

1. 退避: `aws dynamodb create-backup --table-name rolust --backup-name rolust-before-split`。
2. 件数の控え: 旧テーブルで itemType ごと（状態 6 種別と申請 2 種別の 8 種別）と総数を `aws dynamodb scan --select COUNT` で数える。総数が 8 種別の合計と一致すること（itemType を持たないアイテムが無いこと）を確かめる。
3. 反映: README の既存の手順（plan → plan-guard → apply）。ここから手順 4 が終わるまで画面は空に見えるので、操作しない。
4. コピー: `migrate:split-tables` を dry-run → `-- --apply` → dry-run（書く件数が 0 になること）。
5. 突き合わせ: `rolust-state` で手順 2 と同じく数え、状態の 6 種別が旧テーブルと一致し、ChangeRequest・RoleLock が 0 件であることを確かめる。
6. 動作確認: 画面 1〜5 を開き、プール・マトリクス・ロール一覧が以前と同じに見えること、申請の作成と破棄が動くことを確かめる。
7. 旧テーブルの削除: `aws dynamodb delete-table --table-name rolust`。手順 1 のバックアップは残る。

#19 より前のデプロイから一気に更新する場合は、手順 4 の後に #19 → #35 の移行を実行する。申請は移さないので、#35 の分類で「未反映の申請」を理由とする割り当ての残りは常に無い（申請を捨てた事実と食い違わない）。

切り戻しは D-11。`docs/design/rollback-runbook.md` に手順を足す。

### 3.5 エラー処理

- 設定の欠落・廃止変数は起動時の `ConfigurationError`（今の fail fast と同じ）。
- コピーの途中の失敗は例外を握りつぶさず、どのアイテムで止まったかと原因を表示して終了コード 1。条件付き書き込みの失敗だけを「既存」として扱う。

## 4. テスト方針

- アプリコードは TDD（config・client・各リポジトリの送り先・移行ストア・コピーの純粋な処理とストア・CLI の引数検証）。
- Terraform は `fmt -check`・`validate`・trivy・実環境の plan と plan-guard。
- 文書は grep の機械判定: `ROLUST_TABLE_NAME`・`dynamodb_table_name`・`aws_dynamodb_table.rolust`・「単一テーブル」の残りが、`aidlc/`・`docs/superpowers/`（過去の spec・plan）・来歴の注記・`removed` ブロックと廃止の検出（`config.ts` とそのテスト）以外で 0 件。
- モックでは原理的に検証できない点（`removed` が実際に destroy しないこと、実行ロールが新テーブルに届くこと、Scan での件数一致）は、3.4 の手順を経路として実行して実測する。apply と旧テーブルの削除は、実行前にコマンドを示して依頼者の確認を得る。

## 5. 正本への反映

| 文書 | ID・節 | 種別 | 内容 |
|---|---|---|---|
| `packages/api/TABLE-DESIGN.md` | 題・冒頭 | 訂正 | 題を「DynamoDB テーブル設計」に。冒頭に追記注記（Issue #36・2026-09-27・全体像）。テーブル 2 本と環境変数 |
| 同 | キー設計 | 訂正 | 「テーブル」列を足す。ChangeRequest の `gsi1pk`/`gsi1sk` を「—」に。GSI1 の説明を状態テーブルに限る |
| 同 | アクセスパターン 10 | 欠番 | 行を残して「欠番（Issue #36）」 |
| 同 | アクセスパターン 6・11・15 | 訂正 | 読むテーブルを明記（2 本をまたぐ読み取り） |
| 同 | 計画からの逸脱・FR-4.6 のロックアイテム | 訂正 | GSI1 への言及を直し、RoleLock を申請テーブルに置く理由を足す |
| 同 | #19・#35 の移行の節 | 訂正 | 使うテーブル（状態 / 申請）を明記 |
| 同 | 末尾 | 追加 | 節「状態テーブルと申請テーブルへの分割（Issue #36）」（コピーの経路・件数の突き合わせ・`removed`） |
| `docs/design/iam-policy-design-note.md` | 3.4 | 訂正 | ポリシー例の Sid と Resource、冒頭の訂正注記 |
| `docs/design/requirements.md` | A-1・OQ-2 | 訂正 | 「単一テーブル」→「状態テーブルと申請テーブルの 2 本」 |
| `docs/design/cicd-pipeline.md` | Y-2 | 訂正 | 対象を `aws_dynamodb_table.state` と `aws_dynamodb_table.change_requests` に |
| `docs/design/rollback-runbook.md` | 漏れたロックの解放 | 訂正 | `dynamodb_table_name` → `change_request_table_name` |
| 同 | 末尾 | 追加 | 分割の切り戻し（D-11） |
| `docs/design/README.md` | TABLE-DESIGN の説明 | 訂正 | 「単一テーブル」を外す |

正本以外で同じ PR で直すもの: `README.md`（構成の記述・#19 と #35 の移行コマンド・新しい節・設計の記録の表）、`.env.example`、`infra/dynamodb.tf` の冒頭コメント。`CLAUDE.md` は該当なし。

どの訂正も来歴（「Issue #36 により 2026-09-27 訂正」）を付け、同種の古い記述は grep で総当たりする。
