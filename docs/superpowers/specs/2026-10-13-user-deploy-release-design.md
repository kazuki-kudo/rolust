# 利用者向けのデプロイ手順 — Release の配布とターゲット側ロールのテンプレート — 設計

- 日付: 2026-10-13
- Issue: #92
- ブランチ: `feat/92-user-deploy-release`
- 状態: spec レビュー待ち

## 1. 背景と目的

Rolust を自分の AWS アカウントで使ってみたいだけの利用者がいる。OSS 開発者ではなく、GitHub リポジトリをフォークしたくない。いまの README は開発者の手順で、リポジトリを取得し、`npm install && npm run build` で Lambda のバンドルと SPA を作り、`infra/` を `terraform apply` する。ビルド済みの成果物を渡す口が無い。

クロスアカウント構成（#85）では、ターゲットアカウントに Reader・Manager の 2 ロールを作る。いまは README の JSON を 2 つ手書きし、`aws iam` を 4 回実行する手順で、値（アカウント ID、プロジェクト名、管理対象タグ）を Terraform の変数と手で合わせる。

この Issue は 3 つの論点を決める。

1. デプロイ手段の選定（Terraform / CloudFormation / 手作業）
2. クロスアカウントで、ターゲット側の作成を含めて利用者に負担をかけない手段
3. フォークなしの配布（ビルド済みの成果物、state バケットとバックエンド設定）

### 利用者像

- 自分のアカウントで試したい。フォークしない。
- Terraform を使える人もいれば、使えない人もいる。**人によって違い、複数の経路を許す**（依頼者。2026-10-13）。
- Rolust のデプロイ先アカウントに、管理対象のロールがあるとは限らない。ターゲットのロールだけを管理する構成もある（#85 以降）。

### 成功基準

1. 利用者が、リポジトリの取得も `npm` も使わずに、Release の tarball だけで apply まで完了できる（経路 A）。実測: 別アカウントで経路 A だけを辿る。
2. tarball に環境固有の値（`terraform.tfvars`・`backend.hcl`・`.terraform/`・state）が含まれない。機械で確かめる（`release.yml`）。
3. tarball の SHA-256 を `SHA256SUMS` で確かめられる。
4. 展開した tarball で `terraform init -backend=false && terraform validate` と `plan-guard.test.sh` が通る。通らなければ `release.yml` は Release を作らない。
5. ターゲット側のロールを、CloudFormation テンプレート 1 つで作れる。作ったロールの信頼ポリシーと権限ポリシーが、旧 README の JSON と一致する（実測。`jq -S` で比較）。
6. 開発者の反映の経路（作業ツリーからの `terraform apply`）と `cd.yml` は変わらない。
7. 更新と削除の手順が README にあり、更新は実際に 1 回通す（`v0.0.0-rc.1` から `v0.0.0-rc.2`）。

## 2. 決定事項

| ID | 事項 | 決定 | 出所 |
|---|---|---|---|
| D-1 | 方式 | **Terraform 一本**。Release にビルド済みの成果物と `infra/` を添付する | 依頼者の選択（2026-10-13）。採らなかった案: (a) CloudFormation との二本立て。62 リソースの定義が 2 重になって食い違いを防げず、Lambda@Edge の us-east-1 制約があり、plan-guard（Terraform の plan JSON に依存する自作の検査。R-1〜R-12）に相当する検査も無い。(b) CloudFormation で CodeBuild を立て、中で `terraform apply` を走らせる案。Terraform が正本のまま、手元に何も入れずに済むが、実行役の層（CloudFormation）と Rolust の層（Terraform）の二層を更新する必要があり、CodeBuild の実行ロールが IAM の作成権限を持つ。更新の手間は案 1 と変わらない |
| D-2 | 利用者の環境 | 手元の PC に Terraform 1.10 以上・AWS 認証情報・bash と jq を用意する（経路 A）。Node.js と npm は要らない。CloudShell で完結する手順（1b）は後続の Issue | 依頼者の選択（2026-10-13）。CloudShell は Terraform と plan-guard が動くか、無操作タイムアウトに引っかからないかが未実測のため、実測していない手順を README に載せない |
| D-3 | 配布物 | `rolust-vX.Y.Z.tar.gz` と `SHA256SUMS`。tarball の配置は作業ツリーと同じ（`infra/`・`packages/*/dist`・`.github/scripts/plan-guard.sh`・`cloudformation/`） | 導出: `infra/` が `../packages/*/dist` を読む構造を変えない。README の plan-guard の呼び出し（`../.github/scripts/plan-guard.sh`）が、開発者と利用者で同じコマンドになる。依頼者が承認（2026-10-13） |
| D-4 | バージョン | タグ（`vX.Y.Z`）を正とする。`package.json` の `0.1.0` は変えない | 導出: `package.json` は npm に公開しないため、タグと二重に管理すると食い違う。依頼者が承認（2026-10-13） |
| D-5 | CD との関係 | `cd.yml` は変えない。`release.yml` は AWS の資格情報を持たず、`contents: write` だけを持つ | `docs/design/cd-config.md` D-7（CD は反映しない）の維持 |
| D-6 | ターゲット側のロール | CloudFormation テンプレート `cloudformation/target-roles.yaml` を Release に添付する。ターゲットアカウントごとに 1 スタック。手書き JSON の手順を README から外し、テンプレートを唯一の定義にする | 依頼者の選択（2026-10-13）。Terraform サブモジュールにはしない（#85 の依頼者の選択。ターゲット側は Terraform の対象外）を維持する |
| D-7 | 表記 | Rolust をデプロイしたアカウントを「**デプロイ先アカウント**」と書く。「JUMP」は依頼者の環境の呼び名であり、利用者向けの文面・パラメータ名に使わない。テンプレートのパラメータは `DeployAccountId` | 依頼者の指摘（2026-10-13） |
| D-8 | デプロイ先の前提 | デプロイ先アカウントに管理対象のロールがある必要はない。README 66 行の「管理対象の IAMロールと同じアカウントであること（Q3=A の制約）」は、#85 以降は誤りであり、訂正する | 依頼者の指摘（2026-10-13）。#85 でクロスアカウントに対応済み |
| D-9 | 非公開の間 | リポジトリは OSS 公開まで非公開のまま実装する。取得は `gh release download` で実測する。認証なしの取得（ブラウザ・`curl`）は公開後にしか確かめられないため、未実測として扱う | 依頼者の選択（2026-10-13） |
| D-10 | 実測の環境 | 別のアカウントを使い、終わったら destroy する。同じアカウントに 2 つ目の Rolust は置かない | 依頼者の選択（2026-10-13）。導出: 同じアカウントに置くには、`project_name` に加えて DynamoDB のテーブル名 2 つと SSM のパラメータ名 5 つ（既定値が `rolust` 固定）をすべて変え、state を分ける必要がある。さらに `aws_api_gateway_account` はアカウントとリージョンに 1 つの設定で、destroy でリセットされるため、本番のアクセスログが止まる。変数では避けられない |
| D-11 | 値の手同期の削減 | デプロイ先の Terraform に、出力 `target_roles_deploy_command` を足す。`aws cloudformation deploy` のコマンドを、Terraform の変数の値で埋めて出す | 導出: 既存の `set_basic_auth_command` と同じ作り。管理対象タグ・ロール名・プロジェクト名のずれ（#85 の README 注意）を防ぐ |

## 3. 設計

### 3.1 配布物（tarball）

```
rolust-vX.Y.Z/
  infra/                      *.tf、.terraform.lock.hcl、*.example、bootstrap/
  packages/api/dist/{crud,diff,apply}/index.js
  packages/edge-auth/dist/index.js
  packages/web/dist/...
  .github/scripts/plan-guard.sh
  cloudformation/target-roles.yaml
  README.md
```

含めないもの: `terraform.tfvars`・`backend.hcl`・`.terraform/`・`*.tfstate`・`packages/*/src`・`node_modules`・テスト。`.terraform.lock.hcl` は含める（利用者が同じ版のプロバイダで動かす）。

tarball は、手元の作業ツリーではなく、CI が clean な checkout から作る。作業ツリーには `backend.hcl` と `terraform.tfvars`（アカウント固有の値）が置かれており、手元から固めると混ざる。

### 3.2 `release.yml`

- 起動: タグ `v*` の push。
- 手順:
  1. タグの形式を確かめる。`-` を含まないタグ（本番の版）は、コミットが `main` の祖先であることも確かめる。違えば失敗する。prerelease（`v0.0.0-rc.1` など）は、実測のためにマージ前のブランチから打つので、祖先の確認を飛ばす（実装計画で訂正。2026-10-13）。
  2. clean な checkout で `npm ci && npm run build`。
  3. 3.1 の構成で tarball を作り、`SHA256SUMS` を作る。
  4. **展開して検査する**: 展開先で `terraform init -backend=false && terraform validate`、`plan-guard.test.sh`、環境固有ファイルが含まれないこと。
  5. 通ったら Release を作り、2 つのファイルを添付する。タグに `-` を含む場合（`v0.0.0-rc.1` など）は prerelease にする。
- 権限は `contents: write` だけ。AWS の資格情報は持たない（D-5）。action の固定方式は `ci.yml` に合わせる。

### 3.3 `cloudformation/target-roles.yaml`

パラメータ（Terraform の変数と一致させる値）:

| パラメータ | 既定値 | 対応する Terraform の変数 |
|---|---|---|
| `DeployAccountId` | なし（必須。12 桁） | — |
| `ProjectName` | `rolust` | `project_name` |
| `ManagedTagKey` / `ManagedTagValue` | `rolust:managed` / `true` | `managed_tag_key` / `managed_tag_value` |
| `ReaderRoleName` / `ManagerRoleName` | `RolustTrustPolicyReader` / `RolustTrustPolicyManager` | `target_reader_role_name` / `target_manager_role_name` |

`ProjectName` は、ターゲット側のロールが信頼するデプロイ先の実行ロール（`<ProjectName>-crud-exec` など）を決めるだけである。デプロイ先に何かを作る設定ではない。

リソース: IAM ロール 2 本。内容は旧 README の JSON と同じにする。

- Reader: 信頼ポリシーは `<ProjectName>-crud-exec`・`<ProjectName>-diff-exec` だけを名指しする。権限は `iam:GetRole`（管理対象タグの付いたロールだけ）と `iam:ListRoleTags`。
- Manager: 信頼ポリシーは `<ProjectName>-apply-exec` だけを名指しする。権限は `iam:GetRole`・`iam:UpdateAssumeRolePolicy`（どちらも管理対象タグの付いたロールだけ）と、`DenySelfEscalation`（Reader と Manager 自身への `UpdateAssumeRolePolicy` を Deny）。

実行には `--capabilities CAPABILITY_NAMED_IAM` が要る。出力として、両ロールの ARN を出す。

組み込み関数は、`Fn::Sub:` などの**長い形式**で書く（`!Sub` の短縮形を使わない）。機械検査（3.6）が YAML を JSON として読めるようにするため。

タグのキーのパラメータ化には技術的な不確実性がある（7 節 1）。

### 3.4 Terraform の出力

`infra/outputs.tf` に `target_roles_deploy_command` を足す。`aws cloudformation deploy --template-file cloudformation/target-roles.yaml --stack-name ... --capabilities CAPABILITY_NAMED_IAM --parameter-overrides ...` を、`DeployAccountId`・`ProjectName`・`ManagedTagKey`・`ManagedTagValue`・`ReaderRoleName`・`ManagerRoleName` を Terraform の値で埋めて出す。`--profile` はターゲットの資格情報を指す placeholder とする。既存の `cross_account_target_setup` は残す（監査用の情報）。

### 3.5 README

セットアップの手順 1 を、入手の経路で分ける。

| 経路 | 手順 |
|---|---|
| **A. Release から（利用者）** | Releases ページで `rolust-vX.Y.Z.tar.gz` と `SHA256SUMS` を取得し、チェックサムを確かめて展開する。「Source code」の tarball ではなく、添付したファイルを取る旨を明記する。取得はブラウザ、または `gh release download` |
| **B. ソースから（開発者）** | 今の手順 1（`npm install && npm run build`） |

手順 2〜7（state、tfvars、plan、plan-guard、apply、Basic 認証、動作確認）は、配置が同じなので共通のままにする。

追加・訂正する節:

- **前提**: Node.js は経路 B だけ。デプロイ先アカウントの前提を D-8 のとおり訂正する。
- **更新**: 新しい tarball を別ディレクトリに展開し、`terraform.tfvars` と `backend.hcl` を持ち越して、plan → plan-guard → apply → invalidation。リリースノートで持ち越す値（`pool_id` など）を確かめる。
- **削除**: `terraform destroy` と、先に退避するもの（API Gateway のアカウント設定、DynamoDB のデータ）。散らばっている注意を集める。
- **クロスアカウント**: 手書き JSON と `aws iam` の手順を、テンプレートの手順（`target_roles_deploy_command`）に置き換える。トラブルシュートの表と「注意」は残す。ターゲット側のロールは、クロスアカウントのときだけ要る旨を明記する。
- **手作業で作った既存ロールの置き換え**: 同名のロールがあると `AlreadyExists` で失敗するため、既存の 2 ロールを削除してからスタックを作る。その間、クロスアカウントの操作は止まる。作り直した直後は、IAM の結果整合で数分待つ。
- **「JUMP」の表記**: D-7 のとおり改める。依頼者の環境名としての「jump」（SSO のプロファイル名など）は残す。

### 3.6 CI に足すもの

- `cfn-lint`（版を固定）でテンプレートを検査する。
- `cloudformation/target-roles.test.sh`: テンプレートの不変条件を機械で確かめる。(a) Reader が `iam:UpdateAssumeRolePolicy` を持たない。(b) Manager の `DenySelfEscalation` が Reader と Manager の両方を Resource に含む。(c) `GetRole`・`UpdateAssumeRolePolicy` の Allow がすべてタグ条件つき。(d) 信頼ポリシーの Principal が、Reader は crud と diff、Manager は apply だけ。
- Trivy の設定検査（`iac-scan`）の対象に `cloudformation/` を足す。

## 4. 検証

CLAUDE.md の方針に従い、`cloudformation/` と `release.yml` は設定ファイルとして、層ごとに機械判定で検証する。

**自動（CI）**: 3.6 の 3 つ。`release.yml` の展開後の検査（3.2 の手順 4）。

**`release.yml` の実行**: テスト用のタグ `v0.0.0-rc.1` を打って実際に動かし、通ったら Release とタグを削除する。

**実測（別アカウント。D-10）**:

1. 非公開の Release から `gh release download` で tarball を取得し、SHA-256 を確かめる。
2. 展開して、経路 A だけを辿る（`npm` は使わない）。state の用意（`infra/bootstrap/`）から apply、動作確認まで。
3. ターゲット用のスタックを作る。デプロイ先から、管理対象のロールを登録・差分確認・反映する。反映は、新規作成した使い捨てのロールに対してだけ行う。
4. 作った Reader・Manager の信頼ポリシーと権限ポリシーが、旧 README の JSON と一致することを `jq -S` で確かめる。
5. `v0.0.0-rc.2` を出し、更新の手順を 1 回通す。
6. destroy とスタックの削除で後片付けし、残りが無いことを確かめる。既存の資源を書き換える検証ではないので、退避と復元は要らない。

**任意の同値確認**: Release の tarball を展開して、本番の state に対して `terraform plan` だけを実行し、`No changes` になることを確かめる（`apply` はしない）。タグが `main` の先頭と一致するとき、tarball と作業ツリーが同じ定義であることの証拠になる。

**手順書として残すもの（実測しない）**: 本番（#85 の環境）の手作業で作ったロールの、スタックへの置き換え。

**未実測として明記するもの**: 認証なしでの取得（公開後）。CloudShell 版（後続の Issue）。

## 5. 正本への反映

追記は、冒頭の追記注記（Issue #92・2026-10-13）と各箇所の来歴の二層にする。実装と同じ PR で行う。

| 文書 | 変更 |
|---|---|
| `requirements.md` NFR-4・SM-2 | 第三者の経路に Release 経由を足す。クロスアカウントのターゲット側のロールを、手動ではなくテンプレートで作る旨に訂正する（#85 の追記の訂正） |
| `iam-policy-design-note.md` 3.3・277 行・458 行 | 「OSS 利用者向けの配布方法は別途検討する」を、CloudFormation テンプレートを提供する、に訂正する |
| `cd-config.md` | NFR-4 / SM-2 の判定経路（160〜166 行）に Release 経路を足す。`release.yml` が AWS 資格情報を持たず反映しない旨を明記する（D-7 は不変） |
| `cicd-pipeline.md` | `ci.yml` に足す検査（cfn-lint・`target-roles.test.sh`・Trivy の対象）と、`release.yml` の権限 |
| `deployment-strategy.md` | 配布物（tarball）と、更新・削除の戦略 |
| `README.md` | 3.5 のとおり。冒頭の対象表（25 行）と制約の節（542 行）の「パッケージ化は提供しない」も訂正する |
| `CLAUDE.md` | 構成（`cloudformation/`・`release.yml`）、コマンド（cfn-lint・`target-roles.test.sh`）、push 前の検査 |
| 「JUMP」の表記 | README・`docs/design/` 5 文書・テストコード 2 本・`cd.yml`。全箇所を grep で洗い出し、利用者向けの意味で使っている箇所だけを直す |
| `Q3=A` / 「同じアカウント」 | README 66 行を訂正する。ほかの正本を grep で総当たりする |
| `OQ-4`（ライセンス・公開先・README の記載範囲） | **覆さない。** 未解決のまま。ライセンスは OSS 公開の時点で決める |
| FR・画面・IAM ポリシーの内容 | **なし。** ターゲット側のロールの権限は旧 README の JSON と同じで、変えない |

## 6. 対象外

- CloudShell で完結する手順（1b）。後続の Issue。
- 同じアカウントへの、2 つ目の Rolust のデプロイ（D-10）。
- StackSets、Terraform サブモジュール、CodeBuild による実行役（D-1、D-6）。
- ライセンス（OQ-4）。
- Release の自動公開（OSS 公開まで）。実測用の rc タグは削除する。

## 7. 未決事項

1. **タグのキーを CloudFormation のパラメータにする方法。** 条件キー `aws:ResourceTag/<キー>` は、YAML のマップのキーに関数を使えない。ポリシー全体を `Fn::Sub` した JSON 文字列で渡す方法を、`cfn-lint` と実際のデプロイで確かめる。成立しなければ、キーは固定（`rolust:managed`）にして値だけをパラメータにし、Terraform でキーを変えた利用者にはテンプレートの編集を案内する。
2. **`target-roles.test.sh` の YAML の読み方。** 長い形式の組み込み関数なら `yq` で JSON にして `jq` で検査できる。CI のランナーにあるか、ローカル（Windows）で動くかを確かめる。無ければ、Node で読む。
3. **初回の本物のタグ。** OSS 公開時に `v0.1.0` を打つ想定。この Issue では rc タグだけを使う。
4. **tarball の再現性。** `tar --sort=name` と `gzip -n` などで同じ内容から同じバイト列にするかは、`release.yml` の実装時に決める。
