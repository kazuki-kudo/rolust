# CD の apply 経路を恒久的に閉じ、`rolust-ci-apply` を削除する — 設計

- 日付: 2026-09-26
- Issue: #51
- ブランチ: `chore/51-close-cd-apply-path`
- 状態: 設計承認済み（brainstorming の第 1〜4 節）、spec レビュー待ち

## 1. 背景と目的

### 起きていること

GitHub のプランは変更しない（2026-09-26、依頼者の決定）。private リポジトリ ＋ GitHub Free では Environment の Required reviewers を作れないため、前提 P-4（apply の人的承認）は恒久的に成立しない。

現在の統制は「`AWS_DEPLOY_ROLE_ARN` を置かない」ことだけである。これは `cd.yml` がロールを使わないようにしているだけで、引き受けの可否を決める信頼ポリシーは `sub` = `…:environment:production` しか見ていない。Environment `production` は「承認なし・`main` 限定」で存在するため、`main` 上で `environment: production` を持つジョブが走れば、ARN を直書きするだけで `rolust-ci-apply` を引き受けられる。このロールは `iam:CreateRole`・`iam:PutRolePolicy`・`iam:PassRole`（`role/rolust-*`）とワークロード資源の `*` を持つ、特権の集中点である。

### 依頼の内容

Issue #51: 未使用の特権ロール `rolust-ci-apply` を削除し、CD の apply 経路を恒久的に閉じる。反映の経路は README の手動 `terraform apply` だけにする。

### 前提（2026-09-26 に実測）

- `rolust-ci-apply` の付属物はインラインポリシー `terraform-apply` だけ。`RoleLastUsed` は空で、作成（2026-08-23）以来一度も使われていない（Issue #51 の記載）。
- リポジトリ変数は `AWS_PLAN_ROLE_ARN`・`AWS_REGION`・`TF_STATE_BUCKET`・`TF_STATE_REGION` の 4 件。`AWS_DEPLOY_ROLE_ARN` は無い（`gh variable list`）。
- Environment `production` の保護ルールは `branch_policy` だけで、deployment branch policy は `main`（type `branch`）の 1 件（`gh api …/environments`）。
- README の手動経路には、plan-guard の実行も、更新時の 401 の確認も書かれていない。plan-guard の手動手順は `cd-config.md` § 手動経路でも使える にだけあり、401 の確認は初回セットアップ § 6 にだけある。

### 成功基準

1. `aws iam get-role --role-name rolust-ci-apply` が `NoSuchEntity` を返す。
2. 削除前に、実体の信頼ポリシー・権限ポリシー・タグが正本 `cicd-pipeline.md` と一致することを確かめてある。正本の記録から再作成できる。
3. `rolust-ci-plan` の信頼ポリシーとインラインポリシーが、削除後も正本と一致する。
4. `cd.yml` に `apply`・`smoke` ジョブが無く、merge 後の `main` で `plan`・`guard` が緑になる。
5. 正本に D-7「P-4 は成立させない。反映は README の手動経路だけ」がある。現況を述べる記述に、apply ロールや P-4 を前提とするものが残っていない。
6. README の手動経路（plan → plan-guard → `apply tfplan` → `curl` で 401/503）を、jump-admin で経路として実行して通っている。

## 2. 決定事項

| # | 決定 | 根拠 |
|---|---|---|
| 1 | Environment `production` は `main` 限定の branch policy を付けたまま残す（Q1 = A） | GitHub は `environment: production` を参照したジョブの実行時に Environment を自動作成する。削除しても「無い」状態は保てず、自動作成されたものには branch policy が付かない（`.claude/rules/aws-infra.md` § CI/CD）。ロールを削除すれば Environment は AWS 上の権限を持たない。残しておけば、将来ロールを再作成するときの防御になる |
| 2 | README の手動経路に、`guard`・`smoke` の代わりを足す（Q2 = A） | 反映の経路が手動だけになる以上、承認の代わりに機械が止める関門をその経路に置く必要がある。`cd.yml` の `guard` が見るのは `main` の plan であって、手元で打つ apply の直前の plan ではない |
| 3 | 退避は、正本の JSON を正とし、削除直前に実体と `jq -S` で突き合わせる（案 1） | 置き場所が 1 か所で済み、既存の規則（aws-infra.md § CI/CD の照合手順）がそのまま使える。取得した生の出力はスクラッチ領域に置き、コミットしない。差分が出たら削除を止め、正本を実体に合わせてから進む |
| 4 | ロールの削除は、PR の作成後・merge 前に行う | 削除は PR の内容に依存しないため、先に塞ぐほど経路が開いている期間が短い。`cd.yml` の `apply` は変数が無ければ skip されるので、削除が先でも赤にならない |
| 5 | 削除のコマンドは実行前に示し、依頼者の承認を得てから打つ | ロールの削除は元に戻せない（Issue #51 の前提） |

## 3. 設計

### 3.1 `rolust-ci-apply` の退避と削除

jump-admin（ap-northeast-1）で CLI により行う。ロールは Terraform の管理外である。

**手順 1: 事前の実測（読み取りのみ）**

```bash
export AWS_PROFILE=jump-admin AWS_REGION=ap-northeast-1
aws sts get-caller-identity
aws iam get-role --role-name rolust-ci-apply                       # 信頼ポリシー・タグ・RoleLastUsed
aws iam list-role-policies --role-name rolust-ci-apply             # => terraform-apply のみ
aws iam get-role-policy --role-name rolust-ci-apply --policy-name terraform-apply
aws iam list-attached-role-policies --role-name rolust-ci-apply    # => 空
aws iam list-instance-profiles-for-role --role-name rolust-ci-apply  # => 空
```

後の 2 つは、`delete-role` を妨げる付属物（管理ポリシー・インスタンスプロファイル）が無いことの確認である。

**手順 2: 退避の照合**

- `get-role` の `.Role.AssumeRolePolicyDocument` と、正本 § 信頼ポリシー — `rolust-ci-apply` の JSON を、それぞれ `jq -S .` で正規化して比べる。
- `get-role-policy` の `.PolicyDocument` と、正本 § 権限ポリシー — `rolust-ci-apply` の JSON を同様に比べる。
- タグは正本 § 作成手順 の `Project=rolust`・`ManagedBy=manual-4.2` と比べる。
- 生の出力はスクラッチ領域に保存する。差分が出たら削除を止め、正本を実体に合わせる訂正を先に入れる。

**手順 3: 削除（依頼者の承認後）**

```bash
aws iam delete-role-policy --role-name rolust-ci-apply --policy-name terraform-apply
aws iam delete-role --role-name rolust-ci-apply
```

**手順 4: 事後の確認**

```bash
aws iam get-role --role-name rolust-ci-apply          # => NoSuchEntity
aws iam get-role --role-name rolust-ci-plan           # 信頼ポリシーを正本と jq -S で比べる
aws iam get-role-policy --role-name rolust-ci-plan --policy-name terraform-plan   # 同上
gh variable list --repo kazuki-kudo/rolust            # => AWS_DEPLOY_ROLE_ARN が無い
```

Environment `production` は変更しない（決定 1）。

### 3.2 ワークフロー

**`.github/workflows/cd.yml`**

- `apply` ジョブ（CloudFront の無効化を含む）と `smoke` ジョブを削除する。`plan`・`guard` のステップは変更しない。
- コメントを直す:
  - 冒頭: 前提表の P-4 の行を「成立させない（Issue #51、`cd-config.md` D-7）」に改め、有効化の順序と `AWS_DEPLOY_ROLE_ARN` の行を外す。反映は README の手動経路だけであることを書く。
  - `concurrency`: 「apply の同時実行を防ぐ」を、plan 同士が state のロックを取り合わないようにする目的に書き換える。グループ名 `cd-production` は変える実益が無いので残す。
  - `upload-artifact`: 「承認の対象と実際に適用される変更を一致させる」を、guard に plan JSON を渡す目的に書き換える。
  - `guard`: 「人が承認する前に落とす」を、`main` の plan の継続検査という位置づけに書き換える。

**`.github/workflows/ci.yml`**（コメントのみ）

- `terraform` ジョブ: 「実リソースとの差分は main への push 後・apply の承認前に読む」を、`main` への push 後の CD の `plan`・`guard` と、手動 apply の直前の plan-guard で読む形に改める。
- `plan-guard` ジョブ: 「P-3 / P-4 が未充足である間、CD 経由ではこのテストは一度も走らない」は Issue #38 以降すでに事実ではない。CI 側に置く理由を「PR 時点で判定ロジックの変更を検査するため」に改める。

### 3.3 文書

**方針**

- 来歴は二層にする。冒頭の追記注記（日付・Issue #51・変更の全体像）と、各箇所の「Issue #51 により 2026-09-26 訂正」。
- ID（D-x・P-x・R-x・未決の番号）は変えない。撤回は取り消し線と注記で示し、追加は末尾に置く。
- 決定の経緯として書かれた記録（`cicd-pipeline.md` § 決定 — PR 経路の権限境界 の分析と選択肢の表など）は書き換えない。現在形で現況を述べている記述だけを直す。
- 最後に `AWS_DEPLOY_ROLE_ARN`・`rolust-ci-apply`・`P-4`・`smoke`・`スモーク`・`承認` を grep で総当たりし、同種の古い記述を拾う（`aidlc/`・`docs/superpowers/` は対象外）。

**`docs/design/cd-config.md`**

| 箇所 | 変更 |
|---|---|
| 正本注記 | Issue #51 の追記注記を足す。位置づけから「スモークテスト」を外す |
| 決定事項 D-5 | 撤回とする（apply ロールは削除した）。ID は残す |
| 決定事項 D-7（新設・末尾） | 「P-4 は成立させない。CD は反映を行わず、`plan`・`guard` による `main` の継続検査だけを担う。反映は README の手動経路だけ」。Environment `production` を残す理由（決定 1）もここに書く |
| § この CD は、前提が揃うまで動かない | P-4 の行を「成立させない（D-7）」にする。有効化の順序の段落と「Environment が在ることを P-4 の完了と読み違えない」の段落を、D-7 を指す記述に改める。見出しは `cd.yml` から参照されているので残す |
| § リポジトリ変数 | `AWS_DEPLOY_ROLE_ARN` の行を外し、設定状況の段落を改める |
| § 手動経路を残す | 手動経路を唯一の反映経路とし、`cd.yml` の用途を「`main` の plan の継続検査。反映はしない」にする |
| § パイプライン構成 | 図と text fallback を plan → guard の 2 段にする |
| § plan を保存して apply する理由 | 見出しを残して廃止の注記を付ける。artifact の保持期間の記述（復号値を含みうる）は現行なので残す |
| § 承認の前に置く | `main` の plan の継続検査と、手動 apply の直前の検査という位置づけに改める |
| § 手動経路でも使える | README § 4・§ SPA を更新したとき の手順を正とし、そこを指す |
| § スモークテストの判定 | 見出しを残して廃止の注記を付ける。401/503 の判定の根拠は README の手順に引き継いだことを書く |
| § CD から見たタグ方式の帰結 4 | スモークの記述に廃止の注記を付ける |
| § CI との関係 | 「P-3 / P-4 が揃うまで skip され続ける」を現況に改める |
| 未決事項 1 | D-7 により解消とする |
| 未決事項 7（新設・末尾） | 「apply 後の 401 の確認は自動検査ではなく、README の手順に依存する」 |

**`docs/design/cicd-pipeline.md`**

| 箇所 | 変更 |
|---|---|
| 正本注記 | Issue #51 の追記注記を足す。位置づけの「OIDC ロール 2 本」を、現存 1 本と削除済みロールの再作成用の記録に改める |
| § 前提の充足状況 | P-4 の行と「CD の apply は動かない」を D-7 に合わせる |
| § OIDC ロール 導入部・§ ロールを 2 つに分ける | apply ロールは Issue #51 で削除したことを書く。2 つに分ける設計は、P-4 を成立させて再作成するときの設計として残す |
| § 信頼ポリシー — `rolust-ci-apply`・§ 権限ポリシー — `rolust-ci-apply` | JSON は残し、見出し直下に「Issue #51 により削除した。再作成用の記録。削除前に実体と一致することを確かめた」を置く |
| § 作成手順 | apply ロールの行・手順 3 の `AWS_DEPLOY_ROLE_ARN`・手順 4 を「P-4 を成立させて再作成するときだけ」と注記する |
| § 承認者のための plan 読み方 | 読み手を、手動 apply の実行者と `cd.yml` の `guard` の結果を読む者に改める。R-5 の「スモークテストでも検知できる」を README の手順に改める |
| 未決事項 2 | ロールの削除で解消とする |
| 未決事項 5 | `cd-config.md` D-7 で解消とする |

**`.claude/rules/aws-infra.md` § CI/CD**

- 「P-4 が未完了なら `AWS_DEPLOY_ROLE_ARN` を置かない」を、次の規則に差し替える: 承認ゲートが成立しない特権経路は、変数を置かないことではなく、引き受け先のロールを消して塞ぐ。引き受けの可否を決めるのは信頼ポリシーであり、ワークフローの変数ではない（Issue #51）。
- CI ロールの権限の追従（「両ロールに足す」）を plan ロールだけにする。
- apply ロールの書き込み権限の規則（Issue #40）は、再作成するときの注意として 1 行に縮める。

**`README.md`**

- § 4 apply する: `terraform plan -out=tfplan` → `terraform show -json tfplan > tfplan.json` → `../.github/scripts/plan-guard.sh tfplan.json` → `terraform apply tfplan` にする。bash と jq が要ること、初回は未確定値が WARN になり plan を目視で確かめることを添える。
- § SPA を更新したとき: 同じ plan-guard の手順と、apply 後に `curl` で 401（SSM がプレースホルダなら 503）を確かめる手順を足す。200 なら FR-6.1 が破れていること、この節が SPA に限らず更新全般の手順であることを書く。見出しは変えない。

**`docs/design/README.md`**: `cd-config.md` の説明から「スモークテスト」を外す。

**`aidlc/`**: 書き換えない。

### 3.4 検証

| 層 | 判定 |
|---|---|
| 文書 | grep で、`AWS_DEPLOY_ROLE_ARN`・`rolust-ci-apply` が来歴・再作成用の記録以外に現れないこと。`git diff --numstat` と改行コードの統計で、差分が意図した箇所だけであること |
| ワークフロー | `cd.yml` に `apply:`・`smoke:` のジョブが無いこと（grep）。actionlint（無ければ取得して実行）。`plan-guard.test.sh` |
| 秘密情報 | `gitleaks git . --no-banner --redact --exit-code 1`（gitleaks 8.30.1）。`infra/` と依存は変えないため trivy と npm audit は対象外 |
| README の経路 | jump-admin で、書き換えた README の更新手順を plan → plan-guard → `apply tfplan` → `curl` の順に実行する。`main` と実環境に差分が無ければ apply は No changes で、実資源は変わらない。差分が出た場合は apply の前に止め、依頼者に相談する |
| AWS | 3.1 の手順 4 |
| merge 後 | `main` の CD が `plan`・`guard` の 2 ジョブで緑になることを `gh run` で確かめる。#40 に「CD の実 run での確認は行わない（apply ロールを削除したため）」とコメントする |

依頼者が後から実測を引き取るときは、3.1 の手順 1〜4 と、README § SPA を更新したとき の手順をそのまま使う。

## 4. 正本への反映

| 文書 | 覆す | 足す | 直す節 |
|---|---|---|---|
| `docs/design/cd-config.md` | D-5（plan と apply で別ロール） | D-7、未決事項 7 | 正本注記、§ この CD は、前提が揃うまで動かない、§ リポジトリ変数、§ 手動経路を残す、§ パイプライン構成、§ plan を保存して apply する理由（廃止）、§ 承認の前に置く、§ 手動経路でも使える、§ スモークテストの判定（廃止）、§ CD から見たタグ方式の帰結 4、§ CI との関係、未決事項 1 |
| `docs/design/cicd-pipeline.md` | P-4 を成立させる前提（§ 作成手順 の手順 4） | なし | 正本注記、§ 前提の充足状況、§ OIDC ロール、§ ロールを 2 つに分ける、§ 信頼ポリシー — `rolust-ci-apply`、§ 権限ポリシー — `rolust-ci-apply`、§ 作成手順、§ 承認者のための plan 読み方（R-5 を含む）、未決事項 2・5 |
| `docs/design/README.md` | なし | なし | `cd-config.md` の説明 |
| `packages/api/TABLE-DESIGN.md` | なし | なし | なし |
| 要件（FR・NFR）・画面設計・IAM ポリシー設計 | なし | なし | なし（FR-6.1 の確認手段が CD のスモークから README の手順に移るが、要件そのものは変わらない） |
