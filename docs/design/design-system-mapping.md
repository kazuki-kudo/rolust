# Design System Mapping — Rolust × AWS Cloudscape

> **追記**（Issue #93 により 2026-10-08）: 画面名と操作の表示名を改めた。ID と節番号は変えない。画面 1「ユーザプール」→「IAMユーザ」、画面 2「IAMロール」→「IAMロール管理」、画面 3「割り当てマトリクス」→「IAMロール割り当て」、「ユーザを登録」→「ユーザを新規登録」、「ロールを登録」→「ロールを新規登録」、属性の「編集モード」→「属性一括編集モード」、「属性列を編集」→「属性の項目を編集」、IAMユーザ・IAMロールの行の「削除」→「登録を解除」（AWS 上の信頼ポリシーには触れない動作は変えない）、IamUser・IamRole の表示 → IAMユーザ・IAMロール、principal の表示 → プリンシパル。コード識別子とドメイン用語（UserPool・IamUser・属性列など）は変えない。
> **正本注記**（Issue #26 により 2026-09-24 追記）
>
> - **位置づけ**: 本書は Rolust の画面とコンポーネントを Cloudscape の部品に対応づける正本である。変更は `CLAUDE.md` § 開発フロー の規則に従い、実装と同じ PR で行う。
> - **複写元**: `aidlc/spaces/default/intents/260728-rolust-iam-trust/inception/refined-mockups/design-system-mapping.md`（refined-mockups (2.5) の成果物、2026-09-24 複写）。複写元は凍結した経緯として残る。
> - **照合の範囲**: `docs/superpowers/specs/2026-09-24-living-design-docs-design.md` 3.2 の 5 つの源泉から列挙した食い違いを `packages/web` の実装で照合して訂正した。それ以外の記述は照合していない（未照合）。
> - **訂正の全体像**: Stage の行と `## Review` 節を削除した。TopNavigation の行にナビゲーション項目の描き方を追記した。FR-7.3 の自前構成図で、ツールバーを画面側へ移し、SkipToActions を加えた。交点セルと列ヘッダのチェックをネイティブの checkbox に改め、構成図と Component Inventory を `MatrixGrid.tsx` の実装に合わせた（X-1）。
> - **未決**: なし（X-1 は依頼者の判断で解決した。下記）。
> - ソースタグの所在は `docs/design/README.md` にある。
>
> **訂正**（Issue #108 により 2026-10-05）: UserPool をデプロイにつき固定の 1 つに改めた。FR-7.1 の「プールのカード一覧」（`Cards`）・「プールを作成」・名前を変更モーダル・「削除」と削除の確認モーダルの部品を外し、IamUser の表 1 枚とページヘッダのボタン（「ユーザを登録」「属性列を編集」「ロールの紐づけ」）にした。FR-7.3 の UserPool 選択（`Select`）を外した。`LinkRolesModal` の `isItemDisabled` から、ほかのユーザプールに紐づくロールの条件を外した。
>
> **解決済み**: 交点セルの部品（X-1。Issue #26 により 2026-09-24 訂正）。複写元は交点セルと列ヘッダのチェックに Cloudscape の `Checkbox` を割り当てていたが、`MatrixGrid.tsx` はネイティブの `<input type="checkbox">` を使っていた（コメントに「本ステージでの逸脱・要確認」）。a11y の Must（M-1.2 / M-1.3。ローミング tabindex で、ヘッダ行を含むマトリクス全体の Tab 停止点を 1 つにする）に `tabIndex` の直接制御が要り、Cloudscape の `Checkbox` がそれを公開していないためである。`interaction-spec.md` の AssignmentMatrix § Accessibility もネイティブを前提にしていた。2026-09-24 に依頼者がこの逸脱を正式に採ると決め、本書を実装に合わせた。
>
> **追記**（Issue #15 により 2026-09-24）: FR-7.1 の「プールのカード一覧」と「カード内のアカウント別一覧」に、カードの段組みとユーザ名の折り返しの指定を足した。
>
> **追記**（Issue #17 / #19 により 2026-09-25）: FR-7.1 に「編集」・編集モーダル・割り当て可能なロールの表を、FR-7.3 の UserPool 選択に選択肢の表示を足した。
>
> **追記**（Issue #35 により 2026-09-25）: FR-7.1 の「割り当て可能なロールの表」の `isItemDisabled` の条件に、ほかのユーザプールに紐づくロール（`linkedElsewhere`）を足した。
>
> **追記**（Issue #18 により 2026-09-27）: FR-7.1 にユーザプールの「削除」と確認モーダルの部品を足した。
>
> **訂正**（Issue #46 により 2026-09-27）: FR-7.1 の「編集」と編集モーダルを、「名前を変更」とそのモーダル、「ロールの紐づけ」とそのモーダルに分けた。FR-7.3 にツールバーの「ロールの紐づけ」を足した。
>
> **追記**（Issue #21 により 2026-09-27）: FR-7.2 のロール一覧を 4 列にし、登録モーダルの説明欄と説明セルの編集モーダルを足した。
>
> **追記**（Issue #79・#80 により 2026-09-30）: FR-7.1 のロールの紐づけモーダルの `isItemDisabled` の条件を「未反映の申請がある、またはほかのユーザプールに紐づく」に改め、割り当てが残るロールの解除の確認表示（`Alert` とフッターの `Button` 2 つ）と、保存の警告の `Flashbar` を足した。
>
> **訂正**（Issue #22 により 2026-10-02）: FR-7.2 のロール一覧を 5 列にし（訂正前は 4 列）、行の「削除」と確認モーダルの部品を足した。
>
> **追記**（Issue #88 により 2026-10-03）: FR-7.3 のツールバーに「変更を取り消す」（`RevertChangesModal`）を足した。
>
> **追記**（Issue #61 により 2026-10-03）: FR-7.1 に、属性列があるプールの表（1 ユーザ 1 行、列は動的）、「属性を編集」「属性列を編集」、2 つのモーダル、列削除の警告の部品を足した。要件は FR-1.9。

> **追記**（Issue #98 により 2026-10-04）: FR-7.1 の「ユーザを登録」モーダルに、`SegmentedControl`（登録の方法の切り替え）と CSV の `Textarea` の部品対応を足した。既存の記述は覆さない。設計は spec `docs/superpowers/specs/2026-10-04-user-csv-import-design.md`。

> **追記**（Issue #207 により 2026-11-01）: CSV の入力欄の `Textarea` に、ヘッダ行を初期値として入れる記述を足した。部品は変えない。設計はチャットで承認した（bounded のため spec なし）。

> **追記**（Issue #107 により 2026-10-04）: FR-7.3 の MatrixGrid に、属性列の `th`／`td`（自前）と、メニューの殻を一般化した `ColumnMenu`（ロール列用・属性列用のラッパー）を足した。既存の記述は覆さない。設計は spec `docs/superpowers/specs/2026-10-04-matrix-user-attributes-design.md`。

> **追記**（Issue #106 により 2026-10-04）: FR-7.3 に、ユーザの絞り込み欄（Cloudscape `Input`）の部品対応を足した。設計は Issue #106 のチャットでの承認による（bounded のため spec は無い）。

> **追記**（Issue #91 により 2026-10-04）: FR-7.3 の MatrixGrid に、列ヘッダのソート・フィルタのメニュー（自前の `ColumnMenu`。`ButtonDropdown` を使わない理由を X-1 と同じ形で書いた）を足し、固定（sticky）の基準をマトリクスの内側のスクロール領域に改めた（縦の固定が効いていなかった来歴）。設計は spec `docs/superpowers/specs/2026-10-04-matrix-sort-filter-design.md`。

> **訂正**（Issue #105 により 2026-10-04）: FR-7.3 の MatrixGrid の列の背景色を、ヘッダの `th` だけに改めた。設計は Issue #105 のチャットでの承認による（bounded のため spec は無い）。

> **追記**（Issue #100 により 2026-10-04）: FR-7.1 のロールの紐づけモーダルに並び順のリスト、FR-7.2 のロール一覧に背景色の列と色の編集モーダル、FR-7.3 の MatrixGrid に列の背景色の部品対応を足した。既存の記述は覆さない。設計は spec `docs/superpowers/specs/2026-10-04-matrix-role-order-color-design.md`。

> **訂正**（Issue #109 により 2026-10-05）: FR-7.5 の状態フィルタを、状態・作成時刻の日付範囲・対象ロールの検索条件に改めた。

> **追記**（Issue #128 により 2026-10-06）: FR-7.5 の申請一覧の `Table` から「変更」の列を外して 7 列にし、状態の幅を狭め、対象ロールの幅を広げて折り返さないようにした。

> **追記**（Issue #117 により 2026-10-06）: FR-7.5 の申請一覧の `Table` を 8 列にし（反映日を追加）、「作成時刻」を「作成日」に改めた。

> **追記**（Issue #117 により 2026-10-05）: FR-7.5 の検索条件に、反映日の `DateRangePicker` を足した。

> **追記**（Issue #116 により 2026-10-06）: FR-7.5 の作成日の `DateRangePicker` に、初期値（今日から 3 か月前〜、終端なし）と、「下書き・失敗は対象外」のラベルを足した。`Pagination` は付けないまま。

> **追記**（Issue #104 により 2026-10-06）: FR-7.1 の IamUser の表に、絞り込み欄の `TextFilter` と列見出しの並べ替え（`sortingColumn`）を足した。`PropertyFilter` は採らない。

> **追記**（Issue #103 により 2026-10-06）: FR-7.1 の IamUser の表に、属性の編集モードの部品（表の上の行の「編集モード」「キャンセル」「保存」、セルの `Input`、一部失敗の `Alert`、破棄確認の `Modal`）を足した。

> **訂正**（Issue #120 により 2026-10-05）: FR-7.5 の申請一覧の `Table` を 7 列にした（訂正前は 5 列）。作成者・反映者の列を足した。

> **追記**（Issue #133 により 2026-10-06）: FR-7.1 の IamUser の表（2 種）、FR-7.2 のロール一覧、FR-7.5 の申請一覧の `Table` に `stickyHeader` を付けた。画面 1（IamUser の表）・画面 2（ロール一覧）・画面 5（申請一覧）の表のヘッダ行を、縦にスクロールしても固定にした。Cloudscape `Table` の `stickyHeader` による（表の見出しと、あれば絞り込み欄が、トップナビの直下に付く）。あわせて、トップナビを画面上端に固定にした（設計は固定としていたが、実装が固定でなく、`AppLayout` が `headerSelector` のナビの高さだけ下げる固定ヘッダとの間に隙間ができていた）。ロールの紐づけモーダルの表は、スクロールの基準がページ側と別なので対象外。割り当てマトリクス（画面 3）は Issue #91 のとおり自前の固定で、変わらない。FR・GI の ID は変えず、足す FR は無い。

> **訂正**（Issue #135 により 2026-10-07）: 「ロールの紐づけ」を廃止した。FR-7.1 の「ロールの紐づけ」ボタン・`LinkRolesModal`（`GuardedModal` + `Form`）・割り当て可能なロールの表・並び順のリストと、FR-7.3 のツールバーの「ロールの紐づけ」の部品対応を外した。FR-7.2 に、「順」列・「並び順を編集」の `Button`・編集モードの行（`Box` + `Button`）・行の `Button variant="icon"`（「上へ」「下へ」）・移動の読み上げの `aria-live` の領域・破棄確認の `Modal` を足し、削除の確認モーダルに割り当ての `Alert` を足した。並び順の移動の部品の構成（自前の `aria-live` の領域と `Button variant="icon"`。Cloudscape に並べ替えリストの部品が無い）は、Issue #100 のものを画面 2 の `Table` の行へ移した。設計は spec `docs/superpowers/specs/2026-10-07-auto-link-roles-design.md`。
> **追記**（Issue #145 により 2026-10-07）: FR-7.5 の申請一覧の `Table` を 8 列にし（申請 ID を追加。対象ロールの右、幅 120px。先頭 9 文字の短縮表示）、検索条件に `Input type="search"`（申請 ID）を足した。
> **追記**（Issue #148 により 2026-10-07）: FR-7.5 の申請一覧の申請 ID の列を幅 160px（最小 145px）にし、「URL をコピー」（`CopyToClipboard variant="icon"`）を操作列から移した。操作列は 180px。
> **追記**（Issue #94 により 2026-10-15）: 画面の表示言語を日本語と英語にした（FR-8）。共通シェルの表に、トップナビの言語切替（`ButtonDropdown`）と Cloudscape の部品の文言（`I18nProvider`）を足し、Naming Conventions に英語表示の扱いを足した。ID と節番号は変えない。
> **追記**（Issue #170 により 2026-10-15）: FR-7.2 に、信頼ポリシーの乖離の確認（FR-4.9）の部品（確認のボタン・「信頼ポリシー」列・結果のサマリ・乖離の詳細モーダル）を足した。いずれも既製の Cloudscape 部品で賄える。
> **追記**（Issue #172 により 2026-10-16）: FR-7.2 に、乖離の詳細モーダルの 2 つの操作（`PermissionButton`）・確認の状態（同じ `Modal` 内の `Alert type="warning"` とフッタの切り替え。2 枚目の `Modal` にしない。GI-10）・結果の `Alert` を、FR-7.4・FR-7.5 に種別の表示（`Box`）を足した（FR-4.10・FR-4.11）。いずれも既製の Cloudscape 部品で賄える。
> **追記**（Issue #206 により 2026-11-01）: FR-7.2 に、「信頼ポリシーを確認」のキャプション（`Box variant="small"`）を足した。既製の Cloudscape 部品で賄える。
> **訂正**（Issue #232 により 2026-11-03）: Issue #206 のキャプション（見出し行の下に常時表示）を、「信頼ポリシーを確認」の右隣の「i」（`Popover` のトリガー）を押したときだけ出す吹き出しに改めた。説明の文言は変えない。既製の Cloudscape 部品（`Popover`・`Button variant="inline-icon"`）で賄える。
> **訂正**（Issue #225 により 2026-11-02）: 共通シェルのトップナビの行を、実装に合わせて訂正した。訂正前は「`identity` にブランド名 `ROLUST`」としていたが、`children` を渡すと Cloudscape は `identity` を無視する（開発時に警告が出る）ので、ブランドは `children` の `<span>` で描いている。あわせて、ブランドを右隣の画面名と見分けやすくした（18px・縦線）。見た目の変更だけで、FR・GI の ID は変えず、足す部品も無い。

**Design System**: AWS Cloudscape Design System（`@cloudscape-design/components`、React 前提） [Q1]
**Companion**: `mockups.md`／`interaction-spec.md`／`accessibility-checklist.md`

本書は `mockups.md` が定めた 5 画面と `interaction-spec.md` が定めたコンポーネントを、Cloudscape の実在部品に対応づける。上流は `requirements.md`（`wireframes` / `user-flow` / `stories` は不在）、`team-practices` 不在のため命名規約は `org.md` の `## Code Style`（プロジェクトの linter / formatter 設定に従う）にフォールバックする。

## 採用の前提

| ID | 前提 | Source |
|---|---|---|
| DS-1 | Cloudscape は React コンポーネントライブラリであり、C-2（SPA）と整合する | [Q1][FR: C-2] |
| DS-2 | Cloudscape はデスクトップの管理コンソールを想定して設計されており、Q3=`A`（デスクトップ専用 1024px 以上）と整合する | [Q1][Q3] |
| DS-3 | Cloudscape は WCAG 2.1 AA を前提に作られている。既製部品を使う限り、Q2=`C` が求める Must（キーボード操作・ラベル）は自動的に満たされ、Best-effort 側も相当程度が付いてくる | [Q1][Q2][AN-2] |
| DS-4 | Cloudscape の `Pagination` は使わない。NFR-1 がページングの作り込みを禁じている。部品が存在することと使うことは別である | [FR: NFR-1] |
| DS-5 | AWS のブランド資産（ロゴ、サービスアイコン）は使わない。Rolust は AWS の製品ではない | [derived] |

**バージョン検証の必要性**: 本書の部品名は Cloudscape の公開 API に基づくが、採用時点のバージョンで名称・プロパティが変わっている可能性がある。code-generation (3.5) の着手時に `context7` MCP でドキュメントを引き、本書の対応表を実 API と突き合わせること。突き合わせの結果は `MQ-5` として `## Open Questions` に置く。 [derived]

## Screen → Component Mapping

### 共通シェル

| 画面要素 | Cloudscape 部品 | 備考 |
|---|---|---|
| 全体レイアウト | `AppLayout` | `navigationHide` を有効にする。サイドナビは使わない（`mockups.md` の情報アーキテクチャ参照） |
| トップナビゲーション | `TopNavigation` | ブランド名 `ROLUST` とナビゲーション 4 項目は、すべて `children`（custom content）スロットに自前で描く。`identity` は指定しない（`children` と併用すると無視され、開発時に警告が出る）。ブランド名は `<span data-testid="brand">` で、見出し M（18px・太字）・トップナビのタイトル色・右に 1px の縦線（いずれも `@cloudscape-design/design-tokens` のトークン）で、右隣の画面名と見分ける（Issue #225 により 2026-11-02 訂正。訂正前は「`identity` にブランド名 `ROLUST`」）。`utilities` は使わない（設定オブジェクトの配列で `data-testid` を載せられず、現在地も表せない。管理者エンティティが無くユーザメニューも無い）（`AppShell.tsx`。Issue #26 により 2026-09-24 訂正）。`#rolust-top-nav` の div を `position: sticky; top: 0` にして画面上端に固定する（Issue #133 により 2026-10-06 追記。`AppLayout` が `headerSelector` の高さを表の固定ヘッダの位置に使うため） |
| ページ見出し | `Header` | `variant="h1"`、`description` に件数などの補助情報、`actions` に主アクション |
| コンテンツ枠 | `ContentLayout` + `Container` | |
| 縦積みの間隔 | `SpaceBetween` | 個別 margin を使わない |
| 通知帯 | `Flashbar` | 成功・エラーの一過性通知 |
| 常在の警告 | `Alert` | 除外警告など、消えない警告 |
| トップナビの言語切替 | `ButtonDropdown`（既定の見た目。`variant` は指定しない） | ボタンには現在の言語名だけを出し、項目は「日本語」「English」（各項目に `lang`）。`ariaLabel` は「言語 / Language: <現在の言語名>」で、見える文字を含める（WCAG 2.5.3）。右端に置き、ログアウトのリンクがあるときはその左（Issue #94 により 2026-10-15 追記） |
| Cloudscape の部品の文言 | `I18nProvider`（同梱の `all.ja` / `all.en`） | 選んだ言語に合わせて切り替える。ページネーションや絞り込みなど、部品が持つ文言が対象（Issue #94 により 2026-10-15 追記） |

### FR-7.1 IAMユーザ管理 （Issue #93 により 2026-10-08 改名）

| 画面要素 | Cloudscape 部品 | 備考 |
|---|---|---|
| 「IamUser の表」（Issue #108 により 2026-10-05 訂正。訂正前は「プールのカード一覧」で `Cards`） | `Table`（`variant="embedded"`） | 1 枚の表。属性列が 0 件ならアカウント ID ごとに 1 行、1 件以上なら 1 ユーザ 1 行（下の行）。`wrapLines` で折り返し、ユーザ名と「削除」は折り返さない 1 単位にする（Issue #15 により 2026-09-24 追記。`cardsPerRow` の指定はカードの廃止に伴い無くなった） |
| カード内のアカウント別一覧 | `Table` | 2 列（AWS アカウント / IAM ユーザ名）。`variant="embedded"`。ユーザ名と行内の「削除」を 1 ユーザずつ `white-space: nowrap` の要素にまとめる。`wrapLines` は外さない。外すとセルに `overflow: hidden` と省略記号が掛かり、列が狭まると「削除」ごと隠れうるため（Issue #15 により 2026-09-24 追記）。`stickyHeader`（Issue #133 により 2026-10-06 追記。トップナビの直下に固定。`AppLayout` の `headerSelector` が高さを与える） |
| 「ユーザを登録」（ページヘッダ） | `Button variant="primary"` | 「属性列を編集」（`variant="normal"`）と並べる（Issue #135 により 2026-10-07: 「ロールの紐づけ」は廃止した。Issue #108 により 2026-10-05 訂正。訂正前は「プールを作成」が primary で、「ユーザを登録」はカードの normal） |
| 作成・登録モーダル | `Modal` + `Form` + `FormField` | `FormField` の `errorText` にインライン検証結果 |
| アカウント ID 入力 | `Input` | （Issue #108 により 2026-10-05: プール識別子の入力は無い） |
| IAMユーザ名リスト入力 | `Textarea` | 改行区切り。`Multiselect` ではない — 候補集合が存在しない（C-4: 手入力のみ） |
| 登録の方法の切り替え（Issue #98 により 2026-10-04 追記） | Cloudscape `SegmentedControl`（`label`「登録の方法」。「1 件ずつ」「CSV」） | 排他の 2 択でタブほど大きくなく、モーダルの先頭に置ける。切り替えても入力は残す |
| CSV の入力欄（Issue #98 により 2026-10-04 追記） | Cloudscape `Textarea`（`spellcheck` なし）＋ `FormField`。形式の説明は `description`（データ行の例だけを出す。Issue #207 により 2026-11-01）、ヘッダ行は `Textarea` の初期値（Issue #207 により 2026-11-01 追記）、行番号つきのエラー一覧は `errorText`（`aria-live`） | 貼り付けが前提で、ファイルのアップロードは範囲外（spec 6） |
| ARN プレビュー | `Box variant="code"` | 導出結果の書式確認用（FR-1.2） |
| 空状態 | `Cards` の `empty` スロット | |
| 読み込み中 | `Cards` の `loading` + `loadingText` | |
| 「名前を変更」（カード） | （廃止。Issue #108 により 2026-10-05） | |
| 名前を変更モーダル | （廃止。Issue #108 により 2026-10-05。`RenamePoolModal` を削除した） | |
| 「ロールの紐づけ」・ロールの紐づけモーダル・並び順のリスト・割り当て可能なロールの表（旧） | （廃止。Issue #135 により 2026-10-07。`LinkRolesModal`（`GuardedModal` + `Form`）・並び順の `<ol>` と `Button variant="icon"`・複数選択の `Table` を削除した。並び順の部品は画面 2 の編集モードに移した。旧仕様は Issue #17・#19・#35・#46・#79・#80・#100・#108 の各 spec にある） | |
| 「削除」（カード） | （廃止。Issue #108 により 2026-10-05） | |
| 削除の確認モーダル（ユーザプール） | （廃止。Issue #108 により 2026-10-05。`DeletePoolModal` を削除した。IAM ユーザの削除の確認モーダルは残る） | |
| 属性列があるプールの表 | `Table`（`variant="embedded"`） | 1 ユーザ 1 行。列は「AWS アカウント」「IAM ユーザ名」＋属性列（動的。`columnDefinitions` を列の定義から組み立てる）＋「操作」。属性列が 0 件のプールは上のアカウント別一覧のまま。未設定の値は `—` を出す（Issue #61 により 2026-10-03 追記）。`stickyHeader`（Issue #133 により 2026-10-06 追記。トップナビの直下に固定。`AppLayout` の `headerSelector` が高さを与える） |
| 「属性を編集」「削除」（属性列がある表の操作列） | `Button variant="inline-link"` | ユーザの行ごとに 1 組（Issue #61 により 2026-10-03 追記） |
| 「属性列を編集」（ページヘッダ） | `Button variant="normal"` | ページヘッダのボタンの並びは「ユーザを登録」「属性列を編集」（Issue #135 により 2026-10-07 訂正。訂正前は、さらに「ロールの紐づけ」。Issue #61 により 2026-10-03 追記。Issue #108 により 2026-10-05 訂正。訂正前はカードのボタン） |
| 「属性列を編集」モーダル | `GuardedModal`（`Modal`）+ `Form` + `FormField` + `Input` | 列名ごとに `Input`、各行の削除は `Button variant="inline-link"`、「列を追加」は `Button`（10 列で無効）。列の削除の警告は `Alert type="warning"`。保存の失敗はモーダル内（`packages/web/src/screens/AttributeColumnsModal.tsx`。Issue #61 により 2026-10-03 追記） |
| 「属性を編集」モーダル | `GuardedModal`（`Modal`）+ `Form` + `FormField` + `Input` | IAM ユーザ名は読み取り専用、列ごとに `Input`（`packages/web/src/screens/UserAttributesModal.tsx`。Issue #61 により 2026-10-03 追記） |
| IamUser の絞り込み欄（Issue #104 により 2026-10-06 追記） | `Table` の `filter` スロットに `TextFilter`（`countText`「n 件の一致（全 m 件）」。ラベルは `filteringAriaLabel`） | `PropertyFilter` は過剰（軸が 1 つで、入力は自由テキスト。履歴の検索条件と同じ判断）。属性値の完全一致の選択肢も設けない。IamUser が 0 件のときは欄を出さない（`PoolScreen.tsx`、純関数は `pool-view.ts`） |
| IamUser の表の並べ替え（Issue #104 により 2026-10-06 追記） | `Table` の `sortingColumn`・`sortingDescending`・`onSortingChange`（制御。並べ替えは自前の純関数） | Cloudscape は昇順と降順しか返さないため、降順の列をもう一度押したら解除して既定の並びに戻す。アカウント別の表（属性列 0 件）は「AWS アカウント」列だけに `sortingField` を付ける |
| 絞り込みで 0 件の空表示（Issue #104 により 2026-10-06 追記） | `Table` の `empty` スロットに `Box` + `Button`（「条件をクリア」） | IamUser が 0 件の空表示とは別の要素（`data-testid` も別） |
| 「編集モード」「キャンセル」「保存」（Issue #103 により 2026-10-06 追記） | `Table` の `filter` スロットの右端に `Button`（「編集モード」と「キャンセル」は `variant="normal"`、「保存」は `variant="primary"` で `loading`・`loadingText`） | 絞り込み欄と同じ行に置く。ほかの更新系の操作は編集モードの間 `disabled`。1 画面に primary は 1 つ（GI-9）なので、編集モードの間はページヘッダの「ユーザを登録」を `variant="normal"`（`disabled`）に落とし、表の「保存」を唯一の primary にする（`PoolScreen.tsx`） |
| 編集モードのセル（Issue #103 により 2026-10-06 追記） | `Input`（`ariaLabel`「<ユーザ名> の <列名>」、`invalid`、保存中は `readOnly`）＋エラー文の `Box`（`color="text-status-error"`） | Cloudscape `Table` のインライン編集（`editConfig`）はセルごとに確定する操作で、表全体の「保存」と合わない。このため `cell` に `Input` を置く。`disabled` にしない（フォーカスを失うため） |
| 一部失敗の警告（Issue #103 により 2026-10-06 追記） | `Alert type="error"` ＋ `action` に `Button`（「失敗した n 人を再送」） | 表の上に出す。行ごとの理由は操作列に `Box`（`text-status-error`）で出し、「保存済み」は `text-status-success` |
| 編集モードの破棄確認（Issue #103 により 2026-10-06 追記） | `Modal`（確認用。入力欄が無いので `GuardedModal` は使わない）＋ `Button` 2 つ（「編集に戻る」「破棄」／「破棄して移動」） | Escape と × は「編集に戻る」（`PoolScreen.tsx`） |

### FR-7.2 IAMロール管理

| 画面要素 | Cloudscape 部品 | 備考 |
|---|---|---|
| ロール一覧 | `Table` | 7 列（順 / AWS アカウント / ロール名 / 未反映の申請 / 説明 / 背景色 / 操作。Issue #135 により 2026-10-07 訂正: 先頭に「順」列を足した。訂正前は 6 列。編集モードの間だけ、操作の前に「移動」列が加わる。Issue #21 により 2026-09-27 追記。Issue #22 により 2026-10-02 訂正: 「操作」列を足した。Issue #100 により 2026-10-04 訂正: 「背景色」列を足した。訂正前は 5 列）。`stickyHeader`（Issue #133 により 2026-10-06 追記。トップナビの直下に固定。`AppLayout` の `headerSelector` が高さを与える） 「信頼ポリシー」列（「未反映の申請」の次）を足した（Issue #170 により 2026-10-15 追記。確認前は `—`、確認後は記号と文字を併記したテキスト。乖離・読み取り失敗の行は `Button variant="inline-link"` の「詳細」を添える）。「操作」列は、行の「登録を解除」が日本語・英語のどちらでも、また並び順の編集モード（「移動」列が加わる）でも折り返されないよう、幅 128px・最小幅 128px にする（Issue #229 により 2026-11-03 追記。実ブラウザの幅 1024px で、112px では英語が 2 行になり、120px で 1 行に収まった値に余裕を足した。IAMユーザの表のように `white-space: nowrap` の要素で包んでも効かない。Cloudscape のボタンが自身で `white-space: normal` を持つため） |
| 未反映の申請セル | `StatusIndicator` | `type="warning"`（下書き）/ `type="error"`（失敗）/ 未反映なしは `-` のテキスト |
| 状態から申請履歴への遷移 | `Link` | |
| 「ロールを登録」 | `Button variant="primary"` | 並び順の編集モードの間は `variant="normal"` で無効にし、「保存」を唯一の primary にする（GI-9。Issue #135 により 2026-10-07 追記） |
| 「並び順を編集」（ヘッダ。2 件以上のときだけ。Issue #135 により 2026-10-07 追記） | `Button variant="normal"` | 「ロールを登録」の左。編集モードの間は無効 |
| 並び順の編集モードの行（Issue #135 により 2026-10-07 追記） | `Box variant="strong"`（「並び順を編集中」）+ 変更件数のテキスト + `Button`（「キャンセル」）+ `Button variant="primary"`（「保存（n 件）」。保存中は `loading`） | 表の上に出す（`RolesScreen.tsx`。ロジックは `hooks/useRoleOrderEditMode.ts`）。画面 1 の編集モード（#103）と同じ型 |
| 行の「上へ」「下へ」（編集モード。Issue #135 により 2026-10-07 追記。Issue #100 の並び順のリストから移した） | `Button variant="icon"`（`iconName="angle-up"` / `"angle-down"`。`ariaLabel` は「<ロール名> を上へ / 下へ」）を「移動」列に置く | Cloudscape に並べ替えリストの部品が無い（`ButtonDropdown` などで代替しない）ため、`Table` の列に `Button` を置く。移動の読み上げは `aria-live="polite"` の自前の領域（画面外に置く）。動かした後のフォーカスは、同じロールの同じ向きのボタンへ戻す |
| 並び順の保存の失敗 | `Alert type="error"`（表の上） | 編集モードに留まり、下書きを保つ |
| 並び順の編集モードの破棄確認（Issue #135 により 2026-10-07 追記） | `Modal` + `Box` + `Button` 2 つ（「編集に戻る」「破棄」/「破棄して移動」） | 入力欄を持たない確認なので Escape は「編集に戻る」（GI-4）。画面 1 の編集モードの破棄確認と同じ構成 |
| 登録モーダル | `Modal` + `Form` + `FormField` + `Input` | 説明欄も同じ `Input`（任意。Issue #21 により 2026-09-27 追記） |
| 説明セルの「編集」（Issue #21 により 2026-09-27 追記） | `Button variant="inline-link"` + 編集モーダル（`Modal` + `Form` + `FormField` + `Input`） | ロールの説明の編集モーダル（`Modal` + `Form` + `FormField` + `Input`）。ほかの小さな編集モーダルと同じ構成 |
| 背景色の列とセルの「編集」（Issue #100 により 2026-10-04 追記） | `Table` の列「背景色」（色の見本は自前の `span`（`aria-hidden`）+ 色名のテキスト）+ `Button variant="inline-link"` | 一覧は 6 列になる（説明と操作の間。`RolesScreen.tsx`） |
| 色の編集モーダル（Issue #100 により 2026-10-04 追記） | `GuardedModal`（`Modal`）+ `Form` + `FormField` + `Tiles`（「なし」と 8 色） | `EditRoleColorModal.tsx`。「保存」は変更があるときだけ有効。パレットの色はライトテーマだけを定める（本書はダークモードを扱わない。Design Tokens と同じ） |
| 操作セルの「削除」（Issue #22 により 2026-10-02 追記） | `Button variant="inline-link"`（`ariaLabel` は「<ロール名> を削除」）+ 確認モーダル（`Modal` + `Alert type="warning"` + `Link`。割り当てが残るときは、本文の先頭にもう 1 つの `Alert type="warning"`。Issue #135 により 2026-10-07 追記） | IAM ユーザの削除の確認モーダルと同じ構成。削除できないときの理由は `Alert type="warning"`、直し方は `Link`（`onFollow` でモーダルを閉じて遷移）。失敗は `Alert type="error"`（Issue #135 により 2026-10-07: 紐づきは削除できない理由ではなくなり、割り当てマトリクスへのリンクを外した。確定ボタンは、割り当てが残るときは「割り当てごと削除」） |
| 「信頼ポリシーを確認」（ヘッダ。Issue #170 により 2026-10-15 追記） | `Button variant="normal"`（`loading`・`loadingText`） | 参照（`view`）で押せるので `PermissionButton` にしない。並び順の編集モードの間は無効。primary は「ロールを登録」のまま（GI-9） |
| 「信頼ポリシーを確認」の説明（「i」を押すと出る吹き出し。Issue #206 により 2026-11-01 追記。Issue #232 により 2026-11-03 訂正。訂正前は、見出し行の下に常時表示する `Box variant="small" color="text-body-secondary"` のキャプション） | `Popover`（`triggerType="custom"`・`position="bottom"`・`size="large"`・`dismissAriaLabel`）。トリガーは `Button variant="inline-icon" iconName="status-info"`、中身は `Box variant="small"` | 「信頼ポリシーを確認」の右隣に置く（`SpaceBetween size="xxxs"` の組。ボタンの枠どうしは 2px）。組と「並び順を編集」の間は 25px（依頼者の指定。`SpaceBetween` の間隔は 20px か 24px なので、flex の `column-gap` で置く）。「並び順を編集」と「ロールを新規登録」の間は 8px のまま。吹き出しは結果のサマリの `aria-live` の領域の外にある。`aria-describedby` では結ばない（乖離の詳細モーダルの 2 操作のヒントと同じ扱い）。編集モードの間も使える |
| 確認結果のサマリ（表の上。Issue #170 により 2026-10-15 追記） | `Alert`（`type` は success / warning / info。`dismissible`） | `aria-live="polite"` の領域に出す。API 自体の失敗は `Alert type="error"`（エラーコード併記） |
| 乖離の詳細モーダル（Issue #170 により 2026-10-15 追記） | `Modal` + `SpaceBetween` + `Box` + `<ul>`・`<code>` | 一覧は読み取り専用。フッタは「閉じる」だけ。破棄確認は要らない（Issue #172 により 2026-10-16 追記: 乖離のあるロールには、本文の下に直す 2 操作を足した。フッタは変えない） |
| 乖離を直す 2 つの操作（詳細モーダルの本文。Issue #172 により 2026-10-16 追記） | `PermissionButton`（`need="edit"`。`Button` に `disabledReason`）× 2 + 各ボタンの下に `Box variant="small"`（意味の 1 文） | `loading`・`loadingText`（「申請を作成中」「記録を更新中」）。実行中は 2 つとも `disabled`。どちらも primary にしない（GI-9。詳細モーダルの「閉じる」が primary）。`DriftRepairActions.tsx` |
| 直す操作の結果（同） | `Alert`（`type` は info（乖離なし・未反映の申請あり）/ warning（一部失敗。失敗したユーザの ARN の `<ul>` つき）/ error（API の失敗。エラーコード併記。GI-6）） | 詳細モーダルの本文の中。専用の `aria-live` の領域は足さない |
| 「記録を IAM に合わせる」の確認（同） | 詳細モーダルの本文の先頭に `Alert type="warning"`（`header` は「<ロール名>: 記録を IAM に合わせる」）+ `SpaceBetween` + `Box` + `<ul>`・`<code>`。フッタは `Button` 2 つ（「キャンセル」「記録を合わせる」。後者は primary にしない。`loading`）に切り替える | 2 枚目の `Modal` にしない（GI-10。`GuardedModal` と同じく、同じモーダルの中で状態を切り替える）。確認中の Escape・背景クリック・×・キャンセルは、確認だけを取り消す（詳細モーダルの `onDismiss` を切り替える）。確認へ入るとキャンセルへ、出ると起点のボタンへフォーカスを移す（`Button` の `ref`）。本文はアンマウントしない。`useDriftRepair`・`DriftDetailModal.tsx`・`AdoptConfirmPanel.tsx` |
| 「再確認が必要」（「信頼ポリシー」列。同） | テキスト（`span`） | 確認結果が古くなったロールの行。記号は付けない（状態ではなく注記） |
| 空状態 | `Table` の `empty` スロット | 本文に FR-7.3 への導線を書く |

### FR-7.3 IAMロール割り当て （Issue #93 により 2026-10-08 改名） — **既製部品では賄えない** [AN-1]

**Cloudscape の `Table` は行選択（`selectionType="multi"`）を持つが、列選択を持たない。** Q4=`A` が要求するのは列ヘッダのチェックボックスによる**列**選択であり、両者は別物である。したがって FR-7.3 のマトリクスは既製 `Table` の設定では実現できず、自前構成になる。 [AN-1][Q4]

Q1=`A` を採った利点（管理画面部品が揃っている）は FR-7.1 / FR-7.2 / FR-7.4 / FR-7.5 では full に効くが、**FR-7.3 だけが例外**である。この非対称は採用判断の前提として承認時に確認する。

**AN-1 の当初案からの変更**: `refined-mockups-questions.md` の `## Answer Analysis` AN-1 は自前構成の手段を「`Grid` + `Checkbox` + `FormField` の組み合わせ」と記していたが、本書は**自前の `<table>` + `Checkbox` + `Box`** を採る。理由は 3 つある。(1) マトリクスは表形式データであり、`Grid`（汎用のレイアウト部品）ではネイティブのテーブルセマンティクス（`<th scope>` による行見出し・列見出しの関連付け）が得られず、`accessibility-checklist.md` の B-10（スクリーンリーダーが行/列見出しを正しく読む）が満たせない。(2) 行/列ヘッダの `position: sticky` は `<table>` の `<th>` に対して素直に効くが、`Grid` の div ベースのレイアウトでは追加の工夫が要る。(3) `FormField` はラベル・エラー・制約テキストを伴う**フォーム入力欄**のための部品であり、交点セルのチェックボックス（ラベルは `aria-label` で与える）には過剰である。AN-1 は帰結の把握を目的とした一次分析であり、手段の確定は本書が行う。 [AN-1][derived]

| 画面要素 | 実装方針 | Cloudscape から使うもの |
|---|---|---|
| マトリクス本体 | **自前の `<table>`**。行 = IamUser、列 = IamRole。行ヘッダ列と列ヘッダ行を `position: sticky` で固定。矢印キー移動（ローミング tabindex）を自前実装 | Cloudscape のデザイントークン（`@cloudscape-design/design-tokens`）で色・間隔・線を揃える。固定の基準は、`maxHeight` を持つスクロール領域（縦横ともこの領域の内側でスクロールする。Issue #91 により 2026-10-04 訂正。訂正前は縦のスクロールで固定が効いていなかった） |
| 交点セルのチェック | ネイティブの `<input type="checkbox">`（自前） | Cloudscape の `Checkbox` は `tabIndex` を公開せず、ローミング tabindex（M-1.2 / M-1.3）を実装できないため（X-1。Issue #26 により 2026-09-24 訂正） |
| 列ヘッダのチェック | ネイティブの `<input type="checkbox">` + 自前レイアウト | 交点セルと同じ理由でネイティブ。3 段構成（ロール名 / アカウント ID / チェック）のレイアウトも自前（X-1。Issue #26 により 2026-09-24 訂正） |
| ユーザの絞り込み欄（Issue #106 により 2026-10-04 追記） | Cloudscape `Input`（`type="search"`。`ariaLabel`「ユーザを絞り込み」） | マトリクスの外（件数の行の上）に置く通常の入力で、ローミング tabindex に関わらない。自前にする理由が無いので Cloudscape を使う |
| 列ヘッダのソート・フィルタのメニュー（Issue #91 により 2026-10-04 追記） | 「▾」ボタン（ネイティブの `<button>`、`tabIndex=-1`）と、`document.body` へのポータルで描く自前のメニュー（`ColumnMenu`。`role="menu"`、項目は `menuitemradio`）。ヘッダのセルの Enter で開く | Cloudscape の `ButtonDropdown` はトリガーの `tabIndex` を公開せず、マトリクスの Tab 停止点を 1 つに保てないため（X-1 と同じ理由）、メニューも自前。デザイントークンで装飾する |
| 属性列（Issue #107 により 2026-10-04 追記） | 自前（`MatrixGrid.tsx`）。見出しは `th scope="col"`（ローミング tabindex の位置）、中に名前の畳みボタン（`<button>`、`tabIndex=-1`）と「▾」ボタン（同）。畳んだ列は幅 2.25rem の `th` に開くボタン。値は `td`。メニューは `ColumnMenu.tsx` の `AttributeColumnMenu` | メニューの殻は `MenuShell`（`document.body` へのポータル。`role="menu"`、項目は `menuitemradio`／`menuitem`）。ロール列用 `ColumnMenu` と属性列用 `AttributeColumnMenu` が項目のグループを渡す。値が多いときはメニュー内でスクロールし、メニュー自身のスクロールでは閉じない。Cloudscape の `ButtonDropdown` を使わない理由は X-1 と同じ |
| 列の背景色（Issue #100 により 2026-10-04 追記） | 自前（`MatrixGrid.tsx`）。ヘッダの `th` だけにインラインの背景色を付ける（セルの `td` には付けない。Issue #105 により 2026-10-04 訂正。訂正前は「ヘッダの `th` と全セルの `td`」） | パレットの 8 色はライトだけ（ダークモードは扱わない）。色のある列のヘッダは、文字を `#000716`、補助文字を `#414d5c` に替え（差分記号は既定の色のまま。同じ来歴で訂正。訂正前は `#025a09` / `#a30f0f` に替える）、未反映の申請のチップは白い小さな囲みの中に置く |
| 差分記号（`+` / `−`） | 自前 | 装飾ではないため `Icon` ではなくテキストで実装し、視覚的に隠したラベル（「追加」/「削除」）を添える |
| 除外の状態チップ | `StatusIndicator` | `type="warning"` / `type="error"` |
| 除外警告帯 | `Alert type="warning"` | `ExclusionBanner` の実体 |
| ツールバー | `Header` の `actions` + `SpaceBetween` | |
| UserPool 選択 | （廃止。Issue #108 により 2026-10-05） | |
| 保存中インジケータ | `Spinner` | セル単位 |
| ツールバーの保存中表示（Issue #158 により 2026-10-09 追記） | `Box variant="small"` + `Spinner`（`size="normal"`）。保存済みは `Box variant="small"` のテキスト | 件数の行に置く。表の下の凡例には置かない。読み上げ領域には入れない（`interaction-spec.md` の「保存状態」） |
| 保存失敗 | `Alert type="error"` | ツールバー位置 |
| スキップリンク | 自前 | Cloudscape に相当部品なし。視覚的に隠し、フォーカスで可視化する |
| 1024px 未満の非対応表示 | `Alert type="info"` | メディアクエリで切り替え |
| 「ロールの紐づけ」（ツールバー）（旧） | （廃止。Issue #135 により 2026-10-07。`Button variant="normal"` と `LinkRolesModal` を削除した。ロールが 0 件の empty には、画面 2 へ遷移する `Button`（「IAM ロールを登録」）を出す。`AssignmentMatrix` の `onLinkRoles` は `onRegisterRoles` に改めた） | |
| 「変更を取り消す」（ツールバー）（Issue #88 により 2026-10-03 追記） | `Button variant="normal"`（GI-9 により primary にしない）+ `RevertChangesModal`（`GuardedModal`） | 「申請を作成」（primary）の左。確認は `Alert type="warning"`、API 失敗は確認の中の `Alert type="error"`。成功通知は `Flashbar`、一部の交点の失敗は列挙つきの `Alert type="error"`（`dismissible`）。旧「選択をリセット」は外した |

**自前構成の設計**:

```
MatrixScreen（画面 3）
 ├ ツールバー            … Container + Box + SpaceBetween + Button（Cloudscape）。「申請を作成」はページ唯一の primary（GI-9）
 └ AssignmentMatrix（自前）
    ├ SkipToActions      … マトリクスを飛ばしてツールバーへ（自前）
    ├ ExclusionBanner    … Alert type="warning"（Cloudscape）
    └ MatrixGrid（自前 <table>）
       ├ thead > tr > th.corner            … sticky top+left
       ├ thead > tr > th.role × N          … sticky top（＋ 列ヘッダのメニューを開く「▾」ボタンとバッジ。Issue #91）
       │   ├ ロール名 / アカウント ID        … 自前の div（デザイントークンで装飾）
       │   └ <input type="checkbox">（ネイティブ）または StatusIndicator（Cloudscape）
       ├ tbody > tr > th.user × M          … sticky left
       │   └ ユーザ名 / アカウント ID        … 自前の div（デザイントークンで装飾）
       └ tbody > tr > td.cell × N×M
           └ <input type="checkbox">（ネイティブ）＋ 保存中の Spinner（Cloudscape）＋ 差分記号（自前）
```

（Issue #26 により 2026-09-24 訂正: チェックはネイティブの checkbox、ラベルは自前の div とした（X-1、`MatrixGrid.tsx`）。ツールバーは画面側（`MatrixScreen`）に置く。部品の内側に閉じると、ページ唯一の primary（GI-9）が部品に隠れるため。`AssignmentMatrix` は `toolbarTargetId` でスキップリンクの飛び先だけを受ける。`packages/web/src/components/AssignmentMatrix.tsx` の冒頭コメント）

<!-- Text fallback: 画面 3 はツールバー（Cloudscape の Container・Box・SpaceBetween・Button）と自前コンポーネント AssignmentMatrix からなる。AssignmentMatrix は上から SkipToActions（自前）、ExclusionBanner（Cloudscape の Alert type=warning）、MatrixGrid（自前の table 要素）。MatrixGrid の thead は左上の角セル（上と左に sticky）とロール列ヘッダ（上に sticky、自前の div でロール名とアカウント ID を、ソート・フィルタのメニューを開く「▾」ボタンとバッジ（Issue #91）と、ネイティブの checkbox または Cloudscape の StatusIndicator で選択状態または除外状態を表示）。tbody は各行の先頭にユーザ行ヘッダ（左に sticky、自前の div でユーザ名とアカウント ID）、続いて交点セル（ネイティブの checkbox、保存中の Cloudscape Spinner、自前の差分記号）。 -->

**代替案の検討**: Cloudscape の `Table` に `selectionType="multi"` を付け、**行と列を入れ替えて**行 = IamRole・列 = IamUser とすれば既製の行選択がそのまま使える。しかし FR-3.1 が「行を IamUser・列を登録済み IamRole とするマトリクス」と明示的に定めているため採用しない。要件に反する転置を、部品の都合で行うべきではない。 [FR-3.1][derived]

### FR-7.4 差分確認・反映

| 画面要素 | Cloudscape 部品 | 備考 |
|---|---|---|
| ChangeRequest カード | `Container` + `Header` | カードごとに 1 コンテナ。`Cards` は使わない — カードごとに構造が異なる（警告の有無、結果表示の有無）ため |
| 反映対象チェック | `Checkbox` | `Header` の `actions` に配置 |
| 追加/削除プリンシパル一覧 | `Box variant="code"` + `SpaceBetween` | ARN 全文。等幅で表示し折り返す |
| 管理外プリンシパル警告 | `Alert type="warning"` | カード本体末尾 |
| 「選択した n 件を反映」 | `Button variant="primary" loading` | 実行中は `loading` |
| 反映結果 | `StatusIndicator` | `type="success"` / `type="error"` |
| AWS エラー内容 | `Alert type="error"` | エラーコードと説明を併記（GI-6） |
| 「この申請を再反映」 | `Button` | 失敗カード内 |
| 集計帯 | `Flashbar` | 「n 件中 m 件を反映しました」 |
| 読み込み中 | `Spinner` + テキスト | カードごとに独立 |
| 「IAMロール割り当てへ戻る」 | `Link` | `AppLayout` の `breadcrumbs` は使わない — 階層が浅く、単一の戻り先しかない |
| 種別 `restore` の注記（カード見出しの説明。Issue #172 により 2026-10-16 追記） | `Box variant="small"` | 「IAM を記録に合わせるための申請です。」。種別のない申請には出さない |

### FR-7.5 申請履歴

| 画面要素 | Cloudscape 部品 | 備考 |
|---|---|---|
| 申請一覧 | `Table` | 8 列（状態 / 対象ロール / 申請 ID / 作成日 / 反映日 / 作成者 / 反映者 / 操作。Issue #145 により 2026-10-07 訂正。訂正前は申請 ID が無い 7 列。申請 ID は幅 160px（最小 145px）で、先頭 9 文字の短縮表示（短縮したら「…」。「URL をコピー」のアイコンを隣に置く。Issue #148 により 2026-10-07 訂正。訂正前は幅 120px で、アイコンは操作列）。状態は幅 130px、対象ロールは最小幅 380px でロール名を折り返さない。Issue #128 により 2026-10-06 訂正。訂正前は「変更」の列を持つ 8 列。Issue #117 により 2026-10-06 訂正。訂正前は 7 列で、作成日は作成時刻、反映日は無し。Issue #120 により 2026-10-05 訂正。訂正前は 5 列）。`Pagination` は付けない（DS-4）。`stickyHeader`（Issue #133 により 2026-10-06 追記。トップナビの直下に固定。`AppLayout` の `headerSelector` が高さを与える） |
| 状態チップ | `StatusIndicator` | `RequestStatusChip` の実体。下書き=`warning`、反映済み=`success`、失敗=`error`、破棄=`stopped` |
| 申請の種別（状態の列。Issue #172 により 2026-10-16 追記） | `SpaceBetween size="xxs"`（状態チップ + `Box variant="small"`） | 種別 `restore`・`adopt` の申請だけ、状態チップの下に種別の文言を出す。種別のない申請は状態チップだけ（従来と同じ DOM）。`Badge`・`StatusIndicator` は使わない（状態と取り違えないため） |
| 検索条件 | `Select`（状態）・`DateRangePicker`（作成日と反映日。作成日は Issue #117 により 2026-10-06 に名称を訂正。訂正前は作成時刻。どちらも `dateOnly`・`rangeSelectorMode="absolute-only"`。反映日は Issue #117 により 2026-10-05 追記。作成日は初期値が今日から 3 か月前〜（終端なし）で、ラベルは「作成日（日付範囲。下書き・失敗は対象外）」。Issue #116 により 2026-10-06 追記）・`Input type="search"`（対象ロール）・`Input type="search"`（申請 ID。Issue #145 により 2026-10-07 追記） | `PropertyFilter` は過剰（軸が 5 つで、入力の型が固定。Issue #145 により 2026-10-07 訂正。訂正前は 4 つ）。Issue #109 により 2026-10-05 訂正。訂正前は状態の `Select` のみ（絞り込み軸が 1 つ） |
| 操作列 | `Button variant="inline-link"` | 状態によって出し分ける |
| 破棄の確認 | `Modal` + `Alert type="warning"` | 本文に FR-4.6 ロック解除の副作用を明記 |
| 詳細の展開 | `ExpandableSection` | 凍結入力と反映結果 |
| 空状態 / フィルタ 0 件 | `Table` の `empty` / `noMatch` スロット | |

## Design Tokens

Cloudscape の `@cloudscape-design/design-tokens` をそのまま用い、独自トークンを定義しない。自前構成する `MatrixGrid` も同じトークンを参照する。 [Q1][derived]

| 用途 | 参照するトークン系統 | 適用先 |
|---|---|---|
| 背景（ページ / コンテナ） | `colorBackgroundLayoutMain` / `colorBackgroundContainerContent` | ページ地、マトリクスのセル地 |
| 罫線 | `colorBorderDividerDefault` | マトリクスの格子線、ヘッダ境界 |
| 本文・補助テキスト | `colorTextBodyDefault` / `colorTextBodySecondary` | ユーザ名（本文）、アカウント ID（補助） |
| 選択状態 | `colorBackgroundItemSelected` / `colorBorderItemSelected` | 申請対象に選択中の列 |
| 警告 | `colorTextStatusWarning` / `colorBackgroundStatusWarning` | 除外チップ、除外警告帯、管理外プリンシパル警告 |
| エラー | `colorTextStatusError` / `colorBackgroundStatusError` | 失敗状態、削除されるプリンシパルの記号 |
| 成功 | `colorTextStatusSuccess` | 反映済み状態、追加されるプリンシパルの記号 |
| 間隔 | `spaceScaledXs` 〜 `spaceScaledXl` | セル padding、縦積みの間隔 |
| フォント | `fontFamilyBase` / `fontFamilyMonospace` | 本文 / ARN・アカウント ID・ロール名 |

**等幅フォントの適用範囲**: ARN、AWSアカウントID、IAMユーザ名、IAMロール名はすべて識別子であり、`fontFamilyMonospace` を適用する。桁の揃った数字（アカウント ID）は視認性が上がり、似た文字（`0` と `O`、`1` と `l`）の取り違えが減る。 [ux][derived]

**ダークモード**: Cloudscape は `awsui-dark-mode` クラスによるダークモードを持つ。poc では**明示的に対応しない**（切替 UI を置かない）。トークンを直接参照する限り、将来クラスを付けるだけで対応できる状態は保たれる。 [derived]

## Naming Conventions

`team-practices` 不在のため `org.md` の `## Code Style`（言語慣用に従い、プロジェクトの linter / formatter 設定を正とする）にフォールバックする。TypeScript / React の慣用は次のとおり。 [org]

| 対象 | 規約 | 例 |
|---|---|---|
| コンポーネント | PascalCase | `AssignmentMatrix`, `PolicyDiffPanel` |
| ファイル | コンポーネント名と同じ PascalCase | `AssignmentMatrix.tsx` |
| props / 変数 / 関数 | camelCase | `selectedRoleIds`, `onToggleRole` |
| イベントハンドラ props | `on` + 動詞 | `onToggleCell`, `onRetry` |
| ドメイン型 | requirements.md の Data Model 名をそのまま用いる | `UserPool`, `IamUser`, `IamRole`, `Assignment`, `ChangeRequest` |
| 状態の列挙値 | requirements.md の日本語状態に対応する英語 | `draft` / `applied` / `failed` / `discarded` |

**ドメイン用語を訳し替えない**: `requirements.md` の Data Model が定めた 5 エンティティ名を型名として直接使う。UI 上の日本語表示（「ユーザプール」「申請」）とコード上の英語識別子（`UserPool`、`ChangeRequest`）の対応は 1 対 1 に保ち、`Request` や `Policy` のような別名を導入しない。トレーサビリティが切れるため。 [ux][derived]（Issue #94 により 2026-10-15 追記: 英語の表示を足した。日本語表示と英語表示のどちらも、コード上の英語識別子と 1 対 1 に対応させ、識別子を訳し替えない。画面の文言の正本は、日本語が `packages/web/src/i18n/messages/ja.ts`（`ja/` 配下の分割を束ねる）、英語が同 `en.ts`（`en/` 配下）で、用語対応（ユーザプール = user pool など）は `docs/development.md` の「英語表記の用語対応」 の表に従う。）

## Component Inventory

`interaction-spec.md` が仕様を定めたコンポーネントの実装区分。

| コンポーネント | 区分 | Cloudscape 依存 |
|---|---|---|
| `AssignmentMatrix` | **自前**（AN-1） | `Alert`, `Box`, `SpaceBetween`, `Spinner`, デザイントークン（Issue #26 により 2026-09-24 訂正。`AssignmentMatrix.tsx` の import） |
| `MatrixGrid` | **自前**（`AssignmentMatrix` の内部） | `Spinner`, `StatusIndicator`, デザイントークン、`AssignmentMatrix` 側の `Input`（ユーザの絞り込み欄。Issue #106 により 2026-10-04 追記）、自前の `ColumnMenu`（列ヘッダのメニュー。`MenuShell` と、ロール列用・属性列用のラッパー。Issue #91 により 2026-10-04 追記。Issue #107 により 2026-10-04 追記: 殻の一般化と属性列用）。チェックはネイティブの `<input type="checkbox">`（X-1。Issue #26 により 2026-09-24 訂正） |
| `ExclusionBanner` | 既製の組み合わせ | `Alert type="warning"`, `Link` |
| `RequestStatusChip` | 既製のラッパ | `StatusIndicator` |
| `PolicyDiffPanel` | 既製の組み合わせ | `Container`, `Header`, `Checkbox`, `Box`, `Alert`, `StatusIndicator`, `Button` |
| `SkipToActions`（スキップリンク） | **自前** | デザイントークンのみ |
| 各画面のフォームモーダル | 既製の組み合わせ | `Modal`, `Form`, `FormField`, `Input`, `Textarea`, `Button` |

自前実装は 3 件（`AssignmentMatrix` / `MatrixGrid` / `SkipToActions`）に閉じる（`ColumnMenu` は `MatrixGrid` の内部部品で、数えない。Issue #91 により 2026-10-04 追記）。残りはすべて Cloudscape の既製部品の組み合わせで済む。

## Traceability

| 対応づけ | 根拠 |
|---|---|
| Cloudscape の採用 | Q1=`A` |
| デスクトップ専用前提 | Q3=`A`, DS-2 |
| a11y は既製部品に依存し、自前部分のみ自力で満たす | Q2=`C`, AN-2, DS-3 |
| 列選択マトリクスの自前構成 | Q4=`A`, AN-1, FR-3.1 |
| `Pagination` を使わない | FR: NFR-1, DS-4 |
| ドメイン型名の踏襲 | requirements.md `## Data Model` |
| 命名規約のフォールバック | `team-practices` 不在 → `org.md` `## Code Style` |

`[derived]` として承認時に確認する判断:

1. FR-7.3 のマトリクスを自前構成とする判断と、その代替（行列の転置による既製 `Table` 流用）を FR-3.1 違反として退けた判断
2. ダークモードに poc では対応しない判断
3. 識別子（ARN / アカウント ID / ユーザ名 / ロール名）へ等幅フォントを適用する判断
4. AWS のブランド資産を使わない判断（DS-5）
5. ドメイン型名を requirements.md の Data Model からそのまま採る判断

## Open Questions

| ID | 未解決事項 | 決定時期 | Source |
|---|---|---|---|
| MQ-5 | 本書の Cloudscape 部品名・プロパティ名を、採用バージョンの実 API と突き合わせる（`context7` MCP でドキュメントを引く）。名称変更・非推奨があれば本書を更新する | code-generation | [derived] |
| MQ-6 | Cloudscape のバンドルサイズが SM-2（第三者が README と Terraform でセットアップできる）の妨げにならないか。S3 + CloudFront 配信であるため配信自体は問題ないが、ビルド時間とリポジトリの依存の重さは OSS の参入障壁になりうる | code-generation | [Q1][FR: NFR-4] |
| MQ-7 | `MatrixGrid` のローミング tabindex を自前実装するか、既存の軽量ライブラリに委ねるか | code-generation | [AN-3][derived] |
