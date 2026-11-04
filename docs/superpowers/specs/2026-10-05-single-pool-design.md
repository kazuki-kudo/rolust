# ユーザプールを 1 つに固定する — 設計

Issue #108。1 つのデプロイ（CloudFront・Lambda・DynamoDB のひとまとまり）が管理する UserPool を 1 つに固定する。

## 1. 目的と前提

- **目的**: プールの一覧・作成・削除・名前変更・選択という操作と、それに伴う制約（1 ロール 1 プール）をなくし、画面と API を単純にする。
- **決定済み**（依頼者との対話、2026-10-05）:
  - 「1 つ」の意味: プールの概念を画面・API から外す。DynamoDB のキーには既存の `poolId` を固定値として残す。
  - 表示名（FR-1.6）は廃止する。
  - ロールの紐づけ（`PoolRoleLink`）は残し、`RoleLinkOwner`（1 ロール 1 プール）だけを廃止する。
  - 画面の見た目は 5 節の通り（チャットで承認済み）。
- **導出**（根拠つき。再質問しない）:
  - 本番のプールは `jump-account` の 1 つだけ（検証用に作ったプールは削除済み）。固定プールの `poolId` に `jump-account` を使えば、**データの移行は要らない**。
  - 新しい AWS API は呼ばないので、IAM の実行ロールの権限は変えない。
  - 変更の手段は、Lambda 3 系統への環境変数の追加なので、`terraform apply` が要る（`cd.yml` は反映しない。`docs/design/cd-config.md` D-7）。

## 2. 設計

### 2.1 固定プール

- 環境変数 `ROLUST_POOL_ID`（Terraform 変数 `pool_id`、必須）で `poolId` を固定する。未設定、または `isValidPoolId` に反する値なら、起動時に `ConfigurationError` で fail fast する（他の必須設定と同じ）。
- UserPool の META は、`getPool` が無いときに、条件付き Put（`attribute_not_exists(pk)`）で冪等に作る。作るときに `roleLinksInitializedAt` の印を付け、紐づけの移行の対象にならないようにする。META を作る処理は同時実行で二重に走っても、条件の失敗を「既に有る」として扱う。
- リポジトリ・サービスの関数は `poolId` の引数を**残す**（キーの組み立てとテストの変更を最小にする）。ハンドラ層が、URL の `:poolId` の代わりに設定の固定 ID を渡す。`requirePool` は、固定の ID で META を確実に作ってから返す形に改める。

### 2.2 API

`/pools` 系を単数の `/pool` に改める。`:poolId` のパラメータをなくす。

| 変更後 | 変更前 | 備考 |
|---|---|---|
| `GET /pool` | `GET /pools` | 1 つのプールの `users`・`attributeColumns`・`linkedRoleCount` を返す（`pools` の配列をやめる） |
| `POST /pool/users` | `POST /pools/:poolId/users` | 変更なし（CSV 含む） |
| `DELETE /pool/users` | `DELETE /pools/:poolId/users` | 変更なし |
| `PUT /pool/users/attributes` | `PUT /pools/:poolId/users/attributes` | 変更なし |
| `PUT /pool/attribute-columns` | `PUT /pools/:poolId/attribute-columns` | 変更なし |
| `GET` / `PUT /pool/roles` | `GET` / `PUT /pools/:poolId/roles` | `RoleLinkOwner` の検証・取得・返却を除く |
| `GET /pool/matrix` | `GET /pools/:poolId/matrix` | 変更なし |
| `PUT /pool/assignments` | `PUT /pools/:poolId/assignments` | 変更なし |
| `POST /pool/assignments/revert` | `POST /pools/:poolId/assignments/revert` | 変更なし（メソッドは現行のまま） |
| 削除 | `POST /pools`・`DELETE /pools/:poolId`・`PUT /pools/:poolId/display-name` | 作成・削除・表示名の変更をなくす |

- `GET /roles` の `linkedPool`（紐づいているプール）をなくす。紐づけの有無は `linked: boolean` とし、ロールの削除（FR-2.4）の拒否の判定は、紐づけ（`PoolRoleLink`）の有無で行う。
- 申請の作成（`POST /change-requests`）は、リクエストの `poolId` を受けず、固定の `poolId` を凍結入力に書く。凍結入力と `ChangeRequest.poolId` の型は残す（FR-4.5。過去の申請を壊さない）。
- 反映・再開・再反映は凍結入力を使う。削除済みのプールの過去の申請も動く。

### 2.3 `RoleLinkOwner` の廃止

- `ROLELINK#<roleArn>` / `OWNER` のアイテムを、読み書きしない。コード（`role-link-owner.ts`、`role-link-state.ts` の持ち主の判定、紐づけ時の取得・返却、孤児の片付け、ロールの削除での解放）を削除する。
- 本番に残る `RoleLinkOwner` のアイテムは、そのまま残す（読まれないだけ）。コードを前の版に戻すと、持ち主の検証が再び効く。既存の持ち主は 1 ロール 1 プールの不変条件を満たしたまま残っているので、戻しても整合する。
- 紐づけの保存の書き込み順は、**紐づけ → （取り込み）→ 交点の削除**の 2 段になる。持ち主の取得・返却が無いので、途中失敗で残る孤児の持ち主は生まれない。

### 2.4 `displayName` の廃止

- 名前変更の API・サービス・モーダルを削除する。META の `displayName` は読まず、書かない。既存の属性は残る（読まれないだけ）。

### 2.5 DynamoDB

- キー設計は変えない（`POOL#<poolId>`）。GSI1 の `POOLS` は読まなくなる。インデックスと権限は残す（Terraform の変更を増やさない）。
- アクセスパターン 1（プール一覧）・14（表示名の更新。移行の印は固定プールの作成時に書く）・15・16（持ち主）・17（プールの削除）は欠番にする。

### 2.6 画面（チャットで承認した見た目）

- **ユーザプール管理（`/pool`）**: カード一覧をやめ、1 枚の画面にする。ページヘッダに件数（IamUser・アカウント・紐づけロール）と、「ユーザを登録」「属性列を編集」「ロールの紐づけ」。本体は IamUser の表（属性列が 0 件ならアカウント別、1 件以上なら 1 ユーザ 1 行）。プールの作成・削除・名前変更のボタンとモーダルをなくす。empty 状態は「まだ IAM ユーザがありません」＋「ユーザを登録」。
- **割り当てマトリクス（`/matrix`）**: プール選択欄と `?pool=` をなくす。#78 の既定選択と「未選択」の案内も要らない。
- **申請履歴**: 「ユーザプール」列と `poolNames`・「削除済み」の表示をなくす。
- **IAM ロール管理**: 一覧の「紐づいているプール」の表示と、削除モーダルの紐づけ先のプール名をなくす（「紐づけを外してから削除」の案内は残す）。
- 旧 URL（`/pools`、`?pool=`）のリダイレクトは作らない。ナビゲーションの項目は変えない。
- ロールの紐づけモーダルの「ほかのプールに紐づけ済み」の行と、その説明の一文をなくす。

### 2.7 移行スクリプト

- `pool-role-links`（#19）と `role-link-owners`（#35）の移行スクリプトは、複数プールを前提とし、本番では実行済みなので**削除**する（テスト・CLI・`package.json` のスクリプトを含む）。README の該当の節は、削除した旨と来歴を残して短くする。
- `split-tables`（#36）は旧テーブルから状態テーブルへの写しで、プールの数に依らない。**残す**。

### 2.8 インフラ

- `infra/variables.tf` に `pool_id`（既定なし、書式の validation）を足し、`infra/lambda.tf` の 3 系統の環境変数に `ROLUST_POOL_ID` を足す。`terraform.tfvars.example` と README に例を足す。本番の `terraform.tfvars` は `pool_id = "jump-account"`。
- IAM ポリシーは変えない。plan-guard が赤にならないこと（Lambda の環境変数の変更だけ）を確かめる。

## 3. 正本への反映

覆す・足す ID と節（実装と同じ PR で、plan のタスクに含める。各箇所に「Issue #108 により 2026-10-05 …」の来歴と、各文書の冒頭に追記注記を足す）:

| 文書 | ID / 節 | 変更 |
|---|---|---|
| `requirements.md` | FR-1.3 | 「複数作成」を覆し、デプロイごとに固定の 1 つにする |
| 同上 | FR-1.4 | 「既存の UserPool」を「UserPool」に（意味は不変） |
| 同上 | FR-1.6 | 表示名を廃止（欠番） |
| 同上 | FR-1.7 | 「1 つの IamRole を紐づけられる UserPool は高々 1 つ」と、ほかのプールに紐づくロールの拒否を覆す。紐づけ自体は残す |
| 同上 | FR-1.8 | プールの削除を廃止（欠番） |
| 同上 | FR-1.9・FR-1.10 | 「プール」の語を固定プールに合わせる |
| 同上 | FR-2.4 | 削除の拒否理由を「紐づいている」に（持ち主の語を除く） |
| 同上 | FR-4.4・FR-5.x | `poolId` は固定プールの ID を書く。凍結入力は不変 |
| 同上 | FR-7.1 | 一覧・作成・削除・名前変更を外す |
| 同上 | FR-7.3 | プール選択と #78 の既定選択を外す |
| 同上 | FR-7.5 | 「ユーザプール」列と削除済みの表示を外す |
| 同上 | Data Model・トレーサビリティ | UserPool を「デプロイにつき 1 件」とし、`displayName` と `RoleLinkOwner` の語を除く |
| `mockups.md` | 画面 1・2・3・5、フロー | 2.6 節の通り |
| `interaction-spec.md` | プール関連の IA・遷移・状態 | 2.6 節の通り |
| `design-system-mapping.md` | プールのカード・選択欄・各モーダルの対応 | 外すものを削る |
| `iam-policy-design-note.md` | プールに触れる記述 | 権限は変えない旨の確認注記のみ |
| `packages/api/TABLE-DESIGN.md` | キー設計表、アクセスパターン 1・14〜17、「ロールの持ち主」の節、移行の節 | 2.3・2.5・2.7 節の通り。冒頭に追記注記 |
| `README.md` | セットアップの変数、制約の節（1 ロール 1 プール、プールの削除）、移行の節 | `pool_id` の説明、廃止した節の整理 |
| `docs/design/rollback-runbook.md` | 切り戻し | 前の版へ戻した場合の見え方（持ち主の検証が再び効く）を足す |

`aidlc/` は書き換えない。同種の古い記述は grep で総当たりして同じ来歴で直す。

## 4. テスト

- **アプリコードは TDD**。先にテストを書いて失敗を確かめる。削除する機能のテストは消す。
  - 固定プール: 設定の fail fast、META の冪等な作成（同時実行で条件が失敗しても成功）、各ルートが固定プールを使うこと。
  - 紐づけ: 他のプールの制約が無いこと、`linked` の判定、ロールの削除の拒否。
  - 申請: 凍結入力に固定の `poolId` が入ること、過去の `poolId`（削除済み）の申請の反映・再開が動くこと。
  - 画面: プール選択・作成・削除・名前変更が無いこと、`/pool` と `/matrix` の表示、履歴の列が無いこと。
- **モックの限界**: 実 DynamoDB の条件付き Put と、本番の API 経路は、反映後の実測で確かめる（6 節）。
- 変更に関係する CI の検査を CI と同じ版・引数でローカル実行する（gitleaks は常に、`infra/` を変えたので trivy、依存は変えないので npm audit は不要）。

## 5. 画面の見た目

チャットで承認済み（2026-10-05）。要点は 2.6 節。正本の `mockups.md` に反映するときに、枠組みの図を書き直す。

## 6. 反映と実測（plan の最終タスク）

- README の手順で `terraform apply`（jump-admin / ap-northeast-1）。`pool_id = "jump-account"` を設定する。Lambda 3 系統と SPA が変わる。
- 実測（本番は依頼者も同時に触るため、読み取り中心にする）:
  1. 画面の読み取り（ヘッドレス Playwright、Basic 認証または Cognito の現行の方式）: `/pool` に既存の IAM ユーザと属性列が出る、`/matrix` が選択欄なしで開き既存の列が出る、履歴にプール列が無い、IAM ロール管理に紐づけ先のプール名が無い。
  2. 書き込み: 使い捨てのユーザ名で登録・属性編集・削除し、元に戻す。紐づけの保存は、既存のロールを変えずに「変更なし」で保存して成功することだけ確かめる。
  3. CloudTrail（us-east-1）で `UpdateAssumeRolePolicy` が無いことを確かめる。
  4. 反映後の plan が空であること。

## 7. 範囲外

- DynamoDB のキーからの `POOL#` の除去、本番データの書き換え。
- 旧 URL のリダイレクト、`displayName`・`RoleLinkOwner` の既存アイテムの掃除。
- GSI1 の削除。
- ChangeRequest の `poolId` 欄の廃止（凍結入力の形は変えない）。

## 8. 実測の結果（2026-10-05）

- **反映**: ブランチ `feat/108-single-pool` から `terraform apply`（jump-admin / ap-northeast-1）。Lambda 3 系統（環境変数 `ROLUST_POOL_ID=jump-account` とコード）と SPA の S3 アセット（14 追加 / 4 変更 / 13 削除）。plan-guard は赤 0 件・警告 0 件、IAM の変更は 0 件。反映後の plan は `No changes`。`index.html` を無効化した。リポジトリ変数 `POOL_ID=jump-account` を設定した。
- **実測の手段**: 本番の認証は Cognito で、画面の操作には Cognito のログインが要る。そのため、画面は測らず、crud Lambda を合成した API Gateway イベントで直接呼び出して API を測った（管理者の資格情報による `aws lambda invoke`）。画面はユニットテスト（1096 件）で確かめた。配信中の `index.html` は新しい `index-CIx1WnLu.js` を指し、`PoolScreen-*.js` が S3 にあり、未認証のアクセスは 302（Cognito）。
- **読み取り**: `GET /pool` が 200（`poolId=jump-account`、IAM ユーザ 14 件、属性列 2 列、紐づけロール 5 件）。`GET /pool/matrix` が 200（14 ユーザ・5 ロール・割り当て 23 件）。`GET /roles` が 200 で、`linked` を返し `linkedPool` を返さない。`GET /change-requests` が 200（22 件。`poolNames` なし）。旧経路 `GET /pools`・`/pools/jump-account/matrix` は 404。
- **書き込み（使い捨てユーザ `rolust-verify-108`、アカウント 999999999999）**: 登録（201、createdCount 1）→ 属性の保存（200）→ `GET /pool` に属性つきで出る → 削除（200、連鎖削除した割り当て 0 件）。前後でユーザの ARN の集合は同一（14 件）。残ったアイテムなし。
- **紐づけ**: `PUT /pool/roles` を現在の紐づけの順のまま保存し、200（追加 0 / 解除 0 / 取り込み 0）。マトリクスの列の順は変わらなかった。
- **本番に残るアイテム**: META の `displayName` と `RoleLinkOwner` のアイテムは読まれず、上の応答に影響しなかった。
- **CloudTrail**（us-east-1、`AttributeKey=EventName`）: 反映後の時間帯に `UpdateAssumeRolePolicy` は 0 件。
- **実測できていないこと**: Cognito 配下の画面の目視（`/pool`・`/matrix`・`/history`・`/roles` の見た目と、`/pools` の「画面がありません」の案内）。ユニットテストでのみ確認している。
