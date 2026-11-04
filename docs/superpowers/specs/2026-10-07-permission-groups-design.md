# 管理者の権限の分離（参照・作成・反映）と申請の URL での受け渡し（Issue #141）

日付: 2026-10-07 / 関連: #20（Cognito）・#117（承認日）・#120（実行者の記録）・#121（排他）

## 1. 目的と背景

ログインした管理者は、誰でも ChangeRequest の作成から反映までできる。信頼ポリシーの更新は特権的な操作なので、反映の権限を持つ人だけが反映できるようにする。あわせて、参照だけできる人を作れるようにし、反映する人へ申請を URL で渡せるようにする。

依頼者の確認で決まったこと（2026-10-07）:

- 承認を独立した工程（状態）にはしない。反映の権限だけを足す（用語は「反映」に統一する）。
- 作成者本人も、反映の権限があれば自分の申請を反映できる（自己反映は可）。
- Cognito のどのグループにも属さないユーザは何もできない（fail closed）。
- 権限は階層にする。1 ユーザが複数のグループに属した場合は、最上位の 1 つが効く。
- 参照の権限（`viewer`）を足す（依頼者の追加要望）。
- 破棄は `editor` に含める（記録を状態「破棄」にするだけで、AWS を書き換えないため）。

## 2. 権限モデル

| グループ | 権限 | できること |
|---|---|---|
| `viewer` | `view` | 参照だけ。マトリクス・ユーザプール・ロール一覧・申請履歴・差分確認の表示 |
| `editor` | `edit` | `view` に加え、マトリクスの編集・ユーザとロールの登録・編集・削除・属性の編集・申請の作成と破棄 |
| `applier` | `apply` | `edit` に加え、反映（再反映を含む） |

- 階層は `apply` ⊃ `edit` ⊃ `view`。複数のグループに属すときは、最上位が効く。互いを打ち消さない。
- どのグループにも属さない、または `cognito:groups` が無い・空・未知の名前だけのときは、権限なし（すべて 403）。
- `auth_mode=basic` は全権限（`apply`）。資格情報が単一でグループを識別できないため。
- Cognito の優先度（precedence）は使わない（IAM ロールの割り当て用で、Rolust は ID トークンのグループ名だけを見る）。

### ルートごとの必要権限

| 必要権限 | ルート |
|---|---|
| `view` | `GET /config`・`GET /pool`・`GET /pool/matrix`・`GET /roles`・`GET /change-requests`・`GET /diff`・`GET /me`（新設） |
| `edit` | 上記以外の `POST`・`PUT`・`PATCH`・`DELETE` のうち `POST /apply` を除くすべて（`/pool/*`・`/roles*`・`POST /change-requests`・`POST /change-requests/:id/discard`） |
| `apply` | `POST /apply` |

ルートを足すときに必要権限の宣言を忘れると、既定で `apply`（最も厳しい）になる。宣言の無い GET も同じ。

## 3. 強制の仕組み

- Lambda@Edge（`packages/edge-auth`）が、検証した ID トークンの `cognito:groups` を `x-rolust-actor` の JSON に `groups`（文字列の配列）として載せる。`basic` は `groups` を載せず、API は「`basic` で全権限」を、別のヘッダーではなく **設定（環境変数 `ROLUST_AUTH_MODE`）** で判定する。ヘッダーの有無で全権限を決めると、付与の失敗が権限過多になるため。
- API の共通層（`packages/api/src/http.ts`）が `Route` に必要権限を持たせ、ハンドラを呼ぶ前に判定する。不足は 403（`Forbidden`。必要な権限を本文に含める）。AWS（IAM・DynamoDB）は判定の後に初めて呼ぶ。
- `auth_mode=cognito` で `x-rolust-actor` が無い・不正なときは、権限なしとして 403 にする（認証を通ったのに実行者が読めないのは異常で、通さない）。
- ヘッダーの信頼は #120 と同じ前提（ビューアが送った同名のヘッダーは Edge が必ず除去する。API Gateway の直 URL は API キーで塞いである）。

## 4. 画面

- `GET /me` が `{ permission: "view" | "edit" | "apply" | "none", actor }` を返す。SPA は起動時に 1 回読み、各画面へ渡す。
- 権限が足りない操作は、ボタンを非表示にせず無効にし、必要な権限を理由として出す。`none` のときは画面全体に、権限が無い旨と管理者への連絡を促す案内を出す（API は 403）。
- **申請の URL**: 申請の詳細ページを新設せず、既存の画面 4（`ROUTES.requests` の `?ids=<id>`。FR-7.4）をそのまま使う。画面 4 は URL の再訪で成立する設計（FR-4.7）で、ChangeRequest の既存 ID を使うので、新しいルートは要らない（Issue の例の `#/requests/<id>` は採らない）。
- 画面 4 と申請履歴に、申請の ID と「URL をコピー」を置く。URL は `<origin>/<画面 4 のパス>?ids=<id>`。反映者がこれを開けば、差分確認と反映の画面が直接出る。
- `viewer` が開いたときは、差分は見えて「反映」だけが無効（理由つき）になる。
- 申請履歴の「承認日」は「反映日」に改める（#117）。「承認」の語は画面・文書から使わない。

## 5. インフラと運用

- Terraform で `aws_cognito_user_group` を 3 つ（`viewer`・`editor`・`applier`）作る（`auth_mode=cognito` のときだけ）。
- Lambda に `ROLUST_AUTH_MODE` を渡す。
- README に、グループの割り当て手順（`admin-add-user-to-group`）を書く。「最上位の 1 つだけ割り当てる」。**反映の前に、現在の管理者へ `applier` を割り当てる**（割り当てるまで、その管理者は全 API が 403 になる）。
- IAM ポリシー（`DenySelfEscalation` を含む）は変えない。Cognito のグループ作成は Terraform を実行する人の権限で行う。

## 6. 正本への反映

| 文書 | 変更 |
|---|---|
| `requirements.md` Out of Scope | 「ロールベースのアプリ内権限」を外す（Issue #141 により追記・訂正）。「複数人による承認ワークフロー」は残し、理由を「承認の工程を持たない。反映の権限だけを持つ」に書き直す |
| `requirements.md` FR-6.5 | 新設（権限の分離。§ 2・§ 3。ID は末尾に追加） |
| `requirements.md` FR-4.4・FR-4.8 | 「申請を作成」・破棄に `edit` が要ることを注記 |
| `requirements.md` FR-5.3・FR-5.5・FR-5.6 | 反映に `apply` が要ることを注記 |
| `requirements.md` FR-7.4・FR-7.5 | 権限が無いときの表示、ID と URL のコピー、「反映日」への改称を注記 |
| `requirements.md` A-6・#117・#120 の注記 | 管理者エンティティは未実装のまま、権限は Cognito のグループで足したことを追記・訂正 |
| `mockups.md` | 画面 4・5（ID・URL のコピー、無効なボタンと理由、権限なしの画面） |
| `interaction-spec.md` | URL の受け渡し、権限が無いときの状態、`GET /me` |
| `iam-policy-design-note.md` | 権限の根拠。IAM を変えない旨 |
| `README.md` | グループの割り当て手順、用語（「承認日」→「反映日」） |
| `packages/api/TABLE-DESIGN.md` | **なし**（データ項目は増えない） |

「承認」の語は `docs/design/`・README・`packages/web` を grep で総当たりし、同じ来歴で直す（`aidlc/` は書き換えない）。

## 7. テストと実測

- TDD（`packages/`）: 権限判定（グループ × 必要権限の全組み合わせ。複数所属で最上位が効く。無グループ・空・未知の名前は 403）、全ルートの必要権限の表（宣言の抜けを検出する網羅テスト）、`basic` は全権限、Cognito で `x-rolust-actor` が無いと 403、`groups` の符号化（Edge と API の固定値）、`GET /me`、画面の無効表示と理由、URL コピー。
- Terraform は `fmt -check`・`validate`・plan-guard（グループの追加は破壊的でないことを確かめる）。
- 実測（実 Cognito が絡むので手順書を残す）: 3 つのグループと無グループの検証用ユーザを作り、`viewer` の更新が 403、`editor` の反映が 403、`applier` の反映が成功、無グループがすべて 403 になることを確かめる。終わったら検証用ユーザを削除する。
- plan の最終タスクは、README の手順による反映（管理者への `applier` の割り当てを先に行う）と、その実測。

## 8. 範囲外（決定）

- 承認の状態・承認者の記録。作成者と反映者の記録は #120 で足りる。
- 自己反映の禁止（グループの割り当てで職務を分けられる）。
- グループの管理画面。割り当ては運用者が CLI で行う。
- `basic` でのグループ識別。
