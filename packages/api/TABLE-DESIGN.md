# DynamoDB テーブル設計 — Rolust

> **追記**（Issue #178 により 2026-10-18 訂正）: `README.md` の手順を指していた参照を、移行手順は `docs/design/one-time-migrations.md` に、削除済みの移行スクリプトは README から削除した旨の記述に改めた。
>
> **追記**（Issue #17 / #19 により 2026-09-25）: プールとロールの紐づけ（`PoolRoleLink`）、UserPool の `displayName` と `roleLinksInitializedAt`、アクセスパターン 12〜14、紐づけの移行の節を足した。
>
> **追記**（Issue #35 により 2026-09-25）: 1 つのロールを紐づけられるプールを 1 つに限るため、ロールの持ち主のプールを引く逆引きのアイテム（`RoleLinkOwner`）、その不変条件と書き込みの順序の節、アクセスパターン 15・16、ロールの持ち主の移行の節を足した。設計は spec `docs/superpowers/specs/2026-09-25-role-single-pool-design.md`。
>
> **追記**（Issue #44 により 2026-09-26）: アクセスパターン 11（IamUser の削除）に、削除できない理由を判定するための読み取り（#3・#12・#6・#9）を足した。アイテムとキーは変えていない。
>
> **追記**（Issue #36 により 2026-09-27）: 1 本のテーブルを、状態テーブル（`rolust-state`）と申請テーブル（`rolust-change-requests`）の 2 本に分けた。キーは変えていない。キー設計に「テーブル」列を足し、ChangeRequest の GSI1 の属性を廃止してアクセスパターン 10 を欠番にした。1 リクエストで 2 本を読むアクセスパターンに読むテーブルを書き、末尾に節「状態テーブルと申請テーブルへの分割（Issue #36）」を足した。設計は spec `docs/superpowers/specs/2026-09-27-split-tables-design.md`。
>
> **追記**（Issue #18 により 2026-09-27）: ユーザプールの削除のアクセスパターン 17 と、「ロールの持ち主」の節にプールの削除での持ち主の解放を足した。アイテムとキーは変えていない。設計は spec `docs/superpowers/specs/2026-09-27-pool-deletion-design.md`。
>
> **訂正**（Issue #46 により 2026-09-27）: 紐づけの保存の API を `PUT /pools/:poolId/settings` から `PUT /pools/:poolId/roles` に、画面の名前を「このプールの編集」から「ロールの紐づけ」に改めた。アイテムとキー・アクセスパターンは変えていない。
>
> **追記**（Issue #21 により 2026-09-27）: IamRole のアイテムに任意の `description` を足し、アクセスパターン 18（説明の更新）を足した。キーは変えていない。
>
> **追記**（Issue #79・#80 により 2026-09-30）: 紐づけ時の取り込み（アクセスパターン 19）と、解除時の交点の全削除（アクセスパターン 20）を足した。「ロールの持ち主」の書き込みの順序と失敗の表に、取り込み・交点の全削除を足し、移行の節の「割り当てが残る」の説明を訂正した。アイテムとキーは変えていない。設計は spec `docs/superpowers/specs/2026-09-30-role-unlink-and-trust-import-design.md`。
>
> **追記**（Issue #22 により 2026-10-02）: IamRole の削除のアクセスパターン 21 と、#5 の行に `GET /roles` が紐づいているプールを読むこと、「ロールの持ち主」の節にロールの削除での孤児の持ち主の解放と競合の見え方を足した。アイテムとキーは変えていない。設計は spec `docs/superpowers/specs/2026-10-02-role-deletion-design.md`。
>
> **追記**（Issue #88 により 2026-10-03）: 未反映の変更の取り消しのアクセスパターン 22 を足した。キーとアイテムは変えていない。
>
> **追記**（Issue #61 により 2026-10-03）: UserPool の META に `attributeColumns`、IamUser のアイテムに `attributes` を足し、アクセスパターン 23（属性列の定義の保存）・24（ユーザの属性の保存）を足した。キーは変えていない。IamUser の登録の Put を `attribute_not_exists(pk)` 付きにし、登録済みのユーザを上書きしない（属性・作成日時を保つ）ようにした（最終レビューによる）。設計は spec `docs/superpowers/specs/2026-10-03-user-attribute-columns-design.md`。

> **追記**（Issue #100 により 2026-10-04）: PoolRoleLink に任意の `position`（列の並び順）、IamRole に任意の `color`（背景色。固定パレットの ID）を足し、アクセスパターン 25（並び順の保存）・26（ロールの色の更新）を足した。#12 の読み取りに並び順の整列を足した。キーは変えていない。設計は spec `docs/superpowers/specs/2026-10-04-matrix-role-order-color-design.md`。

> **追記**（Issue #108 により 2026-10-05）: ユーザプールをデプロイにつき固定の 1 つにした（環境変数 `ROLUST_POOL_ID`。Terraform 変数 `pool_id`）。キーとアイテムの形は変えない（`POOL#<poolId>` の `poolId` が固定値になる）。UserPool の `displayName` と、ロールの持ち主（`RoleLinkOwner`）を廃止し、既存のアイテムは残して読まない。アクセスパターン 1・15・16・17 を欠番にし、14 の表示名の更新をなくし、5・19・20・21 から持ち主の記述を外し、固定プールを確保するアクセスパターン 27 を足した。「ロールの持ち主」の節と、紐づけ・持ち主の移行の節に廃止の注記を足した。設計は spec `docs/superpowers/specs/2026-10-05-single-pool-design.md`。

> **追記**（Issue #120 により 2026-10-05）: ChangeRequest に属性 `createdBy`・`appliedBy`（Map `{ name, sub? }`。無い、または null は実行者なし）を足した。キー・GSI・アクセスパターンは変えていない。末尾に節「ChangeRequest の実行者（Issue #120）」を足した。

> **追記**（Issue #121 により 2026-10-06）: ChangeRequest に任意の `applyingToken`・`applyingUntil`（反映の claim）を足し、アクセスパターン 28 を足した。キー・GSI は変えない。末尾に節「ChangeRequest の同時操作（Issue #121）」を足した。設計は spec `docs/superpowers/specs/2026-10-06-concurrent-admin-exclusion-design.md`。

> **訂正**（Issue #135 により 2026-10-07）: 登録した IAM ロールを無条件にユーザプールへ紐づけ、「ロールの紐づけ」（`PUT /pool/roles`）を廃止した。アイテムとキー（`PoolRoleLink`・`IamRole` ほか）は変えない。`PoolRoleLink` は、列の並び順 `position` を持つ記録として残り、登録（`POST /roles`）が作り、削除（`DELETE /roles`）が消す。アクセスパターン 13（書き手）・19（登録時の取り込み）・20（削除時の交点の削除）・21（削除の判定と順序）・25（並び順の保存。`PUT /roles/order`）と、5（一覧は列順）を訂正した。紐づけを持たない登録済みロール（Issue #135 より前に、紐づけを外したもの）は、`GET /roles` では末尾に出て、割り当ての保存は 409 になる。直し方は、削除して登録し直すか、移行スクリプト（`npm run migrate:link-registered-roles --workspace @rolust/api`。`docs/design/one-time-migrations.md`（Issue #178 により 2026-10-18 訂正。訂正前は README）。登録と同じ書き込みで、取り込みと末尾への紐づけを行う）を使うこと。設計は spec `docs/superpowers/specs/2026-10-07-auto-link-roles-design.md`。

> **追記**（Issue #150 により 2026-10-08）: IamRole のアイテムに任意の `displayName`（表示名。FR-2.7）を足した。キーは変えず、移行は無い。アクセスパターン 5（一覧は `displayName` を返す）・13（登録の PutItem に含めてよい）・18（説明の更新を「説明・表示名の更新」に改める。`SET` / `REMOVE` を属性ごとに切り替える）を訂正した。

> **追記**（Issue #94 により 2026-10-15）: ChangeRequest の `result`（反映結果）に任意の `localized`（言語に依らない文言の `{ id, params }`）を足した。キー・GSI・アクセスパターンは変えない。移行は要らない（任意属性）。末尾に節「ChangeRequest の反映結果の localized（Issue #94）」を足した。

>
> **追記**（Issue #170 により 2026-10-15）: アクセスパターン 29（乖離の確認）を足した。既存のアクセスパターン（#5・#12・#2・#3）の読み取りの組み合わせだけで、書き込みはない。結果は保存しない（使い捨て）。**テーブル・キー・属性は変えない**。設計は spec `docs/superpowers/specs/2026-10-15-trust-drift-check-design.md`。
>
> **追記**（Issue #172 により 2026-10-16）: ChangeRequest に任意の属性 `kind`（`restore`・`adopt`。無ければ通常）を足し、アクセスパターン 30（乖離を直す `restore`）・31（記録を IAM に合わせる `adopt`）を足した。**テーブル・キー・GSI は変えない**。移行は要らない（任意属性）。末尾に節「ChangeRequest の種別（Issue #172）」を足した。設計は spec `docs/superpowers/specs/2026-10-16-drift-repair-design.md`。

**採用根拠**: `code-generation-questions.md` 質問 1 = `A`（DynamoDB 単一テーブル設計）。
requirements.md の C-1（DynamoDB を第一候補）と A-1（DynamoDB で表現可能か）の検証責任は
code-generation にある。本書はその検証結果である。

テーブルは 2 本（Issue #36 により 2026-09-27 訂正: 当初は 1 本の `rolust`、環境変数 `ROLUST_TABLE_NAME` だった）。課金モードはどちらも PAY_PER_REQUEST。

| テーブル | 既定名 | 環境変数 | エンティティ | GSI |
|---|---|---|---|---|
| 状態 | `rolust-state` | `ROLUST_STATE_TABLE_NAME` | UserPool・IamUser・Assignment・PoolRoleLink・IamRole・RoleLinkOwner | `gsi1` |
| 申請 | `rolust-change-requests` | `ROLUST_CHANGE_REQUEST_TABLE_NAME` | ChangeRequest・RoleLock | なし |

## キー設計

| テーブル | エンティティ | `pk` | `sk` | `gsi1pk` | `gsi1sk` |
|---|---|---|---|---|---|
| 状態 | UserPool（Issue #108 により 2026-10-05: デプロイにつき固定の 1 件。`poolId` は `ROLUST_POOL_ID`） | `POOL#<poolId>` | `META` | `POOLS` | `POOL#<poolId>` |
| 状態 | IamUser | `POOL#<poolId>` | `USER#<userArn>` | — | — |
| 状態 | Assignment | `POOL#<poolId>` | `ASSIGN#<userArn>#<roleArn>` | — | — |
| 状態 | IamRole | `ROLE` | `ROLE#<roleArn>` | — | — |
| 申請 | ChangeRequest | `CR` | `CR#<changeRequestId>` | `—`（Issue #36 により 2026-09-27 廃止） | `—`（Issue #36 により 2026-09-27 廃止） |
| 申請 | RoleLock（FR-4.6） | `ROLELOCK#<roleArn>` | `UNREFLECTED` | — | — |
| 状態 | PoolRoleLink（FR-1.7） | `POOL#<poolId>` | `ROLE#<roleArn>` | — | — |
| 状態 | RoleLinkOwner（FR-1.7。Issue #35 により 2026-09-25 追記。Issue #108 により 2026-10-05 に廃止。既存のアイテムは残り、読まない） | `ROLELINK#<roleArn>` | `OWNER` | — | — |

GSI1 は状態テーブルにだけあり、`gsi1pk` を持つアイテム（UserPool）のみを射影する疎なインデックスである（Issue #36 により 2026-09-27 訂正）。

UserPool の META アイテムは、移行済みの印 `roleLinksInitializedAt`（下記「プールとロールの紐づけの移行」）を持つ（Issue #17 / #19 により 2026-09-25 追記）。（Issue #108 により 2026-10-05: 任意の `displayName`（FR-1.6）は廃止した。本番の META に残る属性は読まず、書かない。）

IamRole のアイテムは、任意の `description`（FR-2.3。未設定なら属性を持たない）を持つ（Issue #21 により 2026-09-27 追記）。任意の `displayName`（表示名。FR-2.7。任意の文字列。未設定なら属性を持たない）も持つ（Issue #150 により 2026-10-08 追記）。

PoolRoleLink のアイテムは、任意の `position`（0 始まりの整数。マトリクスの列の並び順）を持つ。未設定なら属性を持たず、読み取りで、`position` を持つものの後ろに ARN 昇順（コード単位）で並べる。同じ値は ARN 昇順で決める。値の欠番・重複は許す。並び順の保存（アクセスパターン 25。登録時の末尾の順位は #19・#13）が最終の順位を書き（Issue #135 により 2026-10-07 訂正。訂正前は「紐づけの保存（アクセスパターン 19・20）が最終の順位を書き」）、`position` を持たない既存の紐づけは次の保存で書かれる（移行はしない）。IamRole のアイテムは、任意の `color`（固定パレットの ID。`red` `orange` `yellow` `green` `teal` `blue` `purple` `pink`）を持つ。未設定なら属性を持たず、読み取りで、パレットにない値は未設定として扱う（Issue #100 により 2026-10-04 追記）。

UserPool の META アイテムは、任意の `attributeColumns`（`[{ columnId, name }]`。IAM ユーザの属性列の定義。追加順、最大 10 列。未設定なら属性を持たない）を持つ。IamUser のアイテムは、任意の `attributes`（`{ <columnId>: 値 }`。値の無い列は持たない。未設定なら属性を持たない）を持つ。値を列の安定 ID で持つので、列の名前を変えても値は残る。列を削除しても IamUser のアイテムは書き換えず、読み取りで定義に無い `columnId` の値を無視し、そのユーザの属性を次に保存するときに書かない（Issue #61 により 2026-10-03 追記）。

## アクセスパターン

| # | 用途 | 操作 | 要件 |
|---|---|---|---|
| 1 | （欠番。Issue #108 により 2026-10-05: UserPool 一覧。固定の 1 件を #27 で確保する） | — | — |
| 2 | プール配下の IamUser 一覧 | Query `pk = POOL#<id>` / `begins_with(sk, "USER#")` | FR-1.1, FR-1.4 |
| 3 | プールの Assignment 一覧（マトリクス） | Query `pk = POOL#<id>` / `begins_with(sk, "ASSIGN#")` | FR-3.1 |
| 4 | 交点 1 件の保存 | UpdateItem `pk = POOL#<id>`, `sk = ASSIGN#<u>#<r>` | FR-3.2, MQ-4 |
| 5 | IamRole 一覧 | Query `pk = ROLE`。`GET /roles` は、固定プールの紐づけを #12 で引き、列順（position 順）に整列し、各ロールの割り当ての件数（`assignments`）を #3 の Assignment 一覧から数える。（Issue #135 により 2026-10-07 訂正。訂正前は、各ロールの `linked`（紐づいているか）を決めた。Issue #22 により 2026-10-02 追記。Issue #108 により 2026-10-05 訂正: 訂正前は、各ロールの紐づいているプール（`linkedPool`）のために #15 で持ち主を引き、持ち主のプールごとに #12 で紐づけを確かめ、紐づいたロールがあるときだけ #1 で表示名を引いた）。各ロールの `displayName` も返す（Issue #150 により 2026-10-08 追記） | FR-2.1, FR-7.2 |
| 6 | ロール別の未反映申請（一覧の「未反映の申請」列） | BatchGetItem on `ROLELOCK#<roleArn>`（申請テーブル） | FR-4.6, FR-7.2 |
| 7 | 未反映申請の排他取得（申請作成） | PutItem `ROLELOCK#<roleArn>` + `attribute_not_exists(pk)`（申請テーブル） | FR-4.6 |
| 8 | ChangeRequest 全件（申請履歴） | Query `pk = CR`（`LastEvaluatedKey` の最後まで辿る。Issue #116 により 2026-10-06 追記。`createdFrom` はアプリ側の絞り込みで、読む量は変えない） | FR-7.5 |
| 9 | ChangeRequest 1 件 | GetItem `pk = CR`, `sk = CR#<id>` | FR-4.7, FR-5.6 |
| 10 | 欠番（Issue #36 により 2026-09-27。未実装で、申請テーブルに GSI を作らないため） | — | — |
| 11 | IamUser の削除と Assignment の連鎖削除 | Query（#2 の SK 前方一致）＋ DeleteItem。削除の前に、削除できない理由（反映済みの Assignment・当該プールから作った未反映の申請の凍結入力）を #3・#12・#6・#9 で読んで判定する（Issue #44 により 2026-09-26 追記）。状態テーブルの #3・#12 と申請テーブルの #6・#9 をまたいで読む（Issue #36 により 2026-09-27 追記） | Q4=B / FR-1.5 |
| 12 | プールの紐づけ一覧 | Query `pk = POOL#<id>` / `begins_with(sk, "ROLE#")`（読み取りで position 昇順→ARN 昇順に整列する。Issue #100 により 2026-10-04 追記） | FR-1.7, FR-3.1 |
| 13 | 紐づけの追加・解除・有無（追加は登録、解除は削除が行う。Issue #135 により 2026-10-07 訂正。訂正前は、紐づけの保存が行った） | PutItem（`attribute_not_exists(pk)`。登録時は末尾の `position` を含む。`position` を持たない紐づけがあるときは、現在の順で埋めてから、その後ろに足す。UpdateItem `attribute_exists(pk)`）/ DeleteItem / GetItem。登録の IamRole の PutItem は、`displayName` を含めてよい（Issue #150 により 2026-10-08 追記） | FR-2.1, FR-2.4 |
| 14 | 移行の印（`roleLinksInitializedAt`） | 固定プールの確保（#27）の条件付き PutItem に含める。表示名の更新（UpdateItem `pk = POOL#<id>`, `sk = META`）は Issue #108 により 2026-10-05 に廃止 | FR-1.7 |
| 15 | （欠番。Issue #108 により 2026-10-05: ロールの持ち主の取得。`RoleLinkOwner` を廃止した） | — | — |
| 16 | （欠番。Issue #108 により 2026-10-05: 持ち主の取得・返却。`RoleLinkOwner` を廃止した） | — | — |
| 17 | （欠番。Issue #108 により 2026-10-05: プールの削除。UserPool を固定の 1 つにしたので、削除しない） | — | — |
| 18 | IamRole の説明・表示名の更新（Issue #21 により 2026-09-27 追記。Issue #150 により 2026-10-08 訂正。訂正前は「IamRole の説明の更新」） | UpdateItem `pk = ROLE`, `sk = ROLE#<roleArn>`（`attribute_exists(pk)`）。廃止したユーザプールの `#14` の表示名の更新と同じ形（SET / REMOVE を説明・表示名の有無で、属性ごとに切り替える。Issue #150 により 2026-10-08 訂正。訂正前は説明だけ） | FR-2.3, FR-2.7 |
| 19 | 登録時の取り込み（Issue #80 により 2026-09-30 追記。Issue #135 により 2026-10-07 訂正。訂正前は「紐づけ時の取り込み」） | 登録するロールについて、先に IamRole の GetItem で登録済みなら何も書かずに 409 → そのロールの古い交点（取り込むユーザ以外のもの。#3 の Query の結果）を DeleteItem（条件なし。以前の登録・削除の途中失敗で残った孤児。最終レビューにより追記）→ 取り込むユーザがいるときだけ Query（#2）で当該プールの IamUser を読む → 未登録なら PutItem `attribute_not_exists(pk)`（IamUser）→ PutItem（Assignment。`checked = reflected = true`。条件なし）→ #13 の紐づけの PutItem（`appendRoleLink`。既にあれば何もしない）→ IamRole の PutItem `attribute_not_exists(sk)`（最後。IamRole を最後に確定するので、途中で失敗しても「登録済みだが紐づいていない」状態は生まれない。やり直しは続きから直る）。（Issue #108 により 2026-10-05: 持ち主の取得（#16）は無い。）信頼ポリシーは、書き込みの前にすべて読む（DynamoDB ではなく IAM の `iam:GetRole`。`iam-policy-design-note.md` 3.10） | FR-2.1 |
| 20 | 削除時の交点の削除（Issue #79 により 2026-09-30 追記。Issue #135 により 2026-10-07 訂正。訂正前は「解除時の交点の全削除」） | 削除するロールの紐づけを DeleteItem（#13）→ そのロールの交点を DeleteItem（条件なし。`checked`・`reflected` を問わない。交点は #3 の Query の結果）（Issue #108 により 2026-10-05: 訂正前は、このあとに持ち主の返却（#16）があった）。（訂正前は、紐づけの保存の後に、紐づけの無いロールの交点も同じ #3 の結果から DeleteItem で片付けた。Issue #135 により 2026-10-07: 紐づけの保存は廃止した） | FR-2.4 |
| 21 | IamRole の削除（Issue #22 により 2026-10-02 追記） | 存在の確認（GetItem `ROLE#`）→ 判定（申請テーブルの #6 の 1 件版の GetItem。未反映の申請があれば何も書かずに 409）→ 紐づけの DeleteItem（#13）→ 残った交点の削除（固定プールの #3 ＋ DeleteItem）→ IamRole の DeleteItem（最後。条件なし）。状態テーブルと申請テーブルをまたいで読み、書くのは状態テーブルだけ。IamRole を最後に消すので、途中で失敗してもロールは登録されたまま残り、再実行で続きから片付く（Issue #135 により 2026-10-07 訂正。訂正前は、状態テーブルの #12 で、紐づいているときも 409 にし、紐づけの削除は無かった）（Issue #108 により 2026-10-05 訂正: 訂正前は、判定に #15 を使い、孤児の持ち主の解放（#16）と、#1 で引いた全プールの交点の削除があった） | FR-2.4 |
| 22 | 未反映の変更の取り消し（Issue #88 により 2026-10-03 追記） | 存在の確認（GetItem META）→ #3（Assignment 一覧）と紐づけの一覧 → 紐づけたロールの `checked` ≠ `reflected` の交点のロールについて申請テーブルの #6（BatchGetItem）でロックを読み直す → ロックの無いロールの交点ごとに UpdateItem `SET checked = reflected, updatedAt`（条件 `attribute_exists(pk) AND checked <> reflected`。`reflected` は書かない）。条件不一致（読んだ後にそろった）は「すでにそろっている」として数えず、他の失敗は止めずに集めて返す。取り消しは冪等でやり直せる。状態テーブルへの書き込みだけで、AWS にも申請テーブルにも書かない（TransactWriteItems は使わないので実行ロールの権限は変えない） | FR-3.2 |
| 23 | 属性列の定義の保存（Issue #61 により 2026-10-03 追記） | UpdateItem `pk = POOL#<id>`, `sk = META`（`attribute_exists(pk)`）。`attributeColumns` を丸ごと SET する。IamUser のアイテムには触れない（列の削除でも値は書き換えない）。存在の確認は GetItem META | FR-1.9 |
| 24 | ユーザの属性の保存（Issue #61 により 2026-10-03 追記） | 存在の確認（GetItem META・GetItem `USER#<arn>`）→ UpdateItem `pk = POOL#<id>`, `sk = USER#<userArn>`（`attribute_exists(pk)`）。`attributes` を**丸ごと** SET する（空なら REMOVE）。`SET attributes.<id>` のような入れ子のパスは使わない（親のマップが無い既存のアイテムで実 DynamoDB が拒否する）。一覧の読み取りは #1・#2 のままで、読んだ後に定義に無い列の値を捨てる | FR-1.9 |
| 25 | 並び順の保存（Issue #100 により 2026-10-04 追記。Issue #135 により 2026-10-07 訂正。訂正前は「紐づけの並び順の保存」で、紐づけの保存（#19・#20）の最後に書いた） | `PUT /roles/order`: 全登録ロールの ARN を受け、#12（Query）と IamRole 一覧（#5 の Query）を読み、配列に無い登録済みロールは現在の順で後ろに付けて最終の順を決める。最終の順位が読んだ値と違うロールだけ、`UpdateItem pk = POOL#<id>`, `sk = ROLE#<roleArn>`（`attribute_exists(pk)`）で `SET position` する。条件に外れた（読んだ後に削除された）ときは何もしない。順位が変わらないロールは書かない。途中の失敗は再保存で直る（冪等）。登録時の `position` は #13 の PutItem に含める | FR-2.6, FR-3.4 |
| 26 | IamRole の背景色の更新（Issue #100 により 2026-10-04 追記） | UpdateItem `pk = ROLE`, `sk = ROLE#<roleArn>`（`attribute_exists(pk)`）。#18 の説明の更新と同じ形で、色の有無で SET / REMOVE を切り替える。存在の確認は GetItem | FR-2.5 |
| 27 | 固定プールの確保（Issue #108 により 2026-10-05 追記） | GetItem `pk = POOL#<poolId>`, `sk = META`（`poolId` は `ROLUST_POOL_ID`）。無ければ PutItem（`attribute_not_exists(pk)`）で META を作る。作るときに `roleLinksInitializedAt` を付け、`gsi1pk`・`gsi1sk` も書く（キーの形を変えない）。同時に 2 つのリクエストが作ろうとして条件に外れたら、GetItem で読み直す。ハンドラは、リクエストの最初にこれを呼んでから #2〜#4・#12 などを行う | FR-1.1, FR-1.3 |
| 28 | 反映の claim（Issue #121 により 2026-10-06 追記） | UpdateItem `pk = CR`, `sk = CR#<id>`。`SET applyingToken, applyingUntil`、条件 `attribute_exists(pk) AND status IN (draft, failed) AND (attribute_not_exists(applyingUntil) OR applyingUntil < :now)`。反映の確定（#9 の申請の状態更新）は、token が合うときだけ書いて claim を外す。破棄は、claim が無いか期限切れのときだけ書く。申請テーブルだけを書く | FR-5.8, FR-4.8 |
| 29 | 乖離の確認（Issue #170 により 2026-10-15 追記） | 読み取りだけ。#5（IamRole 一覧）・#12（紐づけ一覧。列順）・#2（IamUser 一覧）・#3（Assignment 一覧）を並列に引き、ロールごとに、`reflected = true` のユーザの ARN を集めて、信頼ポリシー（IAM）と比べる。書き込みはなく、結果は保存しない（FR-4.9。`GET /api/drift`。Diff 系統。`dynamodb:Scan` は使わない） | FR-4.9 |
| 30 | 乖離を直す `restore`（Issue #172 により 2026-10-16 追記） | IamRole の GetItem（存在の確認）→ #2（IamUser 一覧）・#3（Assignment 一覧）を並列に引き、IAM の信頼ポリシーと比べて乖離を再計算 → 乖離があれば #7（`ROLELOCK#<roleArn>` の条件付き PutItem。取れなければ `excluded`）→ ChangeRequest の PutItem（`pk = CR`, `sk = CR#<id>`。`status = draft`, `kind = "restore"`。#9 と同じキー）。PutItem に失敗したらロックを補償削除する（DeleteItem。既存の申請作成と同じ）。IAM は読むだけ（`POST /api/drift/restore`。Diff 系統。`dynamodb:Scan` は使わない） | FR-4.10 |
| 31 | 記録を IAM に合わせる `adopt`（Issue #172 により 2026-10-16 追記） | IamRole の GetItem（存在の確認）→ `ROLELOCK#<roleArn>` の GetItem（#6 の 1 件版。あれば何も書かずに `excluded`。IAM は読まない）→ #2・#3 と IAM の信頼ポリシーで乖離を再計算 → ChangeRequest の PutItem（`status = applied`, `kind = "adopt"`, `appliedAt`・`appliedBy`・`result` つき。**先に書く**）→ 乖離したユーザの交点ごとに UpdateItem（`pk = POOL#<id>`, `sk = ASSIGN#<u>#<r>`。`SET checked = :state, reflected = :state, updatedAt`。条件なし。行が無ければ作る。余分は真、足りないは偽）。ユーザごとに独立して書き、失敗は集めて返す。`ROLELOCK` は取らない。IAM は読むだけで書かない（`POST /api/drift/adopt`。Diff 系統。`dynamodb:Scan` は使わない） | FR-4.11 |

**`dynamodb:Scan` は 1 箇所も使わない**（NFR-1 / NFR-2、`iam-policy-design-note.md` 3.4）。
実行ロールにも `dynamodb:Scan` を付与しないため、Scan を書けばテストではなく実環境で
`AccessDenied` として現れる。二重の担保である。

分割（Issue #36）のコピーの件数の突き合わせでは、運用者が CLI で一度だけ Scan する（`docs/design/one-time-migrations.md` の手順。Issue #178 により 2026-10-18 訂正。訂正前は README の手順）。アプリと実行ロールの Scan の禁止は変わらない（Issue #36 により 2026-09-27 追記）。

## NFR-2 との対応

> データモデルがこの規模（ユーザ数百人・ロール数百・AWS アカウント数十）で
> 構造的に破綻する設計（例: 1 レコードに 1 プールの全 Assignment または
> 全 ChangeRequest を格納する等の、件数に比例して単一レコードが肥大する構造）を含まない

- **Assignment は交点 1 件 = 1 アイテム**。プール単位の集約アイテムを作らない。
- **ChangeRequest も 1 件 = 1 アイテム**。ロール単位・プール単位の集約アイテムを作らない。
- **IamUser も 1 件 = 1 アイテム**。UserPool の META アイテムはユーザ名リストを保持しない。登録の Put は `attribute_not_exists(pk)` 付きで、登録済みのアイテムを上書きしない（再登録で属性と作成日時が消えない。Issue #61 により 2026-10-03 追記）。
- **属性列の定義は最大 10 件の配列**で META に収まり、**属性の値は IamUser 1 件のアイテムの中**（最大 10 値 × 128 文字）に収まる。件数に比例して単一レコードが肥大しない（Issue #61 により 2026-10-03 追記）。

したがって件数に比例して肥大する単一レコードは存在しない。
`pk = ROLE` と `pk = CR` は件数に比例してパーティションが伸びるが、これは**アイテム数**が
増えるのであって単一レコードが肥大するのではない。パーティション分割は NFR-1 が明示的に
「作り込まない」と定めた大規模前提の設計であるため、poc では採らない。

## 計画からの逸脱（1 点）

`code-generation-plan.md` Step 5 のキー設計表は ChangeRequest を
`PK = CR#<crId>` / `SK = META` としていた。本実装は `pk = CR` / `sk = CR#<crId>` に変えている。

理由: 前者では FR-7.5（申請履歴の全件一覧）を満たす手段が `Scan` か追加の GSI しかない。
`Scan` は NFR-1 / NFR-2 により禁止であり、GSI を増やすと GSI1（ロール別履歴）と合わせて
2 本になる（Issue #36 により 2026-09-27 追記: ロール別履歴の GSI1 は未実装のまま廃止した）。`pk = CR` の単一パーティションにすると、アイテム 1 件 = 申請 1 件（NFR-2 を満たす）を
保ったまま Query 1 本で全件を引ける（Issue #116 により 2026-10-06 追記: 1 MB でページが切れるので、全件を引くには `LastEvaluatedKey` の最後まで辿る）。ID 指定の取得（`sk = CR#<id>`）も同じキーで成立する。

## FR-4.6 のロックアイテム

`RoleLock` は「この IamRole には未反映（下書きまたは失敗）の ChangeRequest が 1 件ある」
という事実そのものを表すアイテムである。

RoleLock は ChangeRequest と同じ申請テーブルに置く。「未反映の申請があればロックもある」という対応を 1 テーブルに閉じ、テーブル単位で作り直しても FR-4.6 が破れないようにするため（Issue #36 により 2026-09-27 追記）。

```
pk = ROLELOCK#<roleArn>
sk = UNREFLECTED
changeRequestId, status ("draft" | "failed"), createdAt
```

- **取得**: `PutItem` + `ConditionExpression: attribute_not_exists(pk)`。
  既にロックがあれば `ConditionalCheckFailedException` になり、当該ロールを
  申請作成の対象から除外して警告する（既存の ChangeRequest は破棄しない — FR-4.6）。
- **解放**: 反映成功時と破棄時に `DeleteItem` + `ConditionExpression: changeRequestId = :id`。
  条件を付けるのは、解放しようとした申請より新しいロックを誤って消さないため。
- **反映失敗時は解放しない**。失敗は「未反映」に含まれる（Q26）ため、ロックは残る。
  requirements.md 帰結項目 4 が言う「失敗した申請を放置すると当該ロールの新規申請が
  ブロックされ続ける」挙動は、この設計から直接導かれる。

**原子性の範囲**: ロック取得（PutItem）と ChangeRequest 本体の書き込み（PutItem）は
別トランザクションである。`dynamodb:TransactWriteItems` は `iam-policy-design-note.md` 3.4 の
権限一覧に含まれておらず、同節が「複数アイテムをまたぐ原子性が必要になった場合のみ追加する」と
している。本実装は本体書き込みに失敗したらロックを補償削除する。補償にも失敗した場合は
ロールがロックされたまま残る（**過剰にロックする方向**にのみ倒れる）ため、
FR-4.6 の「同時に 1 件まで」が破れることはない。補償失敗は `console.error` で必ず記録する。

## ロールの持ち主（Issue #35）

> **廃止**（Issue #108 により 2026-10-05）: ユーザプールを固定の 1 つにしたので、1 ロール 1 プールの制約とロールの持ち主（`RoleLinkOwner`）を廃止した。コードは持ち主を読まず、書かない。本番に残るアイテムは、1 ロール 1 プールの不変条件を満たしたまま残る。コードを前の版へ戻すと持ち主の検証が再び効くが、残っているアイテムは整合している。以降の節は、廃止前の設計の記録である。残ったアイテムは、不要になったときに運用者が消せる（`aws dynamodb delete-item`。キーは `ROLELINK#<roleArn>` / `OWNER`）。

（Issue #35 により 2026-09-25 追記）1 つのロールを紐づけられるプールは高々 1 つ（requirements.md FR-1.7）。これを、ロールごとに 1 アイテムの逆引き（持ち主）で守る。

```
pk = ROLELINK#<roleArn>
sk = OWNER
itemType = "RoleLinkOwner"（keys.ts の ItemType）, roleArn, poolId, createdAt
```

- **不変条件**: 紐づけ（`POOL#<poolId>` / `ROLE#<roleArn>`）があれば、そのロールの持ち主があり、その `poolId` は紐づけのプールと一致する。逆の「持ち主があるのに、そのプールに紐づけが無い」（孤児の持ち主）は、書き込みの途中の失敗で起こりうる。孤児はロックが強すぎる側への失敗で、不変条件は破らない。
- **検証**: 紐づけの保存（`PUT /pools/:poolId/roles`。Issue #46 により 2026-09-27 訂正）は、足すロールの持ち主がほかのプールなら何も書かずに 409 を返す。
- **取得**: 足すロールごとに、アクセスパターン 16 の条件付き PutItem。検証の後にほかのプールが先に取っていれば条件で失敗し、同じリクエストで取った持ち主を条件付き DeleteItem で返して 409 にする。返すのに失敗したら `console.error` に記録する（孤児が残るだけ）。
- **返却**: 条件付き DeleteItem（`poolId = :poolId`）。ほかのプールの持ち主は消さない。
- **書き込みの順序**（`dynamodb:TransactWriteItems` を使わない。上の「原子性の範囲」と同じ考え方）: 紐づけるときは持ち主 → （取り込む IamUser → 交点）→ 紐づけ、外すときは紐づけ → そのロールの交点（すべて）→ 持ち主（Issue #79・#80 により 2026-09-30 訂正。訂正前は「紐づけるときは持ち主 → 紐づけ、外すときは紐づけ（と残骸の交点）→ 持ち主」）。途中で失敗して残るのは、孤児の持ち主と、紐づけの無いロールの取り込み済みの IamUser・交点、外したロールの交点だけになる。保存の最後に、持ち主がそのプールで紐づけが無く、今回も紐づけないロールの持ち主と、紐づけの無いロールの交点を消す（孤児の片付け）。

| 失敗した箇所 | 残る状態 | 見え方と回復 |
|---|---|---|
| 持ち主の取得の途中 | このプールの持ち主（孤児）が数件 | 409 の補償で返す。返せなければ孤児。このプールのロールの紐づけでは選べる行に、ほかのプールでは「<このプール> に紐づけ済み」の無効な行に見える。このプールで次に保存すると片付く |
| 紐づけの追加の途中（Issue #46 により 2026-09-27 訂正。訂正前は表示名の更新も含んだ） | 足した持ち主の一部が紐づけ無し（孤児）。取り込みの途中なら、取り込み済みの IamUser と交点（紐づけの無いロールのもの）も残る（Issue #80 により 2026-09-30 追記） | 502（再試行可）。画面は紐づけを読み直す。同じ保存をもう一度行うと、取り込みが続きから直る（IamUser は重複せず、交点は同じ値になる）。そのロールを含めずに別の保存を行うと、紐づけの無いロールの交点は片付く（IamUser は残る）。次の保存で片付く、または紐づけ直せる |
| 紐づけの削除の後、交点の削除または持ち主の返却の前（Issue #79 により 2026-09-30 訂正） | 孤児の持ち主。外したロールの交点の一部（紐づけの無いロールのものなので、マトリクスには出ない） | 同上。次の保存の孤児の片付けが、残った交点を消す。残っている間は、その交点の IamUser の削除が FR-1.5 により拒否されることがある |

どの失敗でも、紐づけがあるのに持ち主が無い状態・持ち主がほかのプールである状態は生まれない。持ち主のアイテムは旧版のコードからは読まれない（`ROLELINK#` のパーティションを読む処理が無い）。コードを前の版へ戻しても見え方は変わらないが、戻した版では 1 ロール 1 プールの検証が効かない。

**プールの削除**（Issue #18 により 2026-09-27 追記）: 紐づけの無いプールだけを削除できる（アクセスパターン 17）ので、削除するプールを持ち主とする持ち主はすべて孤児である。削除では META を消す前に、それらを条件付き DeleteItem で返す。返さないと、そのロールはほかのプールのロールの紐づけで「<poolId> に紐づけ済み」の選べない行のまま戻らない。判定と META の削除の間に、ほかの操作がこのプールへロールを紐づけると（競合。Issue #48 の判断で受け入れる）、削除済みのプールを指す持ち主が残りうる。そのときは運用者が消す（同じ識別子でプールを作り直し、そのロールの紐づけで外しても直る）:

```bash
MSYS_NO_PATHCONV=1 aws dynamodb delete-item --table-name rolust-state \
  --key '{"pk":{"S":"ROLELINK#arn:aws:iam::555566667777:role/DeployProd"},"sk":{"S":"OWNER"}}' \
  --condition-expression "poolId = :p" --expression-attribute-values '{":p":{"S":"retired-team"}}' \
  --profile <profile> --region <region>
```

**ロールの削除**（Issue #22 により 2026-10-02 追記）: 紐づいているロールは削除を拒否するので（アクセスパターン 21）、削除で解放する持ち主は孤児（持ち主のプールに紐づけが無い）だけである。条件付き DeleteItem（`poolId = <持ち主のプール>`）で返す。返さないと、同じ ARN を登録し直したときに、ほかのプールのロールの紐づけで「<poolId> に紐づけ済み」の選べない行になる。判定の後、IamRole の削除の前に、ほかの操作がこのロールを紐づけると（競合。Issue #48 の判断で受け入れる）、IamRole の無い紐づけと持ち主が残る。マトリクスの列は登録済みのロールに絞るので出ず、そのプールのロールの紐づけを次に保存すると、保存する集合に入らないので外れ、持ち主も返る。持ち主が削除済みのプールを指し、そのプールに紐づけが残っている場合（上の「プールの削除」の競合）は、ロールの削除は「<識別子> に紐づいています」の 409 になる。直し方は上のコマンドと同じ。 （Issue #135 により 2026-10-07: 以上は、ロールの持ち主（Issue #108 で廃止）がいた時点の記述である。いまの削除は、紐づけがあっても拒否せず、紐づけと交点を片付けて IamRole を最後に消す（アクセスパターン 21）。持ち主は読まず、消さない。）

## プールとロールの紐づけの移行（Issue #19）

> **実施済み**（Issue #108 により 2026-10-05）: 本番では実施済みで、移行スクリプト（`pool-role-links`）は削除した。新しい環境では、固定プールの確保（#27）が `roleLinksInitializedAt` を付けて作るので、移行は要らない。以降は実施時の記録である。

Issue #19 より前に作ったプールは紐づけを持たず、マトリクスの列が 0 件になる。反映の直後に一度だけ、移行スクリプトで登録済みの全ロールを紐づける（手順は README「ユーザプールとロールの紐づけの移行」にあった。Issue #178 により 2026-10-18、スクリプトを Issue #108 で削除済みのため README から削除した）。

- 対象は META に `roleLinksInitializedAt` の無いプールだけ。新しいコードで作るプールは作成時に印が付く。
- 全ロールを紐づけ終えてから印を付ける。途中で失敗したプールは印が無いまま残り、再実行で続きから直る。印の付いたプールは飛ばすので、移行後に絞り込んだ紐づけを全ロールに戻さない。
- 紐づけの項目は、旧版のコードからは読まれない。プールのパーティションを引く Query はどれも `USER#` / `ASSIGN#` の接頭辞で絞っているため。コードを前の版へ戻せば元の見え方に戻る。

（Issue #36 により 2026-09-27 追記）移行スクリプトは `ROLUST_STATE_TABLE_NAME` と `ROLUST_CHANGE_REQUEST_TABLE_NAME` を読む。紐づけ・交点・持ち主は状態テーブル、ロールロックと申請は申請テーブルから読む。

## ロールの持ち主の移行（Issue #35）

> **実施済み・廃止**（Issue #108 により 2026-10-05）: 本番では実施済みで、移行スクリプト（`role-link-owners`）は削除した。持ち主自体を廃止した。以降は実施時の記録である。

（Issue #35 により 2026-09-25 追記）Issue #35 より前の紐づけは持ち主を持たず、#19 の移行の後は 1 つのロールが複数のプールに紐づいている。反映の直後に一度だけ、移行スクリプト（`packages/api/src/migrations/role-link-owners.ts`）で持ち主を付け、2 つ以上のプールに紐づくロールを整理する（手順は README「ロールの持ち主の移行」にあった。Issue #178 により 2026-10-18、スクリプトを Issue #108 で削除済みのため README から削除した）。

- **前提**: #19 の印（`roleLinksInitializedAt`）の無いプールがあれば、何もせずに止まる（終了コード 1）。#19 の移行は印の無いプールに全ロールを紐づけるので、#35 の後に走ると不変条件を破るため。
- **分類**: 全プールの紐づけを Query（アクセスパターン 12）してロール → 紐づけたプールの表を作り、ロールごとに次の順で当てはめる。「割り当てが残る」は、そのプールに `checked || reflected` の交点がある、またはそのロールのロールロックの申請がそのプールから作ったもの（`computeActiveReasons`）。Issue #79 より前は紐づけの解除を拒否する理由と同じで、判定の関数をサービスと共有していたが、Issue #79 で紐づけを外せない理由は未反映の申請だけになったので、共有をやめた（Issue #79 により 2026-09-30 訂正。移行は当時の定義のまま、挙動を変えていない）。

| 分類 | 条件 | `--apply` での扱い |
|---|---|---|
| owner-mismatch | 持ち主があり、紐づけたプールに無い、または紐づけたプールが 2 つ以上 | 手を付けない。列挙する（終了コード 1） |
| single | 紐づけたプールが 1 つ | 持ち主を書く（既に同じプールなら何もしない） |
| conflict | 2 つ以上、割り当てが残るプールが 2 つ以上 | 手を付けない。列挙する（終了コード 1） |
| keep-one | 2 つ以上、割り当てが残るプールが 1 つ | ほかのプールの紐づけを残骸の交点ごと外し、残すプールを持ち主に書く |
| unlink-all | 2 つ以上、割り当てが残るプールが 0 | 全プールの紐づけを残骸の交点ごと外す。持ち主は書かない |

- **書き込みの順序**: 上の「ロールの持ち主」と同じ（外す → 持ち主を書く）。途中で失敗したら止めて表示する（終了コード 1）。分類は毎回その時点のデータから出し直すので、再実行で続きから直る。書き終えたロールは single（持ち主が一致）になるか、どのプールにも紐づかなくなって分類の対象から外れ、もう書かない。
- **dry-run**（既定）: 分類ごとの件数と、single 以外のロールごとの紐づけたプール・割り当てが残るプールを表示する。何も書かない。
- Scan・`BatchWriteItem`・`TransactWriteItems` は使わない。

（Issue #36 により 2026-09-27 追記）移行スクリプトは `ROLUST_STATE_TABLE_NAME` と `ROLUST_CHANGE_REQUEST_TABLE_NAME` を読む。紐づけ・交点・持ち主は状態テーブル、ロールロックと申請は申請テーブルから読む。

## 状態テーブルと申請テーブルへの分割（Issue #36）

（Issue #36 により 2026-09-27 追記）1 本のテーブル `rolust` を、状態テーブルと申請テーブルに分けた。見通しと運用のしやすさ（退避・復元・作り直しをテーブル単位で分ける）のためで、権限は分けていない（Lambda 3 系統の DynamoDB ポリシーは共通で、Resource が 2 本になった）。

- **申請は移さない**。ChangeRequest と RoleLock は捨てる（開発中のため）。状態のアイテムだけを写す。
- **旧テーブルの扱い**: Terraform の `removed`（`destroy = false`）で管理から外し、写し終えて件数を突き合わせてから運用者が消す。`removed` は旧テーブルを消した後も残す。
- **写し方**（`packages/api/src/migrations/split-tables.ts`、`npm run migrate:split-tables`）: Scan を使わず、旧テーブルを GSI1 `POOLS`（#1）→ 各プールの `pk = POOL#<id>` を sk で絞らず全件 → `pk = ROLE`（#5）→ そのロールの `ROLELINK#<arn>` / `OWNER`（#15）の順に辿る。状態テーブルへ `attribute_not_exists(pk)` の条件付き PutItem で、アイテムを加工せずに書く。既存は上書きしない。途中で失敗したら止め、再実行で既存を飛ばして続きから書く。
- **件数の突き合わせ**: 運用者が `aws dynamodb scan --select COUNT` を itemType ごとと総数で旧テーブルと状態テーブルにかけ、状態の 6 種別が一致し、状態テーブルの ChangeRequest・RoleLock が 0 件であることを確かめる。写しと別の経路で全件を数えるので、アクセスパターンから辿れないアイテムがあっても見つかる。
- 手順は `docs/design/one-time-migrations.md`「状態テーブルと申請テーブルへの分割（Issue #36、一度だけ）」（Issue #178 により 2026-10-18 訂正。訂正前は README）、切り戻しは `docs/design/rollback-runbook.md`。

## ChangeRequest の実行者（Issue #120）

| 属性 | 型 | 書く時 | 内容 |
|---|---|---|---|
| `createdBy` | Map `{ name: string, sub?: string }` または NULL | 作成（PutItem） | 申請を作成した実行者。`x-rolust-actor` を Lambda が復号して保存する |
| `appliedBy` | 同上 | 反映（UpdateItem。`status`・`appliedAt`・`result` と同じ式） | 反映を試みた実行者。`appliedAt` と同じく失敗でも入る。破棄は既存の値を書き戻すだけ |

- Issue #120 より前のアイテムは属性を持たない。読む側（`toChangeRequest`）が `null` に畳む。移行はしない。
- `sub` が無いとき（`basic`）は `sub` のキーを作らない（DynamoDB は undefined を受けない）。
- 実行者での検索はしない。アクセスパターンは増やさない。

## ChangeRequest の同時操作（Issue #121）

| 属性 | 型 | 書く時 | 内容 |
|---|---|---|---|
| `applyingToken` | String | 反映の claim（UpdateItem） | claim の持ち主を示す乱数（UUID）。反映 1 回ごとに作る |
| `applyingUntil` | String | 同上 | claim の期限（ISO 8601 UTC。辞書順で比べる）。取得時刻の 2 分後 |

- claim の長さは 2 分（`APPLY_CLAIM_SECONDS`）。apply Lambda の timeout（30 秒）より十分長く、持ち主の実行中に期限が切れない。Lambda が落ちても期限で解ける。
- 反映の成功・失敗の記録と破棄は、書くときに claim を外す（`REMOVE applyingToken, applyingUntil`）。書き込みの前提は 2 種類: claim の持ち主（token が合う）、または下書き・失敗で claim が無いか期限切れ。外れたら `ConflictError`（409）。
- 属性は API の応答（`ChangeRequest` 型）に出さない。Issue #121 より前のアイテムは属性を持たず、条件 `attribute_not_exists(applyingUntil)` に合うので、移行は要らない。コードを前の版へ戻しても、旧コードは属性を読まず、claim が残っていても無害。
- AWS SDK は、タイムアウトなどで同じ UpdateItem を自動で再送する。成功済みの書き込みの再試行は条件に外れるので、条件に外れたときは強い整合性で読み直し、claim なら持ち主が自分の token であるとき、状態の書き込みなら同じ状態・同じ `appliedAt` で claim が外れているときを、成功として扱う（反映済みなのに「失敗」と報告し、ロックが漏れるのを防ぐ）。
- 範囲外: Assignment の同じセルの同時更新（後勝ち）、Rolust の外からの IAM 変更（IAM に条件付き更新が無い）。

## ChangeRequest の反映結果の localized（Issue #94）

（Issue #94 により 2026-10-15 追記）

| 属性 | 型 | 書く時 | 内容 |
|---|---|---|---|
| `result.localized` | Map `{ id: string, params: Map }` | 反映（UpdateItem。`status`・`appliedAt`・`result` と同じ式） | 反映結果の本文の言語に依らない形（`{ id, params }`）。旧レコードには無く、SPA は `message` をそのまま出す。新しい API は `message`（日本語）と併せて書く |

- 任意属性なので移行は要らない。読む側は `localized` が無くても `message` で描画できる。
- `id` を SPA が知らないとき（新しい API に古い SPA が当たったとき）も、`message`（日本語）をそのまま出す。
- キー・GSI・アクセスパターンは増やさない。

## ChangeRequest の種別（Issue #172）

（Issue #172 により 2026-10-16 追記）

| 属性 | 型 | 書く時 | 内容 |
|---|---|---|---|
| `kind` | String（`"restore"` または `"adopt"`） | 作成（PutItem） | 乖離を直す操作で作った申請の種別。`restore` は IAM を記録に合わせる下書きの申請（反映は通常の申請と同じ）、`adopt` は記録を IAM に合わせた監査の申請（`status = applied`。AWS を書いていない）。通常の申請（「申請を作成」）は属性を持たない |

- **無い（既存・通常の申請）は通常として読む**。読む側（`toChangeRequest`）は属性が無ければ `kind` を `undefined` にする（型は `kind?: ChangeRequestKind`）。移行はしない（Issue #120 の `createdBy` と同じ移行の仕方）。
- `kind` を書くのは作成の PutItem だけで、反映（UpdateItem。`status`・`appliedAt`・`result` の式）は `kind` に触れない。`restore` の申請の反映と破棄は、通常の申請と同じ式で動く。
- `adopt` の申請は `status = applied` で作る。`RoleLock`（`ROLELOCK#<roleArn>`）は取らない（未反映の状態を持たないため。FR-4.6 の「未反映」は下書き・失敗だけ）。`createdAt = appliedAt`、`createdBy = appliedBy` = 実行者。`addUserArns` = 記録に取り込んだユーザ（余分）、`removeUserArns` = 記録から外したユーザ（足りない）。
- 種別での検索はしない。アクセスパターン #8 の一覧にそのまま並び、画面 5 の種別の表示はアプリ側で行う。キー・GSI は増やさない。
