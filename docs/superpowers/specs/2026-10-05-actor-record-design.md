# 実行者の記録（`x-rolust-actor`）を ChangeRequest に残す — 設計

- 日付: 2026-10-05
- Issue: #120（関連: #20）
- ブランチ: `feat/120-actor-record`
- 状態: 実装・本番反映・実測済み（2026-10-05。成功基準 1・2・3・5・6 を実測で確認、4 はユニットテスト。結果は `docs/superpowers/plans/2026-10-05-actor-record-handoff.md`）

## 1. 背景と目的

### 現状

- #20 で、管理者ログインを複数ユーザに対応させた（`auth_mode = "cognito"`）。プールのユーザは全員が管理者で、誰が操作したかは記録されない。
- 要件 A-6 は「将来複数の管理者が存在する。その時点で管理者エンティティと実行者の記録を追加する」とする。#20 は認証だけを扱い、実行者の記録は範囲外とした。
- edge-auth（Lambda@Edge の viewer-request）は、`cognito` では ID トークンを検証する時点で `sub` と `cognito:username` を持つ（`IdTokenClaims`、`packages/edge-auth/src/jwt.ts`）。`basic` では `Authorization` ヘッダーに資格情報が載る。
- `ChangeRequest`（`packages/core/src/types.ts`）は、作成者・反映者に当たる属性を持たない。

### 依頼の内容と決定（Issue #120、2026-10-05 の会話）

- 申請を作成した人（作成ボタンを押した人）と、反映した人を、ChangeRequest に記録し、申請履歴で見られるようにする。
- Assignment のセルの更新者は**記録しない**。Assignment は「あるべき状態」で、申請の作成時に ChangeRequest へ凍結される。誰が信頼ポリシーへ反映したかは、作成者・反映者で足りる。セル単位の更新は即時 API で書き込みが増え、画面にも使い道が無い。
- 破棄者は記録しない（記録するのは作成者と反映者の 2 つ）。

### 決めたこと（導出した根拠つき）

| # | 決定 | 根拠 |
|---|---|---|
| 1 | 実行者の値は `name`（`cognito:username`）と `sub` の**両方**を保存する | ユーザ名は変わりうるが読める。`sub` は変わらないが読めない。履歴を読む用途にはユーザ名が要り、ユーザの付け替えに耐えるには `sub` が要る |
| 2 | API への渡し方は、edge-auth が認証後に `x-rolust-actor` を付ける | Issue の足がかり。API Gateway の直 URL は API キーで塞がれていて（FR-6.3）、ヘッダーを信頼してよい経路は CloudFront 経由だけ |
| 3 | ビューアが送った同名のヘッダーは、**どの認証方式でも、通す前に必ず除去**する | なりすましの防止。`basic` で付ける値が無いときも除去する（除去を付与と一体にすると、付与しない経路で偽装が素通りする） |
| 4 | 値は `{"name","sub"?}` の JSON を base64url にした ASCII 文字列にする | Cognito のユーザ名は Unicode になりえて、HTTP ヘッダーに生では載せられない |
| 5 | `basic` のときの名前は、`Authorization` のユーザ名部分だけ。`sub` は持たない。パスワードは扱わない | 単一の資格情報なので複数人は区別できないが、「どの資格情報で入ったか」は残せる。値の取り出しは認証に成功したあとだけ |
| 6 | ヘッダーが無い・不正なときは、API は `null` で保存して `console.warn` を残す。処理は止めない | 実行者なしは既存の申請と同じ有効な状態で、CloudFront を通らないローカル開発・統合テストも動かす。握り潰さずに警告を残す（コード規約）。拒否に変えると、edge-auth の不具合がそのまま操作不能になる |
| 7 | 既存の ChangeRequest は実行者なしのままにし、画面では「—」と表示する。遡って埋めない。移行は不要 | DynamoDB は属性が無いだけで `null` と読める |
| 8 | `appliedBy` は、`appliedAt` と同じく「反映を試みた者」。失敗した反映でも入る | FR-5.5 の `appliedAt` と同じ意味に揃える |
| 9 | 画面に `sub` は出さない（DynamoDB に残すだけ） | 読めない値は履歴の役に立たない |

### 成功基準

1. `cognito` で 2 ユーザ（A・B）がそれぞれ申請を作成・反映すると、申請履歴の作成者・反映者に、それぞれのユーザ名が出る。
2. ビューアが `x-rolust-actor: <別人>` を付けて申請を作成しても、保存されるのは本物の実行者である（`cognito`・`basic` の両方）。
3. CloudFront が viewer-request で付けたヘッダーを、API Gateway 経由で Lambda まで運ぶ（実測で確認する）。
4. `basic` では、`Authorization` のユーザ名が作成者・反映者に出る。
5. 既存の ChangeRequest は、作成者・反映者が「—」で表示され、一覧が壊れない。
6. `auth_mode`・IAM・CloudFront の挙動（認証なしの 302 / 401）は変わらない。

## 2. 設計

### 2.1 edge-auth（ヘッダーを付ける）

- 定数 `ACTOR_HEADER = "x-rolust-actor"` と、値の組み立て・復号の関数（`actor.ts`）を持つ。`Actor = { name: string; sub?: string }`。
- `handler` は、許可 IP の判定を通した直後、認証プロバイダーを呼ぶ前に、`request.headers["x-rolust-actor"]` を削除する。
- `AuthProvider` は、通すとき `request` を返す（現状のまま）。プロバイダーが、返す `request` に `x-rolust-actor` を付ける。
  - `oidc.ts`: `hasValidSession` が検証済みのクレームを返すように改め、`cognito:username`（無ければ `sub`）を `name`、`sub` を `sub` にする。どちらも無いトークンは、ヘッダーを付けずに通す（署名と `aud` の検証は済んでいる。Cognito はどちらも必ず入れるので起きない想定で、起きたときは API が `null` と警告で受ける）。
  - `basic.ts`: `provided` の `Basic <base64>` を復号し、最初の `:` より前を `name` にする。復号できなければ、ヘッダーを付けずに通す（資格情報の比較は成功している）。
- `/callback`（リダイレクト）と、拒否・503 の応答には付けない。

### 2.2 API（受けて保存する）

- `core`: `Actor` 型と `parseActor`（検証。`name` は 1〜256 文字の文字列、`sub` は文字列・256 文字まで。余分な属性は捨てる）を足す。`ChangeRequest` に `createdBy: Actor | null` と `appliedBy: Actor | null` を足す。
- `api`: ハンドラが `x-rolust-actor`（API Gateway のイベントでは小文字）を復号して `parseActor` に通し、ルートのハンドラへ `actor: Actor | null` として渡す。
  - 無い → `null`（警告なし。ローカル・統合テストの通常経路）。
  - あるが不正（base64url でない・JSON でない・型違反）→ `null` で、`console.warn` を残す。
- `POST /change-requests`（作成）は `createdBy` に、反映（`apply` 系統）は `appliedBy` に書く。`appliedBy` は `appliedAt` を書く箇所で一緒に書く。
- リポジトリは、`createdBy`・`appliedBy` を DynamoDB の Map 属性として読み書きする。属性が無ければ `null`。

### 2.3 画面（申請履歴 FR-7.5）

- 一覧に「作成者」「反映者」の列を足す。表示は `name`、`null` は「—」。反映者は、反映を試みていない下書きでは「—」になる。
- 並べ替え・絞り込みの対象にはしない。

## 3. テストと検証

### 3.1 ユニット（TDD。失敗するテストを先に書く）

| 層 | 見る点 |
|---|---|
| edge-auth `actor` | 値の組み立てと復号の往復（日本語のユーザ名を含む）。不正な値は復号できない |
| edge-auth `handler` | ビューアが送った `x-rolust-actor` が、`basic`・`cognito` のどちらでも除去される。認証に失敗したときは付かない |
| edge-auth `oidc` / `basic` | 通すとき、検証済みのクレーム・`Authorization` の値から `x-rolust-actor` が付く。`/callback` には付かない |
| core `parseActor` | 正常、`sub` なし、長さの超過、型違反、余分な属性 |
| api ハンドラ | ヘッダー無し → `null`（警告なし）、不正 → `null` と警告、正常 → 作成者・反映者に保存 |
| api リポジトリ | `createdBy`・`appliedBy` の保存と読み出し。属性が無い既存の項目は `null` |
| web | 列の表示、`null` の「—」 |

### 3.2 実測（モックでは検証できない）

CloudFront が viewer-request で付けたヘッダーの転送、`cognito` の 2 ユーザの記録、偽装の無効化は、外部サービスの挙動なのでユニットテストでは確かめられない。実測の手順書を `docs/superpowers/plans/` に残し、本番へ反映（README の手順。`cd.yml` は反映しない、D-7）したうえで実測する。

| 段階 | 操作 | 期待 |
|---|---|---|
| 1 | 検証用ユーザ A・B を `cognito` に作る（`create_cognito_user_command`）。それぞれヘッドレス Playwright でサインインし、申請を作成する | 申請履歴の作成者が、それぞれ A・B のユーザ名 |
| 2 | A が作成した申請を B が反映する | 作成者 A、反映者 B |
| 3 | A のセッションで `x-rolust-actor: <B を名乗る値>` を付けて `POST /change-requests` | 保存される作成者は A |
| 4 | 認証なしで `x-rolust-actor` を付けて `/api/change-requests` | 401（ヘッダーで通らない） |
| 5 | 既存の申請の表示 | 作成者・反映者が「—」で、一覧が壊れない |
| 6 | `basic` への切り替えは**実測しない**（空白期間と、Cognito のプール・ユーザの破棄を伴う）。`basic` はユニットテストで確かめる | — |
| 7 | 後片付け | 検証用ユーザの削除。検証で作った ChangeRequest は、申請履歴に残す（件数無制限の蓄積は決定済み）か、反映した IAM があれば復元する（`verification-needs-temp-role`） |

- 検証用ロールの作成・IAM の書き換えを伴う段階は、承認を得てから行い、実行前の退避・実行後の復元・復元後の一致確認を必須にする。
- CloudFront がヘッダーを運ばない場合は、段階 1 の前に判明する。その場合は設計判断を伴うので、直さずに選択肢を添えて報告する（原因の候補: 転送するヘッダーの設定。`AllViewerExceptHostHeader` は現状ですべてのビューアのヘッダーを転送する）。

## 4. 正本への反映

| 文書 | 覆す | 足す | 直す節 |
|---|---|---|---|
| `docs/design/requirements.md` | A-6 の「実行者の記録も同時に追加する」のうち、実行者の記録を実装済みにする（管理者エンティティは未実装のまま）。「実行者を記録しないため、監査記録は『いつ・何を』まで」の制約 3。対象外表の「申請の実行者の記録」と「複数人による承認ワークフロー」の根拠（実行者を識別しない） | FR-4.4 の記録内容の補足に作成者（`createdBy`）、FR-5.5 の補足に反映者（`appliedBy`）、FR-7.5 の列、冒頭の追記注記 | A-6（382 行付近）、制約 3（236 行付近）、対象外表（394・395 行付近）、FR-4.4 の記録内容（208 行付近）、FR-5.5（247 行）、FR-7.5（310 行） |
| `docs/design/mockups.md` | 画面 5 の「5 列テーブル」 | 作成者・反映者の列（7 列） | 画面 5 の一覧テーブル、テキストフォールバック、冒頭の追記注記 |
| `docs/design/interaction-spec.md` | なし | 画面 5 の列の表示（`null` は「—」） | FR-7.5 申請履歴の節（211 行付近） |
| `docs/design/design-system-mapping.md` | なし | 画面 5 の表の列定義 | FR-7.5 申請履歴の節（195 行付近） |
| `packages/api/TABLE-DESIGN.md` | なし | ChangeRequest の属性 `createdBy`・`appliedBy`（Map。無ければ `null`）。アクセスパターンの変更は無い | 冒頭の追記注記、ChangeRequest の属性の記述 |
| `docs/design/iam-policy-design-note.md` | 415 行付近の「実行者も記録しないため、操作者単位の制限は poc では成立しない」の前提（記録は始まるが、管理者エンティティは無いので、操作者単位の制限は引き続き成立しない旨に直す） | 冒頭の追記注記 | 415 行付近 |
| `docs/design/cd-config.md`・`cicd-pipeline.md`・`deployment-strategy.md` | なし | なし | なし（Lambda@Edge のコードは変わるが、構成・権限・変数は変わらない） |
| `README.md` | なし | 実行者の記録（`cognito` ではユーザ名と `sub`、`basic` ではユーザ名だけ。既存の申請は「—」） | 認証の節 |
| `.claude/rules/` | なし | なし | なし |
| `aidlc/` | 書き換えない | なし | なし |

訂正は、冒頭の追記注記（日付・Issue・変更の全体像）と各箇所の来歴（例: 「Issue #120 により 2026-10-05 追記」）の二層にする。

## 5. スコープ外とリスク

**スコープ外**: Assignment のセルの更新者、破棄者、管理者エンティティ（権限の区別）、操作者単位の IAM 制限、実行者での絞り込み・並べ替え、既存の申請の遡った補完、排他制御（#20 のスコープ外で挙げた別の課題）。

| リスク | 扱い |
|---|---|
| CloudFront が viewer-request で付けたヘッダーを API に運ばない | 3.2 の段階 1 で最初に判明する。運ばない場合は設計判断を伴うので、直さずに選択肢を添えて報告する |
| `basic` は単一の資格情報なので、実行者は常に同じ名前（複数人の区別は無い） | 受容（Issue に明記済み）。README に書く |
| ヘッダーが不正でも処理は止めず `null` で保存する | 受容。警告を残す。edge-auth が通すときは必ず正しい値を付けるので、不正は設計上起きない |
| ユーザ名はあとで変わりうる | `sub` も保存する。画面は保存時点の `name` を出す |
