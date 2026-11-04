# ログアウト機能（cognito モード）設計

- Issue: #160
- 日付: 2026-10-09
- 対象: `auth_mode = "cognito"`（`basic` は対象外）
- 前提: `docs/superpowers/specs/2026-10-05-admin-auth-cognito-design.md`（以下「Cognito 設計」）。Cognito 設計はログアウトをスコープ外としていた。この spec がその範囲を覆す（§ 7）。

## 1. 背景と目的

`cognito` モードのサインインは、ID トークンを載せた Cookie `__Host-rolust-id` だけで決まる。Cookie は `HttpOnly` のため SPA の JavaScript からは消せず、ログアウトの手段が無い。そのため次の 2 点が起きる。

- 共用の端末で使い終えても、Cookie が有効な間は再びサインイン無しで開ける。
- Cognito の Hosted UI のセッションが残るので、別のユーザでサインインし直せない。

目的は、利用者がログアウトすると、Rolust の Cookie が消え、Cognito の Hosted UI のセッションも終わることである。

## 2. 決定事項

| # | 決定 | 理由 |
|---|---|---|
| 1 | `/logout` は edge-auth（Lambda@Edge）が処理する。API は関与しない | Cookie の発行元（edge-auth）が消すのが一貫する。Cognito への 302 もここで返す |
| 2 | `/logout` は認証を要求しない。IP 判定の後、認証プロバイダーの前に処理する | 期限切れ・改ざんの Cookie でもログアウトできる。Cookie を消すだけで、権限は増えない。IP 判定は全経路で認証より前（FR-6.2） |
| 3 | Cognito の `/logout?client_id=…&logout_uri=…` へ 302 し、Hosted UI のセッションも終える。`logout_uri` は `https://<Host>/` | 別ユーザへの切り替えには Hosted UI のセッションを終える必要がある。`logout_uri` は登録と完全一致で検証されるため、`redirect_uri`（決定 11 の Host 組み立て）と同じ方式にする |
| 4 | `/logout` の応答は `Set-Cookie`（`__Host-rolust-id` を `Max-Age=0`。既存の `clearCookie`）と `Cache-Control: no-store` を付ける | 既存の応答（`/callback`・サインインへの 302）と揃える |
| 5 | `logoutEndpoint` は SSM の `auth-cognito` の JSON の**任意キー**とする。`/logout` のときだけ必須とし、欠けていれば `/logout` は 503 | Terraform の反映の窓で、全アクセスを 503 にしないため。`parseOidcConfig` の必須キーに足すと、サインイン済みの全リクエストが止まる |
| 6 | API の `GET /api/me` の応答に `authMode`（`basic` / `cognito`）を足す | API は既に `ROLUST_AUTH_MODE` を持つ。SPA に認証方式を別経路で教えない |
| 7 | ログアウトは `<a href="/logout">` の画面遷移とする。`fetch` と `navigate()` は使わない | `HttpOnly` の Cookie を消し、Cognito のリダイレクトを受けるには、トップレベルの遷移が要る |
| 8 | ログアウトの操作は、画面上端の `TopNavigation`（`AppShell`）の右側に置く | 既存のナビの並びに続ける。位置は UI の判断であり、後から変えやすい |
| 9 | 残余リスク（コピーされた ID トークンは `exp` まで有効）は受け入れ、文書に明記する | 依頼者の判断（2026-10-09）。リフレッシュトークンを使わない設計の帰結。有効期限の短縮は、再ログインの頻度を上げる |
| 10 | `basic` モードでは、`/logout` の処理もリンクも作らない | Basic 認証はブラウザから資格情報を消せない。ログアウトの意味が無い |
| 11 | `aws_cognito_user_pool_client.admin` の `logout_urls` に `https://<CloudFront ドメイン>/` を足す | `callback_urls` と同じ参照なので、循環は起きない（`cognito.tf` の循環の注記と同じ） |
| 12 | IAM の権限は変えない | `terraform plan` の refresh が `cognito-idp:DescribeUserPoolClient` を既に呼ぶ。実測の plan で確かめる（§ 4） |

## 3. 構成

### 3.1 `/logout`（`packages/edge-auth`）

- `index.ts` の `handler` で、IP 判定と `stripActor` の後、認証方式を読んだ後、プロバイダーを呼ぶ前に分岐する。`mode === "cognito"` かつ `request.uri === "/logout"` のときだけ、ログアウトの応答を返す。
- 応答は次のとおり。
  - `Host` が無い → 403（`redirectToSignIn` と同じ）
  - `logoutEndpoint` が無い・取得できない → 503（fail closed。`getOidcConfig` の失敗と同じ扱い）
  - それ以外 → `302 Found`、`Location: <logoutEndpoint>?client_id=<clientId>&logout_uri=<https://Host/ を URL エンコード>`、`Set-Cookie: clearCookie(ID_COOKIE)`、`Cache-Control: no-store`
- `/logout` は `rewriteSpaRoute` の対象にしない（応答を返すので、通す経路を通らない）。
- `basic` のとき `/logout` は特別扱いしない。従来どおり Basic 認証を通り、SPA の `/` に寄せられる。SPA にリンクを出さないので、通常は到達しない。

### 3.2 SSM の接続情報（`infra/cognito.tf`・`packages/edge-auth/src/auth-config.ts`）

- `aws_ssm_parameter.auth_cognito` の JSON に `logoutEndpoint = "${local.cognito_domain}/logout"` を足す。
- `parseOidcConfig` は `logoutEndpoint` を任意キーとして読む。空文字・非 https は不正とし、無ければ `undefined` を返す。`/logout` の処理だけが `undefined` を 503 にする。

### 3.3 Cognito のクライアント（`infra/cognito.tf`）

- `logout_urls = ["https://${aws_cloudfront_distribution.rolust.domain_name}/"]` を足す。
- 既存の `callback_urls` の注記（循環の回避）の範囲で足せる。CloudFront は `edge_auth_ssm` に依存し、ポリシーは ARN を文字列で組んでいるので、新しい循環は生まれない。

### 3.4 API（`packages/api`・`packages/core`）

- `MeResponse` に `authMode: AuthMode` を足す（`packages/core/src/api-contract.ts`）。
- `handlers/me.ts` は `authMode` を `ROLUST_AUTH_MODE`（`loadAuthMode()`）から返す。値が不正なら既存の fail closed（500）に従う。
- `GET /api/me` の権限は `none` のまま。IAM も DynamoDB も触らない。

### 3.5 SPA（`packages/web`）

- `AppShell.tsx` の `TopNavigation` の右側に、`authMode === "cognito"` のときだけ `<a href="/logout">ログアウト</a>` を出す。
- `authMode` の値は `App` が `GET /me` を読んで配る既存の経路（`permission.tsx` と同じ）に載せる。読み込み前は出さない。
- リンクは既定の遷移を使う。`AppShell` のナビの `onClick`（`navigate()`）は使わない。

## 4. テスト方針（TDD）

アプリコード（`packages/`）は失敗するテストを先に書く。

- **edge-auth（ユニット）**
  - `cognito` で `/logout` → 302、`Location` が `logoutEndpoint` で始まり `client_id`・`logout_uri=https%3A%2F%2F<Host>%2F` を含む、`Set-Cookie` が `__Host-rolust-id` の `Max-Age=0`、`Cache-Control: no-store`。
  - Cookie が無い・期限切れ・改ざんでも `/logout` は 302（認証を要求しない）。
  - IP が拒否されたら、`/logout` でも 403（ログアウトの応答を出さない）。
  - `basic` で `/logout` に Cognito の `Location` を返さない。
  - `logoutEndpoint` が無い → 503。`Host` が無い → 403。
  - `parseOidcConfig`: `logoutEndpoint` が無くても成功、あれば取り出す、非 https は不正。
- **api（ユニット）**: `GET /api/me` が `authMode` を返す（`basic`・`cognito`）。権限なし（`none`）の人にも返す。
- **core**: `MeResponse` の型（`authMode` が必須）。
- **web（ユニット）**: `cognito` でリンク `href="/logout"` が出る。`basic` と `/me` の読み込み前には出ない。通常のナビ項目の遷移（`navigate`）は変わらない。
- **Terraform**: `terraform fmt -check`・`terraform validate`。`TF_VAR_auth_mode=cognito` の plan で、`logout_urls` と `auth_cognito` の値の差分だけが出ること。`plan-guard.test.sh` を通すこと。
- **実測（実 AWS。手順書を残す）**: 検証専用ユーザを作り、ブラウザ（Playwright）で次を確かめる。
  1. サインインし、画面が出る。
  2. ログアウトのリンクから `/logout` へ遷移し、Cookie `__Host-rolust-id` が消える。
  3. Cognito のサインイン画面に戻る。`/` が Hosted UI へ 302 する。
  4. Cookie を失った状態で `/api/` が 401 になる。
  5. 別のユーザでサインインできる。
  6. 検証専用ユーザを削除する（`cognito-verify-user-for-ui-checks` の手順）。
  - 手順は `docs/superpowers/plans/` の plan に残す。依頼者が実測を引き取れるようにする（CLAUDE.md のテスト方針）。

## 5. 反映の順序と戻し方

- 反映は README の手順（`terraform apply`、`jump-admin` / `ap-northeast-1`）で行う。`cd.yml` は反映しない（`docs/design/cd-config.md` D-7）。
- 順序: Terraform（`logout_urls`・`auth_cognito` の任意キー）→ Lambda@Edge と SPA。旧 Lambda は任意キーを無視し、旧 SPA はリンクを出さないので、途中の状態でも既存の動作は変わらない。
- 戻し方: `logout_urls` の削除と、`/logout` の分岐の削除。どちらも既存の認証の経路を変えない。

## 6. 残余リスクと受容

- **コピーされた ID トークンは `exp`（最長 1 日）まで有効。** ログアウトはブラウザの Cookie と Hosted UI のセッションを消すが、トークンそのものは無効化できない。リフレッシュトークンを使わないので、Cognito の `AdminUserGlobalSignOut` も効かない。受容する（決定 9）。`docs/design/iam-policy-design-note.md` § 4 と README に明記する。
- **`logout_uri` の登録と完全一致。** `Host` が登録と違えば Cognito がエラーを返す。`callback_urls` と同じ前提で、既存の制約と変わらない。
- **ログアウト直後にサインイン画面が出る。** 仕様どおり（`/` が Hosted UI へ 302 する）。ログアウト完了の画面は作らない。

## 7. 正本への反映

| 対象 | 変更 | 来歴 |
|---|---|---|
| `docs/design/requirements.md` FR-6.4 | 「`cognito` では、画面からログアウトでき、Cookie を消し、Cognito のセッションを終える。ログアウト後も、発行済みの ID トークンは `exp` まで有効なまま残る」を追記 | 追記（Issue #160 により 2026-10-09） |
| `docs/design/iam-policy-design-note.md` § 4（`cognito` の注記） | 「ログアウトは ID トークンを無効化しない」を追記 | 追記（Issue #160 により 2026-10-09） |
| `README.md`（制約・認証） | ログアウトの操作と、残余リスク（トークンは `exp` まで有効）を書く | 追記（Issue #160 により 2026-10-09） |
| Cognito 設計（`2026-10-05-admin-auth-cognito-design.md`） | 本文は変えない。「ログアウトはスコープ外」（§ 3.2 の `logout_urls` の記述と、スコープ外の節）を、本 spec § 2・§ 3 が覆すことをここに記す | — |

正本の ID（FR-6.4 など）は変えない。`docs/design/` の変更は実装と同じ PR に含める（plan のタスクに入れる）。
