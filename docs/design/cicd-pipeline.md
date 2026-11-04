# CI/CD Pipeline — Rolust（インフラ視点）

> **追記注記**（Issue #248 により 2026-11-03 追記）: Node の下限を 24 に上げ、`build-floor`（Node 20.19 でビルドするジョブ）を廃止したため、CI のジョブは 7 つになった。§ CI 側への影響 の表と、§ CI と同じ検査を手元で走らせる のジョブ数・`SKIP` の説明に、同じ来歴を付けた。経緯は `ci-config.md` の D-6。
> **追記注記**（Issue #240 により 2026-11-03 追記）: `release-artifacts` ジョブの `release.test.sh` が、`changelog-section.sh`（`CHANGELOG.md` から版の節を取り出す）と、`check-release.sh` の `CHANGELOG.md` の節の検査も確かめる。ジョブの構成・権限は変わらない。`release.yml` の変更は `cd-config.md` の追記注記（同 Issue）にある。
> **追記注記**（Issue #199 により 2026-10-25 追記）: 「CI 側への影響」に § CI と同じ検査を手元で走らせる を新設した。CI は全ジョブが AWS の資格情報を持たないため手元で全部再現でき、`.github/scripts/ci-local.sh` がそれを行う。GitHub の利用上限でジョブが起動しなくなったとき（2026-10-24）に、唯一の判定経路になる。ワークフロー（`ci.yml`）の内容と ID・節番号は変えていない。
> **追記注記**（Issue #194 により 2026-10-23 追記）: OSS 公開前のセキュリティ点検により、CI 自身の供給経路を 2 点固めた。サードパーティの action を可変タグ（`@v4` など）ではなく commit SHA で固定し、`ci.yml` が取得する Trivy と gitleaks の tarball を SHA-256 で照合してから展開するようにした。CI の前提として § CI 側への影響 に追記した。ジョブの構成・ゲートの判定・しきい値は変えていない。
> **追記注記**（Issue #181 により 2026-10-19 追記）: 公開リポジトリでは `cd.yml` を廃止し（`cd-config.md` D-8）、CI ロール `rolust-ci-plan` を削除した。`rolust-ci-plan` を引き受けるワークフローが無くなったためである（`ci.yml`・`release.yml` は AWS の資格情報を使わない）。このロールの信頼ポリシー・権限ポリシー・作成手順は、再作成するときの記録として残す。新リポジトリ向けの信頼ポリシーの更新は行わない（再作成するなら、§ 信頼ポリシー — `rolust-ci-plan` の `sub` をそのときのリポジトリの不変 ID に改める）。OIDC プロバイダはアカウント共通なので残す。
> **追記注記**（Issue #178 により 2026-10-18 訂正）: `README.md` の利用者向けの手順を `docs/guide/` に分けたため、README の節・手順を指していた参照を `docs/guide/` の文書に張り替えた（対応は `docs/superpowers/specs/2026-10-18-readme-split-design.md`）。NFR-4・SM-2 の「README と Terraform」という総称は、変えない（Issue #179 により 2026-10-19 訂正: 訂正前は「Issue #179 で扱うので変えていない」とした。README は入口で手順は `docs/guide/` にあるが、総称は今も通じるため）。ID と節番号は変えない。
> **追記注記**（Issue #176 により 2026-10-18 追記）: OSS 公開の準備として、実値を取り除いた。ポリシー例の AWS アカウント ID を `<ACCOUNT_ID>`、Terraform state のバケット名を `<TERRAFORM_STATE_BUCKET>` に置換し（§ 信頼ポリシー・§ 権限ポリシー・§ 作成手順の変数設定の例。形と ID（P-1〜P-4 など）は変えない）、プロファイル名 `jump-admin` を「自分のプロファイル（`AWS_PROFILE`）」に一般化した（P-3 の記述、§ OIDC プロバイダの `--profile`、§ 作成手順の `export AWS_PROFILE`）。
> **追記注記**（Issue #93 により 2026-10-08 追記）: 表記の空白を外した（IAMユーザ・IAMロール・AWSアカウントID）。ID と内容は変えていない。
> **正本注記**（Issue #39 により 2026-09-26 追記）
>
> - **位置づけ**: 本書は Rolust の CI/CD のうち、CI ロール（現存する `rolust-ci-plan` と、Issue #51 で削除した `rolust-ci-apply` の再作成用の記録）の設計（Issue #51 により 2026-09-26 訂正）と、承認者のための plan の読み方（赤信号 R-1〜R-12（Issue #24 により 2026-09-27 訂正。Issue #76 により 2026-09-29 訂正。Issue #85 により 2026-09-30 訂正）・黄信号 Y-1〜Y-5）の正本である。CD の運用（前提 P-1〜P-4・リポジトリ変数・パイプライン構成・guard）は `cd-config.md` にある。変更は `CLAUDE.md` § 開発フロー の規則に従い、実装と同じ PR で行う。CI ロールは Terraform の管理外なので、ロールを変えたら本書の JSON も同じ PR で直す。
> - **複写元**: `aidlc/spaces/default/intents/260728-rolust-iam-trust/construction/infrastructure-design/cicd-pipeline.md`（2026-08-11 作成、2026-09-26 複写）。複写元は凍結した経緯として残る。
> - **照合の範囲**: `docs/superpowers/specs/2026-09-26-cicd-design-docs-design.md` 3.2 の源泉から列挙した食い違い（C-1〜C-10）を、AWS の実測（2026-09-26、`iam get-role`・`iam get-role-policy`）と `.github/`・`infra/` に照合して訂正した。それ以外の記述は照合していない（未照合）。
> - **訂正の全体像**: Stage・Scope の行と § 4.1 の再実行への申し送り（9 項目とも反映済み）を削除した。信頼ポリシーの `sub` を不変 ID の形式に改め、apply ロールの `sub` を deployment branch policy が塞ぐことを追記した。権限ポリシー 2 本を実測した現行の JSON に置き換えた（作成時の差分と Issue #38・#40 の追加を含む）。赤信号 R-1 を到達範囲の判定基準に置き換え、R-9 を足した（取り込み元は `construction/ci-pipeline/quality-gates.md` § plan-guard の赤信号）。黄信号 Y-1 をタグ方式に改めた。P-3 の完了と、P-4 がプラン制限で成立しないことを反映した。凍結文書への相対パスと行番号での参照を改めた。
> - **未決**: なし。
> - **現行ではない凍結文書**: 次の凍結文書（`aidlc/spaces/default/intents/260728-rolust-iam-trust/` 配下）にある CI ロールの `sub` の値と権限の記述は現行ではない。現行は本書にある。
>   - `construction/infrastructure-design/cicd-pipeline.md`
>   - `construction/infrastructure-design/deployment-architecture.md`
>   - `construction/nfr-requirements/security-requirements.md`
>   - `operation/deployment-pipeline/cd-config.md`
>   - `operation/environment-provisioning/environment-inventory.md`
>   - `operation/environment-provisioning/memory.md`
>   - `operation/environment-provisioning/validation-report.md`
> - 本文がファイル名だけで名指す凍結文書（`quality-gates.md` など。`deployment-strategy.md` は Issue #4 により 2026-09-27 正本に切り出した）とソースタグの所在は `docs/design/README.md` にある。

> **追記注記**（Issue #51 により 2026-09-26 訂正）
>
> - **変更の全体像**: P-4 は恒久的に成立させない（`cd-config.md` D-7）。承認なしで引き受けられる経路を塞ぐため、apply ロール `rolust-ci-apply` を削除した。削除の直前に、実体の信頼ポリシー・権限ポリシー・タグが本書の JSON と一致することを確かめた。§ 信頼ポリシー — `rolust-ci-apply`・§ 権限ポリシー — `rolust-ci-apply` は再作成用の記録として残す。§ 前提の充足状況・§ OIDC ロール・§ ロールを 2 つに分ける・§ 作成手順・§ 承認者のための plan 読み方・§ CI 側への影響 を改め、未決事項 2・5 を解消とした。
> - **設計**: `docs/superpowers/specs/2026-09-26-close-cd-apply-path-design.md`

> **追記注記**（Issue #24 により 2026-09-27 追記）
>
> - **変更の全体像**: 赤信号に R-10（plan 内の全 `aws_iam_role` が `DenySelfEscalation` の `Resource` に含まれる）を足し、`.github/scripts/plan-guard.sh` に実装した。Rolust が作るロールを増やして `infra/main.tf` の `self_role_arns` に加え忘れる漏れを、R-2（件数の減少）では捕まえられないため。現行の一覧を指す「R-1〜R-9」を R-1〜R-10 に改めた（位置づけ・§ 赤信号・§ 読み方の実務・§ CI 側への影響・未決事項 4）。
> - **設計**: Issue #24 のチャットで承認した bounded な設計（spec なし）。規則一覧を持つ場所は、Issue #39 で正本として切り出し済みの本書とした。

> **追記注記**（Issue #76 により 2026-09-29 追記）
>
> - **変更の全体像**: 赤信号に R-11（API Gateway の直 URL を塞ぐ設定が外れていないか）を足し、R-8 の対象に IP 許可リストのパラメータ `aws_ssm_parameter.ip_allowlist` を加えた。`.github/scripts/plan-guard.sh` に実装した。現行の一覧を指す「R-1〜R-10」を R-1〜R-11 に改めた（位置づけ・§ 読み方の実務・§ CI 側への影響・未決事項 4）。当時の範囲を述べる記述は経緯として残す。
> - **設計**: `docs/superpowers/specs/2026-09-29-ip-allowlist-and-api-key-design.md`

> **追記注記**（Issue #80 により 2026-09-30 追記）
>
> - **変更の全体像**: CRUD の実行ロールに `iam:GetRole`（タグ条件つき。`aws_iam_role_policy.crud_iam_read_trust`）を足したのに合わせ、R-1・R-3 の対象に `crud_iam_read_trust` を加え、R-9 を「CRUD の 2 つのポリシー（`crud_iam_read_tags`・`crud_iam_read_trust`）の Action が、それぞれ設計の 1 つだけか」に広げた。赤信号の番号は増やしていない（R-1〜R-11 のまま）。`.github/scripts/plan-guard.sh` と `plan-guard.test.sh` に実装した。
> - **設計**: `docs/superpowers/specs/2026-09-30-role-unlink-and-trust-import-design.md`

> **追記注記**（Issue #85 により 2026-09-30 追記）
>
> - **変更の全体像**: 赤信号に R-12（別アカウントへの `sts:AssumeRole` の到達範囲）を足した。Lambda の実行ロールが引き受けられるのは、`crud_assume_target_reader`・`diff_assume_target_reader`（Reader）と `apply_assume_target_manager`（Manager）の 3 ポリシーだけで、Action は `sts:AssumeRole` 単体、Resource はロール名固定（アカウントだけ `*`）、CRUD・Diff は Reader だけ・Apply は Manager だけを指すこと、ほかのポリシーに `sts` の Action が現れないことを見る。`.github/scripts/plan-guard.sh` と `plan-guard.test.sh` に実装した。現行の一覧を指す「R-1〜R-11」を R-1〜R-12 に改めた（位置づけ・§ 読み方の実務・§ CI 側への影響・未決事項 4）。当時の範囲を述べる記述は経緯として残す。
> - **追記**（最終レビューを受けて Issue #85 により 2026-10-02）: R-12 の死角を塞いだ。(d) の Action の照合を大文字小文字を区別しない形にし、Allow の `NotAction` を赤信号に足した。(e) 実行ロールへの管理ポリシーのアタッチと、`aws_iam_role` の `inline_policy`・`managed_policy_arns` の増加を赤信号に足した。(f) 3 ポリシーの `role` 属性を `<project_name>-{crud,diff,apply}-exec` と突き合わせる。(g) 3 ポリシーの `NotAction`・`NotResource` を赤信号に足した。あわせて、jq のプログラムを引数ではなく一時ファイル（`jq -f`）で渡すようにした: プログラムが約 32KB を超えると、Windows の Git Bash では「Argument list too long」で全件が落ちる（apply 前の検査は Git Bash で走らせる）。R-3・R-4 の同じ型の死角（大文字小文字、`NotAction`）は、この変更では直していない。
> - **設計**: `docs/superpowers/specs/2026-09-30-cross-account-roles-design.md`

> **追記注記**（Issue #20 により 2026-10-05 追記）
>
> - **変更の全体像**: 認証方式（`auth_mode`。`basic` / `cognito`）を足した。plan-guard の赤信号は増やさない（どの設定の誤りも edge-auth が 503 で通さず、認証が外れる経路が無い）。`cognito` を `main` で使うとき、plan ロール `rolust-ci-plan` が Cognito を refresh できる権限が要る（§ 権限ポリシー。実測で確定した後に反映する）。R-5 の「401 を期待」は `basic` のもので、`cognito` では 302（`/api/` は 401）。
> - **設計**: `docs/superpowers/specs/2026-10-05-admin-auth-cognito-design.md`

> **追記注記**（Issue #92 により 2026-10-13 追記）
>
> - **変更の全体像**: `ci.yml` に `release-artifacts` ジョブ（`cfn-lint` でターゲット側ロールのテンプレートを、`target-roles.test.sh` でその権限の不変条件を、`release.test.sh` で Release の検査の回帰を確かめる）を足し、`iac-scan`（Trivy）の対象に `cloudformation/` を足した。`release.yml`（タグ `v*` で tarball を作って Release に添付する）を足した。権限は `contents: write` だけで、AWS の資格情報を持たない。plan-guard の赤信号は増やさない（R-12 はデプロイ先の Terraform だけを見る。ターゲット側の権限は `target-roles.test.sh` が見る）。
> - **設計**: `docs/superpowers/specs/2026-10-13-user-deploy-release-design.md`

> **追記注記**（Issue #170 により 2026-10-15 追記）
> 
> - **変更の全体像**: 乖離の確認の経路 `/api/drift`（`infra/apigateway.tf` の `api_leaf_routes` の `drift`）を足したのに合わせ、R-11 の記述に、対象が `aws_api_gateway_method` の全メソッドで、`leaf` の全エントリ（`diff`・`drift`・`apply`）を含むことを足した。検査の中身（`api_key_required` が `true` でないとき赤信号）は変えない。`plan-guard.test.sh` に `leaf["drift"]` の回帰を足した。IAM ポリシーは変えないので、ほかの赤信号の対象は変わらない。
> - **設計**: `docs/superpowers/specs/2026-10-15-trust-drift-check-design.md`

> **追記注記**（Issue #172 により 2026-10-16 追記）
> 
> - **変更の全体像**: 乖離を直す操作の経路 `/api/drift/restore`・`/api/drift/adopt`（`infra/apigateway.tf` の `drift_child`。`/api/drift` の子リソース）を足したのに合わせ、R-11 の記述に、対象の `aws_api_gateway_method` に `drift_child` の 2 経路が含まれることを足した。検査の中身（`api_key_required` が `true` でないとき赤信号）は変えない。`plan-guard.test.sh` に `drift_child["restore"]`・`drift_child["adopt"]` の回帰を足した。IAM ポリシーは変えないので、ほかの赤信号の対象は変わらない。
> - **設計**: `docs/superpowers/specs/2026-10-16-drift-repair-design.md`

## 本書の立場

CI と CD は**既に別ステージで設計されている**。本書はそれらを設計し直すものではない。

| 既存成果物 | ステージ | 扱っている範囲 |
|---|---|---|
| `aidlc/spaces/default/intents/260728-rolust-iam-trust/construction/ci-pipeline/ci-config.md` / `quality-gates.md` | ci-pipeline (3.7) | GitHub Actions の CI 6 ジョブ / ゲート G-1〜G-10（Issue #39 により 2026-09-26 追記: 当時の数。現在の `ci.yml` は `plan-guard` を含む 7 ジョブ、ゲートは G-1〜G-11） |
| `docs/design/cd-config.md`、`docs/design/deployment-strategy.md`（Issue #4 により 2026-09-27 訂正: 正本に切り出した）、`docs/design/rollback-runbook.md`（Issue #5 により 2026-09-27 訂正: 正本に切り出した） | deployment-pipeline (4.1) | CD の構成、in-place 戦略、ロールバック手順 |

（Issue #39 により 2026-09-26 訂正: 相対パスをフルパスと正本に改めた）

本書が担うのは、**それらが「インフラ側の担い手がいない」として残した 3 点**である。

| # | 残されていた課題 | 名指しした箇所 | 本書での扱い |
|---|---|---|---|
| P-1 / P-2 | Terraform state のリモート化とブートストラップ | `cd-config.md` § この CD は、前提が揃うまで動かない | **解消**（`deployment-architecture.md` § Terraform state のバックエンド） |
| P-3 | GitHub Actions 用 OIDC ロール | 同上 | **本書 § OIDC ロール**（質問 2 = C: Terraform で作らず設計と手順を示す） |
| — | `terraform plan` の IAM 差分レビュー観点 | `deployment-strategy.md` § 未決事項 3（担い手は「3.4 か 4.2」） | **本書 § 承認者のための plan 読み方** |

## Upstream Inputs

`deployment-architecture.md` § Upstream Inputs と同一。宣言された 8 件
（`performance-design` / `security-design` / `scalability-design` / `reliability-design` /
`logical-components` / `components` / `services` / `business-logic-model`）はすべて不在であり、
ステージ本文の代替手順により実在する成果物から導出した（Issue #39 により 2026-09-26 訂正: 行番号での参照を改めた）。

## 前提の充足状況（`cd-config.md` P-1〜P-4 の更新）

| # | 前提 | `cd-config.md` 時点 | **現況**（Issue #39 により 2026-09-26 訂正） |
|---|---|---|---|
| P-1 | Terraform state のリモート化 | 未対応 | **解消**。2026-08-21 に `terraform init` が実地で成立した（バケットの実リージョンは us-east-1）（Issue #39 により 2026-09-26 訂正: 列見出しを現況に改めたのに合わせた）。依頼者が既存バケット `<TERRAFORM_STATE_BUCKET>` を提供済み。鍵は `rolust/infra/terraform.tfstate`。ロックは S3 ネイティブ（`use_lockfile`）で DynamoDB テーブル不要 |
| P-2 | バックエンド用リソースのブートストラップ | 未着手 | **`jump` では不要**（バケット作成済み）。第三者向けに `infra/bootstrap/` を任意実行の経路として用意 |
| P-3 | GitHub Actions 用 OIDC ロール | 未作成 | **作成済み**（2026-08-23、管理者のプロファイル（`AWS_PROFILE`）で CLI により作成（Issue #176 により 2026-10-18 一般化）。タグ `Project=rolust`・`ManagedBy=manual-4.2`。Terraform の管理外）（Issue #39 により 2026-09-26 訂正）。`rolust-ci-apply` は Issue #51 で削除した（2026-09-26。Issue #51 により 2026-09-26 追記）。**Issue #181 により 2026-10-19 に削除した**（`cd-config.md` D-8） |
| P-4 | GitHub Environments の protection rule | 未設定 | **成立させない**（`cd-config.md` D-7）。Environment `production` は `main` 限定の deployment branch policy だけを持ち、承認者が無い。Required reviewers は private リポジトリ ＋ GitHub Free では作れず（2026-09-16 に 422 で実測）、GitHub のプランは変えない（Issue #51 により 2026-09-26 訂正） |

**CD は apply しない**（Issue #181 により 2026-10-19 訂正: CD 自体を廃止した。`cd-config.md` D-8。以下は廃止前の記述）。`main` への push で `plan` と `guard` が走るだけであり、apply ジョブと apply ロールは外した。反映は `docs/guide/` の手動経路（Issue #178 により 2026-10-18 訂正）で行う（`cd-config.md` D-7。Issue #51 により 2026-09-26 訂正）。

## OIDC ロール

**質問 2 = C の実装。** Terraform では作らない。理由は質問文に記したとおり、このロールが
`iam:CreateRole` / `iam:PutRolePolicy` / `iam:PassRole` を持ち、**Rolust 自身の実行ロールを
作り替えられる特権の集中点**であるためである。Rolust 本体が `DenySelfEscalation`
（`infra/lambda.tf` の `apply_iam_write` の Sid。Issue #39 により 2026-09-26 訂正: 行番号での参照を改めた）で自己昇格の閉路を塞いでいるのに対し、この経路は塞げない。
IaC の外に置き、作成を明示的な人の操作にする。

（Issue #51 により 2026-09-26 追記: この特権を持つ `rolust-ci-apply` は、承認ゲート P-4 が成立しないため削除した。現存する CI ロールは `rolust-ci-plan` だけである）

### ロールを 2 つに分ける

`cd-config.md` は単一のリポジトリ変数 `AWS_DEPLOY_ROLE_ARN` を前提としているが、
**plan と apply を別ロールに分けることを設計として提案する。**

| ロール | 引き受けられる文脈 | 権限 |
|---|---|---|
| `rolust-ci-plan` | **`main` への push のみ。PR は含めない**（§ 決定 — PR 経路の権限境界） | 読み取り + state のロック/書き込み + SSM 読み取り |
| `rolust-ci-apply` | **GitHub Environment `production` の承認を経たジョブのみ** | apply に必要な作成・更新権限 |

**`rolust-ci-apply` は Issue #51 で削除した（2026-09-26）。** P-4 が成立しない以上、`environment:production` の `sub` は承認の有無を分けないためである。2 つに分ける設計は、P-4 を成立させてロールを再作成するときの設計として残す（`cd-config.md` D-7。Issue #51 により 2026-09-26 追記）。

分ける理由は OIDC の `sub` クレームの粒度にある。GitHub Environment を使うジョブの `sub` は
`repo:<owner>@<owner-id>/<repo>@<repo-id>:environment:production` になり、**protection rule の承認を通過した
実行だけ**がこの値を持つ。単一ロールにすると、承認を経ていない `main` への push の
plan ジョブが apply 相当の権限を引き受けられてしまう。**承認の有無が引き受けられる権限を
分ける**——これが 2 つに分ける理由である（Issue #39 により 2026-09-26 訂正: `sub` を不変 ID の形式に改めた。P-4 が成立していない現在は、承認が無いため `main` 上の実行であればこの値を持つ。§ 信頼ポリシー — `rolust-ci-apply` を見る）（Issue #51 により 2026-09-26 訂正: この値を信頼するロールは削除したため、現在この値で引き受けられるロールは無い）。

**PR からはどちらのロールも引き受けられない。** `sub` は PR ごとに区別できず
（どの PR でも `repo:<owner>@<owner-id>/<repo>@<repo-id>:pull_request` で同一。Issue #39 により 2026-09-26 訂正）、信頼ポリシーの側で正当な PR と
悪意ある PR を分ける手段が無い。詳細と、この境界を選んだ経緯は § 決定 — PR 経路の権限境界 にある。

**`cd.yml` は変数を 2 つ（`AWS_PLAN_ROLE_ARN` / `AWS_DEPLOY_ROLE_ARN`）取る形になる。**
`cd.yml` の実体を持つのは deployment-pipeline (4.1) であり、本ステージの後方ジャンプにより
4.1 は state 上リセットされ再実行される。この設計はその再実行で反映される（Issue #39 により 2026-09-26 追記: 反映済み。`cd.yml` は `AWS_PLAN_ROLE_ARN`・`AWS_DEPLOY_ROLE_ARN` を取る）。（Issue #51 により 2026-09-26 訂正: `apply` ジョブを外したため、現在の `cd.yml` は `AWS_PLAN_ROLE_ARN` だけを取る）

### OIDC プロバイダ

アカウントに 1 つだけ作る（既存があれば再利用する）。

```
プロバイダ URL: https://token.actions.githubusercontent.com
対象者 (audience): sts.amazonaws.com
```

```bash
aws iam create-open-id-connect-provider \
  --url https://token.actions.githubusercontent.com \
  --client-id-list sts.amazonaws.com \
  --profile <自分のプロファイル>
```

> **既存確認を先に行うこと。** `aws iam list-open-id-connect-providers` で既にあれば作らない。
> 同一 URL のプロバイダは 1 アカウントに 1 つしか作れず、二重作成は
> `EntityAlreadyExists` になる。4.2 の確認項目に含める。

### 信頼ポリシー — `rolust-ci-plan`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:kazuki-kudo@13983136/rolust@1318055439:ref:refs/heads/main"
        }
      }
    }
  ]
}
```

`sub` は不変 ID の形式（`repo:<owner>@<owner-id>/<repo>@<repo-id>:…`）で書く。このリポジトリは OIDC の `sub` の設定が `use_immutable_subject: true` であり、形式が食い違うと `Not authorized to perform sts:AssumeRoleWithWebIdentity` としか現れない（Issue #39 により 2026-09-26 訂正。実体は Issue #38 で改めた）。

**`pull_request` は `sub` に含めない**（§ 決定 — PR 経路の権限境界）。plan ロールは
本番の Basic 認証資格情報を復号できるため、承認の要らない PR から引き受けられると
`rolust-ci-apply` に置いた人的承認をこの経路が迂回する（Issue #51 により 2026-09-26 追記: apply ロールを削除した後も、承認の要らない PR から本番の資格情報を復号できる経路を開かない、という理由は残る）。

apply ロールと同じく `StringEquals` の**完全一致**にした。許す `sub` が 1 つになったため
`StringLike` を使う理由が無くなり、ワイルドカードを書ける形を残さない方が安全である。
`ref:refs/heads/main` は `main` ブランチ上の実行だけに一致し、他ブランチの push や
タグ（`ref:refs/tags/*`）には一致しない。

### 信頼ポリシー — `rolust-ci-apply`

> **Issue #51 により 2026-09-26 削除。** 以下は再作成用の記録である。削除の直前に、実体の信頼ポリシーがこの JSON と `jq -S` で一致することを確かめた。再作成は P-4 を成立させてから行う（§ 作成手順）。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:kazuki-kudo@13983136/rolust@1318055439:environment:production"
        }
      }
    }
  ]
}
```

`sub` を `StringEquals` で**完全一致**にする。`StringLike` とワイルドカードの組み合わせは
`repo:kazuki-kudo@13983136/rolust@1318055439:*` のような広い一致を招きやすく、その場合はどのブランチの
どのイベントからでも apply ロールを引き受けられる（Issue #39 により 2026-09-26 訂正: 例の `sub` を不変 ID の形式に改めた）。**`aud` の条件を省いてはならない**
（省くと他者のリポジトリが発行したトークンでも条件を満たしうる）。

**`environment:production` の `sub` は、どのブランチからの実行でも一致する。** IAM 側では区別できないため、GitHub の deployment branch policy で Environment `production` を `main` に限ることが唯一の塞ぎ方であり、2026-09-16 に設定済みである（Issue #39 により 2026-09-26 追記。`aidlc/spaces/default/intents/260728-rolust-iam-trust/operation/environment-provisioning/validation-report.md` V-8）。

### 権限ポリシー — `rolust-ci-plan`

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadEverythingTerraformRefreshes",
      "Effect": "Allow",
      "Action": [
        "s3:Get*", "s3:List*",
        "cloudfront:Get*", "cloudfront:List*",
        "apigateway:GET",
        "lambda:Get*", "lambda:List*",
        "dynamodb:DescribeTable", "dynamodb:DescribeContinuousBackups", "dynamodb:ListTagsOfResource",
        "iam:Get*", "iam:List*",
        "logs:Describe*", "logs:ListTagsForResource",
        "ssm:GetParameter*", "ssm:DescribeParameters", "ssm:ListTagsForResource",
        "kms:DescribeKey",
        "dynamodb:DescribeTimeToLive",
        "cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource",
        "cognito-idp:DescribeUserPool", "cognito-idp:DescribeUserPoolClient", "cognito-idp:DescribeUserPoolDomain",
        "cognito-idp:GetUserPoolMfaConfig", "cognito-idp:ListTagsForResource", "cognito-idp:GetGroup"
      ],
      "Resource": "*"
    },
    {
      "Sid": "TerraformStateReadWriteAndLock",
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::<TERRAFORM_STATE_BUCKET>/rolust/*"
    },
    {
      "Sid": "DecryptSecureString",
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": ["ssm.us-east-1.amazonaws.com"]
        }
      }
    }
  ]
}
```

（Issue #20 により 2026-10-05 追記: `auth_mode = "cognito"` の `terraform plan` が refresh で呼ぶ Cognito の読み取り（`cognito-idp:DescribeUserPool`・`DescribeUserPoolClient`・`DescribeUserPoolDomain`・`GetUserPoolMfaConfig`・`ListTagsForResource`）を、1 つ目の Statement に足した。デバッグログの `rpc.method` と、`aws iam simulate-principal-policy` で実測した。`DescribeUserPoolDomain` はリソース指定をサポートしないので、シミュレーターは `Resource = "*"` で許可になる。書き込み系（`AdminCreateUser`・`DeleteUserPool` など）は許可しない。実体との一致は `jq -S` で確認した。）
（Issue #141 により 2026-10-07 追記: 権限のグループ（`aws_cognito_user_group`）を足したので、`terraform plan` の refresh が呼ぶ `cognito-idp:GetGroup` を、1 つ目の Statement の末尾に足した。足し忘れて、`main` への merge 後の CD の `terraform plan` が `AccessDeniedException`（`reading Cognito User Group`）で落ちて判明した。`aws iam put-role-policy` で足し、`aws iam simulate-principal-policy` で `allowed` を実測し、実体と上の JSON を `jq -S` で突き合わせて一致を確かめた。）

（Issue #39 により 2026-09-26 訂正: 実測した現行のポリシーに置き換えた。`kms:ViaService` から `s3.ap-northeast-1.amazonaws.com` を除き、Sid を `DecryptSecureString` にした。state バケットは SSE-S3 であり、state の読み書きに KMS は要らない。KMS に引き上げる場合の値は、バケットの実リージョンに合わせた `s3.us-east-1.amazonaws.com` である。`dynamodb:DescribeTimeToLive`・`cloudwatch:DescribeAlarms`・`cloudwatch:ListTagsForResource` は Issue #38 で足した。監視（4.4）で足した CloudWatch アラームと DynamoDB の TTL に、Terraform の管理外である plan ロールが追従しておらず、CD の plan の refresh が拒否されていたため）

**plan ロールが書き込みを持つのは state バケットの `rolust/` 配下だけ**である。
`use_lockfile` はロックオブジェクト（`<key>.tflock`）の作成・削除で排他を取るため、
`PutObject` / `DeleteObject` が要る。読み取りだけの権限では plan が失敗する。

**`ssm:GetParameter` を含める必要がある点に注意。** `terraform plan` は
`aws_ssm_parameter.basic_auth` を refresh するために SecureString を読み、
**その復号値を state と plan artifact に書き込む**（`docs/guide/limitations.md` § Terraform の state に（Issue #178 により 2026-10-18 訂正）
機微情報が入る、`cd-config.md` 申し送り 3）。plan ロールから外すことはできず、
**CI 上で Basic 認証の資格情報が読まれることは構造的に避けられない**。
plan artifact の保持期間を最小にすることが唯一の緩和策である。

### 権限ポリシー — `rolust-ci-apply`

> **Issue #51 により 2026-09-26 削除。** 以下は再作成用の記録である。削除の直前に、実体のインラインポリシー `terraform-apply` がこの JSON と `jq -S` で一致し、タグが § 作成手順 の `Project=rolust`・`ManagedBy=manual-4.2` であることを確かめた。

作成・更新・削除に加えて、refresh に要る読み取りも明示する。大半の読み取りは `ManageWorkloadResources` のサービス単位の許可に含まれ、IAM と KMS の読み取りは `ReadIamForRefresh`・`DescribeKmsKeysForRefresh` が持つ（Issue #39 により 2026-09-26 訂正: 複写元は「plan の全権限に加えて」と書きつつ差分だけを列挙しており、そのまま作ると読み取りを欠いた。`ReadIamForRefresh` と `DecryptSecureString` は初回作成時（2026-08-23）に、`cloudwatch:*` と `DescribeKmsKeysForRefresh` は Issue #40 で足した。`DescribeKmsKeysForRefresh` を条件なしにしたのは、`aws_dynamodb_table` の refresh が SSE の AWS 管理キー（`alias/aws/dynamodb`）を `kms:ViaService` を経ずに直接 `kms:DescribeKey` で読むためであり、`DecryptSecureString` の ViaService 条件では拒否される。`DescribeKey` はキーのメタデータを読むだけで暗号化・復号はできない）。

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ManageWorkloadResources",
      "Effect": "Allow",
      "Action": [
        "s3:*", "cloudfront:*", "apigateway:*", "lambda:*",
        "dynamodb:*", "logs:*", "ssm:*", "tag:*", "cloudwatch:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "ManageRolustExecutionRoles",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole", "iam:DeleteRole", "iam:UpdateAssumeRolePolicy",
        "iam:PutRolePolicy", "iam:DeleteRolePolicy",
        "iam:TagRole", "iam:UntagRole",
        "iam:AttachRolePolicy", "iam:DetachRolePolicy"
      ],
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/rolust-*"
    },
    {
      "Sid": "ReadIamForRefresh",
      "Effect": "Allow",
      "Action": ["iam:Get*", "iam:List*"],
      "Resource": "*"
    },
    {
      "Sid": "DescribeKmsKeysForRefresh",
      "Effect": "Allow",
      "Action": "kms:DescribeKey",
      "Resource": "*"
    },
    {
      "Sid": "PassOnlyRolustRoles",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::<ACCOUNT_ID>:role/rolust-*"
    },
    {
      "Sid": "DecryptSecureString",
      "Effect": "Allow",
      "Action": ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "kms:ViaService": ["ssm.us-east-1.amazonaws.com"]
        }
      }
    },
    {
      "Sid": "DenyTouchingCiRolesThemselves",
      "Effect": "Deny",
      "Action": "iam:*",
      "Resource": [
        "arn:aws:iam::<ACCOUNT_ID>:role/rolust-ci-plan",
        "arn:aws:iam::<ACCOUNT_ID>:role/rolust-ci-apply"
      ]
    },
    {
      "Sid": "DenyTouchingTheOidcProvider",
      "Effect": "Deny",
      "Action": ["iam:*OpenIDConnectProvider*"],
      "Resource": "*"
    }
  ]
}
```

**2 つの `Deny` が設計の要点である。**

| Sid | 塞ぐもの |
|---|---|
| `DenyTouchingCiRolesThemselves` | CI ロール自身の信頼ポリシー・権限を CI 経由で書き換える閉路。これを塞がないと、`main` に PR をマージできる者が CI ロールの権限を無制限に広げられる |
| `DenyTouchingTheOidcProvider` | プロバイダの `client-id-list` を書き換えて他リポジトリからの引き受けを許す経路 |

`iam:*` の `Resource` を `role/rolust-*` に絞っているため、**アカウント内の他のロールには
触れない**。CI ロールが作り替えるのは Terraform が作る Rolust 自身の実行ロールであり、その名前はすべて `rolust-` で始まる。Rolust 本体が管理対象のロールを絞る方式（タグ `aws:ResourceTag/<managed_tag_key>`）とは別物である（Issue #39 により 2026-09-26 訂正: 複写元は本体の `managed_role_name_prefix` と同じ発想としていたが、本体はタグ方式に移行済み）。

> **`ManageWorkloadResources` の `"*"` は least-privilege ではない。** `terraform apply` が
> 作る全リソースの action を漏れなく列挙するには実 apply での反復が要る。
> 現実的な運用として、**まず 4.2 / 4.3 の実 apply で `CloudTrail` の `AccessDenied` と
> 実際に使われた action を採取し、その実績から絞り込む**手順を推奨する。
> ここに書いた形は「動く出発点」であって完成形ではない。この開示なしに
> `"s3:*"` を least-privilege と称するのは誤りである。
>
> （Issue #39 により 2026-09-26 追記: この採取はまだ行っていない。Issue #40 では、書き込み側の漏れが承認後の本番の apply の途中で初めて現れるのを避けるため、足すときはサービス単位（`<service>:*`）にする方針を採った。絞り込みはこの方針と引き換えになる）

### 作成手順

（Issue #181 により 2026-10-19 追記: `rolust-ci-plan` は削除した。再作成が要るときの手順である。手順 3 のリポジトリ変数は、`cd.yml` を戻すときだけ設定する。公開リポジトリでは `cd.yml` を持たない（`cd-config.md` D-8）。）

```bash
export AWS_PROFILE=<自分のプロファイル> AWS_REGION=<リージョン>

# 1. OIDC プロバイダ（既存確認 → 無ければ作成）
aws iam list-open-id-connect-providers

# 2. 信頼ポリシー / 権限ポリシーを JSON ファイルに保存して作成
aws iam create-role --role-name rolust-ci-plan  --assume-role-policy-document file://trust-plan.json --tags Key=Project,Value=rolust Key=ManagedBy,Value=manual-4.2
aws iam put-role-policy --role-name rolust-ci-plan  --policy-name terraform-plan  --policy-document file://perm-plan.json
aws iam create-role --role-name rolust-ci-apply --assume-role-policy-document file://trust-apply.json --tags Key=Project,Value=rolust Key=ManagedBy,Value=manual-4.2
aws iam put-role-policy --role-name rolust-ci-apply --policy-name terraform-apply --policy-document file://perm-apply.json

# 3. リポジトリ変数を設定
gh variable set AWS_PLAN_ROLE_ARN   --body "arn:aws:iam::<ACCOUNT_ID>:role/rolust-ci-plan"
gh variable set AWS_DEPLOY_ROLE_ARN --body "arn:aws:iam::<ACCOUNT_ID>:role/rolust-ci-apply"

# 4. GitHub Environment "production" に protection rule（承認者）を設定  <- P-4
```

（Issue #39 により 2026-09-26 訂正: 実体のタグに合わせた。信頼ポリシーの JSON は上の § 信頼ポリシー の現行の形を使う。`AWS_DEPLOY_ROLE_ARN` は P-4 が成立するまで設定しない。P-4 は private リポジトリ ＋ GitHub Free では成立しない）

（Issue #51 により 2026-09-26 追記: `rolust-ci-apply` の 2 行・手順 3 の `AWS_DEPLOY_ROLE_ARN`・手順 4 は、P-4 を成立させて apply ロールを再作成するときだけ行う。そのときは `cd.yml` に apply ジョブを戻す変更も要る。現在は `rolust-ci-plan` の 2 行と `AWS_PLAN_ROLE_ARN` だけが実体に対応する）

**手順 4 は GitHub のリポジトリ設定であり CLI でも Terraform でも代替されない。**
これを設定しないまま `AWS_DEPLOY_ROLE_ARN` を設定すると、`main` への push が
承認なしで apply に到達する。**順序を守ること**（`cd-config.md` § この CD は、前提が揃うまで動かない と同じ。Issue #39 により 2026-09-26 訂正: 参照先の申し送り 1 は訂正で順序に触れなくなったため、節名で参照し直した）。

## 決定 — PR 経路の権限境界

> **決定: 選択肢 A — PR では AWS ロールを引き受けない。** PR での Terraform 検査は
> `terraform init -backend=false` + `validate`（資格情報不要）に留める。
> 2026-08-11、承認ゲート revision 6 で依頼者が決定。

**§12a レビュアー（iteration 1）の blocking finding B-2 に対する応答。** 指摘された穴は実在するが、
提示された機構は正確でないため訂正したうえで記録した。修正には既に人が承認した決定
（`cd-config.md` Q1 = C「`terraform plan` は PR で自動」）の変更が必要であり、
`project.md` の学習「設計判断や要件変更を伴う発見は直さず、承認ゲートに提示して
人間の判断に回す」に従って承認ゲートに回した。以下は決定に至る分析であり、記録として残す。

### 訂正 — fork からの PR は経路にならない

レビュアーは「外部コントリビュータの fork PR がこのロールを引き受けうる」としたが、
**GitHub は fork からの `pull_request` イベントに OIDC トークンを発行しない。**
fork PR のワークフローは権限が read に制限され `id-token: write` を取得できず、シークレットも
渡されない。したがって fork 経由の引き受けは GitHub 側で塞がれている。

### 実際に開いている穴 — 同一リポジトリのブランチ PR

`pull_request` イベントでは、**PR の head ブランチにあるワークフロー定義が実行される**。
リポジトリに push 権限を持つ者は、自分のブランチで `cd.yml` を書き換えた PR を開くことで
`rolust-ci-plan` を引き受け、任意のステップを走らせられる。

これが問題になるのは、**plan ロールが本番の Basic 認証資格情報を復号できる**ためである
（本書 § 権限ポリシー — `rolust-ci-plan` に既述のとおり、`terraform plan` が
`aws_ssm_parameter.basic_auth` を refresh するため構造的に避けられない）。

`sub` クレームは**どの PR でも `repo:kazuki-kudo@13983136/rolust@1318055439:pull_request` で同一**であり、
信頼ポリシーの側で正当な PR と悪意ある PR を区別する手段がない（Issue #39 により 2026-09-26 訂正: `sub` を不変 ID の形式に改めた）。

**非対称性が問題の核心である。**

| 経路 | 承認 | 到達できるもの |
|---|---|---|
| apply | **GitHub Environment `production` の人的承認が必要** | 全リソースの変更 |
| plan | **承認なし。PR を開くだけ** | **本番の Basic 認証資格情報（復号値）** |

`deployment-strategy.md` § 環境と昇格 は「この製品が IAM の特権昇格面そのものであり、
`terraform apply` が IAMロールとポリシーを書き換えるため」承認を置いたと述べている。
その承認を、資格情報の取得については plan 経路が迂回する。

### 選択肢

| # | 案 | 得るもの | 失うもの |
|---|---|---|---|
| A | **PR では AWS ロールを引き受けない。** `terraform init -backend=false` + `validate` に留める | 穴が閉じる。CI の `terraform` ジョブが既に同等の検査を持つため実質の損失は小さい | `cd-config.md` Q1 = C の「PR で plan を自動実行しコメントする」を諦める |
| B | **PR の plan を `main` への push 時のみに移す** | 穴が閉じる。plan 自体は残る | PR の時点で差分が見えない。マージ後・承認前に初めて見る形になる |
| C | **SSM パラメータを Terraform 管理から外す** | plan が資格情報に触れなくなり、根本が消える | `infra/edge-auth.tf` の変更を伴う要件レベルの判断。NFR-4（Terraform 一式で完結）にも影響 |
| D | **現状のまま受け入れ、リポジトリの write 権限保持者を信頼境界とする** | 変更なし | 承認ゲートの迂回が残る。OSS 公開後に write を付与する相手の審査が実質の統制になる |

**推奨は A。** CI の `terraform` ジョブが既に `fmt` / `init -backend=false` / `validate` を
PR で回しており、PR 時点で機械的に検査できることの大半は担保済みである。plan の差分は
`main` への push 後・承認前に読める（`cd-config.md` のパイプライン構成でも apply の直前に
承認が入る）。失うものが最も小さく、穴が確実に閉じる。

D は「write 権限を持つ者はどのみち `main` にマージして apply に到達できる」という理屈で
擁護できるが、**apply には人的承認が要り plan には要らない**という非対称性を消せないため、
承認ゲートの意味が弱まる。

### 決定の反映

**本ステージで反映済み**:

| 箇所 | 変更 |
|---|---|
| § 信頼ポリシー — `rolust-ci-plan` | `sub` から `pull_request` の値を除去（Issue #39 により 2026-09-26 訂正: 旧形式の値の記載を外した）。許す値が `ref:refs/heads/main` の 1 つになったため `StringLike` を `StringEquals` の完全一致へ |
| § ロールを 2 つに分ける | plan ロールの「引き受けられる文脈」から PR を除去。2 ロールに分ける理由を「PR と apply の境界」から「承認の有無が引き受けられる権限を分ける」へ書き直し |
| § CI 側への影響 | PR 時点の Terraform 検査の担い手を明示（CI の `terraform` ジョブ、資格情報不要） |

**deployment-pipeline (4.1) の再実行で反映すること**（§ 4.1 の再実行への申し送り 項目 9）:
`cd.yml` から `pull_request` トリガの plan ジョブを外す。plan は `main` への push 後・
apply の承認前に走る形になる（Issue #39 により 2026-09-26 追記: 反映済み。申し送りの節は削除した）（Issue #51 により 2026-09-26 訂正: CD の apply と承認は外した。plan は `main` への push 後に走り、`guard` とともに継続検査だけを担う）。

### なぜ `cd.yml` を本ステージで直さないか

`.github/workflows/cd.yml` は deployment-pipeline (4.1) の成果物であり、本ステージの
後方ジャンプで 4.1 は state 上リセットされ再実行される。他ステージの成果物を横から
書き換えると、その承認が指していた内容と実体がずれる（`project.md`
`cid:infrastructure-design:c13`）。

**繰り延べても穴は開かない。** 境界を実際に強制するのは `cd.yml` のトリガではなく
**信頼ポリシーの `sub` 条件**であり、それは本ステージの成果物である。`pull_request` を
`sub` から外した以上、`cd.yml` に PR トリガの plan ジョブが残っていても
`AssumeRoleWithWebIdentity` が拒否されジョブが失敗するだけで、資格情報には到達しない。
加えて現時点では OIDC ロール自体が未作成であり（P-3）、リポジトリ変数も未設定のため
`cd.yml` の全ジョブが skip される。**失敗するジョブが残るのは無駄であって危険ではない。**（Issue #39 により 2026-09-26 追記: 当時の状況。現在は P-3 が完了し、`cd.yml` から `pull_request` トリガは外されている）

## 承認者のための plan 読み方

**`deployment-strategy.md` § 未決事項 3 の解消。** 担い手を「3.4 か 4.2」と両名指ししていたが、
対象が CD の承認ゲートであるため CD 設計を扱う本書に置いた。

`cd-config.md` の CD は `terraform plan -out` の結果を人が承認してから apply する。
（Issue #51 により 2026-09-26 訂正: CD は apply しない。この節の読み手は、`docs/guide/` の手動経路（Issue #178 により 2026-10-18 訂正）で apply する実行者と、`cd.yml` の `guard` の結果を読む者である。手動経路での「承認」は、実行者が apply に進むことを指す）
承認者が見落とすと権限範囲が静かに広がるため、**必ず確認する差分**を定める。

### 赤信号 — 承認せず差し戻す

| # | plan に現れる差分 | なぜ危険か |
|---|---|---|
| R-1 | `diff_iam_read`・`apply_iam_write`・`crud_iam_read_trust`（Issue #80 により 2026-09-30 追記）の Allow で `Resource` に `:role/*` を含む Statement の `Condition` に、`StringEquals` の `aws:ResourceTag/<managed_tag_key の値>` が無い、その値にワイルドカードを含む、または期待するタグキーを plan JSON から読めない（判定の詳細は下の § R-1 の判定基準）（Issue #39 により 2026-09-26 訂正） | 到達範囲が管理対象タグで絞られていない。Rolust がアカウント内の**全ロール**の信頼ポリシーを書き換えられる |
| R-2 | `Sid: DenySelfEscalation` の Statement が消える / `Resource` が減る | 自己昇格の閉路が開く。Rolust 経由で Rolust 自身の実行ロールを書き換えられる（定義は `infra/lambda.tf` の Sid `DenySelfEscalation`。その直前のコメントが理由を述べる）（Issue #39 により 2026-09-26 訂正: 行番号での参照を改めた） |
| R-3 | `aws_iam_role_policy.diff_iam_read` / `apply_iam_write` / `crud_iam_read_trust`（Issue #80 により 2026-09-30 追記）に `iam:ListRoles` / `iam:ListUsers` / `iam:GetUser` が増える | FR-5.7 / C-4（AWS からの一覧取得・実在検証は行わない）違反 |
| R-4 | `dynamodb_policy` に `dynamodb:Scan` が増える | NFR-1 / NFR-2 の構造的担保が外れる（`infra/main.tf` の `dynamodb_policy` の定義。Issue #39 により 2026-09-26 訂正: 行番号での参照を改めた） |
| R-5 | `aws_lambda_function.edge_auth` の `lambda_function_association` が default または `/api/*` ビヘイビアから外れる | **Basic 認証が外れる**（FR-6.1 違反）。`docs/guide/operations.md` § SPA を更新したとき（Issue #178 により 2026-10-18 訂正） の apply 後の確認（`curl` で 401 を期待。Issue #20 により 2026-10-05 追記: `auth_mode = "cognito"` では 302、`/api/` は 401）でも検知できるが、apply 後になる（Issue #51 により 2026-09-26 訂正: CD のスモークテストは廃止した） |
| R-6 | `custom_error_response` の `error_code` に 404 が増える | API の正当な 404 が index.html に化ける（`infra/cloudfront.tf` の `custom_error_response`。Issue #39 により 2026-09-26 訂正: 行番号での参照を改めた） |
| R-7 | `aws_s3_bucket_public_access_block.web` のいずれかが `false` になる | SPA バケットが公開されうる |
| R-8 | `aws_ssm_parameter.basic_auth` または `aws_ssm_parameter.ip_allowlist`（Issue #76 により 2026-09-29 追記）の `value` に差分が出る | `lifecycle { ignore_changes = [value] }` が外れた証拠。apply すると**実運用の資格情報がプレースホルダで上書きされる**。`ip_allowlist` では、許可リストが初期値の `0.0.0.0/0` で上書きされ、IP 制限が外れる |
| R-9 | `aws_iam_role_policy.crud_iam_read_tags` の Allow の `Action` が `["iam:ListRoleTags"]` 単体でない（`iam:GetRole` の追加、`iam:ListRoles` への差し替え、`iam:*`）、または `crud_iam_read_trust` の Allow の `Action` が `["iam:GetRole"]` 単体でない（`iam:UpdateAssumeRolePolicy` の追加など。Issue #80 により 2026-09-30 追記）。`policy` が plan 時点で未確定なら WARN（Issue #39 により 2026-09-26 追記） | CRUD がアカウント内の全ロールについてタグ以外も読めるようになる。このポリシーは `Resource = role/*` を条件なしで取るのが設計であり（タグ条件で絞ると「タグが無い」と「読めない」を区別できない）、R-1 の基準を当てると常に RED になるため番号を分けた。`crud_iam_read_trust` はタグ条件つきなので R-1 も当たり、Action の範囲を R-9 が見る（Issue #80 により 2026-09-30 追記） |
| R-10 | plan 内の削除されない `aws_iam_role` のいずれかが、`apply_iam_write` の `Sid: DenySelfEscalation` の `Resource` に含まれない。ロールは `name` と `path` で識別し（新規作成では `arn` が plan 時点で未確定のため）、Deny の各 ARN の `:role` より後ろと glob（`*`・`?`）で照合する。ロール名か `path` が未確定なら WARN。`apply_iam_write` が plan に無い・削除される、または Deny が未確定・消失（R-2 が扱う）なら検査しない（Issue #24 により 2026-09-27 追記） | Rolust が作るロールを増やして `infra/main.tf` の `self_role_arns` に加え忘れると、タグが付いただけでそのロールの信頼ポリシーを Rolust 経由で書き換えられる。タグ方式では `DenySelfEscalation` が自ロールを守る単層の防御であり、R-2（`Resource` が減る）は追加漏れを捕まえられないため番号を分けた |
| R-11 | (a) `aws_api_gateway_method` の作成または更新で、`api_key_required` が `true` でない。(b) `aws_cloudfront_distribution.rolust` の API オリジン（`origin_id` が `api-gateway`）に、`x-api-key` の `custom_header` が無い。(a) は変更の無いメソッドを検査しない（二段階の反映の途中の plan を落とさないため）。`api_key_required` やオリジンが plan 時点で未確定なら WARN。ヘッダーの値は sensitive で plan から読めないため、名前だけを見る（Issue #76 により 2026-09-29 追記） | API Gateway の直 URL が Lambda に届く経路が開く（FR-6.3）。IP 制限（FR-6.2）と Basic 認証（FR-6.1）は CloudFront の側にあり、直 URL には効かないので、API キーの要求が外れると API を守るものが無くなる。既知の限界: メソッドが `false` のまま変わらない状態は検知されない。反映後に、直 URL が 403 になることを実測で確かめる 対象は `aws_api_gateway_method` の全メソッド（型で選ぶ）で、`leaf` の全エントリ（`diff`・`drift`・`apply`）を含む（Issue #170 により 2026-10-15 追記）。乖離を直す操作の 2 経路（`drift_child` の `restore`・`adopt`）も含む（Issue #172 により 2026-10-16 追記）。 |
| R-12 | (a) `aws_iam_role_policy.crud_assume_target_reader`・`diff_assume_target_reader`・`apply_assume_target_manager` の Allow の `Action` が `["sts:AssumeRole"]` 単体でない。(b) `Resource` が、`arn:<partition>:iam::<12 桁または *>:role/<固定名>` の 1 件でない（ロール名にワイルドカードやパスを含む、複数件、`*`）。(c) CRUD・Diff のポリシーが Reader（`target_reader_role_name`）以外を、Apply のポリシーが Manager（`target_manager_role_name`）以外を指す。(d) 上の 3 つ以外の `aws_iam_role_policy` の Allow に、`sts:*` または `*` の Action が現れる（Action 名は IAM と同じく大文字小文字を区別せずに照合する）。Allow の `NotAction` も赤信号（指定した以外の全 Action を許すため）。(e) Lambda の実行ロール（名前が `-exec` で終わるロール）への `aws_iam_role_policy_attachment`・`aws_iam_policy_attachment` の追加・変更、`aws_iam_role` の `inline_policy`・`managed_policy_arns` の増加（アタッチした管理ポリシーの中身を R-12 が読めないため。変更のないものは見ない）。(f) 3 ポリシーの `role` 属性が、付いてよい実行ロール（`<project_name>-crud-exec`・`-diff-exec`・`-apply-exec`）と一致しない。(g) 3 ポリシーの Allow に `NotAction`・`NotResource` がある。期待するロール名（`target_reader_role_name`・`target_manager_role_name`・`project_name`）を plan JSON の `variables` から読めないときも赤信号にする（判定基準が無いまま通さない。R-1 と同じ扱い）（Issue #85 により 2026-09-30 追記。最終レビューを受けて Issue #85 により 2026-10-02 追記: (d) の大文字小文字と `NotAction`、(e)〜(g)） | Rolust の Lambda の実行ロールが、別アカウントの任意のロールを引き受けられる。Reader と Manager の取り違えは、CRUD・Diff に信頼ポリシーの更新権限を渡し、FR-3.2（CRUD は AWS へ書き込まない）の保証が外れる。ターゲット側（手動）のロールの中身は、この検査の対象外である（`docs/runbooks/cross-account-roles.md` の実測と、README の JSON との突き合わせで確かめる） |

#### R-1 の判定基準

（Issue #39 により 2026-09-26 追記。取り込み元は凍結された `quality-gates.md` § R-1 — 判定するのは `Resource` の形ではなく到達範囲である。複写元の R-1 は接頭辞方式の「`Resource` が `role/RolustManaged-*` から `role/*` に広がる」だったが、タグ方式では `Resource = role/*` が正常な形であり、絞り込みは `Condition` が担う）

対象は `diff_iam_read`・`apply_iam_write`・`crud_iam_read_trust`（Issue #80 により 2026-09-30 追記）の Allow のうち、`Resource` に `:role/*` を含む Statement である。

| # | 形 | 判定 | なぜ |
|---|---|---|---|
| 1 | `Condition` に `StringEquals` の `aws:ResourceTag/<managed_tag_key の値>` が無い | **RED** | 到達範囲が管理対象タグで絞られていない。別キーで絞っている場合と、演算子が `StringEquals` 以外の場合も含む |
| 2 | その値にワイルドカード（`*` / `?`）が含まれる | **RED** | タグキーさえ在れば値を問わない。事実上の無条件である |
| 3 | その値が `managed_tag_value` と一致しない | WARN | 絞り込みは効くが、宣言された管理対象集合とは別の集合を指している。到達範囲は広がらないので止めない |
| 4 | 上記のいずれでもない | 緑 | `aws:ResourceTag/<key>` に対する `StringEquals` で、値がワイルドカードを含まない |
| 5 | 期待するタグキーを plan JSON から読めない | **RED** | 下記 |

**「条件が付いていれば緑」では不足である。** 在るが効かない形が 3 つ（別キー・`StringEquals` 以外の演算子・値のワイルドカード）あり、いずれも RED でなければならない。

**期待するタグキーは plan JSON の `.variables.managed_tag_key.value` から読む。** ガード側に値を二重定義しない。読めない場合を RED にしたのは、`plan-guard.sh` の「未知値は WARN」方針からの意図的な逸脱である。期待するキーが分からないと「タグで正しく絞られている」と「事実上の無条件」を機械では区別できず、WARN にすると最も重要な検査が黙って人の目視へ降格する。

### 黄信号 — 影響を確認してから承認

| # | 差分 | 確認すること |
|---|---|---|
| Y-1 | `managed_tag_key`・`managed_tag_value` の値が変わる（Issue #39 により 2026-09-26 訂正） | 既に登録済みのロールが新しいタグを持つか。持たないと**反映不能になる**（`deployment-strategy.md` § 変更の種類ごとの扱い）。なお、ロールへのタグの付け外しは Terraform の外で行われ、plan にも plan-guard にも現れない。管理対象の範囲の統制点は `iam:TagRole` の保持者にある |
| Y-2 | `aws_dynamodb_table.state` または `aws_dynamodb_table.change_requests` が `-/+`（再作成）（Issue #36 により 2026-09-27 訂正: 対象は単一テーブル `aws_dynamodb_table.rolust` だった。旧テーブルは `removed` で管理から外している） | **データが消える**。属性や `hash_key` の変更は再作成を伴う |
| Y-3 | `aws_lambda_function.edge_auth` の再作成 | 全エッジへの複製に数分〜十数分。その間バージョンが混在する（`deployment-strategy.md` § Lambda@Edge の非対称性） |
| Y-4 | `aws_s3_object.web` の大量削除 | SPA の反映では毎回、名前の変わったアセットが destroy される（正常）。反映の前から開いていたタブは画面の案内（`interaction-spec.md` GI-11）で再読込を促す。削除の件数が SPA のビルドの差分と釣り合わないとき（SPA を変えていないのに消える、`index.html` まで消えるなど）に読む（Issue #4 により 2026-09-27 訂正: 初版は「旧アセットを消すと利用者が 403 を踏む」。`deployment-strategy.md` § SPA の更新順序が持つ不整合） |
| Y-5 | `log_retention_days` の減少 | 既存ログが即座に失効する |

### 読み方の実務

`terraform plan` の出力で IAM ポリシーは JSON 文字列 1 行として差分表示され、**目視で
差を見つけにくい**。承認前に次を実行して構造化された差分を得る。

```bash
terraform show -json tfplan > plan.json
jq '.resource_changes[]
    | select(.type | startswith("aws_iam"))
    | {address, actions: .change.actions,
       before: (.change.before.policy // .change.before.assume_role_policy),
       after:  (.change.after.policy  // .change.after.assume_role_policy)}' plan.json
```

`before` / `after` をそれぞれ `jq` で整形して差分を取れば、R-1〜R-4 は機械的に見つかる。
**将来的にはこの検査を CD の 1 ステップとして自動化し、R-1〜R-8 のいずれかに該当したら
ジョブを失敗させるのが筋である**（人の注意力に依存しない）。本ステージでは設計として
提示するに留め、実装は deployment-pipeline (4.1) の再実行に委ねる（Issue #39 により 2026-09-26 追記: `.github/scripts/plan-guard.sh` として実装済み。現行の検査対象は R-1〜R-12 である（Issue #24 により 2026-09-27 訂正。Issue #76 により 2026-09-29 訂正。Issue #85 により 2026-09-30 訂正））。

## CI 側への影響

`ci-config.md` の 6 ジョブ（Issue #39 により 2026-09-26 追記: 当時の数。現在は下の表のとおり `plan-guard` を含む 7 ジョブ）のうち `terraform` ジョブは
`terraform init -backend=false` を使っている。**バックエンドを持たない初期化**であるため、
本ステージの `backend.tf` 追加による影響を受けない（資格情報も state アクセスも不要のまま）。

**決定 A により、このジョブが PR 時点の Terraform 検査の唯一の担い手になる。**
PR では AWS ロールを引き受けないため `plan` は走らず、機械的に検査できるのは
`fmt` / `init -backend=false` / `validate` と `iac-scan`（Trivy、資格情報不要）である。
実リソースとの差分は、反映の直前に手動経路で apply する者が plan-guard にかけて読む形になる（Issue #51 により 2026-09-26 訂正。Issue #181 により 2026-10-19 訂正: CD の `plan`・`guard` は廃止した）。
**この検査は既に CI に存在し、PR で走っている**——決定 A が「失うものが最も小さい」と
判断された根拠がここにある。3.7 の再実行でこのジョブを弱めてはならない。

| ジョブ | 影響 |
|---|---|
| `node` (22/24) / `build-floor` (20.19) / `secrets` / `deps` | なし（Issue #248 により 2026-11-03 追記: `node` は 24 のみ（Issue #238）、`build-floor` は廃止した。この表は 3.4 の時点の記録で、現行のジョブは `ci.yml` が正本） |
| `terraform` (`fmt` / `init -backend=false` / `validate`) | `fmt` は `terraform fmt -check -recursive -diff` で `infra/bootstrap/` を含む。`infra/bootstrap/` に対する `init -backend=false` と `validate` は、`ci.yml` の `terraform` ジョブの「初期化（バックエンドなし） — bootstrap」「構文と型の検証 — bootstrap」として実装済み（Issue #39 により 2026-09-26 訂正: 行番号での参照を改め、実装済みを反映した） |
| `plan-guard` | `plan-guard.test.sh`（赤信号 R-1〜R-12 の回帰テスト（Issue #24 により 2026-09-27 訂正。Issue #76 により 2026-09-29 訂正。Issue #85 により 2026-09-30 訂正））を PR 時点で走らせる。`ci.yml` の `plan-guard` ジョブとして ci-pipeline (3.7) の再々実行で足された（Issue #39 により 2026-09-26 追記） |
| `release-artifacts`（Issue #92 により 2026-10-13 追記） | `cfn-lint`（版を固定）で `cloudformation/target-roles.yaml` の構文と型を、`target-roles.test.sh` でターゲット側の権限の不変条件（Reader が書き込めない、Manager の `DenySelfEscalation`、書き込みのタグ条件）を、`release.test.sh` で Release の検査（`check-release.sh`）と `changelog-section.sh` の回帰を確かめる（`CHANGELOG.md` の節の検査は Issue #240 により 2026-11-03 追記）。AWS 資格情報は要らない |
| `iac-scan` (Trivy) | **`cloudformation/` も走査対象になる**（`infra` と別に走らせる。`trivy config` は対象を 1 つしか取れない。Issue #92 により 2026-10-13 追記）。**`infra/bootstrap/` も走査対象になる。** 新規リソース（S3 バケット）に対する指摘が出る可能性がある。`.trivyignore.yaml` の `paths` は scan-ref からの相対パスで書く点に注意（`ci-config.md` § Trivy は `.trivyignore.yaml` を自動検出しない） |

### CI 自身の供給経路（Issue #194 により 2026-10-23 追記）

CI は、ゲートを実行する側のコードである。ここに入るものが入れ替わると、検査が通ったという事実の意味が失われる。したがって次の 2 点を CI の前提とする。

- **サードパーティの action は commit SHA で固定する。** `actions/checkout`・`actions/setup-node`・`hashicorp/setup-terraform` を `@v4` のような可変タグで参照しない（タグは後から別のコミットへ付け替えられる）。SHA の隣に `# v4.4.0` の形で版をコメントし、更新するときは SHA と版を同時に改める。
- **取得するツールの tarball は SHA-256 で照合してから展開する。** Trivy と gitleaks は GitHub の Release から `curl` で取る。期待値は `ci.yml` の env（`TRIVY_SHA256`・`GITLEAKS_SHA256`）に置き、各 Release の `*_checksums.txt` が公開している値を写す。版（`TRIVY_VERSION`・`GITLEAKS_VERSION`）を上げるときは、同じ Release の checksums から取り直す。

`pip install "cfn-lint==${CFN_LINT_VERSION}"` は版の固定までとする（hash 固定は requirements ファイルを別に持つ必要があり、PyPI の信頼モデルは GitHub Release と異なるため、同じ手当てでは閉じない）。これは残っている穴であり、Issue #194 に記録する。

`ci.yml` の実体を持つのは ci-pipeline (3.7) であり、本ステージの後方ジャンプにより 3.7 も
state 上リセットされ再実行される。この 2 点はその再実行で反映される（Issue #39 により 2026-09-26 追記: 反映済み）。

**本ステージで実測済み**: CI と同一ゲート
（`trivy config infra --ignorefile .trivyignore.yaml --severity CRITICAL,HIGH --exit-code 1`、
Trivy 0.73.0）は `infra/bootstrap/` を含めて **exit 0** である。`terraform fmt -check -recursive infra`
も exit 0。したがって 3.7 の再実行はワークフロー定義の走査対象を広げるだけで、
**新たに赤くなる要素は無い**。

### CI と同じ検査を手元で走らせる（Issue #199 により 2026-10-25 追記）

**この CI は全ジョブが AWS の資格情報を持たない**（公開リポジトリは CD を持たない。`cd-config.md` D-7・D-8）。したがって、CI の判定は原理的にすべて手元で再現できる。`.github/scripts/ci-local.sh` が、`ci.yml` の 7 ジョブに 1 対 1 で対応する処理を直列に実行し、各ジョブを `PASS` / `FAIL` / `SKIP` で要約する。

この経路が要る理由は 2 つある。第一に、`CLAUDE.md` が列挙する push 前の検査はジョブ単位の網羅ではなく、取りこぼしに気づく仕組みが無かった。第二に、GitHub の利用上限を超えると**ジョブが起動しなくなり**（2026-10-24 に実際に起きた。全ジョブが 0 ステップで failure）、CI からは何の判定も得られない。そのとき、手元の実行が唯一の判定経路になる。

設計上の決めごと:

- **固定版は `ci.yml` の `env:` から読む。** スクリプトに書き写すと、CI と手元で別の版が走る。手元のツールの版が違えば、黙って走らせずに失敗させる。
- **`trivy` は自動取得し、SHA-256 を照合する。** `ci.yml` の `TRIVY_SHA256` は Linux の tarball の値なので、Windows の zip には使えない。プラットフォームごとに照合する相手を変える（Linux は `ci.yml` の値、Windows は同じ Release の `*_checksums.txt`）。取得元の Release は同じである。
- **`terraform` の検査は `infra/` の複製に対して行う。** 直接走らせると `init -backend=false` が手元の `.terraform` の backend 設定を壊す。複製からは、CI の checkout に無いもの（`backend.hcl`・`terraform.tfvars`・`.terraform`）を取り除く。CI と同じ入力にするためである。
- **`npm ci` は走らせない。** 既存の `node_modules` を消すうえ、手元の npm 9.6.2 は依存の版を上げた直後に落ちることがある（`.claude/rules/shell-and-aws-cli.md`）。
- **埋まらない範囲は `SKIP` として出す。** 手元の Node と一致しない版（CI の matrix の版が手元の Node と違うときのその版）は実行できない。黙って飛ばして「全緑」に見せず、要約で `SKIP` の件数と理由を出す。
- **ジョブ一覧の一致を機械で見張る。** `ci-local.sh` が CI のジョブを知らないままだと、走らせていない検査を走らせたつもりになる。`ci-local.test.sh` が、`ci.yml` の `jobs:` のキー集合とスクリプトの宣言（`# ci-job: <id>`）の一致、固定版のハードコードの不在、`*_VERSION` の参照、実行権限（`100755`）を検査する。

ローカルの実行は CI の代わりではない（`SKIP` が残り、ランナーの OS も違う）。**CI が走る状態では CI の判定を正とする。** 手元の実行は、push 前に赤を潰すためと、CI が走らないときの代替である。

## 未決事項

1. ~~OIDC ロールは設計のみ。作成されていない。~~ **解消**: 2026-08-23 に作成済み（Issue #39 により 2026-09-26 訂正）。
2. ~~**`rolust-ci-apply` の権限は least-privilege ではない。** 実 apply の実績から絞り込む手順を上に示したが、採取は行っていない。Issue #40 で採った「書き込み権限はサービス単位（`<service>:*`）で足す」方針と引き換えである（Issue #39 により 2026-09-26 訂正）。~~
   **解消**: `rolust-ci-apply` を削除した（Issue #51 により 2026-09-26 訂正）。再作成するときはこの問題が戻る。
3. ~~**plan ロールが Basic 認証の資格情報を読む構造は解消できない。**~~ **解消**: `rolust-ci-plan` を削除し、CI から plan を走らせなくなった（`cd-config.md` D-8。Issue #181 により 2026-10-19 訂正）。元の記述: **plan ロールが Basic 認証の資格情報を読む構造は解消できない。** `terraform plan` が SecureString を refresh するため。plan artifact の保持期間の最小化が唯一の緩和策であり、`cd.yml` で `retention-days: 1`（GitHub の最小値）に設定済みである（Issue #39 により 2026-09-26 訂正）。
4. ~~plan 差分の自動検査（R-1〜R-8）は設計のみ。~~ **解消**: `.github/scripts/plan-guard.sh` として実装済み。CD の `guard` ジョブが承認の前に R-1〜R-12 を検査し、`ci.yml` の `plan-guard` ジョブが PR 時点で回帰テストを走らせる（Issue #39 により 2026-09-26 訂正）（Issue #24 により 2026-09-27 訂正: R-10 を足した）（Issue #76 により 2026-09-29 訂正: R-11 を足した）（Issue #85 により 2026-09-30 訂正: R-12 を足した）（Issue #51 により 2026-09-26 訂正: CD に承認は無くなった。`guard` は `main` の plan の継続検査であり、反映の直前の検査は手動経路で apply する者が行う）。
5. ~~**P-4（GitHub Environment の protection rule）は成立していない。** private リポジトリ ＋ GitHub Free では Required reviewers を作れない（2026-09-16 に 422 で実測）。プランの変更か public 化は依頼者の判断である（Issue #39 により 2026-09-26 訂正）。~~
   **解消**: P-4 は成立させず、apply 経路を閉じた（`cd-config.md` D-7。Issue #51 により 2026-09-26 訂正）。
