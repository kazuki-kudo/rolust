# ロールバック runbook を `docs/design/` に切り出して訂正する — 設計

- 日付: 2026-09-27
- Issue: #5
- ブランチ: `docs/5-rollback-runbook`
- 状態: 設計承認済み（brainstorming の設計 1・2）、spec レビュー待ち

## 1. 背景と目的

### 起きていること

ロールバックの手順書 `rollback-runbook.md` は、凍結された `aidlc/spaces/default/intents/260728-rolust-iam-trust/operation/deployment-pipeline/` にしかない。2026-08-31 以降は更新されておらず、その後の実測（4.3 の初回 apply、4.5 の RB-1・RB-2・RB-4・RB-6）と変更（Issue #51 による CD の apply 経路の封鎖）が反映されていない。

Issue #5 は、実測で確定した 2 点の食い違いを挙げている（出所は `runbooks.md` § 申し送り 2 と `feedback-loop.md` F-1.5）。

1. § データとの非対称性 で IAM を戻す手順に、CloudTrail の照会が要る。IAM はグローバルサービスのため、イベントは `us-east-1` にしか記録されない。
2. § 滞留した申請の扱い の `delete-item` のキー例（`"pk":"ROLELOCK"`、`"sk":"<roleId>"`）が `packages/api/TABLE-DESIGN.md` と異なる。

**Issue の前提と実物の違い**: 複写元の § データとの非対称性 には CloudTrail の手順がそもそも無い（`get-role` と `update-assume-role-policy` だけ）。このため「`--region us-east-1` を追記する」を、「RB-2 の形で、戻す内容を CloudTrail から辿る手順を足し、`--region us-east-1` を付ける」と読み替える（依頼者の承認済み）。

### 依頼の内容

Issue #5 と、その Issue へのコメント: `docs/design/README.md` の「凍結文書を正本に切り出す手順」で `rollback-runbook.md` を `docs/design/` に切り出してから直す。

### 前提（2026-09-27 に確認）

- `RoleLock` のキーは `pk = ROLELOCK#<roleArn>`、`sk = UNREFLECTED` である（`TABLE-DESIGN.md`、`runbooks.md` RB-4 と一致）。
- CD（`cd.yml`）は `plan` と `guard` の 2 ジョブだけで、反映しない（`cd-config.md` D-7）。`plan` は `use_lockfile = true` の backend で `terraform plan` を実行するので、state のロックを取る。
- `infra/outputs.tf` に `console_url`・`cloudfront_distribution_id`・`dynamodb_table_name`・`managed_role_tag`・`managed_role_arn_scope` がある。
- `packages/edge-auth` のユニットテストは 7 件、`CREDENTIALS_PARAMETER_NAME` は `/rolust/basic-auth` である。
- `jump-admin` の SSO は失効していた（2026-09-27）。AWS の実測は行っていない。

### 成功基準

1. `docs/design/rollback-runbook.md` が正本として存在する。正本注記を持ち、3.2 の訂正 K-1〜K-12 のそれぞれに来歴がある。
2. § データとの非対称性 に、`--region us-east-1` を付けた CloudTrail の手順がある。§ 滞留した申請の扱い のキーが `TABLE-DESIGN.md` と一致する（Issue #5 のやること 2 件）。
3. 本文に、CD による反映・承認つき apply を現行として書いた記述が残っていない。
4. フルパスで `rollback-runbook.md` を指す参照が、`docs/design/` を指す。
5. `aidlc/` に差分が無い。

## 2. 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| 切り出す範囲 | **`rollback-runbook.md` の 1 本だけ。** `runbooks.md`（RB-1〜RB-8）は凍結のまま参照する | 手順は「訂正する文書」を切り出すと定めている。`runbooks.md` は訂正しない |
| CloudTrail の手順 | **RB-2 のコマンドを本文に書き写し、来歴を付ける。** 参照先を示すだけにはしない | 障害時に使う手順が、古い記述の混じる凍結文書に頼らずに済む。RB-2 のコマンドは 2026-09-19 に実測済み |
| Issue #4 と重なる箇所（§ SPA だけを戻す場合） | **事実（旧アセットは destroy される）と RB-6 の暫定の手当て（開いているタブの再読込の周知）はここで書く。恒久策は未決とし、#4 に回す** | 事実は RB-6 の実測で確定している。恒久策（S3 オブジェクトを Terraform の管理から外す、または受容する）は IaC の設計判断である |
| AI-DLC の残骸 | **#26・#39 の前例に倣って削除し、正本注記に書く** | Stage 行などは工程の記録であって設計ではない |
| `resourcegroupstaggingapi` の照会（K-13） | **SSO が使えない限り直さず、正本注記の「未決」に挙げる** | 記録上は未検証（4.1 の `memory.md`）で、実行リージョンも確定していない。導出の根拠が無い |
| 範囲外 | README § SPA を更新したとき の「差分のあるファイルだけが S3 に上がる」（#4 の領域）と、README の `MSYS_NO_PATHCONV`（#3 の領域）。**両 Issue にコメントで知らせる** | 別の Issue が扱っている |

## 3. 設計

### 3.1 配置と文書の形

| 正本 | 複写元（`aidlc/spaces/default/intents/260728-rolust-iam-trust/` 配下） | 改行コード |
|---|---|---|
| `docs/design/rollback-runbook.md` | `operation/deployment-pipeline/rollback-runbook.md` | CRLF（維持する。Edit ツールで直す） |

- 複写だけのコミットを先に作る（以後の差分が訂正だけになる）。
- 冒頭の `# Rollback Runbook — Rolust` の直後に**正本注記**を置く。書式は `cd-config.md` に倣う（位置づけ・複写元・照合の範囲・訂正の全体像・未決・ファイル名だけで名指す凍結文書の所在）。
- 節の見出しは変えない。§ ロールバックの基本形 などは `runbooks.md` が名指しているため。節を足すときは既存の節の中に小見出しで足す。

### 3.2 照合（既知の食い違いの総当たり）

`docs/design/README.md` の手順 3 の源泉（記録・コードのコメント・rules・状態欄・残骸）から列挙した。訂正には「Issue #5 により 2026-09-27 訂正」（足すものは「追記」）の来歴を訂正後の文言と同じ行に付ける。

| # | 箇所 | 訂正 | 源泉 |
|---|---|---|---|
| K-1 | 冒頭 | Stage・Scope の行、最終更新、上流の成果物が揃った経緯の段落を削除する | 残骸 |
| K-2 | 冒頭（壊れた apply を通さない仕組み） | 「`cd.yml` の `guard` が承認の前に R-1〜R-8 を落とす」を改める。CD は反映しない（D-7）ので反映は手動経路だけであり、赤信号 R-1〜R-9 は手元の `plan-guard.sh` で止める（README § 4. apply する）。本 runbook が扱うのは、それをすり抜けた壊れ方になる | 記録（#51）・コード |
| K-3 | 冒頭（未実行の注記）・§ 未決事項 1 | 「一度も実行されていない」「`terraform apply` 自体が未実行」を改める。apply は 4.3 で実行済み。SPA の経路は RB-6 で往復を実測済み（2026-09-19）。それ以外の経路（基本形・認証・タグ・state ロック・IAM の復元）は通しで実行していない | 記録（`deployment-log.md`・RB-6） |
| K-4 | § ロールバックの基本形 | 手順を README § SPA を更新したとき の形（リポジトリのルートから `-chdir=infra` で plan → `plan-guard.sh` → apply → `tfplan` の削除）にそろえ、`create-invalidation` に `MSYS_NO_PATHCONV=1` を付ける。「CD 経由の場合は revert コミットを積み、承認つき apply を通す」と「二重経路」の段落を削除する。ロックの注意（`-lock=false` の禁止）は、手動の apply 同士と CD の plan の衝突を防ぐ前提として残す | #51・rules・README |
| K-5 | § 判断基準（503 の行） | `aws ssm get-parameter` に `--region us-east-1` と `MSYS_NO_PATHCONV=1` を付ける（値そのものは表示しない形は RB-3 に倣う） | rules・RB-3 |
| K-6 | § 認証が外れた場合 | `/tmp/dist.json` を使う骨組みを、RB-1 の手順（`ETag` の取り出し、`DistributionConfig` だけを取り出して `Enabled = false`、`file://` は相対パス、`--if-match`）に置き換える。`update-distribution` の発行と再有効化は未実行であることを明記する | RB-1・rules |
| K-7 | § SPA だけを戻す場合 | 「旧アセットを削除しないこと」を改める。`aws_s3_object.web` は `for_each = fileset()` のため、直前のアセットは destroy される（RB-6 の実測）。開いたままのタブは遅延チャンクの読込で壊れるので、反映・戻しの後は再読込を周知する。恒久策は #4 に回す。手順に `plan-guard.sh` を足し、`npm run build -w @rolust/web` にする。復旧後に `git checkout HEAD -- packages/web` で現行に戻して反映し直すこと、戻し先は直前にデプロイした版であることを足す | RB-6・F-1.4 |
| K-8 | § state のロックが残った場合 | 「手動 apply と CD が同じ state を触る」「GitHub Actions の CD が実行中でないこと」を改める。CD は plan だけを実行するが、plan もロックを取るので、CD の `plan` ジョブが実行中でないことを確かめる。ロックの中身を見る `aws s3 cp` に `--region us-east-1` を付ける（state バケットの実体は `us-east-1`） | #51・`cd.yml`・記録（`environment-inventory.md` § 実リージョンの是正） |
| K-9 | § データとの非対称性 | 戻す内容を CloudTrail から辿る手順を足す（**Issue #5**）。`lookup-events --region us-east-1`、`requestParameters.policyDocument` がその更新の後の全文であること、退避・復元・一致確認、`UpdateAssumeRolePolicy` の記録が無い場合は `CreateRole`、90 日の窓。「戻すべき内容の記録は `ChangeRequest` の履歴にある」を、「履歴にあるのは差分だけで、全文は CloudTrail から辿る」に改める | Issue #5・RB-2・rules |
| K-10 | § 滞留した申請の扱い | キーを `pk = ROLELOCK#<roleArn>`、`sk = UNREFLECTED` にする（**Issue #5**）。テーブル名は `terraform output -raw dynamodb_table_name` から取り、削除の前に `get-item` で確かめる。「`build-and-test` のレビューが operation フェーズへ申し送った」の文を削除する | Issue #5・`TABLE-DESIGN.md`・RB-4・残骸 |
| K-11 | § 未決事項 3 | 重大度の定義は incident-response（4.5）で SEV1〜SEV4 として定まった（`incident-plan.md`・`escalation-matrix.md`）ため、解消済みにする | 記録 |
| K-12 | § エスカレーション | 表は `escalation-matrix.md` で重大度ごとに拡張されていることを書き添える | 記録 |

照合したが変えない記述: § Lambda@Edge の制約 の edge-auth のユニットテスト 7 件と `CREDENTIALS_PARAMETER_NAME`、§ 管理対象タグを戻す場合 の `managed_role_tag` 出力と Lambda の環境変数名、§ ロールバック後の確認 の `managed_role_arn_scope`。いずれもコードと一致した。

**未決（直さない）**:

- K-13: § エスカレーション の `resourcegroupstaggingapi get-resources` は未検証で、IAM ロールを列挙するときの実行リージョンが確定していない。
- § SPA だけを戻す場合 の恒久策（Issue #4）。
- § 未決事項 2（ロールバックの所要時間、特に Lambda@Edge の複製）は残す。

### 3.3 参照の張り替え

| ファイル | 変更 |
|---|---|
| `.github/workflows/cd.yml` | 冒頭の `aidlc/…/rollback-runbook.md` を `docs/design/rollback-runbook.md` に改める。動作は変わらない |
| `docs/design/cicd-pipeline.md` | § 本書の立場 の表の `rollback-runbook.md` を正本のパスに改め、来歴を付ける |
| `docs/design/README.md` | 文書の表に `rollback-runbook.md` を足す。ソースタグの表の「`deployment-strategy.md`・`rollback-runbook.md`」の行から `rollback-runbook.md` を外す。正本の本文が名指す凍結文書（`runbooks.md`・`incident-plan.md`・`escalation-matrix.md`・`feedback-loop.md`・`deployment-log.md`）の所在を足す |

ファイル名だけの参照（`cd-config.md` § 未決事項 など）は README の規約で解決するので書き換えない。`README.md` と `CLAUDE.md` は `rollback-runbook.md` を名指していないので変えない。

### 3.4 検証

文書と CI 設定は TDD の例外なので、機械的に判定する。雛形は `docs/superpowers/plans/2026-09-26-cicd-design-docs.md` の検証スクリプトである。

1. `git diff --stat main -- aidlc/` が空であること。
2. 複写元の `##`・`###` 見出しがすべて正本にあること（削除する節は無い）。
3. K-1〜K-12 の各項目について、訂正後の文言と来歴（`Issue #5 により 2026-09-27`）があること。K-1 は削除した文言が無いことで判定する。
4. 正本に `--region us-east-1` を付けた `lookup-events` があり、`"pk":{"S":"ROLELOCK"}` が無いこと（`grep`）。
5. 正本の本文に、CD の apply・承認つき apply を現行として書いた記述が無いこと（`grep` で「承認つき」「CD 経由」を引き、来歴つきの行だけであること）。
6. 張り替えたパス参照の先が実在し、`aidlc/…/rollback-runbook.md` をフルパスで指す参照が `aidlc/`・`docs/superpowers/` の外に残っていないこと。
7. CRLF の正本について、`git diff --numstat` と改行コードの統計で、差分が意図した箇所だけで、改行が混在していないこと。
8. push の前に gitleaks 8.30.1 を実行すること（`gitleaks git . --no-banner --redact --exit-code 1`）。
9. `.github/` のコメントを変えるので、PR の CI（`ci.yml`）が緑であることを確かめる。

## 4. 正本への反映

- 足すもの: `docs/design/rollback-runbook.md`（新しい正本）。`docs/design/README.md` の文書の表とソースタグの表を更新する。`docs/design/cicd-pipeline.md` § 本書の立場 のパスを改める。
- 覆すもの: なし。既存の正本の ID と節は変えない。
