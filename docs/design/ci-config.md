# CI Configuration — Rolust

> **正本注記**（Issue #213 により 2026-11-01 追記）
>
> - **位置づけ**: 本書は Rolust の CI（`.github/workflows/ci.yml`）の決定事項（D-1〜D-6）・ジョブ構成・ゲートの記録である。`ci.yml` の冒頭のコメントは本書を指す。
> - **複写元**: `aidlc/spaces/default/intents/260728-rolust-iam-trust/construction/ci-pipeline/ci-config.md`（2026-08-29 最終更新、2026-11-01 複写）。複写元は凍結したままで、以後の訂正は本書にだけ入れる。
> - **照合の範囲**: **CI の起動条件（トリガ）だけ**。D-1、§ ジョブ構成 の図と Text fallback の起動の記述、§ 注意点 4（ブランチ保護）を、`ci.yml`・`gh api`（2026-11-01 の実測）・`CLAUDE.md` と突き合わせた。ジョブの数・構成、ゲートの閾値、CD に関する記述は**未照合**で、凍結時のままである。
> - **訂正の全体像**（Issue #213 の時点。Issue #252 で戻した。次の項を参照）: `main` への push では CI を走らせない（`pull_request: main` と手動実行 `workflow_dispatch` のみ）。理由は GitHub Actions の利用上限（Issue #213）。あわせて、D-1 の根拠にあった squash-merge を、実運用の merge コミットに直した。
> - **トリガを戻した**（Issue #252 により 2026-11-04 追記）: 公開に伴い、`main` への push でも CI を走らせる（`push: main`・`pull_request: main`・`workflow_dispatch`）。D-1・§ ジョブ構成 の図と Text fallback・§ 注意点 4 の該当箇所に、同じ来歴を付けた。
> - **未決**: なし（下の「既知の古い記述（未訂正）」は、今回の範囲外として残した）。
> - **Node のマトリクスの訂正**（Issue #238 により 2026-11-03 追記）: Lambda と Lambda@Edge の実行環境を `nodejs24.x` に上げたため、`node` ジョブのマトリクスを 22 / 24 から 24 のみに絞った。D-5・§ ジョブ構成の図と Text fallback・§ Node の下限を別ジョブにした理由 の該当箇所に、同じ来歴を付けた。この時点では下限 20.19 の `build-floor`（D-6）は変えていなかった（次の注記で廃止した）。
> - **`build-floor` の廃止**（Issue #248 により 2026-11-03 追記）: 実行環境・CI・Release が Node 24 にそろったため、Node の下限も 24 に上げ（`package.json` の `engines`、`docs/guide/setup.md`）、下限を別に確かめる `build-floor` ジョブ（D-6）を廃止した。D-6・§ ジョブ構成の図と Text fallback・§ Node の下限を別ジョブにした理由・§ 未決事項 1 の該当箇所に、同じ来歴を付けた。ID は変えていない。
>
> **既知の古い記述（未訂正。今回の範囲外）**: 「6 ジョブ」「7 ジョブ」の数（現在は 7 ジョブで、`ci.yml` が正本。`cicd-pipeline.md` § CI 側への影響 の表も 7 ジョブの時点のもの）、§ 注意点 5 と 7 の `cd.yml`（Issue #181 で廃止した。経緯は `cd-config.md`）。触れる作業が、実装と照合してから直す。

**Stage**: ci-pipeline (3.7) / CONSTRUCTION
**Scope**: infra / **Depth**: Standard / **Test Strategy**: Standard
**Lead**: aidlc-pipeline-deploy-agent / `mode: inline`
**最終更新**: 2026-08-29（再々実行 — タグ方式移行への追随）

このステージは **CI のみ**を扱う。デプロイ（CD）は deployment-pipeline (4.1) と
deployment-execution (4.3) の領分であり、ここでは扱わない。

> **本書は再実行版である。** infrastructure-design (3.4) が後から実行され、
> `infra/backend.tf` / `infra/bootstrap/` の新設と PR 経路の権限境界の決定を持ち込んだ。
> 3.4 の `cicd-pipeline.md` § CI 側への影響 が名指しした反映事項を取り込んでいる。
> 差分は § 3.4 の成果の取り込み（再実行の差分）にまとめた。初回実行分の決定
> （Q1〜Q4、6 ジョブ構成、ゲート G-1〜G-10）は変更していない。
>
> **2026-08-29 にさらに再実行した。** infrastructure-design (3.4) が接頭辞方式から
> タグ方式へ移行し、本ステージ宛に 3 項目の申し送りを残したためである
> （`../infrastructure-design/infrastructure-specification.md` § CI ゲートとの衝突）。
> `plan-guard.sh` の R-1 は現行設計を無条件に差し戻す状態にあり、実測でブロッカーと
> 確定していた。差分は § タグ方式移行への追随（再々実行の差分）にまとめた。

## Upstream Inputs

| 成果物 | 参照した内容 |
|---|---|
| `../code-generation/code-summary.md` | 生成物一覧（4 パッケージ + Terraform 9 ファイル）、`npm run lint / typecheck / test / build` が検証コマンドであること、未解決事項 6 件 |
| `../build-and-test/build-and-test-summary.md` | 前提ツールの版（Node 24.14.0 / npm 9.6.2 / Terraform 1.10.5）、統合テストが実 AWS を要すること、`checkov` / `tfsec` / `trivy` / `gitleaks` が「実行環境に不在」で未実行であること |
| `../build-and-test/build-test-results.md` | § セキュリティ検証の 8 項目、`npm audit` の high 1 件（`nanoid`、配布物への影響なし）、OSS 公開（OQ-4）前に gitleaks の履歴走査が必要という申し送り |
| `../infrastructure-design/cicd-pipeline.md` | § CI 側への影響（`infra/bootstrap/` の validate 追加・Trivy 走査対象の拡大）、§ 決定 — PR 経路の権限境界（PR で plan を走らせない） |
| `../infrastructure-design/deployment-architecture.md` | `infra/backend.tf`（partial config）の追加、`required_version` の `>= 1.10.0` への引き上げ |
| `../infrastructure-design/infrastructure-services.md` | § 導入しないサービス の WAF 行（`.trivyignore.yaml` の `AWS-0011` の繰り延べを解消） |

infrastructure-design の 3 件は本ステージの `consumes` に宣言されていないが、
実在する成果物であり、かつ**本ステージを名指しして反映事項を残している**ため上流入力として
採る（`project.md` の学習 `cid:code-generation:c7`）。

`build-and-test-summary.md` が「ツール不在により実行できなかった検証」として引き渡した
3 項目（IaC スキャン・シークレット走査・依存監査）は、**本ステージですべて実行し解消した**。
不在だったのは能力ではなく手元の環境であり、実際には導入して実測できた。

## 決定事項

### 選定 — GitHub Actions（Q1 = A）

リポジトリの remote が `https://github.com/kazuki-kudo/rolust.git` であること、および
**CI 用の AWS リソースを一切作らない**ことが決め手である。CodePipeline を採ると CodeBuild /
CodePipeline / S3 / IAM を Terraform が追加で作ることになり、NFR-4（第三者が README と
Terraform だけでセットアップを完了できる）で `terraform apply` が作るものの範囲が広がる。
CI の都合でプロダクトのセットアップ手順が重くなるのは筋が悪い。

成果物: `.github/workflows/ci.yml`（リポジトリルート）。

### 上流から導出した事項（質問に回していない）

| # | 決定 | 根拠 |
|---|---|---|
| D-1 | トリガは `push: main`・`pull_request: main`・手動実行（`workflow_dispatch`）（Issue #252 により 2026-11-04 訂正。訂正前は `pull_request: main` と手動実行のみで、`main` への push では走らせなかった。公開リポジトリは Actions に利用上限が無いので戻した。Issue #213 により 2026-11-01 に push を外した理由は、非公開の間の GitHub Actions の利用上限である。2026-10 は約 2,027 分で、`main` への push の CI が約 822 分を占めた。さらに前の記述も `push: main` と `pull_request: main` だった） | `org.md` § Way of Working が trunk-based・短命ブランチを定める。リポジトリのブランチは `main` のみ。PR は merge コミットで取り込む（Issue #213 により 2026-11-01 訂正。訂正前は「main へ squash-merge」。実運用は `CLAUDE.md` § 開発フロー のとおり merge コミット）。Release を出す前の検査は `ci-local.sh` か手動実行で行う（`docs/development.md`） |
| D-2 | アーティファクトリポジトリ（ECR / CodeArtifact / S3）を導入しない | `infra/lambda.tf` L27 と `edge-auth.tf` L13 が `data "archive_file"` で `packages/*/dist` を apply 時にローカル ZIP 化する。レジストリを挟むと NFR-4 に手順が増える |
| D-3 | 統合テストを CI の既定経路から除外 | 実 IAM の信頼ポリシーを実際に書き換える（README § テストの方針）。`project.md`「既存の実資源を書き換える検証は退避・復元・一致確認を必須にする」に照らし、PR ごとの自動実行は取れない。`vitest.config.ts` が既に `*.integration.test.ts` を除外している |
| D-4 | CD を本ステージの範囲外とする | コンパイル済みステージグラフに deployment-pipeline (4.1) / deployment-execution (4.3) が infra スコープの EXECUTE として存在する |
| D-5 | Node 24 のテスト、Terraform 1.10.5（Issue #238 により 2026-11-03 訂正。訂正前は Node 22 / 24 のマトリクス。理由: Lambda・Lambda@Edge の実行環境を `nodejs24.x` に上げ、テストを実行環境と同じ版に絞った） | `package.json` の `engines`、`build-and-test-summary.md` § 前提ツール |
| D-6 | **廃止**（Issue #248 により 2026-11-03 訂正。訂正前は「Node 20.19 の build-only ジョブを追加」。理由: Node の下限を 24 に上げ、実行環境・テスト・下限が同じ版になったため、下限だけを別に確かめるジョブが要らなくなった） | 廃止前の根拠: README「前提」節が下限を 20.19 と宣言しており、宣言が正しいかを CI で押さえることは NFR-4 / SM-2 の一部を機械的に担保することにあたる |

D-6 は上流の指示ではなく本ステージの追加判断だった。廃止前の理由は下記「Node の下限を別ジョブにした理由」。

## ジョブ構成

```
push: main / pull_request: main / workflow_dispatch（Issue #213 により 2026-11-01 に push: main を外し、Issue #252 により 2026-11-04 に戻した）
  |
  +-- node (matrix: 24)      lint -> typecheck -> test:coverage -> build（Issue #238 により 2026-11-03 訂正。訂正前は matrix: 22, 24）
  |                          （Issue #248 により 2026-11-03 訂正。訂正前は build-floor (20.19) が並んでいた）
  |
  +-- terraform              fmt -check -recursive -> init -backend=false -> validate
  |                          （infra と infra/bootstrap の 2 ルートモジュール）
  |
  +-- iac-scan               trivy config infra (CRITICAL/HIGH で失敗)
  |
  +-- secrets                gitleaks git . (履歴全体・検出で失敗)
  |
  +-- deps                   npm audit --audit-level=high
  |
  +-- plan-guard             ./.github/scripts/plan-guard.test.sh
                             （本番デプロイを止める側のコードの自己検査）
```

<!-- Text fallback: main への push、main 向け PR、または手動実行（workflow_dispatch）を契機に、6 つのジョブが並列に走る
     （Issue #213 により 2026-11-01 訂正し、Issue #252 により 2026-11-04 に戻した。#213 の訂正前は「push または main 向け PR を契機に」。ジョブの数は未照合）。
     node ジョブは Node 24 で lint・typecheck・カバレッジ付きテスト・
     ビルドを順に実行する（Issue #238 により 2026-11-03 訂正。訂正前は Node 22 と 24 のマトリクス）。訂正前は build-floor が Node 20.19 で依存導入とビルドのみを行っていた（Issue #248 により 2026-11-03 廃止）。
     terraform は書式検査（-recursive）・バックエンドなし初期化・検証を、infra と
     infra/bootstrap の 2 つのルートモジュールに対して行う。iac-scan は Trivy、
     secrets は gitleaks、deps は npm audit、plan-guard は plan-guard.test.sh を
     実行する。相互依存はない。 -->

7 ジョブは相互に依存させていない。直列化すると最初の失敗以降の情報が得られず、
1 回の PR で分かることが減るためである。

### Node の下限を別ジョブにした理由

> **廃止済み**（Issue #248 により 2026-11-03 追記）: Node の下限を 24 に上げ、`build-floor` を廃止した。実行環境（`nodejs24.x`）・テスト・下限が同じ版なので、下限を別ジョブで確かめる必要がない。Node 20 は 2026-04 に EOL を迎えており、tarball から入れる経路（Node 不要）の利用者にも影響しない。以下は廃止前の判断の記録である。

`jsdom@30.0.1` が `^22.22.2 || ^24.15.0 || >=26.0.0` を要求するため、**テストは Node 20.19 では
走らない**。一方 `package.json` の `engines` と README は下限を 20.19 と宣言しており、README の
セットアップ手順は `npm install` と `npm run build` である。

`node_modules` 配下の全 `package.json` の `engines.node` を走査したところ、20.19 を排除する
制約を持つのは `jsdom` / `undici` / `@asamuzakjp/css-color` / `@asamuzakjp/dom-selector` の 4 件で、
**すべて jsdom（テスト専用）の依存部分木**にある。ビルド経路（`vite` / `rolldown` /
`@vitejs/plugin-react` / `esbuild`）はいずれも `^20.19.0` を許す。`.npmrc` が無く
`engine-strict` は既定の false なので、`npm ci` は EBADENGINE 警告を出すだけで失敗しない。

したがって「テストは 22 以上（CI は 24 のみ。Issue #238）・ビルドは 20.19 から」が実態であり、ジョブを分けることで
README の宣言をそのまま検証できる。ここが赤くなったら、直すか `engines` を上げるかの
どちらかであって、放置してよい赤ではない。

### 検証ツールの版を固定した理由

`TRIVY_VERSION` / `GITLEAKS_VERSION` / `TERRAFORM_VERSION` をワークフローの `env` で固定し、
GitHub Action ではなくリリースのバイナリを直接取得している。版が動くと、赤の原因が
コードの変更なのかツールの更新なのかを切り分けられなくなる。また gitleaks の公式 Action は
GitHub Organization で使う場合にライセンスキーを要求するため、バイナリ取得にすると
リポジトリの所有形態が変わっても影響を受けない。

## 実装上の落とし穴（実測で確認したもの）

### Trivy は `.trivyignore.yaml` を自動検出しない

除外の**根拠**（`statement`）と**失効期限**（`expiredAt`）を書けるのは YAML 形式だけだが、
Trivy が自動検出するのはプレーンな `.trivyignore` のみである。`--ignorefile .trivyignore.yaml`
を明示しないと、ファイルは存在するのに**黙って無視される**。

実測（Trivy 0.73.0）:

| 呼び出し | 結果 |
|---|---|
| `trivy config infra --severity CRITICAL,HIGH --exit-code 1` | exit 1（除外が効かない） |
| `trivy config infra --severity CRITICAL,HIGH --exit-code 1 --ignorefile .trivyignore.yaml` | exit 0 |

ワークフローの当該ステップにこの旨をコメントで残した。将来この指定を「冗長だから」と
外すと、除外が効かなくなるのではなく**ゲートが黙って厳しくなる**（= 赤くなる）。その際に
`.trivyignore` へ改名して解決すると、今度は根拠と期限を失う。

なお `paths` の指定は scan-ref からの相対パス（`cloudfront.tf`）で書く。`infra/cloudfront.tf`
と書くと一致せず、除外が効かない。

### OSS 版 checkov は重大度を持たない

Q3 = C は「Critical / High を検出したら失敗させる」だが、**無償の checkov には severity が無い**
（severity は Prisma Cloud プラットフォーム側の機能）。実測では 142 passed / 57 failed で、
57 件すべてが重大度なしである。これをそのままゲートにすると「57 件全部を直すか、
全部を無視するか」の二択になり、回答が求めた強度を表現できない。

重大度を持つのは tfsec を吸収した Trivy であるため、**回答の文面（「IaC スキャン」）ではなく
回答が求めたゲートの強度**を満たす方を採り、Trivy を選定した。

## 3.4 の成果の取り込み（再実行の差分）

infrastructure-design (3.4) は `cicd-pipeline.md` § CI 側への影響 で本ステージへの反映事項を
名指ししていた。その 3 点と、決定 A の帰結 1 点を取り込む。

| # | 3.4 が名指しした事項 | 反映 |
|---|---|---|
| 1 | `infra/bootstrap/` に対する `init -backend=false` + `validate` を足す | `terraform` ジョブに 2 ステップ追加（下記） |
| 2 | `fmt` は追加対応不要（`-recursive` が bootstrap を含む） | 変更なし。実測で確認 |
| 3 | `iac-scan` の走査対象が `infra/bootstrap/` に広がる | コマンドは変更不要（scan-ref が `infra` で再帰的）。持ち込まれる検出を実測して確認 |
| 4 | 決定 A — PR では AWS ロールを引き受けない | `terraform` ジョブが **PR 時点で Terraform を機械的に検査する唯一の経路**になった。その旨を `ci.yml` にコメントで固定 |

### `infra/bootstrap/` は独立したルートモジュールである

`terraform init` / `validate` は 1 ディレクトリしか見ない。`infra/` に対する初期化では
`infra/bootstrap/` は検証されないため、ステップを分ける。

```yaml
- name: 初期化（バックエンドなし） — bootstrap
  working-directory: infra/bootstrap
  run: terraform init -backend=false

- name: 構文と型の検証 — bootstrap
  working-directory: infra/bootstrap
  run: terraform validate
```

ステップの `working-directory` はジョブ既定（`infra`）を上書きし、**ワークスペースルート
相対**で解決される。起点を取り違えれば `infra/infra/bootstrap` を探して即座に失敗する——
README の `cd infra` 問題（3.4 のレビュアー finding B-1）と違い、**黙って飛ばされる形には
ならない**。同じクラスの誤りでも、失敗が見えるかどうかで危険度が変わる。

### `backend.tf` の追加は `terraform` ジョブに影響しない

3.4 が `infra/backend.tf`（`backend "s3" {}` の partial config）を追加したが、
`terraform init -backend=false` は**バックエンドの初期化そのものを行わない**ため、
`backend.hcl` も AWS 資格情報も要らないまま通る。実測で確認した。

### Terraform の版が `versions.tf` と結合した

3.4 が `required_version` を `>= 1.9.0` → `>= 1.10.0` に引き上げた（S3 ネイティブロック
`use_lockfile` のため）。ワークフローの `TERRAFORM_VERSION: "1.10.5"` は満たしているが、
**この固定値を 1.10.0 未満に下げると `terraform init` が落ちる**。`ci.yml` の `env` に
その旨をコメントで残した。

### 再実行時の実測

| 検証 | コマンド | 結果 |
|---|---|---|
| G-6 書式 | `terraform fmt -check -recursive -diff infra` | **exit 0**（bootstrap を含む） |
| G-7 検証（infra） | `terraform -chdir=infra init -backend=false` + `validate` | **Success** |
| G-11 検証（bootstrap） | `terraform -chdir=infra/bootstrap init -backend=false` + `validate` | **Success** |
| G-8 IaC スキャン | `trivy config infra --ignorefile .trivyignore.yaml --severity CRITICAL,HIGH --exit-code 1` | **exit 0**（Trivy 0.73.0、`bootstrap` / `bootstrap/main.tf` が走査対象に現れることを確認） |
| G-9 シークレット走査 | `gitleaks git . --no-banner --redact --exit-code 1` | **exit 0**（16 コミット / 5.01 MB、検出 0 件） |
| G-10 依存監査 | `npm audit --audit-level=high` | **exit 0**（0 件） |

`trivy` / `gitleaks` は本セッションの実行環境の PATH に無かったが、初回実行時と同じ版
（0.73.0 / 8.30.1）を取得して実測した。`project.md` の学習
「環境の不足を能力の不在と読むと、実行可能な検証を『不可能』として記録することになる」に従う。

**bootstrap が持ち込む検出は `AWS-0089`（state バケットに S3 アクセスログなし）1 件のみで、
重大度は LOW である。** 除外適用後の全体は LOW 15 件 / MEDIUM 1 件（初回は LOW 14 / MEDIUM 1）で、
差分はこの 1 件に一致する。CI ゲートは CRITICAL / HIGH のみを見るため**緑のまま**であり、
`.trivyignore.yaml` には書かない（3.4 の判断。書くと「LOW も見ている」という誤った印象を
与えるため。代替の監査手段は README の CloudTrail データイベント）。

G-1〜G-4（Node 系）は再実測していない。前回実行以降 `packages/` に変更が無いためである
（`git log --since` で確認。変更されたのは Terraform・README・`aidlc/` 配下の文書のみ）。

## ワークスペースへの変更

本ステージは通常 record dir 配下の設計文書のみを書くが、回答の前提を満たすために
ワークスペースのファイルにも手を入れている。

| ファイル | 変更 | 根拠 |
|---|---|---|
| `.github/workflows/ci.yml` | 新規 | Q1 = A |
| `.trivyignore.yaml` | 新規 | Q4 = A（既知 HIGH 2 件を根拠と期限つきで除外） |
| `package-lock.json` | `nanoid` 3.3.16 → 3.3.18（3 行） | Q3 = E の選択肢が「先に `npm audit fix` を当てる前提」と明記していたため |
| `package.json` | `@vitest/coverage-v8@4.1.10` を devDependency に追加、`test:coverage` スクリプトを追加 | Q2 = A が「計測して表示する」を求めているため。計測にはプロバイダが要る |
| `vitest.config.ts` | `coverage` ブロックを追加（**`thresholds` は意図的に置かない**） | 同上。ゲートにしないことをコメントで明示した |

**再実行で加えた変更**:

| ファイル | 変更 | 根拠 |
|---|---|---|
| `.github/workflows/ci.yml` | `terraform` ジョブに bootstrap 用の `init -backend=false` + `validate` を追加 | 3.4 § CI 側への影響 |
| 〃 | `terraform` ジョブに「PR 時点で Terraform を検査する唯一の経路」というコメントを追加 | 3.4 の決定 A |
| 〃 | `TERRAFORM_VERSION` に `versions.tf` の `>= 1.10.0` との結合をコメントで明記 | 3.4 による `required_version` の引き上げ |
| 〃 | `iac-scan` に走査対象の拡大と `AWS-0089` を除外しない理由をコメントで明記 | 3.4 の判断 |
| `.trivyignore.yaml` | `AWS-0011` の `statement` から「infrastructure-design で再検討する」を削除し、3.4 の「導入しない」という決定への参照に置き換え。ヘッダにゲート対象外の重大度を書かない旨を追記 | 3.4 `infrastructure-services.md` § 導入しないサービス |

`.trivyignore.yaml` の編集後にゲートを再実行し **exit 0** を確認した。除外が壊れていれば
HIGH 2 件が戻って exit 1 になるため、この結果は YAML が正しく解釈されていることの裏付けでもある。

`npm audit fix` 適用後、`lint` / `typecheck` / `build` が exit 0、テスト 21 ファイル / 137 件が
全パス、`npm audit` が 0 件であることを確認済み。NFR-4（再現性）への影響は patch レベルの
推移的依存の更新のみで、`package-lock.json` はコミット対象なので再現性は保たれる。

## タグ方式移行への追随（再々実行の差分・2026-08-29）

infrastructure-design (3.4) が信頼ポリシーの絞り込みを**ロール名の接頭辞から
リソースタグへ**移行した。絞り込みの表現場所が `Resource` から `Condition` へ移った
という変更である。これが CI ゲートに 3 つの帰結を持った。

### 何が壊れていたか

`plan-guard.sh` の R-1 は Allow の `Resource` が `:role/*$` に一致するだけで RED を出し、
**`Condition` を一切読んでいなかった。** 移行後の設計はまさにその形（`Resource = role/*`
＋タグ条件）を採るため、CD の `guard` ジョブで必ず止まる。3.4 が合成 plan で実測し、
**赤信号 3 件・終了コード 1** を確認していた。`cd.yml` の `apply` は `needs: guard` を
持つため、このまま CD へ流すと apply に到達できない。

**統制の意図（到達範囲が広がっていないか）と、その実装（`Resource` の形）を
取り違えると、表現場所が移った瞬間に統制は誤検知へ変わる。** R-1 が差し戻すのは
「広がった Allow」であって「`Resource` が `role/*` である Allow」ではなかった。

副産物として、新設された `aws_iam_role_policy.crud_iam_read_tags` が
**検査対象アドレスに含まれず 1 件も検査されていない**ことも判明していた。

### 何を変えたか

| ファイル | 変更 |
|---|---|
| `.github/scripts/plan-guard.sh` | R-1 の判定を「到達範囲が管理対象タグで絞られているか」へ改めた。期待するタグキーは plan JSON の `.variables.managed_tag_key.value` から読む。読めない場合は RED（Q6 = B）。R-9（`crud_iam_read_tags` の Action が `iam:ListRoleTags` 単体か）を新設。説明文から `managed_role_name_prefix` の語を除いた |
| `.github/scripts/plan-guard.test.sh` | R-1 のテストを迂回 3 形態 + 条件なし + 値不一致（WARN）へ組み替え、判定基準欠落の RED 3 本と R-9 の 4 本を追加。複数赤信号の同時テストの変異を `Condition` 削除へ変更 |
| `.github/scripts/testdata/plan-clean.json` | タグ方式の形へ移行。`crud_iam_read_tags` の要素と `variables` ブロックを追加 |
| `.github/workflows/ci.yml` | `plan-guard` ジョブを新設（Q5 = B。独立ジョブ） |

判定基準そのものは `quality-gates.md` § plan-guard の赤信号 に置いた。
`../infrastructure-design/cicd-pipeline.md` の R-1〜R-8 一覧は 3.4 の承認済み成果物であり、
**横から書き換えていない**（`project.md` `cid:infrastructure-design:c13`）。

### なぜ `plan-guard` を CI 側にも置いたか（Q5 = B）

`plan-guard.test.sh` は以前から存在したが、走る場所は `cd.yml` の `guard` ジョブだけだった。
その `guard` は `needs: plan` を持ち、`plan` は `AWS_PLAN_ROLE_ARN` /
`TF_STATE_BUCKET` が設定されるまで skip される。P-3（OIDC ロール）と P-4（承認ゲート）が
未充足である現在、**この自己検査は一度も走っていなかった。**

ゲートそのものが静かに壊れると「全部落ちる」か「全部通る」のどちらかになり、後者は
検査していない差分を検査済みとして通す。判定ロジックと fixture の両方を書き換える回に、
その自己検査が走らない状態は残せない。テストは jq と bash だけで完結し、実 AWS も
実 state も要さないため、CI 側に置ける。独立ジョブにしたのは、失敗箇所が Actions 上で
terraform の検査と分離して見えるようにするためである。

### 実測

| 検証 | 結果 |
|---|---|
| `plan-guard.test.sh` | **PASS=37 / FAIL=0**（変更前は 24 件） |
| `plan-guard.sh testdata/plan-clean.json`（移行後の fixture） | **赤信号 0 件 / 警告 0 件・終了コード 0** |
| `ci.yml` の YAML 構文 | パース成功 |
| `plan-guard.sh` / `plan-guard.test.sh` の bash 構文 | `bash -n` 成功 |

**実 `terraform plan` に対しては実行していない。** AWS 資格情報と共有 state のロックを
要するためである。検証は移行後の設計を模した合成 plan に対して行った。

## 未決事項と申し送り

1. （`build-floor` は Issue #248 により 2026-11-03 に廃止した。以下は廃止前の記録）**`build-floor` ジョブの初回結果は事前検証していない。** 依存の `engines` 制約からは通る
   見込みだが、Node 20.19 の実行環境が手元に無いため実測していない。他の 5 ジョブは
   すべて実測で緑を確認している。
2. **`deps` ジョブはコードが変わらなくても赤くなりうる。** 新しい勧告が公開されれば
   `npm audit --audit-level=high` は落ちる。これは Q3 = E を選んだ以上は仕様であり、
   赤くなったときに「無視する」を既定にしないことが運用上の要点になる。
3. **カバレッジの実測値は line 48.85%**（core 90.42% / edge-auth 95.24% / api 51.60% /
   web 30.46%）。`org.md` § Testing Posture が infra スコープに定める 80% とは開きがある。
   Q2 = A はこれをゲートにしないと決めたが、`build-and-test-summary.md` が挙げた
   「5 画面のうち 4 画面に画面単位のテストが無い」がそのまま数値に出ている。
4. **CI は `main` へのマージを機械的にブランチ保護で強制していない。** ワークフローは
   定義したが、required status checks の設定は GitHub 側の操作であり、リポジトリ設定として
   別途必要になる。ジョブ名は再実行でも変えていないため、`quality-gates.md` § ブランチ保護 の
   対象リストはそのまま使える。（Issue #213 により 2026-11-01 追記: ブランチ保護・ルールセットは、現在の契約（private・Free）では使えない。
   `gh api repos/<owner>/<repo>/branches/main/protection` が 403（`Upgrade to GitHub Pro or make this repository public`）を返す。
   赤い CI のまま merge できる状態は、公開後にブランチ保護が使えるようになるまで続く。`main` への push では CI を走らせなくなった
   （D-1）ので、merge の結果の検査は、PR の CI と、Release 前の `ci-local.sh`・手動実行による。）
   （Issue #252 により 2026-11-04 追記: 公開に切り替えるとルールセットが使える。Issue #252 で `main` に、force push と削除の禁止、PR の必須（承認 0 件）を入れる。
   required status checks は設けない（作業者が 1 人で、CI が走らない変更の merge を妨げないため）。D-1 も戻して、`main` への push で CI が走る。）
5. **`terraform` ジョブは PR 時点の Terraform 検査の唯一の経路になった**（3.4 の決定 A）。
   実リソースとの差分は `main` への push 後・apply の承認前にしか見えない。この非対称性は
   意図した設計であり、`cd.yml` 側の反映は deployment-pipeline (4.1) の再実行に残っている。
6. **`infra/bootstrap/` は CI で `validate` までしか見ていない。** 実際に S3 バケットを作る
   `apply` は第三者のセットアップ経路でのみ走り、CI では検証されない。`bootstrap` は
   backend を持たずローカル state で動くため、CI が state を壊す心配はない。
7. **`cd.yml` の `guard` ジョブのステップ名が `赤信号 R-1〜R-8 を検査する` のままである。**
   R-9 の新設により実体と食い違う。`cd.yml` は deployment-pipeline (4.1) の成果物であり、
   4.1 は本ステージの直後に実行される。横から書き換えず申し送る
   （`project.md` `cid:infrastructure-design:c13`）。あわせて同ジョブのコメント
   （L169）の `R-1〜R-8` も同じ修正を要する。
8. **`../infrastructure-design/cicd-pipeline.md` § 赤信号 — 承認せず差し戻す の一覧は
   R-1〜R-8 のままであり、R-1 の現行基準と R-9 を含まない。** 3.4 の承認済み成果物のため
   書き換えていない。現行基準は `quality-gates.md` § plan-guard の赤信号 が持つ。
   3.4 が再実行されることがあれば、そこで一覧を揃えること。
9. **`plan-guard` はポリシーの「形」しか見ない。** どのロールに実際にタグが付いているかは
   `terraform plan` に現れない（3.4 の受容リスク R-e — タグの付け外しは IaC の外で起きる）。
   R-1 が緑であることは「Allow がタグで絞られている」ことを示すのみで、
   「管理対象が意図どおりである」ことは示さない。統制点は `iam:TagRole` の保持者にある。
10. **`.variables` を読む経路は `terraform show -json` の出力形式に依存する。**
   形式が変われば `$tagkey` が null になり、R-1 は RED を出して apply を止める
   （Q6 = B の fail closed）。止まる側に倒してあるので見逃しにはならないが、
   Terraform の版を上げるときは `plan-guard.test.sh` の 3 本（`variables` 欠落系）が
   実際の出力を模しているかを確認すること。
11. **`plan-guard` ジョブは `jq --version` を最初に走らせる。** ubuntu-latest には
   入っているが、無ければ `plan-guard.test.sh` は終了コード 2（前提不足）で落ちる。
   「前提不足」を「検査して問題なし」と読み違えないための明示である。
