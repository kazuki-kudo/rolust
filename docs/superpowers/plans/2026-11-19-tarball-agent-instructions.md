# tarball 利用者向けエージェント指示書 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release の tarball の直下に `AGENTS.md`（実体）と `CLAUDE.md`（`@AGENTS.md` の 1 行）を同梱し、同梱を 3 本のスクリプトで担保する（Issue #262）。

**Architecture:** 正本 `docs/tarball-agent-instructions.md` を `build-release.sh` が tarball の直下へ `AGENTS.md` として複写し、`CLAUDE.md` を取り込みの 1 行で書き出す。`check-release.sh` が同一性と形を検査し、`release.test.sh` が正常系と、1 箇所ずつ壊す異常系を持つ。

**Tech Stack:** bash（`build-release.sh`・`check-release.sh`・`release.test.sh`）、Markdown

**Spec:** `docs/superpowers/specs/2026-11-19-tarball-agent-instructions-design.md`

## Global Constraints

- 指示書は日本語 1 本。英語版は作らない。
- 正本は `docs/tarball-agent-instructions.md`。tarball に入れる名前は `AGENTS.md` と `CLAUDE.md`（直下）。正本そのものは tarball に入れない。
- `CLAUDE.md` の内容は `@AGENTS.md` と LF の 1 行だけ。symlink は使わない。
- 保護値（アカウント ID・CloudFront の DNS 名・IP・会社ドメイン・作者メール）を、どのファイルにも書かない。
- 指示書は手順書の内容を複製せず、`docs/guide/` の文書を指す。
- 利用者向けの変更なので、`CHANGELOG.md` の `## 未リリース` に追記する（`### 更新時にやること` は無し）。
- コミットメッセージは日本語で、Issue #262 を含め、末尾に `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` を付ける。push は依頼者に確かめてから行う。

## Review Focus

- 正本に CRLF が混ざる → tarball の `AGENTS.md` に CR が入る。`check-release.sh` が落とす（Task 2 の `agentscrlf`）。
- 開発者向けの `CLAUDE.md`（リポジトリ直下のもの）が tarball に混ざる → `CLAUDE.md` が `@AGENTS.md` と一致しないので落ちる（`claudediff`）。
- 正本が未追跡・欠落のまま Release を作る → `build-release.sh` が終了コード 1 で止まる（Task 2）。
- 指示書が指す手順書のパスが、手順書の改名で切れる → 機械の検査は持たない（スペック外）。Task 1 で実在を確かめ、手順書を改名する PR では grep で拾う。
- Claude Code が `@AGENTS.md` を解決しない → Task 4 の実測で確かめる。解決しなければ同内容の 2 本に切り替える（Task 4 Step 4）。
- 英語の利用者が、英訳の無い手順書（`operations.md` など）に当たる → 指示書に「英語版があるのは `setup.md`・`access-control.md`・`cross-account.md` の 3 本だけ。ほかは日本語の版を読み、利用者の言語で説明する」と書く（Task 1）。

---

### Task 1: 指示書の正本を書く

文書の作成なので TDD の例外。機械判定で検証する。

**Files:**
- Create: `docs/tarball-agent-instructions.md`

**Interfaces:**
- Produces: tarball の `AGENTS.md` の中身そのもの。Task 2 が複写し、`check-release.sh` が同一性を検査する。

- [ ] **Step 1: 正本を書く**

  先頭の見出しは `# Rolust — Release の tarball の利用者向け指示`。章はスペックの「指示書の章立て」の 1〜7 をそのまま 7 つの `##` にする（章の名前もスペックの太字の名前）。次を守る:
  - 手順書は `docs/guide/setup.md` のようにパスで指し、手順を書き写さない。
  - 質問の一覧（3 章）は、値ごとに使う手順書の節を添える。「全体に関わるもの（目的・認証方式・ターゲットアカウントの有無）は最初に、そのほかは必要になる直前に」と書く。独自ドメインは質問に入れない。
  - 英語版の記述（上の Review Focus の 6 つ目）を 2 章に入れる。
  - 4 章の承認を取る操作に、`terraform apply`（`infra/bootstrap/` を含む）・SSM への書き込み・IAM / CloudFormation への書き込み・ファイルの削除を挙げ、`terraform destroy` と `state rm` は利用者が明示したときだけと書く。
  - 5 章に、Basic 認証のパスワードをエージェントが生成・受領しないこと、アカウント ID・バケット名を応答の文面に書き写さずコミットしないこと、`tfplan`・`tfplan.json` を apply の後に消すこと、`terraform.tfvars`・`backend.hcl` の控えを展開先の外に取ることを書く。
  - 実在するアカウント ID・バケット名・メールアドレス・IP は書かない。

- [ ] **Step 2: 指している手順書が実在することを確かめる**

  Run: `for p in $(grep -o 'docs/guide/[A-Za-z0-9/._-]*\.md' docs/tarball-agent-instructions.md | sort -u); do test -f "$p" && echo "OK $p" || echo "NG $p"; done`
  Expected: `NG` が 1 行も出ない。

- [ ] **Step 3: 章の数・CR・保護値を確かめる**

  Run: `grep -c '^## ' docs/tarball-agent-instructions.md; grep -c $'\r' docs/tarball-agent-instructions.md; ./.github/scripts/protected-values-guard.sh text docs/tarball-agent-instructions.md`
  Expected: `7`、`0`、保護値の検査が「問題なし」で終了コード 0。

- [ ] **Step 4: Commit**

  ```bash
  git add docs/tarball-agent-instructions.md
  git commit -m "docs: tarball 利用者向けのエージェント指示書の正本を足す（Issue #262）"
  ```

---

### Task 2: 同梱と検査（build-release.sh・check-release.sh・release.test.sh）

アプリコードではないが、回帰テストを持つスクリプトなので、テストを先に書いて落ちることを確かめる。

**Files:**
- Modify: `.github/scripts/release.test.sh`（`make_repo` と、正常系・拒否系のケース）
- Modify: `.github/scripts/build-release.sh`
- Modify: `.github/scripts/check-release.sh`（冒頭の検査の一覧のコメントを含む）

**Interfaces:**
- Consumes: Task 1 の `docs/tarball-agent-instructions.md`（追跡されていること）。
- Produces: tarball の直下の `AGENTS.md`（正本と同一）と `CLAUDE.md`（内容は `@AGENTS.md\n`）。

- [ ] **Step 1: 失敗するテストを書く（`release.test.sh`）**

  `make_repo` の `git add -A` の前に `printf '# agent instructions\n' > docs/tarball-agent-instructions.md` を足す。正常系（`dist が tarball に入っている` の近く）に次を足す。`$T` は `$OUT/rolust-v1.2.3.tar.gz`:
  - `AGENTS.md が tarball の直下に入っている`（0）: `tar -tzf $T | grep -q 'rolust-v1.2.3/AGENTS.md$'`
  - `AGENTS.md が正本と同一である`（0）: `tar -xzOf $T rolust-v1.2.3/AGENTS.md | cmp -s - "$REPO/docs/tarball-agent-instructions.md"`
  - `CLAUDE.md が @AGENTS.md の 1 行である`（0）: `[ "$(tar -xzOf $T rolust-v1.2.3/CLAUDE.md)" = "@AGENTS.md" ]`
  - `指示書の正本（docs/tarball-agent-instructions.md）は tarball に入らない`（1）: `tar -tzf $T | grep -q 'docs/tarball-agent-instructions.md'`

  `build-release.sh の拒否` の節に足す: `正本が追跡されていなければ作らない`（1）。`make_repo "$TMP/repo-noagent"` の後、`git -C "$TMP/repo-noagent" rm -q --cached docs/tarball-agent-instructions.md` し、`env ROLUST_REPO_ROOT="$TMP/repo-noagent" "$BUILD" v1.2.6 "$TMP/out-noagent"` を実行する。

  `check-release.sh の拒否` の節の、CRLF のケース（`repack crlf`。`$REPO` を書き換えるので最後に置く）より前に、すべて 1 で落ちるケースを足す:
  - `AGENTS.md が無ければ落ちる`: `repack noagents 'rm AGENTS.md'`
  - `CLAUDE.md が無ければ落ちる`: `repack noclaude 'rm CLAUDE.md'`
  - `AGENTS.md が正本と違えば落ちる`: `repack agentsdiff 'echo x >> AGENTS.md'`
  - `CLAUDE.md が @AGENTS.md の 1 行でなければ落ちる`: `repack claudediff "printf '# dev\n' > CLAUDE.md"`
  - `CLAUDE.md に CR があれば落ちる`: `repack claudecrlf "printf '@AGENTS.md\r\n' > CLAUDE.md"`
  - `AGENTS.md に CR があれば落ちる`: `repack agentscrlf "printf '# x\r\n' > AGENTS.md; printf '# x\r\n' > '$REPO/docs/tarball-agent-instructions.md'"`（正本も同じ内容にして、同一性ではなく CR で落ちることを確かめる）
  - `正本（docs/tarball-agent-instructions.md）が混ざっていれば落ちる`: `repack agentssrc 'mkdir -p docs && echo x > docs/tarball-agent-instructions.md'`

  `agentscrlf` は `$REPO` の正本を書き換えるので、`crlf` のケースと同じく最後の位置に置き、その後のケースが正本の内容に依存しないことを確かめる。

- [ ] **Step 2: 落ちることを確かめる**

  Run: `./.github/scripts/release.test.sh 2>&1 | tail -30`
  Expected: 新しいケースのうち、`AGENTS.md` / `CLAUDE.md` の同梱を見るものが FAIL。「パス / 失敗」の失敗が 0 でない。

- [ ] **Step 3: `build-release.sh` を実装する**

  `git ls-files … | tar` の直後、`for d in "${DISTS[@]}"` の前に足す: 正本のパスを変数 `AGENT_SRC=docs/tarball-agent-instructions.md` に置き、`git ls-files --error-unmatch -- "$AGENT_SRC"` が失敗したら、標準エラーに「追跡された指示書の正本が無い: $AGENT_SRC」を出して `exit 1`。成功したら、`cp "$AGENT_SRC" "$STAGE/$NAME/AGENTS.md"` と、`printf '@AGENTS.md\n' > "$STAGE/$NAME/CLAUDE.md"`。ヘッダのコメントの終了コードの説明（`1 成果物が無い`）はそのままで足りる。コメントに、2 本の由来（Issue #262）を 2 行で書く。

- [ ] **Step 4: `check-release.sh` を実装する**

  - 検査 1: `REQUIRED` に `AGENTS.md` と `CLAUDE.md` を足す。
  - 検査 2: `find` の対象に、含まれてはならないものとして `-name 'tarball-agent-instructions.md'` を足す。
  - 検査 3: `AGENTS.md` が `$ROOT/docs/tarball-agent-instructions.md` と `cmp` で同一であること（両方があるとき）。`CLAUDE.md` の内容が `@AGENTS.md` の 1 行であること（`[[ "$(cat "$DIR/CLAUDE.md")" == "@AGENTS.md" ]]`）。
  - 検査 4: CR の検査の対象に `AGENTS.md`・`CLAUDE.md` を足す。
  - 冒頭の検査の一覧のコメントを、上の 4 点に合わせて直す（Issue #262）。

- [ ] **Step 5: 通ることを確かめる**

  Run: `./.github/scripts/release.test.sh 2>&1 | tail -12`
  Expected: 末尾が `パス N / 失敗 0`、終了コード 0。FAIL の行が無い。

- [ ] **Step 6: Commit**

  ```bash
  git add .github/scripts/release.test.sh .github/scripts/build-release.sh .github/scripts/check-release.sh
  git commit -m "feat: tarball の直下に AGENTS.md と CLAUDE.md を同梱し、検査する（Issue #262）"
  ```

---

### Task 3: 正本と文書の更新

文書の変更なので TDD の例外。grep と `guide-parity.sh` で確かめる。

**Files:**
- Modify: `docs/design/cd-config.md`、`docs/development.md`、`docs/guide/setup.md`、`docs/guide/en/setup.md`、`CHANGELOG.md`、`CLAUDE.md`（リポジトリ直下）

- [ ] **Step 1: `cd-config.md` に追記注記を足す**

  冒頭の追記注記の列（先頭は Issue #240 のもの）の先頭に、`> **追記注記**（Issue #262 により 2026-11-19 追記）: …` を足す。書くこと: tarball の直下に `AGENTS.md`（正本は `docs/tarball-agent-instructions.md`）と `CLAUDE.md`（`@AGENTS.md` の 1 行）を入れること、`build-release.sh` が複写・生成すること、`check-release.sh` の追加の検査（同一性・取り込みの 1 行・CR・正本が入らないこと）。

- [ ] **Step 2: tarball の内容を列挙した同種の記述を総当たりする**

  Run: `grep -rn "SECURITY.md\|THIRD-PARTY-NOTICES\|CHANGELOG.md" docs/design CLAUDE.md docs/development.md CONTRIBUTING.md | cut -c1-160`
  Expected: tarball の内容を列挙している箇所の一覧。列挙に `AGENTS.md`・`CLAUDE.md` を足すべき箇所には、同じ来歴（`Issue #262 により 2026-11-19 追記`）で足す。足さない箇所は、理由を 1 行でコミットメッセージに書く。

- [ ] **Step 3: `docs/development.md`・リポジトリ直下の `CLAUDE.md` を直す**

  - `docs/development.md` のディレクトリの表（`docs/guide` の行の近く）に、`docs/tarball-agent-instructions.md` の行を足す: 利用者向けのエージェント指示書の正本で、`build-release.sh` が tarball の直下に `AGENTS.md`・`CLAUDE.md` として入れる。
  - 直下の `CLAUDE.md` の「構成」に、同じ内容を 1 行で足す。`release.yml` の説明の tarball の内容の列挙があれば合わせる。

- [ ] **Step 4: 手順書に一段落足す（日本語・英語を同じ変更で）**

  `docs/guide/setup.md` の経路 A の手順 3 のコードブロックの後、`### B. ソースから（開発者）` の前に、1 段落を足す: AI コーディングエージェント（Claude Code など）を使うなら展開先で起動する。直下の `AGENTS.md`（Claude Code は `CLAUDE.md` 経由）を読み、決めきれない値を質問しながらこの手順を進める。`terraform apply` などは実行前に承認を求める。`docs/guide/en/setup.md` の同じ位置に、同じ内容の英訳を足す。見出しは増やさない。

  Run: `./.github/scripts/guide-parity.sh`
  Expected: 終了コード 0。

- [ ] **Step 7: `CHANGELOG.md` に追記する**

  `## 未リリース` の下に `### 変更` を作り、1 件書く: tarball の直下に、AI コーディングエージェント向けの指示書（`AGENTS.md`・`CLAUDE.md`）を同梱した。展開先でエージェントを起動すると、決めきれない値を質問しながら手順書を進める。`### 更新時にやること` は書かない。

- [ ] **Step 8: 保護値と lint の確認**

  Run: `./.github/scripts/protected-values-guard.sh`
  Expected: 終了コード 0（gitleaks 8.30.1 が要る。無ければ `CLAUDE.md` の手順で取得する）。

- [ ] **Step 9: Commit**

  ```bash
  git add docs/design/cd-config.md docs/development.md docs/guide/setup.md docs/guide/en/setup.md CHANGELOG.md CLAUDE.md
  git commit -m "docs: エージェント指示書の同梱を設計文書・手順書・変更履歴に反映する（Issue #262）"
  ```

---

### Task 4: 実測と push の前の検査

**Files:** なし（実測の結果は PR の本文に、件数と種類だけで書く）。

- [ ] **Step 1: ローカル CI を走らせる**

  Run: `./.github/scripts/ci-local.sh`
  Expected: 全ジョブが PASS（`SKIP` は理由を確かめる）。赤があれば直してから進む。二重に起動しない。

- [ ] **Step 2: tarball を作って展開する**

  `packages/*/dist` が無ければ `npm run build` を先に実行する。スクラッチ領域に空のディレクトリを作り、`./.github/scripts/build-release.sh v0.0.0-rc.1 <スクラッチ>/out` → `./.github/scripts/check-release.sh <スクラッチ>/out/rolust-v0.0.0-rc.1.tar.gz` → 別の空のディレクトリに `tar --force-local -xzf` で展開する。
  Expected: 3 つとも終了コード 0。展開先の直下に `AGENTS.md`・`CLAUDE.md` がある。

- [ ] **Step 3: エージェントで実測する（Claude Code）**

  展開先のルートで、`AWS_*` の環境変数を外し、読み取りだけを許可して実行する: `claude -p "セットアップを始めて" --allowedTools "Read,Glob,Grep"`。次に `claude -p "いま読み込んでいる指示書の、質問すること（3 章）の一覧を、そのまま列挙して" --allowedTools "Read,Glob,Grep"`。
  Expected: 1 つ目は、最初の応答が質問（目的など）で、実行系のコマンドを走らせない。2 つ目は、指示書の質問の一覧が出る（`CLAUDE.md` の取り込みが効いている証拠）。出力のアカウント ID などは記録しない。

- [ ] **Step 4: 取り込みが効かなかったときの切り替え（Step 3 の 2 つ目が失敗したときだけ）**

  同梱を「同内容の 2 本」に切り替える。`build-release.sh` は `cp "$AGENT_SRC"` を `AGENTS.md` と `CLAUDE.md` の両方に行い、`check-release.sh` と `release.test.sh` の `CLAUDE.md` の検査を「`AGENTS.md` と同一」に直す。スペックと `cd-config.md` の追記注記、手順書の段落の「`CLAUDE.md` 経由」の記述も合わせ、Step 1 からやり直す。依頼者には切り替えを報告する。

- [ ] **Step 5: 依頼者に push と PR を確かめる**

  実測の結果（件数と種類だけ）を示し、push してよいか尋ねる。承認後、`git push -u origin docs/262-tarball-agent-instructions` し、PR の本文を `./.github/scripts/protected-values-guard.sh text` にかけてから、`gh pr create` する（本文の末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)`。Issue #262 を含める）。
