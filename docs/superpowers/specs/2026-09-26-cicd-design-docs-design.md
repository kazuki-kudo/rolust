# CI/CD の設計を `docs/design/` に切り出す — 設計

- 日付: 2026-09-26
- Issue: #39
- ブランチ: `docs/39-cicd-design-docs`
- 状態: 設計承認済み（brainstorming の第 1〜3 節）、spec レビュー待ち

## 1. 背景と目的

### 起きていること

CI/CD の設計は、凍結された `aidlc/` の文書にしかない。対象は、CI ロールの信頼ポリシー・権限ポリシー・作成手順、CD の前提 P-1〜P-4、plan の読み方である。README にも `docs/design/` にも記述が無い。

その後の変更は凍結文書に反映できず、`.claude/rules/aws-infra.md` § CI/CD に事実として書き足してきた。

- Issue #38: CI ロールの信頼ポリシーの `sub` を不変 ID の形式に改めた。
- Issue #38 と #40: 両ロールの権限を足した。

その結果、次の食い違いが生じている。

- **凍結文書の値が現行ではない。** `sub` の値（`repo:kazuki-kudo/rolust:…`）と権限ポリシーの JSON が古い。
- **赤信号 R の判定基準が 2 つの凍結文書に分かれている。**
  - R-1〜R-8 の一覧は `construction/infrastructure-design/cicd-pipeline.md` にある。
  - 現行の R-1 の基準と R-9 は `construction/ci-pipeline/quality-gates.md` にある。
  - `cd.yml` と `plan-guard.sh` は両方を名指ししている。
- **規則のファイルに事実が混在している。** `aws-infra.md` § CI/CD は、ファイルを開くたびに読み込まれる規則であるにもかかわらず、`sub` の現行値や権限の追加履歴という事実を持っている。

### 依頼の内容

Issue #39: `docs/design/README.md` の「凍結文書を正本に切り出す手順」で、CI/CD の設計を `docs/design/` に切り出す。

### 前提（2026-09-26 に実測）

- **P-3 は完了している。**
  - OIDC プロバイダ 1 件と、`rolust-ci-plan`・`rolust-ci-apply` がある（2026-08-23 作成、タグ `Project=rolust`・`ManagedBy=manual-4.2`）。
  - 信頼ポリシーの `sub` は 2 本とも不変 ID の形式である。
  - リポジトリ変数 `AWS_PLAN_ROLE_ARN`・`AWS_REGION`・`TF_STATE_BUCKET`・`TF_STATE_REGION` は設定済みである。
- **P-4 は成立していない。**
  - Environment `production` の保護ルールは `branch_policy`（`main` 限定）だけで、承認者は無い。
  - 2026-09-16 に Required reviewers の作成を試み、GitHub のプラン制限（private ＋ Free）により 422 になった（`aidlc/.../operation/environment-provisioning/validation-report.md` V-21・申し送り 10）。
  - `AWS_DEPLOY_ROLE_ARN` は未設定である。
- plan-guard の回帰テストは PASS=37 / FAIL=0 である。`ci.yml` には独立した `plan-guard` ジョブがある。

### 成功基準

1. `docs/design/cicd-pipeline.md` と `docs/design/cd-config.md` が正本として存在する。どちらも、正本注記と、3.2 の訂正（それぞれに来歴を付ける）を持つ。
2. 赤信号 R-1〜R-9 の現行の判定基準が、正本の `cicd-pipeline.md` の 1 か所で読める。
3. 両ロールの信頼ポリシーと権限ポリシーが、正本と AWS の実測で一致する。
4. `cd.yml`・`ci.yml`・`plan-guard.sh` のうち、切り出した 2 本と R の基準を指す参照がすべて `docs/design/` を指す。
5. `aws-infra.md` § CI/CD が規則だけを持ち、事実は正本の節を指す。
6. `aidlc/` に差分が無い。

## 2. 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| 切り出す範囲 | **`cicd-pipeline.md` と `cd-config.md` の 2 本。`quality-gates.md` の R-1 の現行基準と R-9 は、正本の `cicd-pipeline.md` の赤信号の表に訂正として取り込む** | R の正本が 1 か所になり、`cd.yml`・`plan-guard.sh` の参照がすべて `docs/design/` を指せる。`quality-gates.md`・`ci-config.md`（CI ゲート G-1〜G-11 など）は、触れる Issue が出たときに切り出す（#26 の spec 2 節「必要になった Issue が切り出す」） |
| `aws-infra.md` との重複 | **事実は正本、規則は rules** | 事実を規則のファイルに置くと、正本との二重管理になる。規則（どうやるか・何に注意するか）は `infra/`・`.github/` を開いたときに自動で読まれる必要があるため、rules に残す |
| 旧形式の `sub` を持つ凍結文書 | **切り出さず、正本の正本注記に列挙して「この点は現行ではない」と書く** | 凍結文書は書き換えない。読み手が凍結文書の値を現行と取り違えないよう、正本の側から名指す |
| AI-DLC の工程の残骸 | **#26 の前例に倣って削除し、正本注記に書く** | Stage 行などは工程の記録であって設計ではない。項目がすべて反映済みの申し送りの表も同じ扱いにする |

## 3. 設計

### 3.1 配置と文書の形

| 正本 | 複写元（`aidlc/spaces/default/intents/260728-rolust-iam-trust/` 配下） | 改行コード |
|---|---|---|
| `docs/design/cicd-pipeline.md` | `construction/infrastructure-design/cicd-pipeline.md` | LF |
| `docs/design/cd-config.md` | `operation/deployment-pipeline/cd-config.md` | CRLF（維持する。Edit ツールで直す） |

`docs/design/` に同名の既存ファイルは無い。

**役割の分担**

- `cicd-pipeline.md` は CI ロールの設計と承認者の観点を持つ。
  - OIDC ロール 2 本
  - 信頼ポリシー
  - 権限ポリシー（現行の JSON）
  - 作成手順
  - 決定 A（PR 経路の権限境界）
  - 赤信号 R-1〜R-9 と黄信号 Y-1〜Y-5
  - CI 側への影響
- `cd-config.md` は CD の運用を持つ。
  - 決定事項（Q1'・Q2・D-1〜D-6）
  - 前提 P-1〜P-4 の現況
  - リポジトリ変数
  - パイプライン構成
  - guard の設計
  - スモークテストの判定
  - 未決事項

**正本注記**は既存の 5 本の書式に倣う。項目は、位置づけ・複写元・照合の範囲・訂正の全体像・未決の 5 つである。

**AI-DLC の工程の残骸**

- 削除するもの:
  - Stage・Scope・Depth・Lead の行
  - `cicd-pipeline.md` § 4.1 の再実行への申し送り（9 項目とも反映済み）
  - `cd-config.md` § タグ方式移行への追随 のうち、再実行の差分の記録（「何が古くなっていたか」「何を変えたか」）
- 残すもの:
  - 設計の内容を持つ節（`cd-config.md` § CD から見たタグ方式の帰結）
  - `Upstream Inputs`
  - 冒頭の再実行の注記。経緯の要約として、正本注記の下へ移す

**旧形式の `sub` を持つ凍結文書 7 本**

`cicd-pipeline.md` の正本注記に列挙し、「`sub` の値と CI ロールの権限の記述は現行ではない」と書く。7 本はいずれも `<intent>/` 配下にある。

- `construction/infrastructure-design/cicd-pipeline.md`
- `construction/infrastructure-design/deployment-architecture.md`
- `construction/nfr-requirements/security-requirements.md`
- `operation/deployment-pipeline/cd-config.md`
- `operation/environment-provisioning/environment-inventory.md`
- `operation/environment-provisioning/memory.md`
- `operation/environment-provisioning/validation-report.md`

### 3.2 照合（既知の食い違いの総当たり）

`docs/design/README.md` の手順の 5 つの源泉から、次の食い違いを列挙した。実装の時点で、各項目を現在のコードまたは AWS の実測で裏を取ってから直す。記録上の食い違いが後で解消されていることがあるためである。

各訂正には「Issue #39 により 2026-09-26 訂正」の来歴を、訂正後の文言と同じ行に付ける。結論を確定できないものは直さず、正本注記の「未決」に挙げて人間の判断を仰ぐ。

**`cicd-pipeline.md`**

| # | 箇所 | 訂正 | 源泉 |
|---|---|---|---|
| C-1 | § 信頼ポリシー 2 本 | `sub` を不変 ID の形式（`repo:kazuki-kudo@13983136/rolust@1318055439:…`）にする（#38）。`StringEquals` の完全一致と `aud` の条件は変わらない | rules |
| C-2 | § 信頼ポリシー — `rolust-ci-apply` | `environment:production` の `sub` はどのブランチからの実行でも一致する。IAM 側では区別できず、`main` 限定の deployment branch policy が唯一の塞ぎ方であり、2026-09-16 に設定済みであることを書く | 記録（V-8、validation-report 申し送り 5） |
| C-3 | § 権限ポリシー — `rolust-ci-plan` | `get-role-policy` で実測した現行の JSON に置き換える。変わる点は次の 2 つ。(1) `kms:ViaService` から `s3.ap-northeast-1.amazonaws.com` を削除した（state バケットが SSE-S3 のため。KMS に引き上げる場合の値は `s3.us-east-1.amazonaws.com`）。(2) #38 で `dynamodb:DescribeTimeToLive`・`cloudwatch:DescribeAlarms`・`cloudwatch:ListTagsForResource` を追加した。Sid 名も実体（`DecryptSecureString`）に合わせる | 記録（environment-inventory D-2）・rules |
| C-4 | § 権限ポリシー — `rolust-ci-apply` | 実測した現行の JSON に置き換える（`ReadIamForRefresh`、#40 の `cloudwatch:*`・`DescribeKmsKeysForRefresh`、`DecryptSecureString`）。「plan の全権限に加えて」と書きつつ差分だけを列挙していた点を、実体（読み取りも明示する）に合わせる | 記録（environment-inventory D-1）・rules |
| C-5 | 同上の説明 | 「`managed_role_name_prefix` による絞り込みと同じ発想」を、タグ方式の現行に改める | rules |
| C-6 | § 赤信号 | R-1 を `quality-gates.md` § R-1 の到達範囲の判定基準に置き換え、R-9 を末尾に足す。R-2・R-4・R-6 の行番号での参照（`infra/lambda.tf` L103-108 など）を、節名・資源名での参照に改める | 記録（`quality-gates.md`）・README の規約 |
| C-7 | § 黄信号 Y-1 | `managed_role_name_prefix` をタグ 2 変数（`managed_tag_key`・`managed_tag_value`）に改める。「タグの付け外しは plan に現れない」を足す | 記録（`cd-config.md` § 黄信号）・rules |
| C-8 | § 前提の充足状況・§ 作成手順 | P-3 は 2026-08-23 に作成済み（タグ `ManagedBy=manual-4.2`、Terraform の管理外）。P-4 は GitHub のプラン制限で設定できない（V-21）。作成手順は再現用として残し、信頼ポリシーの `sub` とタグの付与を現行に合わせる | 記録（validation-report） |
| C-9 | § CI 側への影響 | `ci.yml` の `plan-guard` ジョブと bootstrap の validate が実装済みであることを書く。`ci.yml` L134・L135 などの行番号での参照を改める | コード |
| C-10 | § 未決事項 | 1（未作成）と 4（R の自動化）は解消済みにする。2（least-privilege でない）は残し、#40 で決めた「書き込み権限はサービス単位で足す」方針との関係を書く。5（P-4）はプラン制限に改める | 状態欄・rules |

**`cd-config.md`**

| # | 箇所 | 訂正 | 源泉 |
|---|---|---|---|
| D-1 | § この CD は、前提が揃うまで動かない | P-1〜P-4 の表と有効化の順序を現況（C-8）に合わせる。`production` は「承認なし・`main` 限定」で存在し、`AWS_DEPLOY_ROLE_ARN` を置いた時点で `main` への push が承認なしで apply に到達することを書く | 記録・rules |
| D-2 | § リポジトリ変数 | 4 件は設定済み、`AWS_DEPLOY_ROLE_ARN` は未設定であることを書く | 実測 |
| D-3 | § plan の赤信号を機械で止める | 「現行の判定基準は 3.7 側（`quality-gates.md`）が持つ」を、正本の `cicd-pipeline.md` § 赤信号を指すように改める | 本 spec の決定 |
| D-4 | § 未決事項と申し送り 5・6 | 5（`plan-guard.test.sh` が CI で走らない）は `ci.yml` の `plan-guard` ジョブで解消済みにする。6（実 plan で未実行）は、#38 以降に CD の `plan`・`guard` が実際に走った実績を `gh run` で確かめてから改める | 状態欄・コード |
| D-5 | § Q1 は Q1' に上書きされた | PR の `sub` の例を、不変 ID の形式にする | rules |
| D-6 | § Upstream Inputs ほか | 相対パス（`../../construction/…`）で書かれた凍結文書を、`aidlc/` のフルパスか `docs/design/` の正本に改める | README の規約 |

**照合しないもの**: 上の源泉から出てこない本文は照合しない。例として、「CD は CI の完了を待たない」の前提になるブランチ保護の現況がある。正本注記の「照合の範囲」に「未照合」と明記する。

### 3.3 参照の張り替え

**書き換えるもの**

| ファイル | 変更 |
|---|---|
| `.github/workflows/cd.yml` | 冒頭の `cd-config.md`・`cicd-pipeline.md` のフルパスを `docs/design/` に改める。`quality-gates.md` を現行の基準として指すコメント（`guard` ジョブ）を、`cicd-pipeline.md` § 赤信号を指すように改める。冒頭コメントの P-3「設計済み・未作成」と P-4 を現況に直す。動作は変わらない |
| `.github/workflows/ci.yml` | `terraform` ジョブのコメントの `.../cicd-pipeline.md` を `docs/design/` に改める |
| `.github/scripts/plan-guard.sh` | 冒頭のフルパスを改める。出力の案内にある `quality-gates.md § R-1 / § R-9` を、正本の `cicd-pipeline.md` を指すように改める |
| `docs/design/README.md` | 文書の表に 2 本を足す。本文が名指す凍結文書（`quality-gates.md`・`ci-config.md`・`deployment-strategy.md`・`rollback-runbook.md`・`deployment-architecture.md` など）の所在を、ソースタグの表に足す |
| `README.md` | § 構成 の表の `docs/design` の説明に「CI/CD の設計」を足す |
| `CLAUDE.md` | § 構成 の `docs/design/` の説明に CI/CD を足す |

**書き換えないもの**

- `infra/backend.tf`・`infra/bootstrap/versions.tf`。Issue には挙がっているが、指しているのは切り出さない `deployment-architecture.md` である。
- `ci.yml` 冒頭の `ci-config.md`・`quality-gates.md`（G-1〜G-11 の在処）と、`cd.yml` 冒頭の `deployment-strategy.md`・`rollback-runbook.md`。凍結のまま残る文書を指している。
- `.gitignore` の `cd-config.md`。ファイル名だけの参照であり、README の規約で `docs/design/` に解決される。

### 3.4 規則の整理（`.claude/rules/aws-infra.md` § CI/CD）

- **正本へ移す事実**:
  - `sub` の現行値
  - CI ロールの権限の追加履歴（#38・#40 の個々のアクション）
  - 移した跡には、正本の節への参照を置く。
- **rules に残す規則**:
  - P-4 が未完了なら変数を置かない
  - 外部サービスの中間状態の扱い
  - `sub` を仮定せず実測する
  - 両ロールは Terraform の管理外で、変更は CLI で行う
  - 資源型を足したら洗い出して両ロールに足す（手順と抽出の注意を含む）
  - 書き込み権限はサービス単位で足す
  - `.trivyignore.yaml` の規則
- **足す規則**: CI ロールの信頼ポリシーや権限ポリシーを変えたら、正本の `cicd-pipeline.md` の JSON も同じ PR で直す。IaC の外にある実体と文書の二重化が、静かに食い違うのを防ぐためである。

### 3.5 検証

文書と CI 設定は TDD の例外なので、機械的に判定する。雛形は #26 の plan（`docs/superpowers/plans/2026-09-24-living-design-docs.md`）の Task 7 の検証スクリプトである。

1. `git diff --stat main -- aidlc/` が空であること。
2. 複写元の ID と見出しがすべて正本にあること。対象は P-1〜P-4、R-1〜R-8、Y-1〜Y-5、Q1'・Q2・D-1〜D-6、§ 見出し。3.1 で削除する節は除く。R-9 は正本にだけある。
3. 3.2 の訂正の各項目について、訂正後の文言と来歴（`Issue #39 により 2026-09-26`）が同じ行にあること。
4. 張り替えたパス参照の先が実在すること。
5. 正本・`.claude/`・`.github/` に旧形式の `sub`（`repo:kazuki-kudo/rolust:`）が残っていないこと（`grep`）。
6. 正本の権限ポリシーの JSON 2 本と信頼ポリシーの JSON 2 本が、AWS の実測（`get-role-policy`・`get-role`）と `jq -S` で一致すること。
7. `plan-guard.test.sh` が PASS=37 / FAIL=0 のままであること。
8. CRLF の `cd-config.md` について、`git diff --numstat` と改行コードの統計で、差分が意図した箇所だけであること。
9. push の前に gitleaks 8.30.1 を実行すること（`gitleaks git . --no-banner --redact --exit-code 1`）。
10. `.github/` のコメントを変えるので、PR の CI（`ci.yml`）が緑であることを確かめる。

## 4. 正本への反映

- 足すもの: `docs/design/cicd-pipeline.md` と `docs/design/cd-config.md` の 2 本（新しい正本）。`docs/design/README.md` の文書の表とソースタグの表に行を足す。
- 覆すもの: なし。既存の 5 本（`requirements.md`・`mockups.md`・`interaction-spec.md`・`design-system-mapping.md`・`iam-policy-design-note.md`）と `packages/api/TABLE-DESIGN.md` の ID と節は変えない。
