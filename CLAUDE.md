# Rolust

AWS IAM ロールの信頼ポリシー（`AssumeRolePolicyDocument`）を、申請と差分確認を経て保全方式で反映する管理ツール。利用者向けの説明・セットアップ・制約は `docs/guide/`、開発者向けは `docs/development.md` と `CONTRIBUTING.md` にある。`README.md`（英語）と `README.ja.md`（日本語）は入口の案内である。

> **旧番号の読み方**（Issue #182 により 2026-11-04 追記）: この木は、旧リポジトリ（`rolust-legacy`、非公開）の main から履歴を持ち越さずに作った。**Issue・PR の番号が #251 以下のものは、旧リポジトリのものである**（以下の「Issue #121」などの来歴を含む）。この木の新しい番号は #252 から始まる。新しい Issue・PR・コミットで旧番号を引くときは「旧 #N」と書く。旧リポジトリの Issue は `gh issue view N --repo kazuki-kudo/rolust-legacy` で引く（N ≤ 251 を `--repo kazuki-kudo/rolust` で引くと、存在しないか別物に当たる）。`aidlc/` と旧 plan・旧コミットの SHA も旧リポジトリのもの。

## 構成

実装言語は TypeScript で統一する（フロント: React + AWS Cloudscape、バックエンド: Node.js Lambda）。

- `packages/core` — ドメインモデルと純粋なビジネスロジック（差分算出・保全方式マージ）。AWS SDK に依存しない
- `packages/api` — Lambda ハンドラ（crud / diff / apply の 3 系統）・DynamoDB リポジトリ・IAM クライアント。テーブル設計は `packages/api/TABLE-DESIGN.md`
- `packages/web` — 管理画面（React + Cloudscape の SPA）
- `packages/edge-auth` — CloudFront viewer-request の Basic 認証（Lambda@Edge）
- `infra/` — Terraform 一式（`>= 1.10.0`）。`infra/bootstrap/` は state バケットを持たない第三者向けの任意経路
- `cloudformation/` — ターゲットアカウントに Reader・Manager のロールを作る CloudFormation テンプレート（`target-roles.yaml`）と、その権限の不変条件のテスト（Issue #92）
- `.github/workflows/` — `ci.yml`（lint・型・テスト・Terraform 検証・CFN 検証・trivy・gitleaks・npm audit）と `release.yml`（タグ `v*` で tarball を作って Release に添付する。本文は `CHANGELOG.md` のその版の節を先頭に、自動生成のノートを後ろに置く。AWS の資格情報を持たない。Issue #92・#240）。公開リポジトリは Actions のログが外から読めるので、AWS の資格情報を使うワークフロー（CD）を持たない。plan と plan-guard は手元で走らせる（`docs/design/cd-config.md` D-8。Issue #181）
- `.gitleaks-protected.toml`・`.github/scripts/protected-values-guard.sh`・`.githooks/` — 保護値（アカウント ID など）の混入検査。規約は「保護値」の節（Issue #177）
- `docs/design/` — 設計の正本（要件・画面設計・IAM ポリシー設計・CI/CD）。案内は `docs/design/README.md`
- `docs/guide/` — 利用者向けの手順書（概要・セットアップ・認証・クロスアカウント・管理対象ロール・ユーザプール・運用・制約）。Release の tarball に同梱される。`docs/guide/en/` はセットアップ・認証・クロスアカウントの英語版（Issue #205・#245）
- `docs/development.md`・`CONTRIBUTING.md` — 開発者向けの手引きと、貢献の流れ
- `CHANGELOG.md` — 版ごとの、利用者に影響する変更と「更新時にやること」。tarball に同梱し、Release の本文の先頭にも使う（Issue #240）

## コマンド

```bash
npm run lint              # ESLint
npm run typecheck         # tsc --noEmit（4 パッケージ）
npm run test              # Vitest（ユニット。AWS SDK はモックで、実 AWS を呼ばない）
npm run test:coverage     # カバレッジの計測（合否ゲートではない）
npm run build             # Lambda バンドル + SPA ビルド
npm run dev --workspace @rolust/web
source .local/rolust.env && ROLUST_INTEGRATION=1 npm run test:integration   # 実 IAM を書き換えて復元する統合テスト（環境変数は必須。雛形は .local/rolust.env.example）
./.github/scripts/plan-guard.test.sh                                 # plan-guard の回帰テスト（jq が必要）
./.github/scripts/release.test.sh                                    # Release の tarball を作る・検査するスクリプトの回帰テスト
./.github/scripts/guide-parity.sh                                    # 手順書の英語版（docs/guide/en/）と日本語版の、見出しの階層の列の一致（Issue #205）
./.github/scripts/guide-parity.test.sh                               # その検査の回帰テスト
./cloudformation/target-roles.test.sh                                # ターゲット側ロールのテンプレートの不変条件（PyYAML のある Python が要る。PYTHON= で指す）
./.github/scripts/protected-values-guard.sh                          # 保護値の検査（追跡ファイルと起点以降の履歴・メッセージ。gitleaks 8.30.1 が要る。Issue #177）
./.github/scripts/protected-values-guard.test.sh                     # 保護値の検査の回帰テスト
(cd infra && terraform fmt -check -recursive && terraform init -backend=false && terraform validate)
```

## 開発フロー（Superpowers）

- 作業の単位は GitHub Issues（kazuki-kudo/rolust）。依頼には Issue 番号を添え、spec・コミット・PR にも含める。
- 入口は `superpowers:brainstorming`。bounded な修正はチャットで短い設計を承認してから実装し、architectural な変更は spec と plan を作る。
- brainstorming では、変更が触れる FR・画面・IAM の記述を `docs/design/` で確かめてから設計する。
- spec は「正本への反映」節を必ず持ち、覆す・足す ID と節を列挙する。該当が無ければ「なし」と書く（確認を飛ばしたのか、該当が無かったのかを区別するため）。bounded ではチャットの設計に同じ列挙を含める。正本の更新は plan のタスクに含め、実装と同じ PR で行う。
- 正本に無い凍結文書（旧リポジトリ `rolust-legacy` の `aidlc/` にある運用手順や CI 設計など）を訂正・変更する必要が出たときは、その文書を旧リポジトリから `docs/design/` に複写して正本にしてから直す（手順は `docs/design/README.md`）。`aidlc/` はこの木には無く、旧リポジトリでも書き換えない。（Issue #182 により 2026-11-04 訂正。訂正前は「`aidlc/` の運用手順や CI 設計など」と、`aidlc/` がこの木にある書き方だった。）
- spec は `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`、plan は `docs/superpowers/plans/YYYY-MM-DD-<feature>.md` に置く。
- ブランチ: 現在のチェックアウト上でフィーチャーブランチを切り、worktree は既定では使わない（Windows では worktree ごとに `npm install` が要るため）。並行作業が要るときだけ `.worktrees/` を使う。
- trunk-based で進める。`main` から短命なブランチを切り、PR を GitHub で merge コミットにより取り込む（`main` の first-parent の履歴では 1 PR が 1 つの merge コミットになり、ブランチのコミットも残る）。`finishing-a-development-branch` では「push して PR」を選び、`main` へのローカル merge はしない。
- README は日本語（`README.ja.md`）を正本とし、英語（`README.md`）は日本語から訳す。README を変える PR は 2 本を同じ PR で更新し、見出しの構造・順序とリンクを 1 対 1 に揃える。`docs/guide/` は日本語が正本で、`setup.md`・`access-control.md`・`cross-account.md` だけ `docs/guide/en/` に英語版を持つ。この 3 本を変える PR は日本語版と英語版を同じ PR で更新し、見出しの階層の列の一致を `guide-parity.sh` が検査する。ほかの手順書は日本語のみで、英訳しない（Issue #205 により 2026-11-03 訂正: 訂正前は `docs/guide/` 全体を日本語のみとしていた。Issue #245 により 2026-11-03 追記: `cross-account.md` を足して 3 本にした。Issue #179。`CONTRIBUTING.md` の「README を更新する」）。
- 利用者に影響する変更（機能・画面・API の挙動、Terraform の変数や出力、更新のときの作業）は、同じ PR で `CHANGELOG.md` の `## 未リリース` に追記する。`### 更新時にやること` は、通常の更新手順（`docs/guide/operations.md`）に加えて必要な作業があるときだけ書く。タグを打つ前に、見出しを `## vX.Y.Z - 日付` に改める PR を merge する（`CONTRIBUTING.md` の「Release を出す」。Issue #240）。
- plan の実行方式（subagent-driven か inline か）は plan の承認時に選ぶ。
- デプロイは Superpowers の工程に無い。terraform apply を伴う Issue は、plan の最終タスクに `docs/guide/operations.md` の手順による反映（CD は持たず、反映しない。`docs/design/cd-config.md` D-7・D-8）と、その実測を含める。

## テスト方針

- アプリコード（`packages/`）は TDD で書く。失敗するテストを先に書き、失敗を確かめてから実装する。
- Terraform・CI 設定・文書は TDD の例外（configuration files）とし、変更した層ごとに機械判定で検証する。Terraform は `terraform fmt -check`・`terraform validate`・plan-guard、CI は `plan-guard.test.sh` と実際の workflow の実行、文書は grep などの機械的な判定。
- モックは実物より寛容になりうる。外部サービスが拒否する状態をモックが受理していると、その経路はユニットテストをすり抜ける。要件が外部 API の呼び出しそのもの（信頼ポリシーの反映など）であれば、モックでは原理的に検証できないので、統合テストか実測で確かめる。
- 既存の実資源を書き換える検証は、実行前の退避・実行後の復元・復元後の一致確認を必須にする。新規作成のフィクスチャと違い、後片付けの失敗が他人の資源を壊した状態で残るため。
- 統合テストの環境変数（`ROLUST_INTEGRATION_{DEPLOY,TARGET1}_{PROFILE,ACCOUNT}`）は必須で、既定値を持たない。書き込みの前に、プロファイルの STS が期待アカウントと一致するかを照合する（誤ったアカウントの同名ロールを書き換えないため。Issue #176）。個人の値は gitignore した `.local/` に置く（雛形は `.local/rolust.env.example`）。
- 実 AWS を要する成功指標や特権昇格面（`DenySelfEscalation` の対象変更など）に触れる変更では、テストの件数に関わらず、依頼者が実測を引き取れる手順書を残す。
- push の前に、変更に関係する CI の検査を CI と同じ版・同じ引数でローカル実行し、赤を潰しておく。`./.github/scripts/ci-local.sh` が `ci.yml` の 7 ジョブをまとめて走らせる（固定版は `ci.yml` から読む。手元の Node と一致しない版は `SKIP` として出る。Issue #199）。ジョブ単位で走らせるなら `ci-local.sh <ジョブ名>`、個別のコマンドは次のとおり（gitleaks は常に、`infra/` を変えたら trivy、依存を変えたら npm audit）:
  - `gitleaks git . --no-banner --redact --exit-code 1`（gitleaks 8.30.1）
  - `./.github/scripts/protected-values-guard.sh`（保護値の検査。gitleaks 8.30.1。常に）
  - `trivy config infra --ignorefile .trivyignore.yaml --severity CRITICAL,HIGH --exit-code 1`（Trivy 0.73.0）。`cloudformation/` を変えたら、同じ引数で `trivy config cloudformation …` も走らせる（`trivy config` は対象を 1 つしか取れない）
  - `cloudformation/` を変えたら `cfn-lint cloudformation/target-roles.yaml`（CI と同じ版。`ci.yml` の `CFN_LINT_VERSION`）と `./cloudformation/target-roles.test.sh`
  - `npx -y npm@11 audit --audit-level=high`（手元の npm 9.6.2 は high があっても exit 0 を返し、CI の npm 11 だけが赤くなる。`.claude/rules/shell-and-aws-cli.md`。Issue #194）

## コード規約

- 整形と lint は ESLint（`eslint.config.js`）と `tsc` の設定に従う。設定が扱わない事項だけを提案する。
- 統合境界（AWS API・DynamoDB・ファイル I/O）でエラーを処理し、握りつぶさない。呼び出し元へ返すか、ログに残す。
- 認証情報や秘密情報をハードコードしない（`.env` にも AWS の認証情報を書かない）。システム境界で入力を検証する。

## 決定済みの仕様

- ChangeRequest は破棄分・失敗分を含めて件数無制限に蓄積する。保持期間・件数上限・TTL は設けない。
- Assignment の保存はセル単位の即時 API 呼び出しとし、debounce でまとめない。楽観的更新はせず失敗したセルを操作前に戻す仕様のため、まとめると巻き戻し対象が曖昧になる。
- レイテンシに数値目標を新設しない。NFR-1 が定量しきい値を持たないため、UX 上の手当ては loading 状態の定義で足りる。
- Assignment の同じセルの同時更新は後勝ちとし、version などの排他は設けない（Issue #121）。セル単位の即時保存は絶対値の書き込みで、別のセルは干渉せず、同じセルはどちらの値も正当なため。排他するのは ChangeRequest の状態遷移だけ（FR-5.8）。Rolust の外からの IAM 変更は防げないので対象外。

## 進め方の原則

- 決定済みの事項（Issue・spec・README・過去の決定）から根拠をもって導出できることは再質問せず、導出した根拠を書き残す。質問に回すのは導出根拠が無いものだけ。
- 人間が「X なら Y」と分岐付きで決めた事項は、X が実測で確定した時点で再質問せずに Y を発動する。
- 制約を基盤層（IAM ポリシーなど）だけでかけると、違反は操作の連鎖の末尾で初めて現れる。制約は、それを作り込んだ操作の場（登録時など）でも検証して返す。
- 作業中に見つけた不具合はその場で直し、回帰テストを足す。設計判断や要件変更を伴うものは直さず、選択肢を添えて人間の判断を仰ぐ。
- 「ツールが実行環境に無い」を「検証できない」と読まない。まず導入を試みる（CI が固定する版をスクラッチ領域に取得し、CI と同じ引数で実測する）。
- 指示された手段が、指示の求める強度を表現できないときは手段の方を差し替える（例: OSS 版 checkov は重大度を持たず「Critical / High で失敗させる」を表現できないため Trivy を採った）。
- 手順書は文面を読むのではなく、経路として実行して確かめる。設計文書の手順表と手順書（`docs/guide/`）は乖離しうる。
- レビュー指摘の採否は、指摘された機構の正誤ではなく、穴が実在するかで決める。
- 依頼者の操作待ち（SSO ログインなど）の間は、その操作に依存しない検証を先に進める。
- 実行環境に止められた破壊的操作（一括削除など）を、別の手段で押し通さない。実行コマンドを示して人間に選ばせる。復元が必須の資源（IAM など）は、止められる前に先に片付ける。
- 承認済み文書の食い違いを訂正するときは、名指しされた箇所だけでなく同種の古い記述を grep で総当たりし、同じ来歴で直す。後から追記・訂正するときは、冒頭の追記注記（日付・Issue・変更の全体像）と各箇所の来歴（例: 「Issue #1 により 2026-09-21 追記」）の二層にする。

## 保護値（実値の混入防止）

次の 5 種を、コード・文書・spec・plan・コミットメッセージ・Issue・PR・コメントのどれにも書かない（Issue #177。OSS 公開のため）: AWS アカウント ID、CloudFront の DNS 名、自宅の IP アドレス、会社ドメイン、作者メール。

| 守る対象 | 書くもの（検査が通す形） |
|---|---|
| AWS アカウント ID | `<ACCOUNT_ID>`、`111122223333`（4 桁の同じ数字を 3 つ並べた形と `123456789012`） |
| CloudFront の DNS 名 | `dXXXXXXXXXXXXX.cloudfront.net` |
| IP アドレス | `203.0.113.x`（RFC 5737 の `192.0.2.0/24`・`198.51.100.0/24`・`203.0.113.0/24`、`127.*`、`0.0.0.0`） |
| メールアドレス | `user@example.com`（`example.com`・`example.org`・`example.net`、`users.noreply.github.com`、`noreply@anthropic.com`、`git@github.com`） |

- 実測の記録（PR 本文・コメント・plan・handoff）には、件数や種類だけを書く。実値が要る作業では、その場で取り出す（アカウント ID は `aws sts get-caller-identity`、CloudFront の DNS 名は `terraform output -raw console_url`、IP の正本は SSM）。個人の値は gitignore した `.local/` に置く。応答や出力に実値が混ざっても、そのまま貼らない。
- 検査の実体は `.gitleaks-protected.toml`（ルールの唯一の定義）と `.github/scripts/protected-values-guard.sh`。許可していない形の 12 桁の数字・`*.cloudfront.net`・IPv4・メールアドレスを検出する。誤検知は、その行の末尾に `gitleaks:allow` を付けて通す。ファイル名（パス）も同じルールで検査する。検出の報告はルール・ファイル・行だけで、値は出ない（パス名に値があるときは、ファイル名も伏せる）。
- `gh` や GitHub の MCP ツールで Issue・PR・コメントを投稿する**前**に、本文をファイルか標準入力で `./.github/scripts/protected-values-guard.sh text [file]` にかけ、0 で終わることを確かめる。投稿する本文は CI の走査の対象外である。
- コミットメッセージと、作者・コミッタのメールは `commit-msg` フックが検査する（`#` で始まる行も検査する。`git commit -m` の本文では git が消さないため）。メールは `git var` の値を同じルールにかけるので、`git config user.email` を `<ID>+<ユーザ名>@users.noreply.github.com` の形にする（`<ID>` は `gh api user --jq .id`。環境変数での上書きも検査する）。clone したら一度 `git config core.hooksPath .githooks` を実行する。（Issue #182 により 2026-11-04 追記。作者メールの強制は旧リポジトリでは見送っていた。）
- gitleaks（8.30.1）が PATH に無い、または版が違うと、検査は終了コード 2 で止まる（通さない）。`GITLEAKS_BIN` で実行ファイルを指せる。Windows は Release の `gitleaks_8.30.1_windows_x64.zip` を取得し、`*_checksums.txt` の SHA-256 と照合して PowerShell の `Expand-Archive` で展開する（Git Bash の tar は zip を展開できない）。docker が動いていれば `ghcr.io/gitleaks/gitleaks:v8.30.1` でもよいが、このスクリプトは実行ファイルを直接呼ぶ。
- 走査の範囲は、除外が `.git/` と `package-lock.json` だけで、履歴は全履歴である（`PROTECTED_BASE` の既定は空。起点を指定すると `PROTECTED_BASE..HEAD` だけを走査する）。（Issue #182 により 2026-11-04 訂正。旧リポジトリでは `aidlc/` と `docs/superpowers/plans/` を除き、履歴は #176 の merge 以降だけを走査していた。この木の初回コミットは 1 つで、旧履歴を持ち越していない。）
- `<ダミー>_<実値>` のように、区切りの `_` を前の値と共有する実値は、補助ルール（`protected-account-id-underscore`・`protected-ipv4-underscore`）で拾う（Issue #182 により 2026-11-04 追記。#177 で据え置いた取り逃がしを、実測で確かめて直した）。据え置いている点: `history` は、merge コミットだけで入った内容（競合の解決で足した行など）を見ない。PR を merge コミットで取り込む運用なので、将来の履歴には merge コミットができる。ただし `tree` が結果の木を毎回走査するので、木に残る実値は検出される。取りこぼすのは、merge コミットで足して後で消した実値だけである。必要になったら、`--log-opts` に `--diff-merges=first-parent` を足して対処する。

## 記録の場所

- 設計の正本: `docs/design/` と `packages/api/TABLE-DESIGN.md`。ファイル名だけの参照（例: `mockups.md` 画面 2）は `docs/design/` を指す。正本の ID（FR-x・GI-x・節番号など）は変えない。削除は欠番、追加は末尾
- 2026-09-23 以降の設計と計画: `docs/superpowers/specs/`、`docs/superpowers/plans/`
- それ以前: 旧リポジトリ（`rolust-legacy`）の `aidlc/`（AI-DLC 時代の記録。凍結済みで書き換えない。設計の根拠や経緯を読む用途に限る。案内は旧リポジトリの `aidlc/README.md`）。**この木には持ち越していない。** 旧リポジトリの plan（`docs/superpowers/plans/`）と履歴・Issue・PR も同じ（Issue #182 により 2026-11-04 訂正。訂正前は `aidlc/` がこの木にある書き方だった）。以下は旧リポジトリの中のパス:
  - 要件・画面設計・IAM の設計判断の経緯（旧リポジトリ）: `aidlc/spaces/default/intents/260728-rolust-iam-trust/`（現在の設計は `docs/design/`）
  - 2026-09-20 時点のコード知識（旧リポジトリ）: `aidlc/spaces/default/codekb/rolust/`
- 領域別の規則: `.claude/rules/`（`frontend.md` は `packages/web/`、`aws-infra.md` は `infra/`・`.github/` のファイルを読んだときに読み込まれる）

## 言語

本文（spec・plan・コミットメッセージ・PR・文書）は日本語で書く。コード識別子・パス・コマンド・要件 ID（FR-1 など）は原文のまま。
