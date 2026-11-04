# 新リポジトリの公開と最初の Release（Issue #252）実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 非公開の `kazuki-kudo/rolust` を公開し、v0.2.0 の Release を出し、認証なしの取得を実測し、旧リポジトリをアーカイブする。

**Architecture:** 文書とワークフローの変更は作業ブランチ `chore/252-publish` に溜め（段階 A、非公開のまま・Actions を走らせない）、公開に切り替えてから（段階 B）、PR で取り込み、CHANGELOG の見出しを改める PR を経てタグを打つ（段階 C）。最後に旧リポジトリを片付ける（段階 D）。GitHub への書き込みは 1 手ごとに依頼者の承認を得る。

**Tech Stack:** `gh` CLI（`GH_TOKEN` は新リポジトリを含む）、GitHub Actions（`ci.yml`・`release.yml`）、bash、`./.github/scripts/*`（gitleaks 8.30.1）。

**Spec:** `docs/superpowers/specs/2026-11-04-publish-new-repo-design.md`（D-1〜D-3 が依頼者の決定、C-1〜C-9 が私の判断）。

## Global Constraints

- 最初の版は **v0.2.0**。タグは `v0.2.0`（注釈付き）。版の正本はタグ。
- **公開に切り替えるまで、Actions を走らせない**: PR を作らない、`workflow_dispatch` を使わない、タグを打たない（C-1）。作業ブランチの push は、トリガが `pull_request`・手動だけなので走らない。
- 公開の切り替え、Settings の変更、PR の merge、タグの push、Issue の作成・編集・close、リポジトリのアーカイブは、すべて依頼者の承認を 1 手ごとに得てから行う。公開は「公開してよい」の明示を待つ。
- 保護値（アカウント ID・CloudFront の DNS 名・IP・会社ドメイン・作者メール）を、コード・文書・コミット・Issue・PR・コメント・Release の本文に書かない。投稿する本文は `./.github/scripts/protected-values-guard.sh text <file>` を先に通す。
- コミットメッセージの末尾は `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`、PR 本文の末尾は `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。コミット前に `git branch --show-current` を確かめる。
- PR は merge コミットで取り込む（`gh pr merge --merge`）。`main` へ直接 push しない。
- 本文は日本語。旧リポジトリの Issue・PR の番号は「旧 #N」と書く。
- 作業ディレクトリは `C:/Users/kkudo/wsclaude/rolust-oss`。Windows の落とし穴: `.claude/rules/shell-and-aws-cli.md`（新しいスクリプトは `git update-index --chmod=+x`、`gh` の出力に CRLF が混ざらない確認、など）。

## Review Focus

- 公開した直後の数分: `SECURITY.md` が案内する窓口（private vulnerability reporting）が無効のまま公開されていないか。Task 5 の最初の操作で有効にし、有効であることを `gh api` で取得して確かめる。
- Actions の実行が 0 件のまま公開に切り替わったか（Task 4 と Task 5 で、切り替え前後の `gh run list` を比べる）。
- main の保護が、自分の PR の merge を妨げないか（承認 0 件で足りること）。Task 6 の merge で実測する。
- `release.yml` は、CHANGELOG に v0.2.0 の節が無い、または main の祖先でないタグを拒否する。タグを打つ前に、Task 7 の merge 済みの見出しを `changelog-section.sh v0.2.0` で取り出せることを確かめる。
- 公開した Release の本文と添付ファイルに保護値が無いこと（Task 8）。

---

### Task 1: Issue テンプレートと CONTRIBUTING（C-5・D-2）

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`、`.github/ISSUE_TEMPLATE/question.md`、`.github/ISSUE_TEMPLATE/config.yml`
- Modify: `CONTRIBUTING.md`（「流れ」の 1 の近くに、通常の報告への応じ方を足す）

**Interfaces:**
- Consumes: なし
- Produces: `config.yml` の `contact_links` が、脆弱性の報告先として `https://github.com/kazuki-kudo/rolust/security/advisories/new` を指す（Task 5 で private vulnerability reporting を有効にすると、このリンクが機能する）。

- [ ] **Step 1: 失敗する検査を先に用意する。** 次を実行し、3 ファイルが無いので失敗することを確かめる。
  `for f in bug_report.md question.md config.yml; do test -f .github/ISSUE_TEMPLATE/$f || echo "MISSING $f"; done`
  Expected: 3 行の `MISSING`。
- [ ] **Step 2: テンプレートを書く。**
  - `bug_report.md`: front matter に `name`・`about`・`title`・`labels: bug`。本文の見出しは「何が起きたか」「期待した動き」「再現の手順」「環境（Rolust の版、`auth_mode`、導入の経路 A/B、Node のバージョン）」「実値を貼らないでください」。最後の節で、AWS アカウント ID・CloudFront の DNS 名・IP・メール・資格情報・トークンを貼らず、`<ACCOUNT_ID>` などのプレースホルダに置き換えるよう書き、**脆弱性は公開の Issue に書かず `SECURITY.md` の方法で報告する**と案内する。
  - `question.md`: front matter に `name`・`about`・`title`・`labels: question`。「知りたいこと」「試したこと」「実値を貼らないでください」（同じ文面）。
  - `config.yml`: `blank_issues_enabled: true`、`contact_links` に脆弱性の報告（上記の URL とその説明）を 1 件。
  - ラベル `bug`・`question` は GitHub の既定ラベルとして新リポジトリにあることを `gh api repos/kazuki-kudo/rolust/labels --jq '.[].name'` で確かめる（読み取りのみ）。
- [ ] **Step 3: CONTRIBUTING に追記する。** 「流れ」の 1 の後に、次の趣旨を一段落で足す: 通常の不具合報告・質問には、気づいたら返事をするが期限は約束しない。脆弱性は公開の Issue に書かず、`SECURITY.md` の方法で報告する（`SECURITY.md` の応答期限は脆弱性だけの約束）。Issue のテンプレートがあること。来歴として「Issue #252 により 2026-11-04 追記」を付ける。
- [ ] **Step 4: 機械判定。**
  `python -c "import yaml,sys; yaml.safe_load(open('.github/ISSUE_TEMPLATE/config.yml',encoding='utf-8')); print('yaml ok')"`（PyYAML のある Python。`PYTHON=` で指す）
  `grep -c "^---" .github/ISSUE_TEMPLATE/bug_report.md .github/ISSUE_TEMPLATE/question.md`（各 2）
  `./.github/scripts/protected-values-guard.sh`（終了コード 0）
  Expected: `yaml ok`、各 2、終了コード 0。
- [ ] **Step 5: Commit。** メッセージ「docs: Issue テンプレートと通常の報告への応じ方を足す（Issue #252）」。

### Task 2: CI のトリガを戻す（C-2）と、CI の記述の更新

**Files:**
- Modify: `.github/workflows/ci.yml`（`on:` と冒頭のコメント）、`docs/design/ci-config.md`（冒頭の追記注記、D-1 の行、図の起動の記述、注意点 4）、`docs/development.md`（「CI が走る時と、Release の前」と末尾から 2 つ目の段落「公開（Issue #183）後は…」）

**Interfaces:**
- Consumes: なし
- Produces: `ci.yml` が `push: branches: [main]`・`pull_request: branches: [main]`・`workflow_dispatch` で走る（Task 6 の merge で `main` の CI が走ることに依存する）。

- [ ] **Step 1: 現状の確認（RED に相当）。** `grep -n "push" .github/workflows/ci.yml` が、トリガとしての `push:` を含まないことを確かめる。
- [ ] **Step 2: `ci.yml` を直す。** `on:` に `push: branches: [main]` を足す。冒頭の「`main` への push では走らせない（Issue #213）…」のコメントを、「公開リポジトリは Actions に利用上限が無いので、`main` への push でも走らせる（Issue #252 により 2026-11-04 訂正。訂正前は pull_request と手動のみ。旧 #213 は利用上限のため push を外した）」という趣旨に改める。他の行は変えない。
- [ ] **Step 3: `ci-config.md` を直す。** D-1 の行と図の起動の記述を `push: main` / `pull_request: main` / `workflow_dispatch` に戻し、来歴を二層で書く（冒頭の追記注記に「Issue #252 により 2026-11-04」の全体像、各箇所に個別の来歴）。注意点 4 の「ブランチ保護は使えない」の追記に、公開後は使えるようになり main の保護を入れた旨を足す（実際に入れるのは Task 5。文言は「入れた」ではなく「Issue #252 で入れる。内容は force push と削除の禁止、PR 必須」とし、Task 5 の後に過去形に直す）。
- [ ] **Step 4: `development.md` を直す。** 「CI が走る時と、Release の前」を、`main` 向けの PR・`main` への push・手動実行で走る、と改める。「公開（Issue #183）後は…」の段落を、公開に伴いトリガを戻した（Issue #252）という事実に置き換える。旧番号の参照が残らないことを `grep -n "#183" docs/development.md` で確かめる。
- [ ] **Step 5: 機械判定。**
  `python -c "import yaml; d=yaml.safe_load(open('.github/workflows/ci.yml',encoding='utf-8')); t=d.get(True, d.get('on')); print(sorted(t.keys()))"` → `['pull_request', 'push', 'workflow_dispatch']`（YAML 1.1 では `on` が True に読まれる）。
  `./.github/scripts/ci-local.sh --list`（7 ジョブ）と `./.github/scripts/ci-local.test.sh`（PASS）。`grep -rn "main\` への push では" docs/development.md docs/design/ci-config.md .github/workflows/ci.yml` が、訂正前の記述を現在形で残していないこと。
  `./.github/scripts/protected-values-guard.sh`（終了コード 0）。
- [ ] **Step 6: `CLAUDE.md` の確認。** `grep -n "push\|#183" CLAUDE.md` で、CI のトリガや #183 を現在形で述べた箇所が無いことを確かめる。あれば直す。無ければ、ledger に `Ruling: CLAUDE.md は変更なし（該当記述なし）` と書く。
- [ ] **Step 7: Commit。** メッセージ「ci: 公開に合わせて main への push でも CI を走らせる（Issue #252）」。

### Task 3: CHANGELOG の注記と v0.2.0 の内容（C-8）

**Files:**
- Modify: `CHANGELOG.md`（冒頭の説明の後に v0.1.x の注記、`## 未リリース` の下に v0.2.0 の内容）

**Interfaces:**
- Consumes: Task 1・2 の変更（CHANGELOG に書く内容）
- Produces: `## 未リリース` の下の記述。Task 7 が見出しを `## v0.2.0 - <日付>` に改め、`changelog-section.sh v0.2.0` が取り出す。

- [ ] **Step 1: 現状の確認。** `./.github/scripts/changelog-section.sh v0.2.0 CHANGELOG.md` が失敗する（節が無い）ことを確かめる。
- [ ] **Step 2: 書く。** 冒頭の説明に 1 項目足す: v0.1.0〜v0.1.5 は公開前の非公開リポジトリの版で、Release は公開していない。公開の最初の版は v0.2.0 である。`## 未リリース` の下に `### 変更` を作り、次の趣旨を書く: リポジトリを公開した。公開に伴い版を v0.2.0 に改めた。アプリ・Terraform・API の挙動の変更はない。公開のリポジトリで CI が `main` への push でも走るようになった。Issue テンプレートを足した。`### 更新時にやること` は書かない（v0.1.5 からは通常の更新手順で足りる）。旧リポジトリの番号は「旧 #N」と書く。
- [ ] **Step 3: 機械判定。** `./.github/scripts/release.test.sh`（PASS）、`./.github/scripts/protected-values-guard.sh`（終了コード 0）。節は `## 未リリース` のままなので、`changelog-section.sh v0.2.0` はまだ失敗してよい（Task 7 で通る）。
- [ ] **Step 4: Commit。** メッセージ「docs: 変更履歴に公開の注記と v0.2.0 の内容を書く（Issue #252）」。

### Task 4: 公開前の最終確認（読み取りのみ）

**Files:** なし（確認だけ）

**Interfaces:**
- Consumes: Task 1〜3 のコミット
- Produces: 公開してよいという根拠。ledger に確認結果を書き、依頼者へ報告する。

- [ ] **Step 1: 木・履歴・メッセージ。** `./.github/scripts/protected-values-guard.sh all`（終了コード 0）。`gitleaks git . --no-banner --redact --exit-code 1`（終了コード 0）。作業ブランチの全コミットの作者・コミッタが noreply であること（`git log --format='%ae %ce' main..HEAD | sort -u` が noreply のみ）。
- [ ] **Step 2: GitHub 側の現状。** 読み取りのみ: `gh run list --repo kazuki-kudo/rolust` が 0 件、`gh api repos/kazuki-kudo/rolust/git/refs/tags` が空、`gh release list --repo kazuki-kudo/rolust` が空、`gh issue list --repo kazuki-kudo/rolust --state all` が #252 だけ、`gh pr list --state all` が 0 件。
- [ ] **Step 3: 公開される文章の保護値検査。** #252 の本文とコメントを取得して `protected-values-guard.sh text` にかける（終了コード 0）。
- [ ] **Step 4: ci-local の全体。** `./.github/scripts/ci-local.sh`（二重に起動しない。起動前に実行中のプロセスを確かめる）。要約の `失敗 0` と `SKIP` の理由を報告する。
- [ ] **Step 5: 依頼者へ報告し、「公開してよい」の明示を待つ。** 公開は取り消しにくい（fork・キャッシュ・検索に残りうる）ことを添える。承認が出るまで Task 5 へ進まない。

### Task 5: 公開に切り替え、直ちに窓口と保護を入れる（C-3・C-6）

**Files:** なし（GitHub の設定）

**Interfaces:**
- Consumes: Task 4 の確認と、依頼者の「公開してよい」。
- Produces: 公開リポジトリ、有効な private vulnerability reporting、main の保護（Task 6 の merge が従う）。

- [ ] **Step 1: 公開に切り替える。** `gh repo edit kazuki-kudo/rolust --visibility public --accept-visibility-change-consequences`。直後に `gh api repos/kazuki-kudo/rolust --jq .visibility` が `public`。
- [ ] **Step 2: private vulnerability reporting を有効にする（最初の操作）。** `gh api -X PUT repos/kazuki-kudo/rolust/private-vulnerability-reporting`。確認: `gh api repos/kazuki-kudo/rolust/private-vulnerability-reporting --jq .enabled` が `true`。
- [ ] **Step 3: main を保護する。** `gh api -X POST repos/kazuki-kudo/rolust/rulesets` に JSON（`@file` で渡す。`target: branch`、`enforcement: active`、`conditions.ref_name.include: ["~DEFAULT_BRANCH"]`、`rules`: `deletion`、`non_fast_forward`、`pull_request`（`required_approving_review_count: 0`）。`bypass_actors` は空）。確認: `gh api repos/kazuki-kudo/rolust/rulesets --jq '.[].name'` と、`gh api repos/kazuki-kudo/rolust/rules/branches/main` が 3 つの規則を返す。
- [ ] **Step 4: その他の設定。** `gh repo edit kazuki-kudo/rolust --description "<1 文>" --add-topic aws --add-topic iam --add-topic terraform`（description は README の冒頭の趣旨を英語 1 文。保護値を含めない）。fork からの PR のワークフローは、初めての貢献者に承認を求める（既定）ことを `gh api repos/kazuki-kudo/rolust/actions/permissions/fork-pr-contributor-approval` で確かめ、既定と違えば `first_time_contributors` に設定する。
- [ ] **Step 5: 公開後の状態。** `gh run list --repo kazuki-kudo/rolust` が 0 件のままであること（切り替えで実行が生じていない）。未認証の `curl -sI https://github.com/kazuki-kudo/rolust` が 200。結果を ledger に書く。

### Task 6: 作業ブランチを取り込む（C-1・C-2）

**Files:** なし（PR の作成と merge）

**Interfaces:**
- Consumes: Task 1〜3 のコミット、Task 5 の保護（PR 必須）。
- Produces: `main` に Task 1〜3 と spec・plan が入る。`push: main` の CI が走る。

- [ ] **Step 1: push して PR を出す。** `git push -u origin chore/252-publish`。PR 本文は一時ファイルに書き、`protected-values-guard.sh text` を通し、末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。`gh pr create --base main --head chore/252-publish --title … --body-file …`。
- [ ] **Step 2: CI を確かめる。** `gh run list --branch chore/252-publish` と `gh run view <id> --json jobs` で 7 ジョブの結果を読む（`gh pr checks` は 403 になりうる）。赤なら原因を直して push する。
- [ ] **Step 3: ログに保護値が無いことを確かめる。** CI の各ジョブのログを `gh run view <id> --log` で取得し、`protected-values-guard.sh text` にかける（出力は貼らない）。
- [ ] **Step 4: 依頼者の承認を得て merge する。** `gh pr merge <N> --merge`。保護が自分の merge を妨げないこと（承認 0 件で通る）を実測する。
- [ ] **Step 5: `main` の CI。** merge の push で CI が走ることを `gh run list --branch main` で確かめ、7 ジョブの結果を読む。ローカルの `main` を `git switch main && git pull --ff-only` で追従させる。

### Task 7: 版の見出しを改める PR

**Files:**
- Modify: `CHANGELOG.md`（`## 未リリース` → `## v0.2.0 - <実行日>`、その上に空の `## 未リリース`）、`docs/design/ci-config.md` 注意点 4（Task 5 の後の過去形への直し）

**Interfaces:**
- Consumes: Task 3 の記述、Task 6 の `main`。
- Produces: `changelog-section.sh v0.2.0` が取り出せる `main`（Task 8 のタグの前提）。

- [ ] **Step 1: ブランチを切る。** `git switch -c chore/252-release-v0.2.0`（`main` の最新から）。
- [ ] **Step 2: 失敗の確認。** `./.github/scripts/changelog-section.sh v0.2.0 CHANGELOG.md` が失敗する。
- [ ] **Step 3: 直す。** 見出しを改め、上に空の `## 未リリース` を残す。`ci-config.md` 注意点 4 を過去形に直す（「Issue #252 で main の保護を入れた」）。
- [ ] **Step 4: 機械判定。** `changelog-section.sh v0.2.0 CHANGELOG.md` が節を出力し空でない。`./.github/scripts/release.test.sh`（PASS）。`protected-values-guard.sh`（0）。
- [ ] **Step 5: コミット・push・PR・CI・merge（Task 6 と同じ手順、merge は承認を得る）。** メッセージ「docs: 変更履歴の見出しを v0.2.0 に改める（Issue #252）」。merge 後に `git switch main && git pull --ff-only`。

### Task 8: タグ v0.2.0 と Release

**Files:** なし（タグと Release）

**Interfaces:**
- Consumes: Task 7 の `main`、`main` の最新の CI が緑であること。
- Produces: GitHub の Release `v0.2.0`（`rolust-v0.2.0.tar.gz`・`SHA256SUMS`）。

- [ ] **Step 1: タグを打つ前の検査。** `git rev-parse HEAD` が `origin/main` と一致。`gh run list --branch main --limit 1` が success。`./.github/scripts/ci-local.sh`（`失敗 0`。`SKIP` があれば理由を報告）。
- [ ] **Step 2: 依頼者の承認を得て、注釈付きタグを打つ。** `git tag -a v0.2.0 -m "v0.2.0"` → `git push origin v0.2.0`。
- [ ] **Step 3: `release.yml` の結果。** `gh run list --workflow release.yml` と `gh run view <id> --json jobs` で success を読む。失敗なら原因を調べる（Release を作り直す前に、依頼者へ選択肢を示す。公開後のタグの付け替えは外から改ざんに見える）。
- [ ] **Step 4: Release の中身。** `gh release view v0.2.0 --json body,assets --jq …` で、本文の先頭が `CHANGELOG.md` の v0.2.0 の節であること、添付が `rolust-v0.2.0.tar.gz` と `SHA256SUMS` の 2 つであることを確かめる。本文を一時ファイルに取り `protected-values-guard.sh text` にかける（0）。

### Task 9: 認証なしの取得の実測（旧 #92 D-9）と正本への反映

**Files:**
- Modify: `docs/design/requirements.md`（NFR-4・SM-2 に実測結果を追記）

**Interfaces:**
- Consumes: Task 8 の Release。
- Produces: 実測の記録（NFR-4・SM-2）。

- [ ] **Step 1: 認証なしで取得する。** 資格情報を持たない状態で（`env -u GH_TOKEN -u GITHUB_TOKEN`、`gh` を使わず `curl` だけ）、新しい空のディレクトリに取得する: `curl -fsSL -O https://github.com/kazuki-kudo/rolust/releases/download/v0.2.0/rolust-v0.2.0.tar.gz` と `…/SHA256SUMS`。HTTP の最終ステータス（`-w '%{http_code}'`）を記録する。
- [ ] **Step 2: 照合する。** `sha256sum -c --ignore-missing SHA256SUMS` が `rolust-v0.2.0.tar.gz: OK`。tarball を別の空のディレクトリに展開（Windows では PowerShell の `tar` ではなく、`tar -xzf … --force-local` など）し、`docs/guide/setup.md` が参照するファイル（`infra/`、`docs/guide/`、`LICENSE`、`CHANGELOG.md`、`THIRD-PARTY-NOTICES.txt`）が入っていることを確かめる。
- [ ] **Step 3: ブラウザでの取得。** Release のページ（`https://github.com/kazuki-kudo/rolust/releases/tag/v0.2.0`）を、サインインしていないブラウザの文脈（ヘッドレス Playwright の新しいコンテキスト）で開き、2 つのダウンロードのリンクが見えて、それぞれのリンクが 200 を返す（`curl -sIL`）ことを確かめる。
- [ ] **Step 4: 正本に反映する。** `requirements.md` の NFR-4 の行の近くと SM-2 の記述に、「Issue #252 により 2026-11-04 追記: v0.2.0 の Release で、認証なしの `curl` とブラウザで tarball と `SHA256SUMS` を取得でき、チェックサムが一致した。第三者の経路での実機デプロイは別の Issue（Task 10 で起票）」を、実測の事実だけで書く（保護値を含めない）。
- [ ] **Step 5: PR で取り込む。** ブランチ `chore/252-measured`、PR、CI、承認を得て merge（Task 6 と同じ手順）。メッセージ「docs: 認証なしの取得の実測結果を要件に追記する（Issue #252）」。

### Task 10: 片付け（段階 D）

**Files:** なし（GitHub と AWS の読み取り）

**Interfaces:**
- Consumes: Task 9 の結果。
- Produces: 実機デプロイの Issue、アーカイブされた旧リポジトリ、閉じた旧 #11、更新した #252。

- [ ] **Step 1: 実機デプロイの Issue を起票する（承認を得る）。** タイトル「第三者の経路で実機デプロイを通す（README → Release の tarball → 別アカウント）」。本文に、経路 A を別アカウント（実測用の `dev2-admin`・`dev3-admin`。アカウント ID は書かない）で通す手順の観点、destroy に 30 分以上かかりうること、出典として #252 と旧 #92 の D-9 を書く。本文を `text` で検査してから `gh issue create`。番号を ledger に書く。
- [ ] **Step 2: #252 の「やること」を更新する（承認を得る）。** D-3 により、README の実機デプロイの項目を新 Issue へ移したことを反映した本文に、`gh issue edit` で直す（検査後）。
- [ ] **Step 3: CI ロールの信頼を確かめる。** 依頼者が `aws sso login --profile jump-admin` を済ませたら、`aws iam get-role --role-name rolust-ci-plan` が `NoSuchEntity` であることを確かめる（旧 #181 で削除済みの見込み）。残っていれば、旧リポジトリ向けの信頼を外す案を示して承認を得る。AWS の資格情報が無ければ、この確認だけを後に回す旨を報告する（アーカイブは先に進めてよい）。
- [ ] **Step 4: 旧 #11 を閉じる（承認を得る）。** アーカイブの前に旧 #11 へ結果をコメント（新リポジトリの Release の URL、実機デプロイの新 Issue の番号。`text` で検査）して `completed` で close する。アーカイブ済みのリポジトリには書き込めないので、この手順はアーカイブ（Step 5）の前に行う。
- [ ] **Step 5: 旧リポジトリをアーカイブする（承認を得る）。** `gh repo archive kazuki-kudo/rolust-legacy --yes`。確認: `gh api repos/kazuki-kudo/rolust-legacy --jq '"archived=\(.archived) private=\(.private)"'` が `archived=true private=true`。旧リポジトリの Release を非公開のまま残す（C-7）ことは何もしない。
- [ ] **Step 6: 完了の確認と報告。** 成功基準 1〜8（spec §8）を、1 つずつ実測の根拠とともに報告する。`rolust-oss` を `main` に戻し、作業ブランチを `git branch -d` で削除する（merge 済みで安全に消せること）。

---

## Self-Review（spec との照合）

- 成功基準 1（公開・脆弱性の窓口・保護）は Task 5、2（Actions 0 件で切り替え）は Task 4・5、3（最初の PR の CI と merge）は Task 6、4（Release）は Task 8、5（認証なしの取得）は Task 9、6（アーカイブ）と 7（Issue と旧 #11）は Task 10、8（保護値）は Task 4・6・8 の検査。
- 私の判断: C-1 は Task 4〜6 の順序、C-2 は Task 2、C-3・C-6 は Task 5、C-4 は変更なし（置かない）、C-5 は Task 1、C-7 は Task 10 Step 4、C-8 は Task 3・7、C-9 は Task 10 Step 5。
- 正本への反映（spec §7）: requirements.md NFR-4・SM-2 は Task 9、ci-config.md D-1 は Task 2。`CLAUDE.md` は Task 2 Step 6 で確認し、該当記述が無ければ変更しない。
- 順序の訂正: Task 10 の旧 #11 のコメント・close は、アーカイブ（書き込めなくなる）の**前**に行う。spec §4 の段階 D（10 → 11）の順序を、この計画で入れ替える（spec の誤りの訂正。ledger に Ruling として書く）。
