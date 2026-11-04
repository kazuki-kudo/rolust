# CD Configuration — Rolust

> **追記注記**（Issue #240 により 2026-11-03 追記）: Release の tarball に `CHANGELOG.md`（版ごとの、利用者に影響する変更と、更新時にやること）を入れ、`release.yml` はその版の節を Release の本文の先頭に置く（自動生成のノートはその後ろに続く）。`check-release.sh` は、本番の版（タグに `-` を含まない）では `CHANGELOG.md` にそのタグの節が空でなくあることを検査し、無ければ Release を作らない（prerelease は除く）。`release.yml` の権限・D-7（CD は反映しない）は変わらない。書き方と Release の手順は `CONTRIBUTING.md`。
> **追記注記**（Issue #181 により 2026-10-19 追記）: 公開リポジトリでは、`cd.yml`（`main` への push ごとの `terraform plan` と `guard`）を廃止した（D-8）。公開リポジトリの Actions の実行ログは、GitHub のアカウントを持つ誰でも読める。ログにはバケット名や ARN の形でアカウント ID が出る（廃止前の実行ログで 34 行。成果物を作らない形にしても、ログは残る）。plan と guard は手元で走らせる（`docs/guide/operations.md`・`setup.md` の手動経路。D-7 により、これが唯一の反映経路でもある）。`plan-guard.sh` と `plan-guard.test.sh`（`ci.yml` の `plan-guard` ジョブ）は残る。CI ロール `rolust-ci-plan` は使い道がなくなったので削除し（P-3）、リポジトリ変数（§ リポジトリ変数）は新リポジトリに置かない。`ci.yml`・`release.yml` は AWS の資格情報を使わない（`id-token`・`aws-actions`・`secrets`・`vars` が無く、`pull_request` でも OIDC を使わない）。以下の本文は、廃止した CD の設計の記録として残し、変わった箇所に来歴を添えた。D-7（反映しない）は変わらない。
> **追記注記**（Issue #187 により 2026-10-19 追記）: Release の tarball に、SPA に取り込んだ第三者のコードのライセンスと NOTICE（`packages/web/dist/THIRD-PARTY-NOTICES.txt`。SPA のビルドが `dist` に作り、S3 にも置かれる）を入れ、`check-release.sh` がその存在と、Lambda のバンドルに第三者のコード（`node_modules`）が入っていないことを検査する。Lambda は `@aws-sdk/*` を外部化していて、第三者のコードを含まない。`release.yml` の権限・D-7（CD は反映しない）は変わらない。SPA の `dist` が変わるので、本番の画面への反映は `docs/guide/operations.md` の手順による（`cd.yml` は反映しない。D-7）。
> **追記注記**（Issue #178 により 2026-10-18 訂正）: `README.md` の利用者向けの手順を `docs/guide/` に分けたため、README の節・手順を指していた参照を `docs/guide/` の文書に張り替えた（対応は `docs/superpowers/specs/2026-10-18-readme-split-design.md`）。NFR-4・SM-2 の「README と Terraform」という総称は、変えない（Issue #179 により 2026-10-19 訂正: 訂正前は「Issue #179 で扱うので変えていない」とした。README は入口で手順は `docs/guide/` にあるが、総称は今も通じるため）。ID と節番号は変えない。
> **正本注記**（Issue #39 により 2026-09-26 追記）
>
> - **位置づけ**: 本書は Rolust の CD の運用（決定事項・前提 P-1〜P-4・リポジトリ変数・パイプライン構成・guard）（Issue #51 により 2026-09-26 訂正: スモークテストを外した）の正本である。CI ロールの設計と赤信号 R-1〜R-12（Issue #24 により 2026-09-27 訂正。Issue #76 により 2026-09-29 訂正。Issue #85 により 2026-09-30 訂正）は `cicd-pipeline.md` にある。変更は `CLAUDE.md` § 開発フロー の規則に従い、実装と同じ PR で行う。
> - **複写元**: `aidlc/spaces/default/intents/260728-rolust-iam-trust/operation/deployment-pipeline/cd-config.md`（2026-08-10 作成、2026-08-31 最終更新、2026-09-26 複写）。複写元は凍結した経緯として残る。
> - **照合の範囲**: `docs/superpowers/specs/2026-09-26-cicd-design-docs-design.md` 3.2 の源泉から列挙した食い違い（D-1〜D-6）を、GitHub の実測（2026-09-26、`gh variable list`・Environment `production` の設定・`gh run`）と `.github/` に照合して訂正した。それ以外の記述は照合していない（未照合。例: § 未決事項と申し送り 2 の前提になるブランチ保護の現況）。
> - **訂正の全体像**: Stage・Scope・Lead の行と、§ タグ方式移行への追随 のうち再実行の差分の記録（「何が古くなっていたか」「何を変えたか」）を削除した。P-3 の完了、P-4 がプラン制限で成立しないこと、リポジトリ変数の設定状況を反映した。赤信号の現行の判定基準の在処を、正本の `cicd-pipeline.md` に改めた。解消した未決（CI での `plan-guard.test.sh`、実 plan での guard）を反映した。PR の `sub` を不変 ID の形式に、凍結文書への相対パスをフルパスに改めた。
> - **未決**: なし。
> - 本文がファイル名だけで名指す凍結文書（`quality-gates.md`・`ci-config.md` など。`deployment-strategy.md` は Issue #4 により 2026-09-27 正本に切り出した）とソースタグの所在は `docs/design/README.md` にある。

> **追記注記**（Issue #51 により 2026-09-26 訂正）
>
> - **変更の全体像**: GitHub のプランを変えないため、P-4 は恒久的に成立しない。CD の apply 経路を閉じ、apply ロール `rolust-ci-apply` を削除した。D-5 を撤回し、D-7（P-4 は成立させない。反映は `docs/guide/` の手動経路（Issue #178 により 2026-10-18 訂正）だけ）を足した。`cd.yml` から `apply`・`smoke` ジョブを外したことに合わせて、§ この CD は、前提が揃うまで動かない・§ リポジトリ変数・§ 手動経路を残す・§ パイプライン構成・§ 承認の前に置く・§ 手動経路でも使える を改めた。§ plan を保存して apply する理由 と § スモークテストの判定 は廃止し、401/503 の確認は `docs/guide/` の手順に移した（Issue #178 により 2026-10-18 訂正）。未決事項 1 を解消とし、7 を足した。
> - **設計**: `docs/superpowers/specs/2026-09-26-close-cd-apply-path-design.md`

> **追記注記**（Issue #24 により 2026-09-27 追記）
>
> - **変更の全体像**: plan-guard に赤信号 R-10（plan 内の全 `aws_iam_role` が `DenySelfEscalation` の `Resource` に含まれる）を足した。定義は `cicd-pipeline.md` § 赤信号 — 承認せず差し戻す にある。現行の一覧を指す「R-1〜R-9」を R-1〜R-10 に改めた（位置づけ・§ Upstream Inputs の注記・D-6・§ パイプライン構成・§ plan の赤信号を機械で止める）。当時の範囲を述べる R-1〜R-8 の記述は経緯として残す。

> **追記注記**（Issue #76 により 2026-09-29 追記）
>
> - **変更の全体像**: plan-guard に赤信号 R-11（API Gateway の直 URL を塞ぐ設定が外れていないか）を足した。定義は `cicd-pipeline.md` § 赤信号 — 承認せず差し戻す にある。現行の一覧を指す「R-1〜R-10」を R-1〜R-11 に改めた（位置づけ・§ Upstream Inputs の注記・D-6・§ パイプライン構成・§ plan の赤信号を機械で止める）。当時の範囲を述べる R-1〜R-10 の記述は経緯として残す。

> **追記注記**（Issue #85 により 2026-09-30 追記）
>
> - **変更の全体像**: plan-guard に赤信号 R-12（別アカウントへの `sts:AssumeRole` の到達範囲）を足した。定義は `cicd-pipeline.md` § 赤信号 — 承認せず差し戻す にある。現行の一覧を指す「R-1〜R-11」を R-1〜R-12 に改めた（位置づけ・§ Upstream Inputs の注記・D-6・§ パイプライン構成・§ plan の赤信号を機械で止める）。当時の範囲を述べる R-1〜R-11 の記述は経緯として残す。
> - **設計**: `docs/superpowers/specs/2026-09-30-cross-account-roles-design.md`

> **追記注記**（Issue #20 により 2026-10-05 追記）
>
> - **変更の全体像**: 認証方式（`auth_mode`。`basic` / `cognito`）を足したため、`cd.yml` の `terraform plan` に `TF_VAR_auth_mode`（リポジトリ変数 `AUTH_MODE`）を渡すようにした。スモークテストの判定（401）は `basic` のもので、`cognito` では 302（`/api/` は 401）になる。
> - **設計**: `docs/superpowers/specs/2026-10-05-admin-auth-cognito-design.md`

> **追記注記**（Issue #92 により 2026-10-13 追記）
>
> - **変更の全体像**: タグ（`v*`）の push で Release を作る `release.yml` を足した。`release.yml` は AWS の資格情報を持たず、権限は `contents: write` だけで、反映（`terraform apply`）をしない。D-7（CD は反映しない）は変わらない。NFR-4 / SM-2 の判定経路に、Release の tarball からの `docs/guide/setup.md` の経路 A を足した（Issue #178 により 2026-10-18 訂正）（§ 手動経路を残す）。
> - **設計**: `docs/superpowers/specs/2026-10-13-user-deploy-release-design.md`

**経緯**（複写元の冒頭の注記）:

**最終更新**: 2026-08-31（再々実行 — タグ方式移行への追随）。差分の一覧は
§ タグ方式移行への追随（再々実行の差分・2026-08-31）にある（Issue #39 により 2026-09-26 追記: 差分の一覧は削除した。複写元に残る）。

> **再実行（2026-08-18）。** 初版は 2026-08-10 に書かれたが、その時点では
> infrastructure-design (3.4) が未実行であり、`consumes` の 2 件を欠いたまま
> 代替入力から導出していた。3.4 が 2026-08-11 に完了して 4 件すべてが揃ったため、
> `cicd-pipeline.md` § 4.1 の再実行への申し送り の 9 項目を反映して更新した（Issue #39 により 2026-09-26 追記: この節は正本の `cicd-pipeline.md` では削除した。複写元に残る）。
>
> **2026-08-31 にさらに再実行した。** 3.4 が 2026-08-24 に信頼ポリシーの絞り込みを
> **ロール名の接頭辞からリソースタグへ**移行し、ci-pipeline (3.7) が 8/29 に、
> code-generation (3.5) が 8/31 に追随した。本書は 8/23 時点の接頭辞方式のまま
> 取り残されていた。差分は § タグ方式移行への追随（再々実行の差分・2026-08-31）に
> まとめた。初回・再実行分の決定（Q1' / Q2、6 ジョブ構成、guard の設計判断）は
> 変更していない。

## Upstream Inputs

| 成果物 | 状態 | 参照した内容 |
|---|---|---|
| `aidlc/spaces/default/intents/260728-rolust-iam-trust/construction/ci-pipeline/ci-config.md` | 存在（**2026-08-29 更新**） | GitHub Actions 選定、CD を CI の範囲外とした判断（D-4）、検証ツールの版固定方針、Trivy の `--ignorefile` の罠、§ タグ方式移行への追随（R-1 の判定書き換え・R-9 新設・`plan-guard` ジョブの新設） |
| `aidlc/spaces/default/intents/260728-rolust-iam-trust/construction/ci-pipeline/quality-gates.md` | 存在（**2026-08-29 更新**） | ゲート G-1〜G-11。CD の前段として何が担保済みかの境界。**§ plan-guard の赤信号 が現行の R-1〜R-9 の判定基準を持つ**（Issue #39 により 2026-09-26 訂正: R の現行の判定基準は正本の `cicd-pipeline.md` に取り込んだ） |
| `aidlc/spaces/default/intents/260728-rolust-iam-trust/construction/code-generation/code-summary.md` | 存在（**2026-08-31 更新**） | § 2026-08-31 ラウンド（Step 18）。アプリ側がタグ方式へ移行し、Lambda の環境変数が 2 つに変わったこと |
| `aidlc/spaces/default/intents/260728-rolust-iam-trust/construction/infrastructure-design/deployment-architecture.md` | **存在**（3.4 で解消） | Terraform state のバックエンド（S3 + `use_lockfile`）、環境レイアウト、ディレクトリ構成 |
| `docs/design/cicd-pipeline.md` | **存在**（3.4 で解消） | OIDC ロール 2 本の設計、PR 経路の権限境界（決定 A）、承認者のための plan 読み方（R-1〜R-8 / Y-1〜Y-5）、4.1 への申し送り 9 項目 |

（Issue #39 により 2026-09-26 訂正: 相対パスをフルパスと正本に改めた。正本の `cicd-pipeline.md` は現在 R-1〜R-12 を持ち（Issue #24 により 2026-09-27 訂正。Issue #76 により 2026-09-29 訂正。Issue #85 により 2026-09-30 訂正）、申し送りの節は削除済み）

初版では下 2 件が **不在** であり、ステージ本文 Step 2 の代替手順により
`infra/` の Terraform と README を設計の実体として読んでいた。**その但し書きは不要になった。**
不在の理由（infra スコープで 3.4 が EXECUTE のまま取り残されていた）も解消済みである。

## 決定事項

| # | 決定 | 出所 |
|---|---|---|
| Q1' | **PR では AWS ロールを引き受けない。** `terraform plan` は `main` への push 後・承認前に走る | `cicd-pipeline.md` § 決定 — PR 経路の権限境界（決定 A） |
| Q2 | 環境の段階を設けない。`jump` アカウントに単一環境 | 質問 Q2 = A |
| D-1 | デプロイ戦略は **in-place**（Terraform の収束）。blue/green・canary を採らない | 導出 |
| D-2 | フィーチャーフラグを導入しない | 導出 |
| D-3 | ロールバックは git のリビジョンを戻して `npm run build` + `terraform apply` | 導出 |
| D-4 | DynamoDB のデータをロールバック対象に含めない | 導出 |
| D-5 | ~~plan と apply で**別のロール**を引き受ける（`AWS_PLAN_ROLE_ARN` / `AWS_DEPLOY_ROLE_ARN`）~~ **撤回**: apply ロール `rolust-ci-apply` は削除した。CD は plan ロールだけを引き受ける（D-7。Issue #51 により 2026-09-26 訂正） | `cicd-pipeline.md` § ロールを 2 つに分ける |
| D-6 | 赤信号を **承認の前**に機械で検査し、該当したら落とす（3.4 時点で R-1〜R-8。3.7 のタグ方式追随で **R-1〜R-9** になった。Issue #24 で R-10 を足し **R-1〜R-10** になった（Issue #24 により 2026-09-27 追記）。Issue #76 で R-11 を足し **R-1〜R-11** になった（Issue #76 により 2026-09-29 追記）。Issue #85 で R-12 を足し **R-1〜R-12** になった（Issue #85 により 2026-09-30 追記））。CD に承認と apply が無くなった後は、手動経路で apply する者が apply の前に走らせる。CD の `guard` は `main` の plan の継続検査である（D-7。Issue #51 により 2026-09-26 追記） | `cicd-pipeline.md` § 承認者のための plan 読み方（実装を 4.1 に委ねている） |
| D-7 | **P-4 は成立させない。CD は反映を行わず、`plan`・`guard` による `main` の継続検査だけを担う。反映は `docs/guide/` の手動経路（Issue #178 により 2026-10-18 訂正）（plan → plan-guard → `terraform apply tfplan` → 401 の確認）だけで行う。** Environment `production` は `main` 限定の branch policy を付けたまま残す（§ D-7 — apply 経路を閉じる）（Issue #51 により 2026-09-26 追記） | 依頼者の決定（2026-09-26、GitHub のプランを変えない）、Issue #51 |
| D-8 | **公開リポジトリでは CD（`cd.yml`）を持たない。** `main` の plan の継続検査はやめ、plan と plan-guard は反映する者が手元で走らせる。CI ロール `rolust-ci-plan` を削除し、リポジトリに AWS 関連の変数を置かない（Issue #181 により 2026-10-19 追記） | 依頼者の決定（2026-10-19）、Issue #181 |

### Q1 は Q1' に上書きされた

初版の Q1 = C は「`terraform plan` は PR で自動、`terraform apply` は `main` で人の承認後」だった。
**PR 側は 3.4 の承認ゲート（revision 6、2026-08-11）で人が決定 A を選び、上書きされている。**

理由は権限の非対称性である。`pull_request` イベントでは PR の head ブランチにある
ワークフロー定義が実行されるため、push 権限を持つ者は `cd.yml` を書き換えた PR を開くだけで
plan ロールを引き受けられた。plan ロールは `terraform plan` が
`aws_ssm_parameter.basic_auth` を refresh する構造上、**本番の Basic 認証資格情報を復号できる**。
apply には人的承認が要るのに plan には要らない——この非対称性が承認ゲートの意味を弱めていた。

`sub` クレームはどの PR でも `repo:kazuki-kudo@13983136/rolust@1318055439:pull_request` で同一であり、
信頼ポリシー側で正当な PR と悪意ある PR を区別できない。したがって**経路ごと閉じた**（Issue #39 により 2026-09-26 訂正: `sub` を不変 ID の形式に改めた）。

失うものは小さい。PR 時点で機械的に検査できることの大半は `ci.yml` の `terraform` ジョブ
（`fmt` / `init -backend=false` / `validate`）と `iac-scan`（Trivy）が既に担っており、
いずれも AWS 資格情報を要しない。plan の差分は `main` への push 後・承認前に読める。

Q2 = A の根拠は製品の前提である。requirements.md の Q3 = A により Rolust が反映できるのは
デプロイ先と同一アカウントのロールだけであり、環境を分けると各環境が別々の管理対象アカウントを
持つことになる。`org.md` § Deployment の「staging へは merge で自動、production は手動承認」は
**段階が存在する場合の規定**であり、単一環境に段階を新設する根拠ではないと解した。

### D-7 — apply 経路を閉じる

（Issue #51 により 2026-09-26 追記）

private リポジトリ ＋ GitHub Free では Environment の Required reviewers を作れず、GitHub のプランも変えない（2026-09-26、依頼者の決定）。したがって P-4 は恒久的に成立しない。

それまでの統制は「`AWS_DEPLOY_ROLE_ARN` を置かない」ことだったが、これは `cd.yml` がロールを使わないようにしているだけである。引き受けの可否を決めるのは信頼ポリシーであり、その条件は `sub` = `…:environment:production` だけだった。Environment `production` は承認なし・`main` 限定で存在するため、`main` 上で `environment: production` を持つジョブが走れば、ARN を直書きするだけで apply ロールを引き受けられた。**この経路を塞ぐため、apply ロール `rolust-ci-apply` を削除した**（2026-09-26）。削除の直前に、実体の信頼ポリシー・権限ポリシー・タグが `cicd-pipeline.md` の記録と一致することを確かめてあり、同書 § 作成手順 で再作成できる。

**Environment `production` は削除せず、`main` 限定の deployment branch policy を付けたまま残す。** GitHub は `environment: production` を参照したジョブの実行時に Environment を自動作成する。そのため削除しても「無い」状態は保てず、自動作成されたものには branch policy が付かない。ロールを削除した今、この Environment は AWS 上の権限を持たない。残すのは、将来 P-4 を成立させてロールを再作成するときの防御のためである。

### D-8 — 公開リポジトリでは CD を持たない

（Issue #181 により 2026-10-19 追記）

公開リポジトリの Actions は、実行ログと成果物が外から読める。`cd.yml` の `plan` は、`main` への push ごとに実資格情報で `terraform plan` を走らせ、ログにリソースの ARN とバケット名（アカウント ID を含む）を出し、plan を成果物に 1 日置いていた（SSM SecureString の復号値が入りうる。§ 未決事項と申し送り 3）。

選択肢のうち、次の理由で「CD をやめる」を採った。
- **成果物を作らない形では足りない。** 成果物をなくしてもログが残り、廃止前の実行ログには 12 桁のアカウント ID が 34 行あった。ログはワークフローの外から隠せない（`::add-mask::` は、値ごとに列挙が要り、漏れが静かに残る）。
- **暗号化では足りない。** 鍵の管理が増え、ログは変わらない。
- **失うものが小さい。** D-7 により CD は反映せず、継続検査だけを担っていた。反映の直前の検査は手動経路が担い、「本番 == main」の確認は反映する者が手元の `terraform plan` で行う。
- **フォークした導入先にも害がある。** 公開フォークの Actions ログも公開されるため、`cd.yml` を有効にした導入先がアカウント ID を漏らす。Release の tarball に `cd.yml` は入らない。

CI ロール `rolust-ci-plan` は使い道がなくなったので、信頼ポリシーを新リポジトリ向けに更新せず、削除する。再作成の手順は `cicd-pipeline.md` § 作成手順 に残る。GitHub の OIDC プロバイダはアカウント共通なので残す。

## この CD は、前提が揃うまで動かない

（Issue #181 により 2026-10-19 訂正: この節以降の CD の記述は、廃止した `cd.yml` の設計の記録である。D-8）

初版の P-1〜P-4 のうち 3 件が解消した。**P-4 は成立させない（D-7）。この CD が apply まで動くことは無く、`plan` と `guard` だけを走らせる。**（Issue #51 により 2026-09-26 訂正）

| # | 前提 | 初版（2026-08-10） | **現在** |
|---|---|---|---|
| P-1 | Terraform state のリモート化 | 未対応 | **解消**。`infra/backend.tf`（partial config）+ `infra/backend.hcl`。ロックは S3 ネイティブ（`use_lockfile`）で DynamoDB テーブルは使わない |
| P-2 | バックエンド用リソースのブートストラップ | 未着手 | **`jump` では不要**（既存バケットを使う）。state バケットを持たない第三者は `infra/bootstrap/` を任意実行できる |
| P-3 | GitHub Actions 用 OIDC ロール | 未作成 | **作成済み**（2026-08-23。タグ `ManagedBy=manual-4.2`、Terraform の管理外。設計と再現手順は `cicd-pipeline.md` § OIDC ロール）（Issue #39 により 2026-09-26 訂正）。**Issue #181 により 2026-10-19 に削除した**（D-8。再作成の手順は同書に残る） |
| P-4 | GitHub Environment `production` の protection rule | 未設定 | **成立させない**（D-7）。Required reviewers は private リポジトリ ＋ GitHub Free では作れず（2026-09-16 に 422 で実測）、GitHub のプランは変えない。Environment `production` は `main` 限定の deployment branch policy だけを持つ（Issue #51 により 2026-09-26 訂正） |

**apply に到達する経路は無い。** apply ロールを削除したためである（D-7）。P-4 を成立させてロールを再作成する場合に限り、順序は P-3 → P-4 → `AWS_DEPLOY_ROLE_ARN` の設定であり、`cd.yml` に apply ジョブを戻す変更も要る。Environment `production` が承認なし・`main` 限定で在ることは変わらないが、引き受けられるロールが無いため AWS 上の権限は伴わない（Issue #51 により 2026-09-26 訂正）。

`cd.yml` は必要な変数が設定されるまで全ジョブが skip される。未設定のまま `main` に
push しても赤にならず、かつ「設定すれば動く」状態で待機する。前提が揃っていないのに
ワークフローだけ先に赤くなるのは、CI の赤を意味のある信号として保つうえで害になる（Issue #39 により 2026-09-26 追記: 現在は `AWS_PLAN_ROLE_ARN` などが設定済みのため、`main` への push で `plan` と `guard` が走る。Issue #51 により 2026-09-26 訂正: `apply` 以降のジョブは外した）。

### リポジトリ変数

（Issue #181 により 2026-10-19 訂正: 廃止した。旧リポジトリの 6 件は削除し、新リポジトリには AWS 関連の変数を置かない。D-8。以下は記録）

`Settings > Secrets and variables > Actions > Variables` に置く。**いずれも秘匿値ではない**
（ロール ARN もバケット名もアカウント ID を含むが、信頼ポリシーと IAM が実際の統制であり、
名前を知っていても引き受けられない）。

| 変数 | 用途 | 未設定のときの挙動 |
|---|---|---|
| `AWS_REGION` | デプロイ先リージョン | — |
| `AWS_PLAN_ROLE_ARN` | `rolust-ci-plan` の ARN | `plan` 以降の全ジョブが skip |
| `TF_STATE_BUCKET` | state を置く S3 バケット名 | `plan` 以降の全ジョブが skip |
| `TF_STATE_REGION` | そのバケットのリージョン | — |
| `POOL_ID` | ユーザプールの識別子（Terraform 変数 `pool_id`）。`cd.yml` の plan に `TF_VAR_pool_id` として渡る（Issue #108 により 2026-10-05 追記） | 未設定だと plan が失敗する（変数に既定値が無い）。`main` に merge する前に、本番の値（`jump-account`）を設定する |
| `AUTH_MODE` | 認証方式（`basic` / `cognito`）。`cd.yml` の plan に `TF_VAR_auth_mode` として渡る（Issue #20 により 2026-10-05 追記） | `basic`（既定）。本番が `cognito` なのに未設定だと、Cognito の破棄が差分として出続ける |

2026-09-26 時点で `AWS_REGION`・`AWS_PLAN_ROLE_ARN`・`TF_STATE_BUCKET`・`TF_STATE_REGION` は設定済み（2026-08-23）である。`AWS_DEPLOY_ROLE_ARN` は置かない。引き受け先の apply ロールを削除したためである（D-7。Issue #51 により 2026-09-26 訂正）。

`key` は変数にしていない。`rolust/infra/terraform.tfstate` は環境によらない規約
（第 1 階層がプロジェクト名、第 2 階層がリポジトリの Terraform ディレクトリ名）であり、
`deployment-architecture.md` § Terraform state のバックエンド が定めている。
変数にすると規約を破れる余地だけが増える。

`backend.hcl` は `.gitignore` にあるため CI では変数から組み立てる。手で書いた
`backend.hcl`（`infra/backend.hcl.example` が雛形）と**同じ形**になるようにしてある。

### 手動経路を残す（意図的な二重経路）

NFR-4 / SM-2 の判定経路は **`docs/guide/` の手動手順のまま（Issue #178 により 2026-10-18 訂正）**とする。CD が主経路になると、
第三者が手順書（`docs/guide/`）だけを辿る経路が検証されなくなり、SM-2 が形骸化する。

**D-7 により、手動経路は唯一の反映経路になった。**（Issue #51 により 2026-09-26 追記）

| 経路 | 用途 | 検証者 |
|---|---|---|
| `docs/guide/setup.md`・`docs/guide/operations.md`（Issue #178 により 2026-10-18 訂正）（手動 `terraform apply`） | **NFR-4 / SM-2 の判定経路**。第三者の再現性を問う。**唯一の反映経路**（D-7。Issue #51 により 2026-09-26 訂正）。第三者の経路は、Release の tarball から入れる `docs/guide/setup.md` の経路 A でもある。tarball は `release.yml` が作る（AWS の資格情報を持たず、反映しない。Issue #92 により 2026-10-13 追記）。tarball には第三者のライセンスの一覧 `packages/web/dist/THIRD-PARTY-NOTICES.txt` が入る（Issue #187 により 2026-10-19 追記）。`CHANGELOG.md` も入り、本番の版はその版の節の存在を `check-release.sh` が検査する（Issue #240 により 2026-11-03 追記） | deployment-execution (4.3) |
| ~~`.github/workflows/cd.yml`~~ | ~~`main` の plan の継続検査（`plan`・`guard`）。反映はしない（D-7。Issue #51 により 2026-09-26 訂正）~~ **廃止**（D-8。Issue #181 により 2026-10-19 訂正） | 本ステージ |

両者は同じ state を触るため、**ロックが競合の唯一の防波堤**になる。P-1 の解消により
S3 ネイティブロック（`use_lockfile = true`）がこれを担う。`backend.hcl` でこれを
false にしてはならない。

## パイプライン構成

（Issue #181 により 2026-10-19 訂正: 廃止した。D-8。以下は記録）

```
push -> main
  |
  +-- plan       npm ci -> npm run build -> backend.hcl 生成
  |              -> terraform init -backend-config=backend.hcl -> terraform plan -out
  |              -> show -no-color / show -json を artifact に保存（retention 1 日）
  |
  +-- guard      plan-guard 自身の回帰テスト -> 赤信号 R-1〜R-12 の検査
                 AWS 資格情報を持たない。赤信号があればここで落ちる
```

（Issue #51 により 2026-09-26 訂正: 承認待ち・apply・invalidate・smoke を外した。反映は `docs/guide/` の手動経路（Issue #178 により 2026-10-18 訂正）で行う（D-7））

<!-- Text fallback: main への push で plan ジョブが走り、backend.hcl をリポジトリ変数から
     組み立てて terraform init と terraform plan を実行し、その出力を artifact として
     保存する。次に guard ジョブが AWS 資格情報なしで plan JSON を読み、赤信号 R-1 から
     R-9 を検査する。赤信号があればここで失敗する。この CD は反映を行わない（D-7）。
     PR ではこのワークフローは一切動かない。 -->

**PR にジョブが無い。** 決定 A により `on:` から `pull_request` を外した。トリガだけ残して
ジョブ側で除外する形も取れたが、引き受けられないロールを要求して失敗するジョブが
PR ごとに出るのは無駄である（`cicd-pipeline.md` § なぜ `cd.yml` を本ステージで直さないか が
「失敗するジョブが残るのは無駄であって危険ではない」と述べた、その無駄をここで消す）。

### plan を保存して apply する理由

**廃止**（Issue #51 により 2026-09-26 訂正）: CD は apply しない（D-7）。承認した plan を CD が適用する、という目的は無くなった。手動経路でも `terraform apply tfplan` として、plan-guard にかけた plan そのものを適用する（`docs/guide/setup.md` § apply する（Issue #178 により 2026-10-18 訂正））。artifact は `guard` に plan を渡すために残す。

artifact には `tfplan`（バイナリ）、`tfplan.txt`（人が読む）、`tfplan.json`（guard が読む）の
3 つが入る。**いずれにも SSM SecureString の復号値が含まれうる**ため、
`retention-days` は GitHub の最小値である 1 にしてある。

## plan の赤信号を機械で止める

`cicd-pipeline.md` § 承認者のための plan 読み方 は、承認せず差し戻すべき差分を
R-1〜R-8 として定義し、**「将来的にはこの検査を CD の 1 ステップとして自動化し、
R-1〜R-8 のいずれかに該当したらジョブを失敗させるのが筋である」**として実装を本ステージに
委ねていた。`guard` ジョブがその実装である。

**現在の赤信号は R-1〜R-12 である。**（Issue #76 により 2026-09-29 訂正。Issue #85 により 2026-09-30 訂正） タグ方式移行に伴い ci-pipeline (3.7) が R-1 の判定を
書き換え、R-9 を新設した（§ タグ方式移行への追随）。R-10（`DenySelfEscalation` 対象の網羅）は Issue #24 で足した（Issue #24 により 2026-09-27 訂正）。判定基準の一覧は `cicd-pipeline.md` § 赤信号 — 承認せず差し戻す にある（Issue #39 により 2026-09-26 訂正: R-1 の現行基準と R-9 は、凍結された `quality-gates.md` § plan-guard の赤信号 から正本の `cicd-pipeline.md` に取り込んだ）。

| 実装 | 場所 |
|---|---|
| 検査本体 | `.github/scripts/plan-guard.sh`（bash + jq。`terraform show -json` の出力を読む） |
| 回帰テスト | `.github/scripts/plan-guard.test.sh` + `.github/scripts/testdata/plan-clean.json` |

### 承認の前に置く

**`apply` を外した後の位置づけ**（Issue #51 により 2026-09-26 訂正）: CD の `guard` は `main` の plan を push ごとに検査し、実環境との差分に赤信号が現れたことを知らせる。反映の直前の検査は、`docs/guide/` の手動経路（Issue #178 により 2026-10-18 訂正）で apply する者が同じ `plan-guard.sh` を自分の plan に走らせて行う（§ 手動経路でも使える）。機械が既に「差し戻す」と判定したものを人に適用させない、という目的は変わらない。承認が日常化したときに最初に失われるのは、承認者の注意力に依存する統制である。

### AWS 資格情報を持たせない

`guard` は plan JSON を読むだけであり、ロールを引き受けない。`terraform show -json` は
初期化済みの作業ディレクトリを要るため、JSON 化は `plan` ジョブ側で済ませて artifact に載せた。
検査する側に本番への到達手段を持たせない形にしてある。

### 未確定値は緑にしない

plan の時点で値が確定しない属性（初回 apply でのリソース新規作成など）は **WARN** として出し、
緑にも赤にもしない。「見えなかった」を「問題なし」と取り違えると、検査していない差分を
検査済みとして通すことになる。WARN が出た箇所は承認者が plan を目視で確認する（Issue #51 により 2026-09-26 訂正: 手動経路では apply する実行者が、apply の前に確認する）。

未確定を赤にしなかったのは、そうすると**初回 apply が構造的に必ず落ちる**ためである。

### ゲート自身にゲートを置く

`guard` は赤信号の検査より先に `plan-guard.test.sh` を走らせる。plan-guard が静かに壊れると
「全部落ちる」か「全部通る」のどちらかになり、後者は検査していない差分を検査済みとして通す。
**通す側に倒れる壊れ方**があるものは、判定を信じる前に自己検査させる。

テストは `plan-clean.json`（赤信号のない plan）を jq で 1 箇所ずつ変異させ、対応する赤信号が
出ることを確かめる。実 AWS も実 state も要らない。本ステージの再実行時点では 25 件だったが、
3.7 のタグ方式追随で **37 件**に増えている（実測は 3.7 が行った）。

**（Issue #181 により 2026-10-19 訂正: CD の `guard` を廃止したので、この自己検査の実行経路は CI の `plan-guard` ジョブだけになった。）この自己検査は CI 側でも走るようになった。** `guard` は `needs: plan` を持ち、`plan` は
`AWS_PLAN_ROLE_ARN` / `TF_STATE_BUCKET` が設定されるまで skip される。P-3 / P-4 が
未充足である現在、**CD 側のこの自己検査は一度も走っていない**。3.7 が `ci.yml` に
独立した `plan-guard` ジョブを置いた（Q5 = B）。判定ロジックと fixture が壊れていないことは、
CD が動き出す前に CI が確かめる（Issue #39 により 2026-09-26 追記: Issue #38 以降、CD の `guard` は `main` への push ごとに走っている）。

### 黄信号（Y-1〜Y-5）は機械判定に載せていない

差分があること自体は正常で、正しいかどうかが文脈依存だからである（`managed_tag_key` /
`managed_tag_value` の変更や DynamoDB の再作成は、意図した変更なら正しい）。承認者が確認する。

**タグ方式では管理対象の増減そのものが plan に現れない。** タグを付けるのは運用者であり
Rolust も Terraform も `iam:TagRole` を持たない。したがって「Rolust が管理できるロールが
増えた」という事実は `terraform plan` にも `plan-guard` にも映らない。接頭辞方式では
`managed_role_name_prefix` の変更として plan に現れていた性質が失われている。
統制点は `iam:TagRole` の保持者に移った。

### 手動経路でも使える

`plan-guard.sh` は plan JSON のパスを引数に取るだけなので、`docs/guide/` の手動 `terraform apply`（Issue #178 により 2026-10-18 訂正）
経路でも同じ検査を回せる。

```bash
cd infra
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
../.github/scripts/plan-guard.sh tfplan.json
```

**手動経路の正は `docs/guide/` である。** `docs/guide/setup.md` § apply する と `docs/guide/operations.md` § SPA を更新したとき が（Issue #178 により 2026-10-18 訂正）、plan → plan-guard → `terraform apply tfplan` → 401 の確認 の順で手順を持つ。赤信号が出たら apply しない（Issue #51 により 2026-09-26 追記）。

## スモークテストの判定

**廃止**（Issue #51 により 2026-09-26 訂正）: `cd.yml` の `smoke` ジョブは `apply` とともに外した。以下の判定（401 を成功とし、SSM がプレースホルダなら 503 も通す。200 は FR-6.1 違反）は、`docs/guide/operations.md` § SPA を更新したとき（Issue #178 により 2026-10-18 訂正） の apply 後の確認手順に引き継いだ。自動検査ではなく人の手順に依存する点は § 未決事項と申し送り 7 に挙げる。

`terraform output -raw console_url` に対して HTTP リクエストを送り、**401 が返ることを確認する**。

200 ではなく 401 を成功条件にするのは、FR-6.1（認証なしで到達できない状態にする）が
本製品の防御の要であり、**認証が外れていることを検知できる唯一の自動チェック**だからである。
200 が返ったら認証が働いていない（Issue #20 により 2026-10-05 追記: 上の 401 は `auth_mode = "basic"` のもの。`cognito` では認証なしの `console_url` は 302、`/api/` は 401 が正常）。`docs/guide/setup.md` § 動作を確認する（Issue #178 により 2026-10-18 訂正） の手順 1 と同じ判定を
機械化したものである。

なお SSM の資格情報がプレースホルダのままなら `edge-auth` は 503 を返す（fail closed）。
初回 apply 直後は 503 が正常であり、スモークは 401 と 503 の両方を通す。

R-5（Basic 認証の関連付けが外れる）は `guard` でも検査するが、**そちらは apply 前**である。
スモークは apply 後の実測であり、両者は重複ではなく前後の二重化である。

## CI との関係

（Issue #181 により 2026-10-19 訂正: `cd.yml` を廃止したので、以下の CD への言及は記録である。`ci.yml` の `plan-guard` ジョブは `plan-guard.test.sh` の唯一の実行経路として残る。D-8）

`ci-config.md` の D-4 は「CD は本ステージの範囲外」とし、CI に deploy を持ち込まなかった。
その判断はここでも維持する。`cd.yml` は `ci.yml` と**別ファイル・別トリガ**であり、
CI のゲート（`quality-gates.md` の G-1〜G-11）を CD が再実行することはしない。

決定 A により、**PR 時点の Terraform 検査は `ci.yml` の `terraform` ジョブが唯一の担い手**に
なった。`cicd-pipeline.md` § CI 側への影響 が「3.7 の再実行でこのジョブを弱めてはならない」と
述べているのはこのためである。3.7 の再実行では逆に `infra/bootstrap/` の検証が足され、
走査対象は広がっている。

3.7 の再々実行で `ci.yml` に `plan-guard` ジョブが加わった（Q5 = B）。CD の `guard` が
持つ自己検査（`plan-guard.test.sh`）と同じものを、資格情報も state も要らない形で
PR 時点に走らせる。**CD の `guard` は P-3 / P-4 が揃うまで skip され続けるため、
それまでは CI 側が唯一の実行経路になる。** 両者は重複ではなく、走る時点が違う（Issue #39 により 2026-09-26 訂正: `guard` は `plan` にだけ依存し、`plan` は `AWS_PLAN_ROLE_ARN`・`TF_STATE_BUCKET` だけを要する。P-4 は関係せず、Issue #38 以降は `main` への push ごとに走っている。CI 側は PR 時点の実行経路として残る）。

`main` への push は `ci.yml` と `cd.yml` の両方を起動する。CD が CI の完了を待たない構成である
点は既知の限界として下記に挙げる。


## タグ方式移行への追随（再々実行の差分・2026-08-31）

infrastructure-design (3.4) が 2026-08-24 に信頼ポリシーの絞り込みを**ロール名の接頭辞から
リソースタグへ**移行し、ci-pipeline (3.7) が 8/29 に、code-generation (3.5) が 8/31 に追随した。
本書は 8/23 時点の接頭辞方式のまま取り残されていた（Issue #39 により 2026-09-26 追記: そのときの差分の記録「何が古くなっていたか」「何を変えたか」は削除した。複写元に残る）。

### CD から見たタグ方式の帰結

**1. 管理対象の増減が CD の統制に映らなくなった。**

接頭辞方式では、Rolust が管理できるロールの範囲は `managed_role_name_prefix` という
Terraform 変数が決めていた。範囲を広げるには変数を変える必要があり、それは `terraform plan`
の差分として現れ、`plan-guard` の R-1 が検査し、承認者が見る場所に来た。

タグ方式では範囲を決めるのはロールに付いたタグであり、タグを付けるのは運用者である
（Rolust も Terraform も `iam:TagRole` を持たない）。**管理対象が増えたという事実は
`terraform plan` にも `plan-guard` にも `environment: production` の承認画面にも現れない。**

CD が担保できるのは「絞り込みの**仕組み**が壊れていないこと」（R-1 が検査する)であって、
「絞り込みの**範囲**が意図どおりであること」ではなくなった。後者の統制点は
`iam:TagRole` を持てる人が誰かに移っている。**これは CD の設計で埋められる穴ではない。**
運用上の申し送りとして § 未決事項と申し送り に挙げる。

**2. 環境変数が 1 つ増えて 2 つになった。**

`infra/lambda.tf` が Lambda へ渡す環境変数が `ROLUST_MANAGED_ROLE_NAME_PREFIX` から
`ROLUST_MANAGED_TAG_KEY` / `ROLUST_MANAGED_TAG_VALUE` に変わった。apply の plan には
`aws_lambda_function` の `environment` の差分として現れる。これは黄信号（意図した変更なら正しい）
であり、機械判定には載せない。

**3. CRUD Lambda が IAM 権限を持つようになった。**

`aws_iam_role_policy.crud_iam_read_tags`（`iam:ListRoleTags`）が新設された。従来
「CRUD は IAM 権限を一切持たない」ことが FR-3.2 の構造的な担保だったが、読み取り専用の
権限を 1 つ持つ形に変わった。書き込み権限を持たない点は変わらないため FR-3.2 の担保は
保たれる。`plan-guard` の R-9 がこのポリシーの Action が `iam:ListRoleTags` 単体であることを
検査し、広がりを止める。

**4. スモークテストの判定は変わらない。**

401 / 503 を成功条件とする判定は Basic 認証（FR-6.1）を見るものであり（Issue #20 により 2026-10-05 追記: `cognito` では 302 / `/api/` の 401 / 503 になる）、管理対象の
絞り込み方式とは独立している。タグ方式移行による変更はない（Issue #51 により 2026-09-26 追記: スモークテストは廃止した。判定は `docs/guide/` の手順に引き継いだ（Issue #178 により 2026-10-18 訂正））。

## 未決事項と申し送り

1. ~~**P-4 が成立していないため、この CD は apply まで動作しない。** P-3 とリポジトリ変数 4 件は設定済みで、`plan` と `guard` は走る。P-4 は private リポジトリ ＋ GitHub Free では成立せず、プランの変更か public 化は依頼者の判断である（Issue #39 により 2026-09-26 訂正）。~~
   **解消**: P-4 は成立させず、apply 経路を閉じた（D-7。Issue #51 により 2026-09-26 訂正）。
2. ~~**CD は CI の完了を待たない。**~~ **解消**: CD を廃止した（D-8。Issue #181 により 2026-10-19 訂正）。元の記述:
   **CD は CI の完了を待たない。** `main` への push で `ci.yml` と `cd.yml` が並行して走る。
   ブランチ保護で CI を required status check にすれば PR 経由では担保されるが、`main` への
   直接 push では担保されない。`quality-gates.md` § ブランチ保護 の設定が前提になる。
3. ~~**plan artifact に SSM SecureString の復号値が入る構造は解消できない。**~~ **解消**: CD を廃止し、plan の成果物を作らなくなった（D-8。Issue #181 により 2026-10-19 訂正）。手元の plan は `infra/tfplan*` に置かれ、`.gitignore` の対象で、反映後に消す。元の記述:
   **plan artifact に SSM SecureString の復号値が入る構造は解消できない。**
   `terraform plan` が SecureString を refresh するためである（`cicd-pipeline.md` § 未決事項 3）。
   `retention-days: 1` が GitHub の最小値であり、これ以上短くできない。その 1 日の間、
   リポジトリの read 権限保持者は artifact を取得できる。**緩和であって解消ではない。**
4. **`terraform destroy` に相当する経路を CD に持たせていない。** Lambda@Edge のレプリカ削除に
   時間がかかる（`rollback-runbook.md` § Lambda@Edge の制約）ため、破棄は手動操作に限る。
5. ~~**`plan-guard.test.sh` は `ci.yml` では走らない。** `guard` ジョブの中で自己検査として
   走るため CD 経路では担保されるが、PR の時点では走らない。`ci.yml` は ci-pipeline (3.7) の
   成果物であり、承認済みの他ステージ成果物を横から書き換えないという方針
   （`project.md` `cid:infrastructure-design:c13`）に従って本ステージでは触っていない。
   **3.7 が再実行される機会があれば、`plan-guard.test.sh` を CI に足すのが筋である。**~~
   **解消**: `ci.yml` の `plan-guard` ジョブが PR 時点で `plan-guard.test.sh` を走らせる（ci-pipeline 3.7 の再々実行で追加。Issue #39 により 2026-09-26 訂正）。
6. ~~**`guard` は実際の plan で走らせていない。** OIDC ロールが未作成で state バケットにも
   到達できないため、本ステージで実測できたのは合成 plan JSON に対する 25 件のテストまでである。
   実 plan での初回実行は 4.2 / 4.3 で行われる。~~
   **解消**: 実 plan での guard は、`docs/guide/` の手動経路（Issue #178 により 2026-10-18 訂正）（4.2・4.3・Issue #38）と、Issue #38 以降の CD の `guard` で走っている（Issue #39 により 2026-09-26 訂正）。
7. **apply 後の 401 の確認（`cognito` では 302 / `/api/` の 401。Issue #20 により 2026-10-05 追記）は自動検査ではなく、人の手順に依存する。** `smoke` ジョブを外したため、`docs/guide/operations.md` § SPA を更新したとき（Issue #178 により 2026-10-18 訂正） の `curl` の確認を実行者が飛ばすと、Basic 認証が外れた状態（FR-6.1 違反）を検知する機械は無い。apply 前の検査は plan-guard の R-5 が担う（Issue #51 により 2026-09-26 追記）。
