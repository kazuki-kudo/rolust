# 実値の混入を防ぐ規約と機械的な検査（Issue #177）

日付: 2026-10-18 / 関連: #11（OSS 公開の準備）・#176（実値の除去。本 Issue の前提。完了）・#182（新リポジトリへの移行。本 Issue から引き継ぐ項目がある）

> **追記（Issue #177 により 2026-10-18。実装中の訂正）**: 本文の次の記述は、実装中に次のとおり変わった。本文は書き換えない。
>
> - §3.2「出力は `--redact`」: `--redact` と `--verbose` の組み合わせでは、同じ行に実値が 2 つあると、片方が検出ごとの出力に平文で出た。検出の報告を gitleaks のテンプレートでルール・ファイル・行・コミットだけに絞り、行の内容を出さない。
> - §3.2 の `tree`/`history`: **ファイル名（パス）も同じルールで検査する**（gitleaks の内容ルールはパスを見ないため、一覧を標準入力で渡す）。パス名に値があるときは、以後の報告からファイル名も伏せる。`tree` は、書き出した件数が追跡ファイルの一覧と合わなければ 2 で止める（`MSYS_NO_PATHCONV=1` の下で空のディレクトリを走査して通る穴を塞ぐ）。
> - §3.3 `commit-msg` フック: `#` で始まる行を除かない（`git commit -m`・`-F` の本文では git が消さない）。切り取り線より後の diff だけを除く。

## 1. 目的と背景

守る対象（AWS アカウント ID、CloudFront の DNS 名、自宅の IP アドレス、会社ドメイン、作者メール。**実値はこの spec にも書かない**）が、コード・文書・コミット・Issue・PR・コメントに入り込むのを、規約と検査で止める。新リポジトリで開発を続けても混入しないようにするため。

#11 の調査で、露出の主因はコードの既定値より、**実測の記録を散文で書いた場所**（PR 本文・コメント・plan・コミットメッセージ）だった。既存の gitleaks の走査（`gitleaks git .`、Issue #12）は資格情報の検出で、アカウント ID・IP・ホスト名・メールは対象外である。

### 実測（2026-10-18。gitleaks 8.30.1 をスクラッチ領域に取得して試した）

- **持ち越す木は、ほぼクリーン**。アカウント ID・自宅 IP・会社ドメインは `docs/superpowers/plans/` と `aidlc/` にだけある（どちらも新リポジトリへ持ち越さない）。
- 持ち越す木で、追跡ファイルの実ヒットは **IP のテストデータ 3 ファイル**だけ: `packages/edge-auth/src/ip-allowlist.test.ts`（CIDR の境界値と不正な入力）、`packages/edge-auth/src/index.test.ts`、`docs/superpowers/specs/2026-09-29-ip-allowlist-and-api-key-design.md`。
- ダミーのアカウント ID は多数あり、形は「4 桁の同じ数字を 3 つ並べたもの」（`111122223333`、`555566667777` など）が大半で、ほかに `123456789012` と、全桁 0・全桁 9 などの全桁同一がある。
- メールアドレスは `noreply@anthropic.com`（`Co-Authored-By` 行）が最多で、次に `example.com`。許可に足さないと、すべてのコミットが赤になる。
- `gitleaks dir` は gitignore 済みのファイル（`node_modules`・`dist`・実値入りの `infra/backend.hcl`）まで走査し、`.git/` の中身も読む。追跡ファイルだけを見るには、書き出してから走査する。
- `gitleaks git` は**コミットメッセージを走査しない**（diff の中身だけ）。メッセージは `gitleaks stdin` で別に走査する。
- `gitleaks stdin` は同じ設定ファイルのルールで動き、本文の検査に使える。
- Go の正規表現（RE2）は後方参照を持たない。ダミー ID の形は選択肢で表す。
- `gitleaks dir` では path が絶対パスになる。path の許可は先頭固定（`^…`）ではなく `(?:^|/)…` で書く。
- 行末の `# gitleaks:allow` は効く。範囲指定（`--log-opts "BASE..HEAD"`）も、空の範囲も正しく動く。
- 旧リポジトリの履歴 663 コミットには実値があるため、新ルールを全履歴に当てると赤になる。

### 受け入れの観点

- 実値の形の文字列を含む差分・メッセージ・本文で検査が失敗し、プレースホルダ・ダミーでは通る（回帰テストで機械判定）。
- 旧リポジトリの現在のツリーと `BASE` 以降の履歴で、検査が緑になる。
- `commit-msg` フックが実際にコミットを止める。
- CI の gitleaks ジョブで新しい検査が実行され、緑になる。
- `CLAUDE.md` に規約があり、`gh` で投稿する前の手順がある。

## 2. 決定

| ID | 論点 | 決定 | 根拠 |
|---|---|---|---|
| D-1 | 検査の方式 | 実値の一覧を持たない**プレースホルダの許可リスト**方式。ルールは gitleaks のカスタムルールの TOML 1 本を唯一の定義とする | Issue の設計方針（壁打ち）。一覧自体が漏れるため。TOML とシェルの 2 か所にパターンを持つと食い違うので、本文の検査も `gitleaks stdin` で同じ TOML を使う |
| D-2 | 既存の資格情報の走査 | `gitleaks git . --no-banner --redact --exit-code 1`（全履歴）は変えない。新ルールは別ファイル `.gitleaks-protected.toml` に置き、`--config` で明示する | 旧リポジトリの履歴に実値があるため、既存の走査に新ルールを足すと赤になる。別ファイルなら既定の設定（`useDefault`）にも影響しない |
| D-3 | 旧リポジトリでの範囲 | 依頼者の決定（2026-10-18）: **除外パス + 起点コミット**。`aidlc/` と `docs/superpowers/plans/` を除外し、履歴は #176 の merge（`09e9648`）以降だけを走査する | 持ち越さない領域と履歴は、実値を消せない（履歴は書き換えず、`aidlc/` は凍結）。起点を決めれば、新ルールを今日から効かせられる |
| D-4 | メールの規則 | 依頼者の決定（2026-10-18）: **許可ドメイン以外はすべて検出**。許可は予約ドメイン・`users.noreply.github.com`・`noreply@anthropic.com`・`git@github.com` | 会社ドメインと作者メールを、名指しせずに（一覧を持たずに）止められる。誤検知は許可に足すか行末の `gitleaks:allow` で通す |
| D-5 | 木の走査 | `git checkout-index` で追跡ファイルだけを一時ディレクトリへ書き出し、`gitleaks dir` で走査する | `gitleaks dir` を作業ツリーに直接当てると、gitignore 済みの実値入りファイルと `.git/` を拾う（実測） |
| D-6 | コミットメッセージ | `gitleaks git` は走査しないので、`git log --format=%B BASE..HEAD` を `gitleaks stdin` に渡す。ローカルでは `commit-msg` フックが `text` モードで同じ検査を行う | Issue の確認項目への回答（実測）。コミットメッセージは実際に 1 件の露出があった |
| D-7 | IP のテストデータ | `index.test.ts` と過去の spec は文書用の範囲に書き換える。`ip-allowlist.test.ts` だけは、`ipv4` ルール限定で path を許可する | このテストは CIDR の境界（全ビットが 1 のアドレスなど）と不正な入力を検証していて、文書用の範囲では表せない。ファイル単位・ルール単位に限れば、ほかの検査を弱めない |
| D-8 | ダミー ID の許可 | `aaaabbbbcccc` 形（4 桁の同じ数字 × 3。10 通りの選択肢）と `123456789012` を通す | 実在の ID がこの形になる確率は無視できる。個別の値を列挙すると、増えるたびに設定を触る |
| D-9 | gitleaks が無いとき | **fail closed**（終了コード 2 で止め、導入手順を示す）。版は `GITLEAKS_VERSION`（既定 `8.30.1`、CI の値と同じ）と照合し、違えば 2 | 検査できないのに通すと、ゲートが無いのと同じ。`CLAUDE.md` の原則（ツールが無いなら導入を試みる）に従い、案内を出す |
| D-10 | 作者メール | 本 Issue では強制しない。新リポジトリでの強制は #182 に引き継ぐ。`git config user.email \| protected-values-guard.sh text` で同じルールを使って確かめられる | 旧リポジトリの履歴は持ち越さず、`user.email` は今も会社ドメインである。ここで強制すると旧リポジトリのコミットが止まる。新履歴の作者表記は #182 で決める |
| D-11 | 投稿の機械的な門 | 本 Issue では作らない。`CLAUDE.md` に「`gh` で投稿する前に `text` を実行」の手順を書くまでとする | Issue の範囲（手順を足す）。Claude Code のフックで `gh` の本文を自動検査する案は、別 Issue の候補 |
| D-12 | CI での PR 本文の走査 | しない | `pull_request` の `edited` イベントで CI 全体が再実行される。Issue も本文は CI の対象外としている |

## 3. 設計

### 3.1 ルール `.gitleaks-protected.toml`

| ルール | 検出するもの | 通すもの |
|---|---|---|
| `protected-account-id` | 前後が英数字でない 12 桁の数字 | D-8 のダミー |
| `protected-cloudfront` | `<label>.cloudfront.net` | `dXXXXXXXXXXXXX.cloudfront.net`、`d123.cloudfront.net`（既存のテスト用） |
| `protected-ipv4` | 有効な IPv4 | RFC 5737 の 3 範囲（`192.0.2.0/24`・`198.51.100.0/24`・`203.0.113.0/24`）、ループバック（`127.*`）、`0.0.0.0` |
| `protected-email` | 許可以外のメールアドレス | D-4 の許可 |

- 全体の path 除外: `.git/`、`aidlc/`、`docs/superpowers/plans/`、`package-lock.json`。
- `protected-ipv4` だけの path 許可: `ip-allowlist.test.ts`（D-7）。
- すべての path は `(?:^|/)…` の形で書く（`dir` が絶対パスを渡すため）。
- 12 桁がタイムスタンプなどの場合は、行末の `# gitleaks:allow` で通す（現行ツリーに実例は無い）。

### 3.2 ラッパー `.github/scripts/protected-values-guard.sh`

| モード | 内容 |
|---|---|
| `tree` | 追跡ファイルを一時ディレクトリへ書き出して `gitleaks dir` で走査する（D-5）。終了時に一時ディレクトリを消す |
| `history` | `BASE..HEAD` の diff を `gitleaks git --log-opts` で、コミットメッセージを `git log --format=%B BASE..HEAD` → `gitleaks stdin` で走査する（D-6） |
| `text [file]` | 標準入力かファイルを `gitleaks stdin` で走査する。Issue・PR・コメントの投稿前と `commit-msg` フックが使う |
| （引数なし） | `tree` と `history` の両方 |

- `BASE` は、スクリプト冒頭の定数 `PROTECTED_BASE`（`09e9648`）。空にすると全履歴が対象になる。環境変数 `PROTECTED_BASE` で上書きできる。
- 出力は `--redact`（検出した値を表示しない）。検出したルール名とファイル・行だけを示す。
- 終了コード: 0 問題なし / 1 検出あり / 2 前提不足（gitleaks が無い、版の不一致、`git` でない、モードが不正）。

### 3.3 組み込み

- **CI**（`ci.yml` の gitleaks ジョブ。fetch-depth 0 済み）: `protected-values-guard.sh`（引数なし）と、`protected-values-guard.test.sh` を実行するステップを足す。ジョブの名前は、資格情報以外も見ることが分かるものに改める。
- **フック**: `.githooks/commit-msg` が `protected-values-guard.sh text "$1"` を呼ぶ。`git config core.hooksPath .githooks` で有効にする（手順は `CLAUDE.md`）。コミットメッセージのコメント行（`#` 始まり）は検査から除く。
- **回帰テスト** `.github/scripts/protected-values-guard.test.sh`: `plan-guard.test.sh` に倣う（使い方・終了コード・PASS/FAIL の集計）。使い捨ての git リポジトリを作り、各ルールの「検出すべきもの」と「通すもの」、各モード、終了コード 2 の経路を確かめる。**フィクスチャは文字列を連結して組み立て**、テストファイル自身が検査で赤にならないようにする。
- 新しい `.sh` と `.githooks/commit-msg` は `git update-index --chmod=+x` を実行し、`git ls-files -s` で `100755` を確かめる。

### 3.4 `CLAUDE.md`

- 「守る対象」5 種と、書いてはならない場所（コード・文書・spec・plan・コミットメッセージ・Issue・PR・コメント）。
- プレースホルダ表: `<ACCOUNT_ID>`、`111122223333`、`203.0.113.x`、`dXXXXXXXXXXXXX.cloudfront.net`、`user@example.com`。
- 実測の記録の書き方: 実値は個人設定の `.local/` に置き、記録には件数や種類だけを書く。実値が要る作業ではその場で取り出す。
- 投稿前の手順: `gh` で Issue・PR・コメントを投稿する前に、本文を `protected-values-guard.sh text` で調べる（MCP の GitHub ツールで投稿するときも同じ）。
- push 前の検査に `./.github/scripts/protected-values-guard.sh` を足す。`コマンド` 節に回帰テストを足す。
- `commit-msg` フックの有効化手順。

## 4. 旧リポジトリの既存ヒットの処置

| ファイル | 処置 |
|---|---|
| `packages/edge-auth/src/index.test.ts` | 文書用の範囲へ書き換える（テストの意味を変えない） |
| `docs/superpowers/specs/2026-09-29-ip-allowlist-and-api-key-design.md` | 文書用の範囲へ書き換える。過去の記録の例示値であり、実値ではない旨を、追記の来歴（Issue #177 により 2026-10-18 訂正）で残す |
| `packages/edge-auth/src/ip-allowlist.test.ts` | 書き換えない。`protected-ipv4` の path 許可に入れる（D-7） |

## 5. 引き継ぎ（#182）

- 新リポジトリでは、`.gitleaks-protected.toml` の除外パスから `aidlc/` と `docs/superpowers/plans/` を外す（plan は新リポジトリでも積むので、守る対象を含んではならない）。
- `PROTECTED_BASE` を空にする（全履歴が対象になる）。
- 作者メール: 新リポジトリで `user.email` を noreply 形式にし、`commit-msg` フックに `git config user.email` の検査を足すか決める（D-10）。
- 新リポジトリの初回コミットの前に `protected-values-guard.sh` を引数なしで実行し、緑を確かめる。

## 6. 検証

| 層 | 検証 |
|---|---|
| ルールとラッパー | `protected-values-guard.test.sh` の全件パス |
| 旧リポジトリの現状 | `protected-values-guard.sh` が緑。この spec・plan も走査の対象で、緑 |
| 赤になること | 実値の形の文字列を足した使い捨てのコピーで、`tree`・`history`・`text` が 1 を返す |
| フック | 実値の形を含むメッセージのコミットが拒否され、クリーンなメッセージは通る |
| 既存の検査 | `gitleaks git . --no-banner --redact --exit-code 1` が緑のまま。lint・型・ユニットテストが緑のまま |
| CI | PR の gitleaks ジョブで新しい検査が実行され、緑 |

TDD の例外（configuration files・CI 設定・文書）として、層ごとに機械判定で検証する。ガード自体の回帰テストは、`plan-guard.test.sh` と同じく先に書き、失敗を確かめてから実装する。

## 7. 正本への反映

- `CLAUDE.md`: §3.4 のとおり（コマンド、テスト方針の push 前の検査、進め方の原則、規約の節）。
- `docs/design/`: FR・画面・IAM に該当は**なし**。`cicd-pipeline.md` は、CI のジョブの一覧に gitleaks ジョブ自体の記述が無い（`deployment-strategy.md` の表に「シークレット走査」の行があるが、「統合テスト」と書かれていて実態と異なる古い記述）。新しい検査は `ci.yml` の既存ジョブに足すので、正本の更新は plan の最初のタスクで再度確かめ、記述が要ると分かれば同じ PR で追記する。`aidlc/` は書き換えない。
- `packages/api/TABLE-DESIGN.md`: 該当なし。

## 8. 範囲外

- Claude Code のフックによる `gh` の本文の自動検査（D-11）。
- CI での PR 本文の走査（D-12）。
- 作者メールの強制（D-10。#182）。
- 履歴・`aidlc/`・過去の plan の実値の除去（持ち越さない。D-3）。
