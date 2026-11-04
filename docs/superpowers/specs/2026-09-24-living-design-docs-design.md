# 設計の正本を `docs/design/` に切り出す — 設計

- 日付: 2026-09-24
- Issue: #26
- ブランチ: `docs/living-design-docs`
- 状態: 設計承認済み（brainstorming の第 1〜5 節）、spec レビュー待ち

## 1. 背景と目的

2026-09-23 の Superpowers への移行で `aidlc/` を凍結した（`docs/superpowers/specs/2026-09-23-aidlc-to-superpowers-migration-design.md` 3.3「記録そのものは書き換えない」）。一方、Superpowers の spec は変更ごとの差分文書で、システム全体の設計文書を保守する工程を持たない。その結果、要件・画面設計・IAM 設計の「現在の正本」がどこにも無い。

### 起きていること

1. **古い記述が注記なしで残る。** `iam-policy-design-note.md` の 2026-08-01 追記は「ロール名プレフィックス方式で決着」「`DenySelfEscalation` は 4 ロール」と書くが、実装はタグ方式（`infra/main.tf` の `managed_tag_condition`）で、Deny の対象は 5 ロール（`self_role_arns`）。README はこの文書を「IAM ポリシーの設計判断」として名指ししている。`aidlc/README.md` の注意書きは `project.md` の 2 件しか扱っていない。
2. **要件を覆す変更の置き場が無い。** #19 は FR-3.1（登録済み IamRole の全件を列に並べる）と Data Model の「IamRole は UserPool に従属しない」を覆すが、`requirements.md` は凍結されている。`CLAUDE.md` の原則「承認済み文書の食い違いは grep で総当たりして直す」と「`aidlc/` は書き換えない」が衝突する。
3. **凍結文書の訂正を求める Issue が進められない。** #4（`deployment-strategy.md`）、#5（`rollback-runbook.md`）、#24（`cicd-pipeline.md` の R-1〜R-9 一覧）。
4. **Superpowers が設計を読む経路が粗い。** brainstorming の「Explore project context」は `CLAUDE.md` の案内に頼るが、`CLAUDE.md` は `260728-rolust-iam-trust/`（約 100 ファイル）をディレクトリ単位で指すだけで、どれが要件の本体かは README にしか書かれていない。

### 依頼の内容

- 更新し続ける正本を `docs/` に切り出し、以後の Superpowers の作業が正本を読み、正本を更新する状態にする（依頼者が方針 B として選択）。

### 前提

1. `aidlc/` から移動せず複写する。移行 spec 3.3 の「記録そのものは書き換えない」から導出した。移動すると、記録の中の相対参照（例: `code-summary.md` から `../../inception/...`）も切れる。
2. 文書の変更は TDD の例外（configuration files）とし、grep などの機械判定で検証する（`CLAUDE.md` § テスト方針）。

### 成功基準

- 正本に、第 3.2 節の源泉から列挙した既知の食い違いが残っていない。
- README・`CLAUDE.md`・`.claude/rules/`・`aidlc/README.md` の案内が正本を指し、参照先がすべて実在する。
- `CLAUDE.md` に正本の更新規則があり、以後の spec が「正本への反映」節を持つ。
- #19・#4・#5・#24 が、正本を編集する（または規則に従って切り出してから直す）形で着手できる。

## 2. 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| 正本にする範囲 | **設計 5 本を今切り出す。運用・CI 文書は必要になった Issue が切り出す** | brainstorming が毎回読むのは要件・画面・IAM の中核。運用・CI 文書（`cicd-pipeline.md`・`deployment-strategy.md`・`rollback-runbook.md`・`runbooks.md` など）は #4・#5・#24 が触れるときに第 3.4 節の規則で切り出せば足りる |
| 照合の深さ | **既知の食い違いの総当たり** | 機械的に列挙できる源泉（3.2）はすべて直す。それ以外の本文は照合せず、正本注記に「未照合」と明記する。全文照合（5 本・約 1,800 行）は作業量に比べて得るものが少ない |
| 参照の方式 | **同名で複写し、規約で解決する** | 5 本を名指す参照は `aidlc/`・`docs/` の外に 74 行 / 41 ファイルある。うち README・`.claude/rules/` の 6 行、行番号参照 6 行、紛らわしい 1 件だけを書き換え、残りのファイル名だけの参照（`packages/`・`infra/` の 61 行 / 35 ファイル）は「`docs/design/` を指す」規約で解決する。全参照のフルパス化は `packages` の差分が広い。移動は凍結の決定と衝突する |

## 3. 設計

### 3.1 配置と文書の形

`docs/design/` を新設する（1 段、下位ディレクトリなし）。

| ファイル | 複写元（`aidlc/spaces/default/intents/260728-rolust-iam-trust/` 配下） |
|---|---|
| `README.md` | 新規。正本の索引 |
| `requirements.md` | `inception/requirements-analysis/requirements.md` |
| `mockups.md` | `inception/refined-mockups/mockups.md` |
| `interaction-spec.md` | `inception/refined-mockups/interaction-spec.md` |
| `design-system-mapping.md` | `inception/refined-mockups/design-system-mapping.md` |
| `iam-policy-design-note.md` | `construction/code-generation/iam-policy-design-note.md` |

**`docs/design/README.md`（索引）** に書くこと:

- 各文書の役割と複写元。
- `packages/api/TABLE-DESIGN.md` はその場に置いたまま正本の一部として扱うこと。
- 規約: ファイル名だけの参照（例: `` `mockups.md` 画面 2 ``）は `docs/design/` の文書を指す。
- ソースタグ（`[Q<n>]`・`[IS]`・`[idea]`・`[org]`・`[phase:*]`・`[state]`・`[derived]`・`[ux]` など）の読み方。タグは来歴として本文に残し、`aidlc/` のどのファイルを指すかをここに対応表で示す。
- 凍結文書を後から切り出す手順（3.4 の規則 3 が参照する）: 複写 → 正本注記 → 既知の食い違いの総当たり（3.2 の源泉）→ 参照の張り替え（3.3 の要領）→ 検証（3.5 の該当項目）。

**各文書の冒頭の正本注記** に書くこと:

- 複写元のパス・複写日（2026-09-24）・Issue #26。
- 照合の範囲: 3.2 の源泉で照合した事項と、照合していない事項。
- 訂正の全体像（各箇所の来歴と対になる。`CLAUDE.md` の二層の原則）。
- 未決: 3.2 で直さず判断を仰いだ項目と、その決定。
- 更新規則は `CLAUDE.md` にあること。

**ID は変えない。** FR-x・NFR-x・C-x・A-x・OQ-x・GI-x・画面番号・節番号（例: `iam-policy-design-note.md` 3.4）はコードのコメントが参照している。以後、削除しても番号を詰めず欠番にし、追加は末尾に足す。

**`aidlc/` 側** は `aidlc/README.md` 以外を変更しない。`aidlc/README.md` は記録そのものではなく移行時に作った案内なので、正本の場所を追記する（3.3）。

### 3.2 照合（既知の食い違いの総当たり）

次の 5 つの源泉から食い違いを列挙し、すべて直す。列挙の結果（1 件 1 行の一覧）は plan に載せ、3.5 の検証 3 が 1 件ずつ対応する。付録 A は本 spec の時点で把握している項目で、網羅ではない。

1. **`aidlc/` の記録にある差異・逸脱の注記** — `iam-policy-design-note.md` の「実装との差異」追記、`construction/code-generation/code-summary.md` § 計画からの逸脱、`construction/infrastructure-design/infrastructure-specification.md` § 管理対象の絞り込み（タグ方式への移行）、Issue #1 の追記（`intents/260920-apigw-account-docs/`）、`aidlc/spaces/default/memory/project.md` の X1・C12。加えて、後段のステージが要件を破る・覆すと決めた記録: 3 つの intent の `*.md`（`audit/` を除く）で、要件 ID（`FR-`・`NFR-`・`C-`・`A-`・`OQ-` ＋数字）と「破る|破って|逸脱|反する|覆」が同じ行に現れるもの（本 spec の時点で 20 行。例: `code-generation-plan.md` の「C-4 / FR-5.7 … 明確に破る」）。
2. **コードのコメントが自己申告する逸脱** — `packages/`・`infra/` のコメントのうち、5 本の文書に対する逸脱・差分を述べるもの。
3. **`.claude/rules/` の規則のうち、正本の記述を補正するもの** — `frontend.md`・`aws-infra.md`。
4. **`requirements.md` の状態欄と決定済みの仕様** — Open Questions・Assumptions・Constraints・Out of Scope・NFR の状態、および `CLAUDE.md` § 決定済みの仕様と移行 spec の決定。
5. **AI-DLC の工程の残骸** — 冒頭の Stage・Depth・Test Strategy の行、`requirements.md` の `## Review` 節、IAM 設計メモの「本書の位置づけ」（承認ゲートを通っていない設計提案）。

**直し方**

- 訂正は二層で記録する: 冒頭の正本注記に全体像、各箇所に来歴（「Issue #26 により 2026-09-24 訂正」）。
- 役目を終えた節は削除せず「不採用」「解決済み」と明記する（節番号の参照を保つ）。例: IAM 設計メモ 3.5（RDS/Aurora の場合）は「不採用（OQ-2 で DynamoDB に確定）」。
- 例外: 工程の残骸（源泉 5）のうちコードから参照されないもの（`## Review` 節、Stage 行）は削除し、削除したことを正本注記に記録する。
- 源泉が実装・コメントだけで結論を確定できないもの（例: `MatrixGrid.tsx` のコメントは自ら「要確認」と書く）は直さない。正本注記の「未決」に列挙し、PR を出す前に選択肢を添えて依頼者の判断を仰ぐ（`CLAUDE.md` § 進め方の原則「設計判断や要件変更を伴うものは直さず」）。

**照合しないもの**: 5 つの源泉に当たらない本文（画面の文言・レイアウト・状態の網羅など）。正本注記に「未照合」と明記し、その箇所に触れる Issue が照合する。

### 3.3 参照の張り替え

| 箇所 | 変更 |
|---|---|
| `README.md` 構成表 | `docs/design` 行（要件・画面・IAM 設計の正本）を足す |
| `README.md` クロスアカウント構成の段落（現 230 行目） | 参照先を `docs/design/iam-policy-design-note.md` の 3.3 節にする |
| `README.md` § 設計の記録 | 表のパスを `docs/design/` にする。`aidlc/` は 2026-09-23 までの経緯として 1 文で案内する |
| `CLAUDE.md` § 記録の場所 | 「要件・画面設計・IAM の設計判断」の案内を `docs/design/` にする。`aidlc/` は根拠・経緯を読む用途に限る旨は維持 |
| `.claude/rules/frontend.md` 本文 1 行目 | 画面仕様の場所を `docs/design/mockups.md`・`interaction-spec.md` にする |
| `aidlc/README.md` | 冒頭に追記: 5 本は `docs/design/` が正本で、`aidlc/` 内の同名ファイルは凍結した経緯。追記には来歴を付ける |
| 行番号参照 5 行（`requirements.md` L84） | `requirements.md` § Assignment と ChangeRequest の関係（`packages/api/src/repository/change-request.ts`、`services/apply-service.ts` の 2 行、`services/apply-service.test.ts` の 2 行） |
| 行番号参照 1 行（`interaction-spec.md` L37） | `interaction-spec.md` § FR-7.1 の「モーダルの Escape」（`packages/web/src/components/GuardedModal.tsx`） |
| `infra/main.tf` の `self_role_arns` 直前のコメント | 「`requirements.md` FR2.1」を Issue #1 の要件書のフルパス（`aidlc/spaces/default/intents/260920-apigw-account-docs/inception/requirements-analysis/requirements.md` FR2.1）にする。本体の FR-2.1 と取り違えないため |

**書き換えないもの**

- 残りのファイル名だけの参照（`packages/`・`infra/` の 61 行 / 35 ファイル）。3.1 の規約で `docs/design/` を指す。
- 5 本以外の凍結文書への参照（`cicd-pipeline.md`・`deployment-strategy.md`・`rollback-runbook.md`・`monitoring-design.md`・`infrastructure-specification.md`）。切り出す Issue が張り替える。

**GitHub**: #4・#5・#24 に「#26 の規則で文書を切り出してから直す」旨のコメントを付けるかは、実装の最後に文面を示してから確認する。

### 3.4 更新規則（`CLAUDE.md`）

**「開発フロー」に足す**

1. brainstorming では、変更が触れる FR・画面・IAM の記述を `docs/design/` で確かめてから設計する。
2. spec は「正本への反映」節を必ず持ち、覆す・足す ID・節を列挙する。該当が無ければ「なし」と書く（確認を飛ばしたのか、該当が無かったのかを区別するため）。bounded ではチャットの設計に同じ列挙を含める。正本の更新は plan のタスクに含め、実装と同じ PR で行う。
3. 正本に無い凍結文書を訂正・変更するときは、`docs/design/README.md` の手順でその文書を切り出してから直す。`aidlc/` は書き換えない。

**「記録の場所」に足す**

- 設計の正本は `docs/design/` と `packages/api/TABLE-DESIGN.md`。ファイル名だけの参照は `docs/design/` を指す。
- 正本の ID は変えない。削除は欠番、追加は末尾。

既存の原則（食い違いの grep 総当たり、二層の来歴、見つけた不具合はその場で直し設計判断は人間へ）は正本にもそのまま適用し、新しい規則は足さない。

brainstorming の spec の雛形は「正本への反映」節を持たない。`CLAUDE.md` の指示は skill より優先されるため、この規則で補う。

### 3.5 検証

PR を出す前:

1. **凍結**: `git diff --stat main -- aidlc/` に出るのが `aidlc/README.md` だけ。
2. **ID の保存**: 複写元と正本から ID を抽出し、複写元の ID がすべて正本にある。対象は `requirements.md` の FR・NFR・C・A・OQ、`interaction-spec.md` の GI、`mockups.md` の画面番号、`iam-policy-design-note.md` の節番号。
3. **食い違いの訂正**: plan の食い違い一覧の 1 件ごとに、訂正後の文言の grep（正本に存在）と来歴「Issue #26」の grep（その箇所に存在）を対にして通す。古い結論（プレフィックス方式・4 ロールなど）が来歴付きの経緯以外に残らない。
4. **工程の残骸**: `docs/design/` に `## Review`・`**Stage**`・`**Depth**` が 0 件。
5. **行番号参照**: `aidlc/`・`docs/superpowers/` を除き、`<ファイル名>.md L<数字>` 形式の参照が 0 件。
6. **パス参照の実在**: README・`CLAUDE.md`・`.claude/rules/`・`aidlc/README.md`・`docs/design/` と、`packages/`・`infra/`・`.github/` のコメントから `docs/design/…` と `aidlc/…` のパスを抽出し、`tr -d '\r'` のうえ全件 `test -e` を通る。
7. **ファイル名参照の行き先**: ファイル名だけの参照に付く節名・ID（「画面 2」「§ 入力検証」「3.4」「GI-4」など）を抽出し、正本に存在する。抽出できない散文の参照は一覧にして目視で確かめ、それぞれの件数を報告する。
8. **回帰**: `npm run lint`・`npm run typecheck`・`npm run test`（`packages` のコメントを変えるため）。`infra/main.tf` を変えるため `terraform fmt -check -recursive`・`terraform validate`・`./.github/scripts/plan-guard.test.sh`・trivy（0.73.0、`CLAUDE.md` の引数）。gitleaks（8.30.1、`CLAUDE.md` の引数）は常に。
9. **未決**: 正本注記の「未決」に残った項目は、PR を出す前に依頼者が決める。

merge 後:

10. 次に #19 を brainstorming で始めたとき、`docs/design/` を読んで FR-3.1 と Data Model の記述を「正本への反映」節に挙げられる。移行 spec の成功基準「#17〜#19 を brainstorming → writing-plans → 実装の流れで扱える」もここで実地に確かめる。

## 4. 正本への反映

本 spec が正本（`docs/design/`）を新設する。既存の正本は無いため、覆す記述はなし。

## 付録 A: 本 spec の時点で把握している食い違い（網羅ではない）

| 源泉 | 文書 | 項目 | 現行 |
|---|---|---|---|
| 1 | `iam-policy-design-note.md` | 3.2 の `Resource` と 2026-08-01 追記「プレフィックス方式で決着」 | タグ方式（`role/*` ＋ `aws:ResourceTag/<managed_tag_key>` 条件）。`iam:TagRole` は誰にも付与しない |
| 1 | `iam-policy-design-note.md` | `DenySelfEscalation` の対象（例は 3 ロール、追記は 4 ロール） | 5 ロール（`apigw-logs` を含む。Issue #1） |
| 1 | `iam-policy-design-note.md` | CRUD 系統の IAM 権限 | タグ方式への移行後は `iam:ListRoleTags` を持つ（`infra/lambda.tf` の `crud_iam_read_tags`） |
| 1 | `requirements.md` | FR-5.7・C-4（登録時に AWS へ問い合わせない・実在検証をしない） | ロール登録時に `iam:ListRoleTags` で管理対象タグを検証し、`NoSuchEntity` は 400 で拒否する。code-generation の質問 11 = A で FR-5.7・C-4 を破ると決定済み（`code-generation-plan.md`） |
| 1 | `iam-policy-design-note.md` | § 4「未解決 — Resource 絞り込みと FR-2.1 の衝突」 | 解決済み（タグ方式） |
| 2 | `design-system-mapping.md` | TopNavigation の使い方 | `AppShell.tsx` が逸脱を自己申告（children スロットで構成） |
| 2 | `design-system-mapping.md` | 交点セルの Cloudscape `Checkbox` | `MatrixGrid.tsx` はネイティブの checkbox（コメントが「要確認」と書くため未決の候補） |
| 3 | `interaction-spec.md` | GI-8（300ms 以下） | `frontend.md`: Cloudscape 由来の 3 件は reduced-motion で停止することをもって充足 |
| 4 | `requirements.md` | OQ-1（アクセス制限の手段）・FR-6.1 | Basic 認証（`packages/edge-auth`、Lambda@Edge） |
| 4 | `requirements.md` | OQ-2・A-1（DynamoDB か RDS か） | DynamoDB（`packages/api/TABLE-DESIGN.md`） |
| 4 | `requirements.md` | OQ-5（IAM ユーザ削除を範囲に含めるか） | 実装済み（`DELETE /pools/:poolId/users`） |
| 4 | `requirements.md` | OQ-7・A-7（ChangeRequest の保持期間・件数上限） | 上限なし（`CLAUDE.md` § 決定済みの仕様） |
| 4 | `requirements.md` | C-6 と Out of Scope の CI/CD・operation の行（poc で SKIP） | 実施済み（`.github/workflows/ci.yml`・`cd.yml`、operation の記録） |
| 4 | `requirements.md` | NFR-5（新規テストの下限を課さない） | アプリコードは TDD（移行 spec 2 節） |
| 5 | `requirements.md` | 冒頭の Stage・Depth・Test Strategy、`## Review` 節 | 削除 |
| 5 | `iam-policy-design-note.md` | 「本書の位置づけ」（承認ゲートを通っていない設計提案） | 正本として位置づけ直す |
