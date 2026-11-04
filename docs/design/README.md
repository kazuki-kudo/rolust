# 設計の正本（docs/design）

Rolust の要件・画面設計・IAM ポリシー設計・CI/CD の**現在の正本**を置く。2026-09-24 に Issue #26 で `aidlc/`（AI-DLC 時代の凍結した記録）から複写して作った。CI/CD の 2 本は 2026-09-26 に Issue #39 で切り出した。ロールバックの手順書は 2026-09-27 に Issue #5 で切り出した。反映の戦略は 2026-09-27 に Issue #4 で切り出した。CI の決定事項は 2026-11-01 に Issue #213 で切り出した。一度きりの移行手順は 2026-10-18 に Issue #178 で `README.md` から移した（`README.md` の利用者向けの手順は `docs/guide/` に分けた）。以後の変更は `CLAUDE.md` § 開発フロー の規則に従い、実装と同じ PR でここを更新する。`aidlc/` 内の同名ファイルは凍結した経緯であり、更新しない。

> **追記**（Issue #182 により 2026-11-04）: `aidlc/` は旧リポジトリ（`rolust-legacy`、非公開）にあり、この木には持ち越していない。この README と各文書にある `aidlc/` のパス（「複写元」の列、「凍結文書の所在」の表、`<intent>`）は、旧リポジトリの中のパスである。ここから切り出した文書の内容は、この木の `docs/design/` に取り込み済みで、旧リポジトリを開かなくても読める。旧リポジトリの plan（`docs/superpowers/plans/`）も同じで、spec にある plan への参照は旧リポジトリの記録を指す。文書中の「Issue #N」「PR #N」は、**#251 以下なら旧リポジトリ（`rolust-legacy`）のもの**で、この木の新しい番号は #252 から始まる（旧番号を引くときは「旧 #N」と書く）。旧コミットの SHA（`2ce40d5` など）も旧リポジトリのもの。

## 文書

| ファイル | 内容 | 複写元（旧リポジトリの `aidlc/spaces/default/intents/260728-rolust-iam-trust/` 配下） |
|---|---|---|
| `requirements.md` | 要件（FR / NFR / 制約 / 前提 / 未解決事項）とデータモデル | `inception/requirements-analysis/requirements.md` |
| `mockups.md` | 5 画面の設計と各画面の 5 状態 | `inception/refined-mockups/mockups.md` |
| `interaction-spec.md` | インタラクション規約（GI-1〜GI-12。Issue #95 により 2026-10-03 訂正。訂正前は GI-1〜GI-10 で、GI-11 の追記が反映されていなかった）と画面・コンポーネントの仕様 | `inception/refined-mockups/interaction-spec.md` |
| `design-system-mapping.md` | 画面とコンポーネントの Cloudscape 部品への対応 | `inception/refined-mockups/design-system-mapping.md` |
| `iam-policy-design-note.md` | Lambda 実行ロールと Lambda@Edge の IAM ポリシー設計 | `construction/code-generation/iam-policy-design-note.md` |
| `cicd-pipeline.md` | CI ロール（削除済みの `rolust-ci-plan`・`rolust-ci-apply` の再作成用の記録。Issue #181 により 2026-10-19 訂正）の信頼ポリシー・権限ポリシー・作成手順、PR 経路の権限境界、承認者のための plan 読み方（赤信号 R-1〜R-10（Issue #24 により 2026-09-27 訂正）・黄信号 Y-1〜Y-5） | `construction/infrastructure-design/cicd-pipeline.md` |
| `ci-config.md` | CI の決定事項（D-1: トリガは `pull_request: main` と手動実行で、`main` への push では走らせない。Issue #213 により 2026-11-01 訂正）、ジョブ構成、ゲート。照合したのはトリガだけで、ジョブの数・構成と CD に関する記述は未照合 | `construction/ci-pipeline/ci-config.md` |
| `cd-config.md` | CD の決定事項（D-7: CD は反映しない。D-8: 公開リポジトリでは CD を持たない）、前提 P-1〜P-4、リポジトリ変数、パイプライン構成、guard | `operation/deployment-pipeline/cd-config.md` |
| `rollback-runbook.md` | ロールバックの判断基準・経路別の手順（基本形・認証が外れた場合・SPA・管理対象タグ・state のロック）、データとの非対称性（IAM を CloudTrail から戻す手順、`RoleLock` の手動解放）、エスカレーション | `operation/deployment-pipeline/rollback-runbook.md` |
| `deployment-strategy.md` | 反映の戦略（in-place を採る理由・構成要素ごとの置き換え特性（SPA の旧アセットは反映のたびに destroy される）・環境・変更の種類ごとの扱い・反映の前に満たされている前提・plan の差分の読み方） | `operation/deployment-pipeline/deployment-strategy.md` |
| `one-time-migrations.md` | 過去のデプロイを更新するときだけ要る、一度きりの移行手順（状態テーブルと申請テーブルへの分割、登録済みロールの紐づけ）。Issue #178 により 2026-10-18 に `README.md` から移した | 旧リポジトリの `README.md`（コミット `2ce40d5`。旧リポジトリのコミットで、この木では引けない。`aidlc/` ではない） |

`packages/api/TABLE-DESIGN.md`（DynamoDB の状態テーブルと申請テーブルのキー設計とアクセスパターン。Issue #36 により 2026-09-27 訂正）も正本の一部として扱う。置き場所は変えない。

実 AWS を要する実測（モックでは確かめられない層）の手順書は `docs/runbooks/` にある（Issue #182 により 2026-11-04 追記。旧 plan の手順書を、実値を抜いて起こした）。特権昇格面に触れる変更では、依頼者が実測を引き取れる手順書を残す（`CLAUDE.md` § テスト方針）。

| ファイル | 内容 |
|---|---|
| `docs/runbooks/cross-account-roles.md` | クロスアカウントの IAM ロールの操作（Reader・Manager 経由の AssumeRole と、特権昇格面）の実測 |
| `docs/runbooks/drift-repair.md` | 信頼ポリシーの乖離を直す操作（restore・adopt）の実測 |

画面と API のメッセージの英語表記は、`docs/development.md` の「英語表記の用語対応」に従う。

各文書の冒頭の**正本注記**に、照合の範囲・訂正の全体像・未決の事項がある。照合していない記述（未照合）は、その箇所に触れる作業が実装と照合する。

## 参照の規約

- コード・Terraform・文書が**ファイル名だけ**で上の表の文書を指す場合（例: `` `mockups.md` 画面 2 ``、`` `iam-policy-design-note.md` 3.4 ``）、それは `docs/design/` の文書を指す。
- ID（FR-x・NFR-x・C-x・A-x・OQ-x・GI-x・MQ-x・画面番号・節番号）は変えない。削除しても番号を詰めず欠番にし、追加は末尾に足す。コメントが ID で参照しているため。
- 行番号では参照しない。節名か ID で参照する。

## ソースタグと、本文が名指す凍結文書の所在

本文の `[Q7]` などのタグは、記述の出典を示す来歴として残している。タグと、本文がファイル名だけで名指す `docs/design/` 以外の文書の所在は次のとおり（`<intent>` は旧リポジトリの `aidlc/spaces/default/intents/260728-rolust-iam-trust`。以下の所在はすべて旧リポジトリの中のパスである）。

| タグ・ファイル名 | 所在 |
|---|---|
| `[Q<n>]`（`requirements.md`・`iam-policy-design-note.md`）、`requirements-analysis-questions.md` | `<intent>/inception/requirements-analysis/requirements-analysis-questions.md` |
| `[Q<n>]`・`[AN-<n>]`（`mockups.md`・`interaction-spec.md`・`design-system-mapping.md`）、`refined-mockups-questions.md` | `<intent>/inception/refined-mockups/refined-mockups-questions.md` |
| 「質問 N」「RQ-N」（訂正の来歴に現れる AI-DLC の後段ステージの質問） | `<intent>/construction/<ステージ名>/*-questions.md`（例: 質問 11 は `code-generation/code-generation-questions.md`、RQ-4 は `infrastructure-design/infrastructure-design-questions.md`） |
| `[IS]`、`intent-statement.md` | `<intent>/ideation/intent-capture/intent-statement.md` |
| `[idea]`、`idea.md` | 依頼者による開発初期の原記述。かつてリポジトリ直下の `idea.md` にあった。Issue #192 により 2026-10-19 に削除した（原文は旧リポジトリの履歴にだけ残る） |
| `[org]`、`org.md`・`team.md`・`project.md` | `aidlc/spaces/default/memory/`（当時の規則。現行の規則は `CLAUDE.md` と `.claude/rules/`） |
| `[phase:inception]`・`[phase:construction]`、`inception.md`・`construction.md` | `aidlc/spaces/default/memory/phases/` |
| `[state]`、`aidlc-state.md` | `<intent>/aidlc-state.md` |
| `[ux]`、`ux-guide.md`・`wireframing-guide.md`・`interaction-design-patterns.md`・`component-spec-template.md` | AI-DLC の撤去で削除済み。旧リポジトリで `git show 380af1b^:.claude/knowledge/aidlc-design-agent/<ファイル名>` で読める |
| `accessibility-checklist.md`（`M-*`・`B-*` の検査項目） | `<intent>/inception/refined-mockups/accessibility-checklist.md` |
| `memory.md`（`interaction-spec.md` GI-6 の補足から） | `<intent>/inception/refined-mockups/memory.md` |
| `wireframes`・`user-flow`・`stories` | 作られていない（AI-DLC の上流成果物として宣言されただけ） |
| `[derived]` | 上流に直接の記述が無く、その文書で導出した判断 |
| `quality-gates.md`（`cicd-pipeline.md`・`cd-config.md` から。`ci-config.md` は Issue #213 により 2026-11-01 に `docs/design/` へ切り出した） | `<intent>/construction/ci-pipeline/` |
| `deployment-architecture.md`・`infrastructure-services.md`・`infrastructure-specification.md`・`monitoring-design.md`（同上） | `<intent>/construction/infrastructure-design/` |
| `validation-report.md`・`environment-inventory.md`（同上） | `<intent>/operation/environment-provisioning/` |
| `code-summary.md`（同上） | `<intent>/construction/code-generation/code-summary.md` |
| `runbooks.md`・`incident-plan.md`・`escalation-matrix.md`（`rollback-runbook.md`・`deployment-strategy.md` から） | `<intent>/operation/incident-response/` |
| `feedback-loop.md`（同上） | `<intent>/operation/feedback-optimization/` |
| `deployment-log.md`（同上）、`smoke-test-results.md`（`deployment-strategy.md` から） | `<intent>/operation/deployment-execution/` |
| `[FR-x]` など要件 ID のタグ | `docs/design/requirements.md` |

## 凍結文書を正本に切り出す手順

`aidlc/` の文書を訂正・変更する必要が出たときは、`aidlc/` を書き換えず、次の手順でその文書を `docs/design/` に切り出してから直す（旧 Issue #26 の 5 本もこの手順で作った）。

> **注記**（Issue #182 により 2026-11-04）: この木には `aidlc/` が無い。次の手順の「`aidlc/`」は旧リポジトリ（`rolust-legacy`）のもので、複写元の文書は旧リポジトリから取り出す（旧リポジトリは書き換えない）。手順 5 の「`aidlc/` に差分が無いこと」と、旧 plan の検証スクリプトは、この木では確かめられない（旧リポジトリで確かめる）。手順は、既に切り出した文書の来歴として残す。

1. **複写**: `cp` で `docs/design/` に同名で複写し、複写だけのコミットを作る（以後の差分が訂正だけになる）。同名が既にある場合は名前を変え、この README の規約に追記する。
2. **正本注記**: 冒頭に正本注記（位置づけ・複写元・照合の範囲・訂正の全体像・未決）を置く。書式は既存の文書に倣う。
3. **既知の食い違いの総当たり**: 次の源泉から食い違いを列挙し、1 件ずつ現在のコードで裏を取ってから直す。記録上の逸脱が後で解消されていることがある（例: `code-summary.md` の逸脱 5 は、後の質問 6 = C で解消済みだった）。
   1. `aidlc/` の記録にある差異・逸脱の注記。加えて、要件 ID（`FR-`・`NFR-`・`C-`・`A-`・`OQ-` ＋数字）と「破る|破って|逸脱|反する|覆」が同じ行に現れる記録
   2. コードのコメントがその文書に対して自己申告する逸脱（文書名の前後 3 行を見る）
   3. `.claude/rules/` の規則のうち、その文書の記述を補正するもの
   4. 状態欄（Open Questions・Assumptions など）と `CLAUDE.md` § 決定済みの仕様
   5. AI-DLC の工程の残骸（Stage 行、`## Review` 節など）

   各訂正には来歴（「Issue #N により YYYY-MM-DD 訂正」）を訂正後の文言と同じ行に付け、正本注記に全体像を書く。結論を確定できないものは直さず「未決」に挙げて人間の判断を仰ぐ。
4. **参照の張り替え**: フルパスでその文書を指す参照（README・`CLAUDE.md`・`.claude/rules/`・CI や infra のコメント）を `docs/design/` に張り替える。ファイル名だけの参照は上の規約で解決するので書き換えない。行番号での参照は節名か ID での参照に変える。この README の表に文書を足す。
5. **検証**: `aidlc/` に差分が無いこと、複写元の ID がすべて正本にあること、訂正ごとに訂正後の文言と来歴があること、パス参照の先が実在することを機械的に確かめる。旧 Issue #26 の plan（旧リポジトリの `docs/superpowers/plans/2026-09-24-living-design-docs.md`。持ち越していない）の Task 7 の検証スクリプトが雛形になる。
