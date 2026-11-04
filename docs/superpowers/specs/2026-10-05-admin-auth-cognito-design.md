# 管理者ログインの複数ユーザ対応（Cognito 方式の追加と、認証方式の選択） — 設計

- 日付: 2026-10-05
- Issue: #20
- ブランチ: `feat/20-admin-auth-cognito`
- 状態: 設計承認済み（brainstorming の会話）、spec レビュー待ち

## 1. 背景と目的

### 現状

- 管理画面と `/api/*` は、CloudFront の viewer-request に付いた Lambda@Edge（`packages/edge-auth`、nodejs22.x、timeout 5 秒、メモリ 128MB）が守る。判定は IP 許可リスト（FR-6.2）、次に Basic 認証（FR-6.1）の順。
- 資格情報は SSM の SecureString `/rolust/basic-auth` に `<ユーザ名>:<パスワード>` の 1 組だけ。5 分キャッシュ（`CACHE_TTL_MS`）。取得できない・不正なときは 503（fail closed）。
- 要件 A-6 は「将来複数の管理者が存在する。その時点で管理者エンティティと実行者の記録を追加する」とする。

### 依頼の内容と決定（Issue #20、2026-10-05 の会話）

- 管理者ログインを複数ユーザに対応させる。実装はリーズナブルに。
- Issue の選択肢のうち **B 案（Cognito User Pool + Hosted UI。Lambda@Edge で JWT を Cookie から検証）** を採る。A 案（SSM に複数ユーザのハッシュを置く）は採らない。
- Basic 認証は、現行のまま「単一ユーザ限定」の使い方として残す。Rolust を導入する人が、デプロイ時に Basic と Cognito を選べるようにする。
- 将来 C 案（既存 IdP との OIDC 連携）も取り込みたい。今回は作らず、足せる継ぎ目だけを作る。
- ユーザの追加・削除は `aws cognito-idp admin-create-user` などで運用者が行う。管理画面は作らない。
- パスワードの変更は、Hosted UI にある範囲（初回の強制変更と「忘れた」の再設定）だけとする。ログイン済みで自分から変更する画面は作らない。
- 方式を切り替える apply の間の空白期間（503）は許容する。
- 範囲は認証のみ。**実行者の記録（`x-rolust-actor`）と、排他制御（Assignment・ChangeRequest・IAM 反映）は別 Issue に切り出す**（4 節の「スコープ外」）。

### 前提（確認済みの事実）

- Cognito の料金（公式、2026-10-05 に確認）: 新規のユーザープールは Lite・Essentials とも 10,000 MAU まで無料。**Issue 本文の「50,000 MAU まで」は 2024-11-22 より前に作ったプールだけの話で、新規のプールには当てはまらない。**
- Lite プールでは、Hosted UI は旧来の **classic hosted UI** だけが使える（managed login は Essentials 以上）。classic hosted UI にもサインイン・パスワードの再設定・MFA の画面がある。
- ID トークンの有効期限は、アプリクライアントごとに 5 分〜1 日。ID トークンは RS256 で署名され、`iss`・`aud`（アプリクライアント ID）・`token_use`（`id`）・`exp`・`cognito:username` を持つ。
- Hosted UI は、セルフサービスのプロフィール変更（属性の変更や MFA の設定）を持たない。ログイン済みの任意のタイミングでのパスワード変更は、アクセストークンで `ChangePassword` を呼ぶ画面が要り、Hosted UI だけでは足りない。
- Lambda@Edge は環境変数を持てない（既存の制約）。設定は SSM から実行時に読む（IP 許可リストと同じ）。
- Cognito のアプリクライアントのコールバック URL には CloudFront のドメインが要る。CloudFront は Lambda を関連付ける。Terraform の参照で Lambda 側が Cognito を指すと循環する（3.3）。
- viewer-request は、キャッシュヒット時にも実行される。SPA の静的ファイルと `/api/*` が同じ関数を通る。
- `aws_cognito_user_pool` の `user_pool_tier`、`aws_cognito_user_pool_domain` の `managed_login_version`（classic hosted UI は `1`）が現行の AWS プロバイダー（`~> 6.0`）にあることは、plan の最初のタスクで `terraform validate` により確かめる。

### 成功基準

1. `auth_mode = "basic"`（既定）のとき、現行と同じ挙動である。認証なしは 401、正しい資格情報は通る。既存の導入に影響しない。
2. `auth_mode = "cognito"` のとき、Cookie の無いブラウザのアクセスは Cognito の Hosted UI に飛び、サインイン後に元の画面が開く。複数のユーザが、それぞれの資格情報でサインインできる。`/api/*` は、サインイン済みの Cookie で通る。
3. Cookie が無い・不正・期限切れの `/api/*` は、リダイレクトせず 401（JSON）を返す。他人のプールのトークン、別のアプリクライアントのトークン、署名の不正、期限切れは通らない。
4. 認証方式の設定が無い・不正・取得不能、または JWKS が取得できないときは、どのアクセスも通さない（503）。IP 許可リスト（FR-6.2）の判定は、どちらの方式でも認証の前に行う。
5. 初回ログインのパスワード強制変更と、「パスワードを忘れた」からの再設定が、Hosted UI で通る。
6. 2 つのモードで、`terraform apply` が循環なく通り、反映後の `terraform plan` が No changes になる。
7. 正本（5 節）が実装と一致する。README の手順を、経路として実行して通っている。
8. 認証の仕様を持つ `packages/edge-auth` は TDD で書かれ、`lint`・`typecheck`・`test`・`build` が緑。

## 2. 決定事項

| # | 決定 | 根拠 |
|---|---|---|
| 1 | 方式は Terraform 変数 `auth_mode`（`"basic"` / `"cognito"`、既定 `"basic"`） | 依頼者の決定。既定を `basic` にすると、既存の導入は何もしなくても挙動が変わらない（NFR-4 / SM-2 を保つ） |
| 2 | 方式の選択は SSM の String `/rolust/auth-mode`（値は `basic` / `cognito`）に置き、Lambda が実行時に読む | Lambda@Edge は環境変数を持てない。コード側で方式を埋め込むと、方式ごとに別のバンドルが要る。値が無い・不正なら 503（fail closed。許可リストと同じ） |
| 3 | Cognito の接続情報は別の SSM の String `/rolust/auth-cognito`（JSON）に置く。`auth_mode = "cognito"` のときだけ作る | 方式の選択（参照なし）と接続情報（Cognito のリソースを参照）を分けると、CloudFront が前者にだけ依存でき、循環しない（3.3） |
| 4 | `edge-auth` に認証プロバイダーの境界を作る。`authenticate(request) → 通す / 応答を返す` の 1 関数で、`basic` と `oidc` の 2 実装 | C 案（外部 IdP）を足すとき、プロバイダーの実装と設定の型を足すだけで済む継ぎ目。作るのは今回使う 2 つだけ（YAGNI） |
| 5 | Cognito 方式の中身は、Cognito 専用ではなく**汎用の OIDC クライアント**（認可コード + PKCE）として書く。設定の `issuer`・`clientId`・各エンドポイントで動く | Hosted UI は OIDC 準拠。実装量はほぼ同じで、C 案の外部 IdP は設定の値の差で載る。出荷するのは Cognito の組み立て（Terraform）だけ |
| 6 | クライアントは公開クライアント（シークレット無し）。認可コード + PKCE（S256）、`state` で CSRF を防ぐ | Lambda@Edge は環境変数を持てず、シークレットを置く場所を増やしたくない。PKCE で認可コードの横取りは防げる |
| 7 | 検証するのは ID トークン。署名（RS256、`kid` で JWKS の鍵を選ぶ）、`iss`、`aud`、`token_use=id`、`exp` | アクセストークンには `aud` が無い。ID トークンが「このアプリクライアントに対してサインインした」ことを示す |
| 8 | JWT の検証は `node:crypto`（JWK の読み込みと `verify`）で自前で書く。ライブラリは入れない | 検証は RS256 だけで足りる。Lambda@Edge のバンドルと `npm audit` の対象を増やさない（IP 許可リストの CIDR 判定を自前にしたのと同じ方針）。JWKS は 5 分キャッシュ。`kid` が未知なら 1 回だけ再取得する |
| 9 | セッションは ID トークンそのものを Cookie に載せる。有効期限は 1 日（Cognito の上限）。リフレッシュトークンは扱わない | 実装が小さい。1 日ごとの再ログインは、管理画面の使い方として許容できる。リフレッシュは必要になったら足す |
| 10 | Cookie は `__Host-rolust-id`（`Secure; HttpOnly; SameSite=Lax; Path=/`）。コールバックで使う一時値（`state`・PKCE の verifier・元のパス）は `__Host-rolust-pkce`（`Max-Age=900`） | `__Host-` 接頭辞で Domain 属性なし・Path=/ を強制する。`SameSite=Lax` は、Cognito からのトップレベルの GET のリダイレクトで Cookie が届くために必要（`Strict` だとコールバックで一時値が届かない） |
| 11 | `/callback` の `redirect_uri` はリクエストの `Host` ヘッダーから `https://<host>/callback` を組み立てる | Cognito がコールバック URL の完全一致を検証する（登録は CloudFront のドメインだけ）。Host を偽装しても、登録されていない URL は Cognito が拒否する。設定に CloudFront のドメインを持たせずに済み、循環も避けられる |
| 12 | `/api/*` で認証が通らないときは 302 を返さず、401（JSON、`WWW-Authenticate` なし）を返す | fetch が Cognito へのクロスオリジンのリダイレクトを辿ると CORS で壊れる。`WWW-Authenticate` を付けないのは、ブラウザの Basic 認証のダイアログを出さないため |
| 13 | サインインの失敗（`error` パラメータ、`state` の不一致、トークン交換の失敗）はリダイレクトしない。403 の固定本文を返す | 失敗のたびに Cognito へ戻すと、リダイレクトのループになる |
| 14 | Cognito の機能プランは Lite、Hosted UI は classic（`managed_login_version = 1`）。セルフサインアップは無効。パスワードの再設定のためにユーザのメールアドレスを検証済みで登録する | 依頼者の範囲（初回変更と再設定）は classic で足り、無料枠（10,000 MAU）に収まる。管理者がユーザを作る運用なので、サインアップは閉じる。再設定のコードはメールで届く |
| 15 | Cognito のユーザープールとドメインは、デプロイ先のリージョン（既定のプロバイダー）に作る。ドメインの接頭辞は `<project_name>-<アカウント ID>` | Lambda@Edge は設定の `issuer` とエンドポイントを使うので、リージョンに依存しない。接頭辞はグローバルに一意で、`aws`・`amazon`・`cognito` を含められない |
| 16 | 認証方式を変えても、`aws_ssm_parameter.basic_auth` と IP 許可リストは常に作る | 方式の切り替えで R-8（plan-guard）の意味を変えない。Cognito 方式のときの `basic-auth` はプレースホルダのまま |
| 17 | plan-guard の赤信号は新設しない | どの設定の誤りも 503（fail closed）になり、認証が外れる経路が無い。方式の変更は plan に差分として現れる（`auth-mode` の値は Terraform の管理下で、`ignore_changes` を付けない） |
| 18 | ユーザの権限の区別は作らない。プールに居るユーザは全員が管理者 | 管理者エンティティと実行者の記録は A-6 のとおり別の課題。ID トークンの `cognito:username` は検証後に取り出せるので、別 Issue で記録するときの足がかりになる |

## 3. 設計

### 3.1 `packages/edge-auth` の構造（TDD）

```
src/
  index.ts           ハンドラ。IP 判定 → 方式の取得 → provider.authenticate
  auth-config.ts     /rolust/auth-mode と /rolust/auth-cognito の取得・検証・5 分キャッシュ
  providers/
    types.ts         AuthProvider = (request) => Promise<request | response>
    basic.ts         既存の Basic 認証（挙動は変えない）
    oidc.ts          認可コード + PKCE。/callback の処理、Cookie の検証
  jwt.ts             ID トークンの検証（RS256、JWKS、iss・aud・token_use・exp）
  cookies.ts         Cookie の読み書き
  ip-allowlist.ts    既存（変更なし）
```

- 既存の `index.ts` にある Basic 認証の部分を `providers/basic.ts` に移す。**挙動と応答（401・503・ログ）は変えない**。既存のテストはそのまま通らなければならない。
- ハンドラの流れ:

```
request が無い                           → 503（従来どおり）
許可リストの取得・解釈に失敗               → 503
isAllowed(request.clientIp) でない        → 403
auth-mode の取得に失敗・値が不正           → 503
mode = basic                             → basic.authenticate
mode = cognito                           → oidc.authenticate
```

- 設定の取得は、成功したときだけ 5 分キャッシュする（許可リストと同じ。失敗を保持しない）。`resetCredentialCache()` は新しいキャッシュも捨てる。

### 3.2 OIDC の流れ（`providers/oidc.ts`）

`/rolust/auth-cognito` の JSON:

```json
{
  "issuer": "https://cognito-idp.<region>.amazonaws.com/<poolId>",
  "clientId": "<appClientId>",
  "authorizationEndpoint": "https://<prefix>.auth.<region>.amazoncognito.com/oauth2/authorize",
  "tokenEndpoint": "https://<prefix>.auth.<region>.amazoncognito.com/oauth2/token",
  "jwksUri": "https://cognito-idp.<region>.amazonaws.com/<poolId>/.well-known/jwks.json"
}
```

- 5 つの値のどれかが無い・文字列でない・`https://` で始まらないときは不正（503）。値の型は C 案の外部 IdP でもそのまま使える形にする。

リクエストごとの判定（順に）:

1. パスが `/callback` → コールバックの処理（下）。
2. Cookie `__Host-rolust-id` があり、ID トークンの検証（3.2.1）に通る → 通す（`request` を返す）。
3. それ以外で、パスが `/api/` で始まる → 401（JSON `{"message":"Unauthorized"}`、`Cache-Control: no-store`）。
4. それ以外 → サインインへのリダイレクト。`state`（ランダム）と PKCE の `code_verifier`（ランダム）を作り、元のパスとクエリ、`state`、`code_verifier` を `__Host-rolust-pkce`（`Max-Age=900`）に入れ、`authorizationEndpoint` へ 302。パラメータは `response_type=code`・`client_id`・`redirect_uri=https://<Host>/callback`・`scope=openid`・`state`・`code_challenge`（S256）・`code_challenge_method=S256`。`Cache-Control: no-store`。

`/callback`:

1. `error` パラメータがある、`code` か `state` が無い、`__Host-rolust-pkce` が無い、`state` が Cookie の値と一致しない → 403（固定本文、`__Host-rolust-pkce` を消す）。リダイレクトしない（決定 13）。
2. `tokenEndpoint` に POST（`grant_type=authorization_code`・`client_id`・`code`・`redirect_uri`・`code_verifier`）。応答が 200 でない、または `id_token` が無い → 403。取得の失敗（ネットワーク・タイムアウト）は `console.error` を残して 503。
3. ID トークンを検証する（3.2.1）。通らなければ 403。
4. 302 で元のパスへ。`Set-Cookie` で `__Host-rolust-id=<id_token>`（`Max-Age` は `exp` までの秒数）を付け、`__Host-rolust-pkce` を消す。元のパスは `/` で始まり `//` で始まらない相対パスだけを受け入れ、それ以外は `/` にする（オープンリダイレクトを防ぐ）。

#### 3.2.1 ID トークンの検証（`jwt.ts`、純粋に近い関数）

- 3 つの部分に分け、ヘッダーの `alg` が `RS256` であること（`none` や他のアルゴリズムは拒否。アルゴリズムの差し替えを防ぐ）、`kid` が JWKS にあることを確かめる。
- 署名を `crypto.createPublicKey({ key: jwk, format: "jwk" })` と `crypto.verify("RSA-SHA256", …)` で検証する。
- ペイロードの `iss` が設定の `issuer` と一致、`aud` が `clientId` と一致、`token_use` が `id`、`exp` が現在より後。
- JWKS は `jwksUri` から取得して 5 分キャッシュする。`kid` が未知のときは 1 回だけ再取得する（鍵のローテーション）。取得できなければ 503（呼び出し側で fail closed）。

### 3.3 Terraform

**変数**（`infra/variables.tf`、`terraform.tfvars.example`）

- `auth_mode`: `"basic"` / `"cognito"`、既定 `"basic"`。`validation` で他の値を拒否する。
- `auth_mode_parameter_name`（既定 `/rolust/auth-mode`）、`auth_cognito_parameter_name`（既定 `/rolust/auth-cognito`）。既存と同じく、変更する場合は `packages/edge-auth` の定数も書き換えて再ビルドする旨を説明に書く。

**SSM**（`infra/edge-auth.tf`、`provider = aws.us_east_1`）

- `aws_ssm_parameter.auth_mode`: String、値は `var.auth_mode`。`ignore_changes` は付けない（切り替えは Terraform の変数で行い、plan に差分が出る）。
- `aws_ssm_parameter.auth_cognito`: String、`count = var.auth_mode == "cognito" ? 1 : 0`、値は JSON（3.2）。`jsonencode` で組み立て、Cognito のユーザープール・クライアント・ドメインを参照する。

**Cognito**（新規ファイル `infra/cognito.tf`。すべて `count = var.auth_mode == "cognito" ? 1 : 0`、既定のプロバイダー）

- `aws_cognito_user_pool`: `user_pool_tier = "LITE"`、`admin_create_user_config { allow_admin_create_user_only = true }`、自動検証属性は `email`、`account_recovery_setting`（`verified_email`）、パスワードポリシーは Cognito の既定より弱くしない。
- `aws_cognito_user_pool_domain`: `domain = "<project_name>-<アカウント ID>"`、`managed_login_version = 1`。
- `aws_cognito_user_pool_client`: `generate_secret = false`、`allowed_oauth_flows = ["code"]`、`allowed_oauth_scopes = ["openid"]`、`allowed_oauth_flows_user_pool_client = true`、`supported_identity_providers = ["COGNITO"]`、`callback_urls = ["https://${aws_cloudfront_distribution.rolust.domain_name}/callback"]`、`id_token_validity = 1` と `token_validity_units { id_token = "days" }`、`prevent_user_existence_errors = "ENABLED"`。`logout_urls` は設けない（ログアウトはスコープ外）。

**循環の回避**（実装で守る制約）

- `aws_cloudfront_distribution.rolust` は、`auth_mode` の SSM（参照なし）だけに `depends_on` する。`auth_cognito` には依存させない。
- `aws_iam_role_policy.edge_auth_ssm` の `Resource` に、`aws_ssm_parameter.auth_cognito` の ARN を**参照で入れない**。`arn:aws:ssm:us-east-1:<アカウント ID>:parameter<名前>` を変数と `data.aws_caller_identity` から文字列で組み立てる（参照すると、ポリシー → パラメータ → クライアント → CloudFront → ポリシー、の循環になる）。同じ理由で、既存の 2 パラメータの ARN の書き方にそろえない。
- `auth_cognito` は CloudFront の更新の後に作られる。初回の切り替えでは、数秒〜数分、Lambda が `auth-cognito` を読めず 503 になりうる（空白期間。許容済み）。

**IAM**: `edge_auth_ssm` に、`auth_mode` と `auth_cognito` の `ssm:GetParameter` を足す（KMS は要らない。String）。Cognito を呼ぶ権限は Lambda に要らない（トークンエンドポイントと JWKS は公開の HTTPS）。Lambda@Edge の実行ロールの信頼ポリシーは変えない。

**出力**（`infra/outputs.tf`）: `auth_mode`、Cognito 方式のときの `cognito_user_pool_id`、ユーザの追加コマンド（`set_basic_auth_command` と同じ位置づけ）。

**plan-guard**: 赤信号は新設しない（決定 17）。R-5（関連付け）・R-8（`basic_auth` と許可リストの値の上書き）・R-10（`DenySelfEscalation` の網羅。Rolust が作る IAM ロールは増えない）の判定は変えない。回帰テストは、`auth_mode = "cognito"` の plan の fixture でも赤信号が出ないことを加える。

**CI の plan ロール**（`rolust-ci-plan`）は Terraform の管理外で、Cognito の refresh 権限を持たない。`auth_mode = "cognito"` を `main` で使うなら、plan が `cognito-idp:Describe*` などを呼べるよう、plan ロールに足す必要がある（`.claude/rules/aws-infra.md` § CI/CD の手順で洗い出し、`cicd-pipeline.md` の JSON も同じ PR で直す）。**本番は実測の後に `cognito` のままにする（依頼者の決定、2026-10-05）ので、この権限の追加は必須である。** 権限の追加は、plan の早いタスク（実測の前）で行う。

**CD に `auth_mode` を渡す**: `cd.yml` の `terraform plan` は tfvars を渡さず、変数の既定値で走る。本番が `cognito` で既定が `basic` のままだと、CD の plan は Cognito の破棄を差分として出し続ける。`cd.yml` の plan ステップに `TF_VAR_auth_mode: ${{ vars.AUTH_MODE }}` を足し、GitHub のリポジトリ変数 `AUTH_MODE` に `cognito` を設定する（変数が未設定の導入先では、空文字ではなく既定の `basic` になるよう、`${{ vars.AUTH_MODE || 'basic' }}` と書く）。リポジトリ変数の設定は `merge` の前に行う（行わないと、`main` の CD が差分を出す）。`ci.yml` の Terraform 検証（`validate`）は、`basic` と `cognito` の両方を回す。

### 3.4 運用手順（README）

- **方式の選択**: `terraform.tfvars` に `auth_mode = "cognito"` を書いて apply する。切り替えの間、最大 5 分は 503（キャッシュ）。Cognito は反映の後に作られるので、Hosted UI が出るまで数分かかる。
- **ユーザの追加**: `aws cognito-idp admin-create-user --user-pool-id <id> --username <name> --user-attributes Name=email,Value=<mail> Name=email_verified,Value=true --temporary-password '<一時パスワード>'`。初回のサインインで新しいパスワードの設定を求められる。メールアドレスは再設定のために検証済みで登録する。
- **ユーザの削除・無効化**: `admin-delete-user` / `admin-disable-user`。**すでに発行された ID トークンは、有効期限（最大 1 日）まで使える**（リフレッシュとリボケーションの確認はしない）。即時に締め出す場合は `auth_mode` を切り替えるか、プールを作り直す。この制約を README に明記する。
- **パスワードの変更**: 初回の強制変更と、サインイン画面の「パスワードを忘れた」から。ログイン済みで自分から変更する画面は無い。運用者は `admin-set-user-password` でいつでも設定できる。
- **Cognito が既定のメール送信を使う**ので、送信数に上限がある（管理者が数人の規模では問題にならない）。
- **Basic に戻す**: `auth_mode = "basic"`（または削除）にして apply。Cognito のユーザープールは破棄され、ユーザは失われる。

### 3.5 検証

| 層 | 判定 |
|---|---|
| `packages/edge-auth` | TDD。下のテスト。`npm run lint`・`typecheck`・`test`・`build` |
| Terraform | `terraform fmt -check -recursive`・`terraform validate`・`auth_mode` ごとの `terraform graph`（依存の循環の検査。`validate` は構成を静的に見るだけで、`count` の分岐で変わる循環はグラフを作らないと見えない。S3 バックエンドのままだと `graph` は資格情報を要求するので、local バックエンドの override で回す。意図した循環で exit 1、正しい構成で両方 exit 0 を実測済み）・plan-guard。`infra/` を変えるので Trivy（CRITICAL/HIGH） |
| plan-guard | `plan-guard.test.sh`（`cognito` の fixture を含む） |
| 文書 | 5 節の grep の総当たり。`git diff --numstat` で差分が意図した箇所だけであること |
| 秘密情報 | `gitleaks git . --no-banner --redact --exit-code 1`（8.30.1）。依存は変えないので `npm audit` は対象外 |
| AWS | 下の実測 |

**ユニットのテスト**

- `jwt`: 有効なトークン（テスト用に生成した RSA 鍵で署名）。署名の改ざん、`alg` が `none`・`HS256`、`kid` が未知（再取得して通る・再取得しても無ければ拒否）、`iss` の不一致、`aud` の不一致、`token_use` が `access`、期限切れ、3 部分でない、JWKS の取得失敗。
- `oidc`: Cookie 無しの HTML リクエストは 302（`state`・PKCE の値、`Set-Cookie` の属性、`redirect_uri` が Host から作られること）。Cookie 無しの `/api/` は 401 で `WWW-Authenticate` が無い。有効な Cookie は通る。`/callback` は、成功（トークン交換の引数と Cookie の属性、元のパスへの 302）、`error` あり・`state` の不一致・一時 Cookie 無し・トークン交換が 4xx・検証に失敗、のいずれも 403 でリダイレクトしない。元のパスが `//evil.example` や絶対 URL のときは `/` にする。トークン交換のネットワーク失敗は 503。
- `auth-config`: `auth-mode` が `basic`・`cognito`・不正・欠落。`auth-cognito` の欠落・不正な JSON・値の欠落・`https` でない。成功だけをキャッシュし、失敗は保持しない。
- ハンドラ: IP が拒否されたら 403 で認証を呼ばない。`basic` のときは既存と同じ応答。`cognito` のときは OIDC に渡る。
- 既存のテストは、無変更で通る。

**実 AWS の実測**（jump-admin、`ap-northeast-1`。モックでは外部サービスの拒否を再現できないので、必ず実測する。手順は依頼者が引き取れる形で残す）

| 段階 | 操作 | 期待 |
|---|---|---|
| 0 | 反映前の退避 | 本番の `terraform.tfvars`・`auth-mode`（無ければ未作成）の値・Basic の資格情報の控え |
| 1 | `auth_mode = "basic"` のまま新しいコードを反映（空白期間の最大 5 分の後） | 認証なしは 401、Basic で 200。既存のテストと同じ |
| 2 | `auth_mode = "cognito"` に切り替えて apply | 反映の途中で 503 が出うる。5 分以内に収束する |
| 3 | 検証用ユーザを 2 人作る（`admin-create-user`、メールは検証済み） | 作成できる |
| 4 | 認証なしで `/`（`curl`）、`/api/pools` | `/` は 302（Cognito の `/oauth2/authorize`）。`/api/pools` は 401（`WWW-Authenticate` なし） |
| 5 | ヘッドレスブラウザ（Playwright）で、ユーザ A として `/` を開く | Hosted UI → 一時パスワードの強制変更 → サインイン → 元の画面（マトリクス）が表示される。API も通る |
| 6 | 別のコンテキストで、ユーザ B で同様に | 通る。A と B は別のセッション |
| 7 | 他人のプールの ID トークン、別のアプリクライアントのトークン、改ざんしたトークンを Cookie に置く | いずれも `/api/pools` が 401、`/` が 302 |
| 8 | 「パスワードを忘れた」からの再設定（メールの確認コード） | 再設定でき、新しいパスワードでサインインできる |
| 9 | 直 URL（API Gateway）にキー無しでアクセス | 403（FR-6.3 は変わらない） |
| 10 | `auth_mode = "cognito"` で、許可リストに自分の IP を含まない値を入れる | 403（IP 判定が認証より前） |
| 11 | 後片付け | 検証用ユーザを削除する。**本番は `cognito` のままにする**（依頼者の決定）。依頼者の管理者ユーザ（ユーザ名とメールアドレスは依頼者が指定）を `admin-create-user` で作り、依頼者が初回サインインとパスワード設定まで通れることを確かめてから、実測を終える。リポジトリ変数 `AUTH_MODE = cognito` を設定してから merge する。`basic-auth` の SSM の値は、`basic` に戻す場合に備えてそのまま残す |

- 段階 2〜11 の間、依頼者を含む全員が Basic のダイアログではなく Cognito の画面になる。実施の日時を事前に合わせる。
- merge の前に、3.3 の plan ロールの権限とリポジトリ変数 `AUTH_MODE` を済ませる。merge 後、`main` の CD の plan が No changes で、plan-guard の赤信号が 0 件であることを確かめる。

### 3.6 スコープ外・リスク

**スコープ外**（別の課題として扱う。Issue は、本 spec の承認後に本文を見せてから作る）

- **実行者の記録**: `x-rolust-actor` ヘッダで API に渡し、ChangeRequest の作成者・反映者として保存する。ID トークンの `cognito:username` が足がかり。
- **排他制御**: Issue #20 のコメント（2026-10-04）の論点。対象は Assignment のセル更新、ChangeRequest の承認・反映、同じロールの信頼ポリシーの read-modify-write。方式は DynamoDB の条件付き書き込み（楽観ロック）と反映時のロックを比べる。競合したときの見せ方（失敗の通知・再読み込みの案内）も含める。
- ログアウト、リフレッシュトークン、ログイン済みのパスワード変更の画面、MFA の強制、カスタムドメイン、外部 IdP との連携（C 案）、`/api/*` が 401 を返したときに SPA が自動で再ログインする改善。

**リスクと受容**

| リスク | 扱い |
|---|---|
| ユーザを削除・無効化しても、発行済みの ID トークンは最大 1 日有効 | 受容。README に明記する。即時の締め出しは `auth_mode` の切り替え |
| ID トークンの有効期限（1 日）後、開いたままのタブの API が 401 になり、手動の再読み込みが要る | 受容（スコープ外に改善を記録） |
| 認証方式の切り替えの間の 503 | 依頼者が許容済み |
| プールのユーザは全員が管理者で、権限の区別が無い | A-6 のとおり別の課題 |
| Lite の classic hosted UI は managed login より機能が少ない（パスキーなど） | 範囲（初回変更・再設定）には足りる。Essentials への変更は将来 |
| Cognito が既定のメール送信を使うので、再設定のメールに送信数の上限がある | 管理者が数人の規模では問題にならない。README に書く |
| Lambda@Edge から Cognito のトークンエンドポイントを呼ぶので、サインイン時だけ外部呼び出しが入る（timeout 5 秒） | サインインのときだけ。通常のリクエストは Cookie の検証で完結する。JWKS は 5 分キャッシュ |

## 4. 正本への反映

| 文書 | 覆す | 足す | 直す節 |
|---|---|---|---|
| `docs/design/requirements.md` | FR-6.1 の「具体手段は実装時に選定」を、方式の選択（Basic / Cognito）に更新する。A-6 の「将来的に複数の管理者」のうち、認証の複数ユーザ化は #20 で対応済みと注記する（管理者エンティティと実行者の記録は未実装のまま） | FR-6.4（管理者認証の方式選択と、Cognito 方式の挙動）、トレーサビリティの 1 行、冒頭の追記注記 | FR-6 の節、A-6 |
| `docs/design/iam-policy-design-note.md` | なし | なし | 冒頭の追記注記、§ 3.7（資格情報に加えて認証方式と Cognito の接続情報も SSM に置く）、§ 3.8（`ssm:GetParameter` が 4 パラメータになる。KMS は SecureString の `basic-auth` だけ）、§ 4（管理画面の防御の記述が Cognito 方式にも当てはまること） |
| `docs/design/deployment-strategy.md` | なし | Cognito のリソースと `auth-mode`・`auth-cognito` の SSM の扱い（`auth-mode` は Terraform の管理下、`basic-auth` は管理外のまま） | 冒頭の追記注記、資格情報の行（107）、方式の切り替えの空白期間 |
| `docs/design/rollback-runbook.md` | 83・84 行の「Basic 認証のダイアログが出ない = 200」「503 は資格情報の未投入」は Basic 方式の記述。Cognito 方式では、認証なしの期待が 302（`/api/` は 401）になる | Cognito 方式のときの判定と、方式を戻す手順 | 冒頭の段落、83・84 行、288 行の `401` の期待 |
| `docs/design/cicd-pipeline.md` | なし | plan ロールの Cognito の refresh 権限（`cognito` を `main` で使う場合） | 冒頭の追記注記、§ 権限ポリシー、R-5 の「401 を期待」の記述 |
| `docs/design/cd-config.md` | なし | `cd.yml` が `TF_VAR_auth_mode` を渡すこと（リポジトリ変数 `AUTH_MODE`） | 冒頭の追記注記、282・351 行の「200 が返ったら Basic 認証が働いていない」「401 / 503 を成功条件とする」を、方式で期待が変わる記述に |
| `README.md` | 手順 5「Basic 認証の資格情報を投入する」は `auth_mode = "basic"` のときの手順に限定する。手順 6 の「Basic 認証のダイアログが出る」の判定を方式別にする。「Basic 認証は『最小限のアクセス制限』である」の節 | 認証方式の選択、Cognito のユーザの追加・削除・パスワード、発行済みトークンの有効期限の制約、Basic に戻す手順、機微情報の扱い（Cognito 方式は秘密を持たない） | 手順 4〜6、`basic_auth_parameter_name` の注記（757 行付近）、認証の節 |
| `.claude/rules/aws-infra.md` | なし | § Lambda@Edge・CloudFront に、Cognito のコールバック URL による循環と、SSM ポリシーの ARN を文字列で組む理由（1 項目） | § Lambda@Edge・CloudFront |
| `.github/workflows/cd.yml`・`ci.yml` | なし | `cd.yml` の plan に `TF_VAR_auth_mode`、`ci.yml` の `terraform` ジョブに、`auth_mode` ごとの `terraform graph`（循環の検査）を足す | なし |
| `.github/scripts/plan-guard.test.sh`、`testdata/` | なし | `auth_mode = "cognito"` の fixture で赤信号が出ない回帰テスト | なし |
| `docs/design/README.md` | なし | なし | なし |
| `packages/api/TABLE-DESIGN.md` | なし | なし | なし |
| 画面設計（`mockups.md`・`interaction-spec.md`） | なし | なし | なし（SPA の変更は無い） |
| `aidlc/` | 書き換えない | なし | なし |

- ID は変えない。FR-6.4 は末尾に置く。
- 来歴は二層にする。冒頭の追記注記（日付・Issue #20・変更の全体像）と、各箇所の「Issue #20 により 2026-10-05 追記・訂正」。
- 実装時に、`401`・`Basic 認証`・`basic-auth`・`ダイアログ`・`資格情報` を `docs/design/`・`README.md`・`.claude/rules/` で grep し、Basic 方式だけを前提にした記述を総当たりで直す（`aidlc/`・`docs/superpowers/` は対象外）。
- Issue #20 の本文のチェックリストは、案を B に決めたこと、格納形式（A 案）の項目を取り下げたこと、Hosted UI の料金の訂正（新規プールは 10,000 MAU）を、コメントで残す。
