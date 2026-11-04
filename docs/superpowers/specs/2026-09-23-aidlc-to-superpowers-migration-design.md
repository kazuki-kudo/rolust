# AI-DLC から Superpowers への移行 — 設計

- 日付: 2026-09-23
- ブランチ: `chore/migrate-to-superpowers`
- 状態: 設計承認済み（brainstorming の第 1〜5 節）、spec レビュー待ち

## 1. 背景と目的

Rolust はこれまで AI-DLC（`.claude/` に同梱されたワークフローフレームワーク）で開発してきた。今後は Superpowers plugin（ユーザー設定で有効化済み、6.4.1）の skill 群 — brainstorming → writing-plans → TDD による実装 → finishing-a-development-branch — に切り替える。

### 依頼の内容

- AI-DLC をやめ、Superpowers を利用する方針に変更する。その移行方法を設計する。

### 前提（推測を依頼者が訂正しなかったもの）

1. やめる理由は重さ。`260922-pool-edit` が既定スコープ `workshop` の domain-design で止まり、成果物が残っていない。
2. 作業の単位は引き続き GitHub Issues（kazuki-kudo/rolust の #3〜#22）。
3. 蓄積した技術的な学びは残す。AI-DLC の手順固有の規則は捨てる。
4. trunk-based・squash merge・push 前確認の運用は維持する。

### 成功基準

- 移行後のセッションで AI-DLC の hook・指示・skill が一切発火しない。
- Issue #17〜#19（プール編集）を brainstorming → writing-plans → 実装の流れで扱える。
- README・CI コメントから設計根拠への参照が切れない。
- 技術的な学びが `CLAUDE.md` と `.claude/rules/` に残り、実装と矛盾する規則は持ち込まない。

## 2. 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| 既存の記録 `aidlc/` | **A. その場に凍結保存** | README・CI コメント・記録内の相互参照が一切壊れない。誤読は注記で防ぐ |
| テストの進め方 | **A. Superpowers の TDD を採用** | アプリコードは全面 TDD。IaC・CI・文書は skill 自身の例外（configuration files）として機械判定で検証する。従来の test-after は org.md の framework 既定であり、team.md で affirm された方針ではない |
| 移行の進め方 | **案 1. 1 ブランチ・1 PR で一括移行** | main に AI-DLC と Superpowers の混在状態を作らない。squash で 1 コミットになり revert 1 回で戻せる |
| pool-edit のレビュー JSON 4 件 | 退避しない | 依頼者が第 1 節を無条件で承認 |

## 3. 設計

### 3.1 撤去するもの・残すもの

**`.claude/` から git 削除する（302 ファイル）**

| パス | ファイル数 |
|---|---|
| `.claude/agents/` | 14 |
| `.claude/aidlc-common/` | 43 |
| `.claude/hooks/` | 18 |
| `.claude/knowledge/` | 59 |
| `.claude/rules/aidlc.md` | 1 |
| `.claude/scopes/` | 12 |
| `.claude/sensors/` | 6 |
| `.claude/skills/`（`aidlc-*` 42 個と `upgrade-aidlc`） | 54 |
| `.claude/tools/` | 93 |
| `.claude/settings.local.json.example` | 1 |
| `.claude/CLAUDE.md`（ルート `CLAUDE.md` に置き換え） | 1 |

**`.claude/settings.json` を書き換える**

- 削除: `companyAnnouncements`、`statusLine`、`hooks` 全体、`env` の 3 キー（`AWS_AIDLC_DEFAULT_SCOPE`、空文字の `CLAUDE_CODE_USE_BEDROCK` と `AWS_REGION`）、permissions の `Bash(bun .claude/tools/*)` と `Bash(date -u *)`。
- 維持: permissions の `Read` / `Edit` / `Write` / `Glob` / `Grep` / `Task` / `WebSearch`、`model`、`effortLevel`（upgrade-aidlc が `SETTINGS_USER_WINS` として利用者側の値を保持していた項目）。
- 副次効果: `AWS_REGION` の空文字上書きが消え、AWS CLI がプロファイルの region を使う。

**`.gitignore` を書き換える**

- 削除: 「AI-DLC: per-user cursors」「AI-DLC: machine-local runtime」の節、DocumentKB（2.6 で追加）と `aidlc/diagnostics/`、2.9.0 で追加された 7 行、`packages/*/aidlc/` とそのコメント。
- 追加: `.worktrees/`（3.4 の worktree 方針）。
- 維持: `eslint.config.js` の `aidlc/**` 除外（`aidlc/` は残るため、このファイルは変更しない）。

**ローカル残骸を削除する（git 管理外。削除すると元に戻せない）**

- `aidlc/.aidlc-sessions/`、`aidlc/.aidlc-clone-id`、`aidlc/active-space`、`aidlc/spaces/default/intents/active-intent`
- `aidlc/spaces/default/intents/.aidlc-hooks-health/`、各 intent の `.aidlc-*` と `runtime-graph.json`
- `aidlc/spaces/default/intents/260922-pool-edit/` 全体（成果物なし。空ディレクトリとエンジン状態のみ）
- `packages/api/aidlc/`、`packages/core/aidlc/`、`packages/web/aidlc/`（type-check センサーの tsc キャッシュ）

gitignore の行を外すより先に削除する。逆順にすると未追跡ファイルとして浮き上がる。

**残すもの**: `aidlc/` の追跡済み記録（3.3）、`.github/`、`infra/`、`packages/`、ユーザー設定側の Superpowers・github plugin の有効化。

**hook の止め方**: hook はセッション開始時に読み込まれる。ローカル残骸の削除と `settings.json` の書き換えを済ませた時点で Claude Code を一度再起動してもらい、以降の削除作業は hook が発火しない状態で行う。

### 3.2 `CLAUDE.md` と学びの移植

`aidlc/spaces/default/memory/project.md` の学び 80 件を仕分ける（全件の対応は付録 A）。

| 区分 | 件数 | 扱い |
|---|---|---|
| AI-DLC の手順そのもの（25）・対応済みの個別事例（1） | 26 | 移植しない |
| 実装と矛盾 | 2 | 移植しない。現状（タグ方式・`DenySelfEscalation`）を `aws-infra.md` に書き起こす |
| 規則ではなく未着手の改善案 | 1 | GitHub Issue として起票する |
| 技術・判断の知見 | 51 | 重複 6 行を統合し、45 件として移植する |

矛盾する 2 件は X1（信頼ポリシーをロール名プレフィックスで絞る）と C12（既定値の安全性を `project_name` の正規表現から導く）。`infra/main.tf:19-29` のとおり実装はタグ方式（`aws:ResourceTag/<managed_tag_key>`）へ移行済みで、接頭辞が持っていた「自ロールと原理的に前方一致しない」層は失われ、残る明示の防御は `DenySelfEscalation` のみである。

学び以外の AI-DLC 規則（`org.md`・`team.md`・`phases/*.md`）からは、今も有効な次の事項だけを `CLAUDE.md` に移す。

- `org.md` Way of Working: trunk-based、短命なフィーチャーブランチ、squash merge。
- `org.md` Code Style: 整形・lint は ESLint などプロジェクトの設定に従い、設定が扱わない事項だけを提案する。
- `org.md` Mandated（Conversation language）: 本文は日本語、コード識別子・パス・ID は原文。
- `phases/construction.md` Error Handling / Security: 統合境界でのエラー処理と握りつぶし禁止、秘密情報をハードコードしない、境界での入力検証。

`org.md` の Walking Skeleton・Deployment、`ideation.md`・`inception.md`・`operation.md` は AI-DLC のフェーズ構造に依存するため移さない。

**ファイル構成**

`CLAUDE.md`（リポジトリ直下、常時読み込み、100 行前後）

- 概要: Rolust の役割、`packages/{core,api,web,edge-auth}` と `infra/`、TypeScript で統一（K1）。
- コマンド: `npm run lint` / `typecheck` / `test` / `test:integration` / `build`、`.github/scripts/plan-guard.test.sh`。
- 開発フロー: 3.4 の運用規約。
- テスト方針: アプリコードは TDD。IaC・CI 設定・文書は `terraform validate`・plan-guard・grep などの機械判定で検証（T5）。T2 / T3 / T4 / C59。
- コード規約: 上記 org.md と construction.md から移す事項。
- 決定済みの仕様: C1 / C3 / C4。
- 進め方の原則: C2 / C11 / C18 / C20 / C21 / C25 / C29 / C39 / C40 / C44 / C51 / C52。
- 記録の場所: `docs/superpowers/specs/`・`plans/`。`aidlc/` は凍結した記録で、根拠を読む用途に限り書き換えない。`aidlc/spaces/default/codekb/rolust/` は 2026-09-20 時点のコード知識。
- 言語: 本文は日本語、識別子は原文。

`.claude/rules/frontend.md`（`paths`: `packages/web/**`）

- S1〜S6（Cloudscape とフォーカス管理・破棄確認）、C13（UI 規約の数値目標の適用範囲）。

`.claude/rules/aws-infra.md`（`paths`: `infra/**`、`.github/**`）

- D1 / D2 / X2 / X3 / C8 / C9 / C28 / C30 / C32 / C34 / C35 / C38 / C47。
- 管理対象ロールの現状（X1・C12 の置き換え）: タグ方式、`iam:TagRole` は誰にも付与しない、範囲変更が `terraform plan` に出ない（受容リスク R-e）、明示の防御は `DenySelfEscalation` のみ。

`.claude/rules/shell-and-aws-cli.md`（`paths` なし、常時読み込み）

- S7 / S8（Git Bash の CRLF）、C14（AWS CLI の失敗の読み方と `sts get-caller-identity --profile --region` による実測）、C46（IAM の CloudTrail は `--region us-east-1`）。

各規則は「何をするか」と「なぜ」を 1〜2 文で書く。`cid` コメントと学習日は移さない。`paths` は YAML のリストで書く（例: `paths:` の下に `  - "packages/web/**"`）。書式は Claude Code の現行ドキュメント（code.claude.com/docs/en/memory § Path-specific rules）で確認済み。frontmatter が YAML として読めないと警告なしに `paths` 無しとして常時読み込まれる。

### 3.3 `aidlc/` の凍結と外部参照

**`aidlc/README.md` を新設する**

- 2026-09-23 に凍結し以後更新しないこと。新しい記録は `docs/superpowers/` に置くこと。
- 中身の案内: `260728-rolust-iam-trust`（本体）、`260920-apigw-account-docs`（Issue #1）、`260921-build-test-counts`（Issue #2）、`260728-inventory-api`（導入時の試行。未完了のまま in-flight 表示で凍結）、`codekb/`（2026-09-20 時点のコード知識）、`memory/`（当時の規則。現行規則は `CLAUDE.md` と `.claude/rules/` に選別移植済み。`project.md` の X1・C12 は実装と矛盾）、`STATUS.md`（2026-08-10 時点の進捗レポート）。
- 記録そのもの（`intents.json`・`aidlc-state.md` を含む）は書き換えない。

**`STATUS.md` を `aidlc/STATUS.md` へ `git mv` する。** 2026-08-10 時点の「AI-DLC ワークフロー進捗レポート」であり、ルートにあると現在の状況と誤読される。他ファイルからの参照は 0 件。

**README を 3 か所更新する**

1. 構成表（49 行目）: `aidlc` 行を「AI-DLC 時代（〜2026-09-23）の設計・要件の記録。凍結済み。アプリケーションの動作には不要」に改め、`docs/superpowers` 行（設計書と実装計画）を足す。
2. 「テストの方針」第 1 段落: 「Test Strategy は Standard」「スコープが poc から classic へ」を TDD の方針に書き換える。モック・統合テストの段落は維持する。
3. 「設計の記録」冒頭: 「2026-09-23 以降の設計は `docs/superpowers/`、それ以前は `aidlc/`（凍結）」を足す。表は維持する。

**変更しないもの**: `.github/workflows/ci.yml`・`cd.yml`・`.github/scripts/plan-guard.sh`・`.trivyignore.yaml`・`infra/bootstrap/versions.tf` のコメント、README 229 行目の参照、`eslint.config.js`。

**GitHub Issues**: `aidlc` ラベルは由来の記録として残す。C54 を Issue として起票する（本文は実装時に提示してから作成）。

### 3.4 auto-memory と Superpowers の運用規約

**auto-memory**（`~/.claude/projects/C--Users-kkudo-wsclaude-rolust/memory/`。PR には含まれない）

| memory | 扱い |
|---|---|
| `commit-at-aidlc-stage-gates` | 名前を `commit-at-milestones` に変えて書き直す。節目は spec 承認・plan 承認・各タスク完了。push は確認してから |
| `aidlc-artifact-language-convention` | 削除（理由だった sensor が消える） |
| `aidlc-settings-no-bedrock` | 削除（`upgrade-aidlc` が消える） |
| `github-issues-for-backlog` | 更新。Issue 番号は brainstorming の依頼・spec・コミット・PR に含める。inventory-api への言及を消す。ラベル 5 種の運用は維持 |

`MEMORY.md` の索引も合わせて更新する。

**Superpowers の運用**（`CLAUDE.md` の「開発フロー」に書く）

- 入口: Issue 番号を添えて依頼する。brainstorming が分類する。bounded（#3、#15 など）はチャットで短い設計を承認して実装、architectural（#17〜#19、#20 など）は spec と plan を作る。
- 置き場: `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`、`docs/superpowers/plans/YYYY-MM-DD-<feature>.md`。本文は日本語。
- ブランチ: 既定は現在のチェックアウト上のフィーチャーブランチで、worktree は使わない（Windows で worktree ごとに `npm install` が要るため）。並行作業が要るときだけ `.worktrees/` を使う。`using-git-worktrees` は宣言済みの希望があれば確認を省くため、`CLAUDE.md` に明記する。
- plan の実行方式: subagent-driven か inline かは plan 承認時に毎回選ぶ。
- 完了: `finishing-a-development-branch` では「push して PR」を既定とし、GitHub で squash merge する。main へのローカル merge はしない。
- デプロイ: Superpowers にデプロイ工程は無い。terraform apply を伴う Issue は、plan の最終タスクに README 手順または `cd.yml` による反映と、その実測を含める。

### 3.5 検証

PR を出す前:

1. 静的検査: `.claude/` 配下と `CLAUDE.md` に AI-DLC の実行系への参照（`bun .claude/tools`・`aidlc.ts`・`/aidlc`・`aidlc-` で始まる agent / skill 名）が 0 件（`aidlc/` の記録へのパス参照は許す）。`git ls-files .claude` が `settings.json` と `rules/` の 3 ファイルの計 4 ファイルだけ。`settings.json` が正しい JSON で `hooks` キーが無い。`.gitignore` に AI-DLC の行が無い。`git status --ignored` に AI-DLC の残骸が出ない。
2. 回帰: `npm run lint`・`npm run typecheck`・`npm run test`・`.github/scripts/plan-guard.test.sh` がすべて成功する。
3. 参照の実在: README・CI コメント・`aidlc/README.md`・`CLAUDE.md` に書いた `aidlc/` 配下のパスを抽出し、すべて実在する（grep・jq の出力は `tr -d '\r'` してから `test -e` する）。
4. 対応表: 付録 A がちょうど 80 行で、区分の件数が 3.2 の表と一致する。

merge 後（依頼者が Claude Code を再起動して確認）:

5. SessionStart に AI-DLC の注入が無い。statusLine が消えている。skill 一覧に `aidlc*` が無い。`/hooks` にプロジェクトの hook が 0 件。`packages/web` のファイルを読ませた後、`/context` の Memory files に `frontend.md` が現れる（`paths` 付きの rule は該当ファイルを読んだ時点で読み込まれる。frontmatter が壊れていると警告なしに常時読み込みになるため、起動直後の `/context` に `frontend.md`・`aws-infra.md` が無いことも確かめる）。

## 付録 A: `project.md` 学び 80 件の対応表

ID は `project.md` の節と出現順による: T = Testing Posture、D = Deployment、S = Code Style、K = Tech Stack、X = Decided、C = Corrections。

移植先の略記: `CL/概要`・`CL/テスト`・`CL/仕様`・`CL/原則` は `CLAUDE.md` の各節、`fe` = `.claude/rules/frontend.md`、`infra` = `.claude/rules/aws-infra.md`、`sh` = `.claude/rules/shell-and-aws-cli.md`。

| ID | 要旨 | 扱い |
|---|---|---|
| T1 | Test Strategy の件数は上限ではない | 不移植（AI-DLC の Test Strategy 概念。TDD が包含） |
| T2 | Minimal でも文脈次第でテスト種別を足す（実 AWS・特権昇格は手順書） | 移植 → CL/テスト |
| T3 | モックは実物より寛容になりうる | 移植 → CL/テスト |
| T4 | 既存の実資源を書き換える検証は退避・復元・一致確認 | 移植 → CL/テスト |
| T5 | Testing Contract の 5 層を IaC・CI・文書層へ読み替える | 移植 → CL/テスト（TDD の例外として再構成） |
| T6 | T2 と同旨（DenySelfEscalation の例） | 統合 → T2 |
| T7 | build-and-test の produces は全件必須 | 不移植（AI-DLC） |
| D1 | 承認ゲート未完了の間は迂回させうる変数を置かない | 移植 → infra |
| D2 | 外部サービスの副作用による中間状態は削除の可否を確かめる | 移植 → infra |
| S1 | TopNavigation は children スロットで構成する | 移植 → fe |
| S2 | 導出値は prop で受けず既存レコードから算出する | 移植 → fe |
| S3 | 唯一の primary アクションのツールバーはページ階層に置く | 移植 → fe |
| S4 | 非同期処理中に要素を差し替えない | 移植 → fe |
| S5 | 破棄確認は全ての閉じ経路に適用する | 移植 → fe |
| S6 | 確認表示へ切り替えるときフォームをアンマウントしない | 移植 → fe |
| S7 | Git Bash の `sed -i` は CRLF を LF に変える | 移植 → sh |
| S8 | Git Bash の jq は CRLF を出力する | 移植 → sh |
| K1 | 実装言語は TypeScript で統一 | 移植 → CL/概要 |
| X1 | 信頼ポリシーの範囲はロール名プレフィックスで絞る | 不移植（実装と矛盾。タグ方式へ移行済み。現状を infra に記載） |
| X2 | Terraform state の置き場所・鍵・S3 ネイティブロック | 移植 → infra |
| X3 | `infra/bootstrap/` は第三者向け経路として残す | 移植 → infra |
| C1 | ChangeRequest は件数無制限に蓄積する | 移植 → CL/仕様 |
| C2 | 上流が具体的に設計済みの事項は再質問しない | 移植 → CL/原則 |
| C3 | Assignment の保存はセル単位の即時呼び出し | 移植 → CL/仕様 |
| C4 | レイテンシに数値目標を新設しない | 移植 → CL/仕様 |
| C5 | 3.4 が SKIP なら Terraform を 3.5 に含める | 不移植（AI-DLC） |
| C6 | `--single` 実行の成果物を上流入力として採用する | 不移植（AI-DLC） |
| C7 | OQ 確定後に UI 導線を追加する | 不移植（個別事例。対応済み） |
| C8 | Lambda@Edge の信頼ポリシーは 2 プリンシパル・us-east-1 | 移植 → infra |
| C9 | CloudFront のカスタムエラー応答は 403 のみ | 移植 → infra |
| C10 | 導出できるものは記録し、根拠の無いものだけ質問する | 統合 → C2 |
| C11 | 制約は基盤層だけでなく作り込んだ操作の場でも検証する | 移植 → CL/原則 |
| C12 | 既定値の安全性は型・正規表現の制約から導く | 不移植（実装と矛盾。接頭辞の層はタグ方式で失われた。現状を infra に記載） |
| C13 | UI 規約の数値目標は自前定義分への規約と解する | 移植 → fe |
| C14 | AWS CLI の失敗は資格情報の不在とは限らない | 移植 → sh |
| C15 | ステージ名で名指しされた未決事項はそのステージが問う | 不移植（AI-DLC） |
| C16 | consumes の未解決プレースホルダを読み替える | 不移植（AI-DLC） |
| C17 | 質問ファイルへの直接記入を回答として採る | 不移植（AI-DLC） |
| C18 | 発見した不具合はその場で直し回帰テスト。設計判断は人間へ | 移植 → CL/原則 |
| C19 | 質問 1〜2 件では対話モード選択を出さない | 不移植（AI-DLC） |
| C20 | 「ツールが無い」検証は導入を試みてから判断する | 移植 → CL/原則 |
| C21 | 名指しの手段が求める強度を表現できないなら手段を差し替える | 移植 → CL/原則 |
| C22 | スコープ変更時に取り残されたステージを提示する | 不移植（AI-DLC） |
| C23 | `activeForm` の角括弧はリテラル | 不移植（AI-DLC） |
| C24 | フェーズ境界検証はチェック項目を辿る | 不移植（AI-DLC） |
| C25 | 手順は文面でなく経路として実行して確かめる | 移植 → CL/原則 |
| C26 | 他ステージの承認済み成果物を横から書き換えない | 不移植（AI-DLC のステージ間規約。文書訂正は C51・C52 に集約） |
| C27 | optional_produces は条件不成立なら作らない | 不移植（AI-DLC） |
| C28 | メトリクスの名前は意味を保証しない | 移植 → infra |
| C29 | レビュー指摘の採否は穴の実在で決める | 移植 → CL/原則 |
| C30 | CI ゲート対象外の重大度を除外ファイルに書かない | 移植 → infra |
| C31 | IaC を産む場が 1 つならそのステージが担う | 不移植（AI-DLC） |
| C32 | 「X の全権限に加えて」は意図に合わせて実装する | 移植 → infra |
| C33 | `[Answer]:` をバッククォートで囲まない | 不移植（AI-DLC） |
| C34 | リソース名は属性を保証しない | 移植 → infra |
| C35 | 自分の Terraform backend は自分で管理できない | 移植 → infra |
| C36 | 宣言された上流成果物が不在でも導出して進める | 不移植（AI-DLC） |
| C37 | Modify 再実行時の見出し重複 | 不移植（AI-DLC） |
| C38 | apply 前の前提検証は apply より前に実測する | 移植 → infra |
| C39 | 依頼者の操作待ちの間は非依存の検証を進める | 移植 → CL/原則 |
| C40 | 分岐付きで決めた事項は条件確定時に再質問せず発動する | 移植 → CL/原則 |
| C41 | Operation の質問は導出で埋める | 統合 → C2 |
| C42 | 中核作業を実施できないステージは skipped として記録 | 不移植（AI-DLC） |
| C43 | 書き換え禁止と即時修正が競合したら選択肢を質問する | 不移植（AI-DLC のステージ間規約） |
| C44 | 実行環境に止められた後片付けを別手段で押し通さない | 移植 → CL/原則 |
| C45 | ステージが列挙するサービス連携の要不要を導出する | 不移植（AI-DLC の Operation ステージ固有） |
| C46 | IAM の CloudTrail イベントは us-east-1 にしか記録されない | 移植 → sh |
| C47 | `aws_s3_object` + `fileset()` は旧アセットを destroy する | 移植 → infra |
| C48 | zero-Unit の testing-posture は `--unit .` | 不移植（AI-DLC） |
| C49 | code-generation の質問は Plan Approval のみ | 不移植（AI-DLC） |
| C50 | 資格情報の失効を実測してから既定の分岐を発動する | 統合 → C14・C40 |
| C51 | 承認済み文書の訂正は grep で総当たりする | 移植 → CL/原則 |
| C52 | 承認済み文書への追記は冒頭注記と各箇所の来歴の二層 | 移植 → CL/原則 |
| C53 | zero-Unit では plan-approval guard が委譲を通さない | 不移植（AI-DLC） |
| C54 | plan-guard に DenySelfEscalation 対象の網羅検査を足す案 | Issue 起票 |
| C55 | C50 と同旨 | 統合 → C14・C40 |
| C56 | 結果ファイルは produces のパスに書く | 不移植（AI-DLC） |
| C57 | trivy・gitleaks は CI と同じ版を取得して実測する | 統合 → C20 |
| C58 | build-and-test は 0 問で進めてよい | 不移植（AI-DLC） |
| C59 | push 前に CI と同じ引数で trivy・gitleaks・npm audit を実行する | 移植 → CL/テスト |

集計: 移植 45（CL/概要 1、CL/テスト 5、CL/仕様 3、CL/原則 12、fe 7、infra 13、sh 4）＋ 統合 6、不移植（AI-DLC）25、不移植（個別事例）1、不移植（実装と矛盾）2、Issue 起票 1。計 80。

## 付録 B: 起票する Issue（C54）の骨子

- タイトル案: plan-guard に「plan 内の全 `aws_iam_role` が `DenySelfEscalation` の `Resource` に含まれる」検査を足す
- 内容: Deny 対象の追加漏れを CI で構造的に検知する。規則の追加は `cicd-pipeline.md` の R-1〜R-9 一覧に波及するため、採否を判断してから実装する。
- ラベル: `enhancement`、`security`、`decision-needed`
