# 開発者向けの手引き

Rolust の開発に加わる人向けです。使う人向けの手順書は [docs/guide/](guide/README.md) にあります。貢献の流れは [CONTRIBUTING.md](../CONTRIBUTING.md) にあります。

## ディレクトリ構成

| ディレクトリ | 内容 |
|---|---|
| `packages/core` | ドメインモデルと純粋なビジネスロジック（差分算出・保全方式マージ）。AWS SDK に依存しない |
| `packages/api` | Lambda ハンドラ・DynamoDB リポジトリ・IAM クライアント |
| `packages/web` | 管理画面（React + AWS Cloudscape Design System / SPA） |
| `packages/edge-auth` | CloudFront viewer-request の認証（Lambda@Edge。Basic 認証または Cognito の OIDC。`auth_mode` で選ぶ） |
| `infra` | Terraform 一式 |
| `cloudformation` | ターゲットアカウントに Reader・Manager のロールを作る CloudFormation テンプレートと、その権限の不変条件のテスト |
| `docs/guide` | 利用者向けの手順書。Release の tarball に同梱される |
| `docs/design` | 要件・画面設計・IAM ポリシー設計・CI/CD の設計の正本 |
| `docs/superpowers` | 2026-09-23 以降の設計書（`specs/`）と実装計画（`plans/`） |
| `docs/runbooks` | 実 AWS を要する実測（モックでは確かめられない層）の手順書 |

2026-09-23 より前の AI-DLC 時代の経緯（`aidlc/`）と、旧リポジトリの履歴・Issue・PR は、この木には持ち越していません。旧リポジトリ（`rolust-legacy`、非公開）に残っています（Issue #182 により 2026-11-04 追記）。

## コマンド

```bash
npm run lint        # ESLint（flat config）
npm run typecheck   # tsc --noEmit（4 パッケージすべて）
npm run test        # Vitest（ユニットテストのみ）
npm run test:coverage   # カバレッジの計測（合否ゲートではない）
npm run build       # Lambda バンドル + SPA ビルド

npm run dev --workspace @rolust/web    # SPA の開発サーバ
```

ローカルの SPA から別オリジンの API を叩く場合は `.env.example` をコピーして `.env` を作り、`VITE_ROLUST_API_BASE_URL` を設定してください。**`.env` に AWS の認証情報を書かないでください。** 認証情報は実行ロールまたはローカルの AWS 認証情報チェーンから取得されます。

CI（`.github/workflows/ci.yml`）と同じ検査は、**まとめて手元で走らせられます**（Issue #199）。この CI は全ジョブが AWS の資格情報を持たないため、原理的に全部ローカルで再現できます。

```bash
./.github/scripts/ci-local.sh                    # ci.yml の 7 ジョブすべて
./.github/scripts/ci-local.sh secrets iac-scan   # 指定したジョブだけ
./.github/scripts/ci-local.sh --list             # ジョブの一覧
```

固定版（Terraform・cfn-lint・trivy・gitleaks）は `ci.yml` から読み、手元の版が違えばその場で失敗します（黙って別の版で走らせません）。`trivy` は `.ci-local/bin` へ自動取得し、SHA-256 を照合します。手元の Node と一致しない版（CI の matrix の版が手元と違うときのその版）は `SKIP` として要約に出ます — **`SKIP` がある実行は CI の全ジョブを覆っていません**。

個別の検査は次のとおりです。変更に関係するものを、push の前に CI と同じ版・同じ引数で走らせてください。

```bash
./.github/scripts/plan-guard.test.sh                 # plan-guard の回帰テスト（jq が必要）
./.github/scripts/release.test.sh                    # Release の tarball を作る・検査するスクリプトの回帰テスト
./.github/scripts/guide-parity.sh                    # 手順書の英語版（docs/guide/en/）と日本語版の、見出しの階層の列の一致
./.github/scripts/guide-parity.test.sh               # その検査の回帰テスト
./cloudformation/target-roles.test.sh                # ターゲット側ロールのテンプレートの不変条件
./.github/scripts/protected-values-guard.sh          # 保護値の検査（gitleaks 8.30.1 が必要）
(cd infra && terraform fmt -check -recursive && terraform init -backend=false && terraform validate)
```

### CI が走る時と、Release の前

CI は、`main` 向けの PR の作成・追加 push、`main` への push（merge）、手動実行で走ります（Issue #252 により 2026-11-04 訂正。訂正前は、`main` への push では走りませんでした。非公開の間の GitHub Actions の利用上限のためで、旧 #213 の決定です）。merge の結果の検査は、`main` への push の CI が受け持ちます。

**Release のタグを打つ前に**、`main` の最新の CI が緑であることを確かめ、手元でも検査を走らせてください。手元と GitHub 上のどちらでも構いません。

```bash
git switch main && git pull --ff-only
./.github/scripts/ci-local.sh                 # 手元で（版が合わない SKIP は、その理由を読む）
gh workflow run ci.yml --ref main             # または GitHub 上で。結果は gh run list --workflow ci.yml
```

Release の流れ（`CHANGELOG.md` の見出しを版に改める PR → 検査 → タグ）は [CONTRIBUTING.md](../CONTRIBUTING.md) の「Release を出す（メンテナー）」にあります。タグを打つ前に、`CHANGELOG.md` にその版の節があることを確かめてください（無ければ `release.yml` の検査が落ちます）。手元では `./.github/scripts/changelog-section.sh vX.Y.Z` で取り出せます。

公開したリポジトリは Actions に利用上限が無いので、`push` のトリガを戻しました（Issue #252。`docs/design/ci-config.md` D-1）。

## テストの方針

アプリケーションコード（`packages/`）は **TDD** で書きます。失敗するテストを先に書き、失敗を確かめてから実装します。5 画面すべてに画面単位のテストがあります。Terraform・CI 設定・文書は、`terraform validate`・plan-guard・grep などの機械的な判定で検証します。

`npm run test` は AWS SDK を `aws-sdk-client-mock` でスタブしており、**実行で実 AWS を呼ぶことはありません**。カバレッジ（`npm run test:coverage`）は**計測して記録するだけで合否ゲートではありません**。

### 統合テスト

実 AWS に対する統合テストは別扱いです。

```bash
source .local/rolust.env && ROLUST_INTEGRATION=1 npm run test:integration
```

信頼ポリシーの反映は、実 IAM API の呼び出しそのものが要件であり、モックでは検証できません。このテストは**対象ロールの信頼ポリシーを実際に書き換え、終了時に実行前の状態へ復元します**。誤って実行しないよう二重に止めてあります。

1. `vitest.config.ts` が `*.integration.test.ts` を除外しているので `npm run test` からは走らない
2. `ROLUST_INTEGRATION=1` が無ければ全件スキップされる

**誰が走らせるか**: PR の貢献者は走らせなくてかまいません。CI でも走りません。実 AWS に触れる変更（信頼ポリシーの反映、権限の昇格にかかわる面）は、メンテナーが実測します。

**走らせるときの前提**（実行する人が事前に用意します。テストは作成も削除もしません）:

- 2 つの AWS アカウント（DEPLOY: Rolust のデプロイ先、TARGET1: クロスアカウントの確認用）のプロファイルがあり、それぞれ対象ロールの信頼ポリシーを読み書きできること（`iam:GetRole`・`iam:UpdateAssumeRolePolicy`）。
- 固定名のロール 3 本が実在すること。名前と役割は `packages/api/src/integration/real-iam.integration.test.ts` の冒頭の表にあります。
- DEPLOY に IAM ユーザ `test1@example.com`〜`test3@example.com` が実在すること（IAM は実在しないプリンシパルを拒否します）。
- 環境変数 `ROLUST_INTEGRATION_{DEPLOY,TARGET1}_{PROFILE,ACCOUNT}` を設定すること。**既定値はありません。** 書き込みの前に、プロファイルのアカウントが期待と一致するかを STS で照合し、違えば書き込まずに失敗します（誤ったアカウントの同名ロールを書き換えないため）。
- 個人の値は、gitignore した `.local/` に置きます。雛形は `.local/rolust.env.example` で、`.local/rolust.env` に写して値を入れ、`source` で読み込みます。プロファイル名はリポジトリで強制しません。標準の `AWS_PROFILE` と、この個人設定を使います。

## 改行コード

改行コードは LF に固定しています（`.gitattributes` の `* text=auto eol=lf`。Issue #235 により 2026-11-03 追記）。Windows で CRLF のファイルを編集しても、`git add` の時点で LF にそろうので、改行だけの差分は出ません。`git config core.autocrlf` の設定は要りません。

- 改行だけを変えたコミットは `.git-blame-ignore-revs` に登録します。GitHub の画面では自動で効きます。手元で `git blame` に効かせるには、`git config blame.ignoreRevsFile .git-blame-ignore-revs` を一度実行します。今は登録するコミットがありません（旧リポジトリで登録していた 1 件は、履歴を持ち越していないので外しました。Issue #182 により 2026-11-04 訂正。訂正前は `aidlc/` を `-text` にする記述もあったが、`aidlc/` がこの木に無いので削除した）。

## 英語表記の用語対応

画面と API のメッセージの英語表記は、次の表に従います（旧 Issue #94 で定めた用語。`packages/core/src/messages/en.ts` が参照します）。

| 日本語 | English |
|---|---|
| ユーザプール | user pool |
| IAMユーザ（画面 1） | IAM users |
| IAMロール管理（画面 2） | IAM roles |
| IAMロール割り当て（画面 3） | Role assignments |
| 差分確認・反映（画面 4） | Review and apply |
| 申請履歴（画面 5） | Request history |
| 申請（ChangeRequest） | request |
| 下書き / 反映済み / 失敗 / 破棄 | Draft / Applied / Failed / Discarded |
| 反映（する） | apply |
| 信頼ポリシー | trust policy |
| 管理対象タグ | managed tag |
| ロールロック | role lock |
| プリンシパル | principal |
| 割り当て | assignment |
| 凍結入力 | frozen input |
| 属性列 | attribute column |
| 保全方式 | preservation merge |

## 設計の記録

要件・画面設計・IAM ポリシーの設計判断の正本は `docs/design/` にあります（案内は `docs/design/README.md`）。変更は、それを必要とする作業と同じ PR で更新します。

| ファイル | 内容 |
|---|---|
| `docs/design/requirements.md` | 要件（FR / NFR / 制約 / 前提 / 未解決事項） |
| `docs/design/mockups.md` | 5 画面の設計と各画面の 5 状態 |
| `docs/design/interaction-spec.md` | インタラクションとコンポーネント仕様 |
| `docs/design/design-system-mapping.md` | 画面とコンポーネントの Cloudscape 部品への対応 |
| `docs/design/iam-policy-design-note.md` | IAM ポリシーの設計と、最小権限が成立しない理由 |
| `docs/design/cicd-pipeline.md`・`cd-config.md` | CI ロールの権限、plan の赤信号、CD の決定事項 |
| `docs/design/deployment-strategy.md`・`rollback-runbook.md` | 反映の戦略と、ロールバックの手順 |
| `docs/design/one-time-migrations.md` | 過去のデプロイを更新するときだけ要る、一度きりの移行手順 |
| `packages/api/TABLE-DESIGN.md` | DynamoDB の状態テーブルと申請テーブルのキー設計とアクセスパターン |

OSS 公開前に行ったセキュリティ点検の記録（観点・方法・発見・対処）は `docs/security-review.md` にあります。塞いである攻撃経路が列挙してあるので、認証・認可・IAM ポリシー・配信ヘッダに触れる変更の前に読んでください。脆弱性の報告窓口は `SECURITY.md` です。

設計書と実装計画は `docs/superpowers/specs/` と `docs/superpowers/plans/` に置きます（案内は `docs/superpowers/README.md`）。2026-09-23 より前は AI-DLC で開発しており、その経緯は旧リポジトリの `aidlc/` に凍結してあります。この木には持ち越していません。
