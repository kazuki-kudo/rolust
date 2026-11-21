# 制約と既知の帰結（そのほか）

## Terraform の state に機微情報が入る

（Issue #266 により 2026-11-21 訂正: 訂正前は、Basic 認証の資格情報（SSM の SecureString）も state に入ると書き、「これは解消できません」としていた。資格情報は Terraform の管理から外したので、入らなくなった。入るのは API Gateway の API キーの値だけである。）

`aws_ssm_parameter` の SecureString は、`terraform plan` / `refresh` が**復号して読み取り、state に平文で書き込みます**（`terraform plan -out` の plan ファイルにも入ります）。`ignore_changes` は差分の抑止であって、state への記録は止めません。

Basic 認証の資格情報（`/rolust/basic-auth`）は、この理由で **Terraform の管理から外してあります**。Terraform が作らず、利用者が `aws ssm put-parameter` で作るので（[setup.md](setup.md) の「認証の準備」）、state にも plan にも入りません。

**API Gateway の API キー（`aws_api_gateway_api_key`）の値は、解消できません。** CloudFront に `x-api-key` として渡すために Terraform が持つ値で、state に入ります。リモート化で得られるのは暗号化とアクセス制限であって、値が state に入ること自体は変わりません。

- state は S3（SSE-KMS）に置きます（[setup.md](setup.md) の「Terraform state の置き場所を決める」）。バケットへのアクセスを制限してください。
- `infra/bootstrap/` が作るバケットは SSE-KMS・バージョニング有効・パブリックアクセス全ブロック・HTTPS 強制・`force_destroy = false` です。**既存のバケットを使う場合は、少なくとも暗号化とバージョニングが有効であることを確認してください。**
- ローカルの `terraform.tfstate` を共有・コミットしないでください（`.gitignore` 済み）。
- `infra/backend.hcl` はアカウント ID を含むため `.gitignore` 済みです。共有する必要はありません。
- **API Gateway の API キー（`aws_api_gateway_api_key`）の値は、state と plan の artifact に入ります**（CloudFront に `x-api-key` として渡す値のため）。CI で `terraform plan` を走らせる場合は、plan の artifact の保持期間を最小にしてください。state へのアクセスも制限してください。鍵を入れ替えるには `terraform apply -replace=aws_api_gateway_api_key.rolust` を実行します。CloudFront の更新が終わるまでの数分、`/api/*` は 403 になります。

`auth_mode = "cognito"` では、Rolust は秘密を持ちません。SSM に置く接続情報（`/rolust/auth-cognito`）は issuer・クライアント ID・エンドポイントの URL だけで、公開情報です。`basic-auth` の SSM（SecureString）は、Terraform が作りません（Issue #266 により 2026-11-21 訂正: 訂正前は、`cognito` でもプレースホルダのまま作られると書いていた）。`cognito` では作らなくてよく、読まれることもありません。

state バケットに S3 アクセスログは設定していません（Trivy の `AWS-0089`、重大度 LOW）。ログ用のバケットが追加で必要になり、`terraform apply` が作るものが増えるためです。state の読み取りを監査したい場合は CloudTrail のデータイベントを有効にしてください。

## そのほか

- **申請に保持期間や件数上限はありません**。申請履歴は、初期は作成日が直近 3 か月の申請（と、期間によらず下書き・失敗）を読みます。作成日の範囲を変えると、それ以前の申請も読めます。件数が約 1,000 件に達したら、ページングを別途検討します。
- **1 IAMロールにつき未反映（下書き / 失敗）の申請は 1 件まで**です。失敗した申請を放置すると、そのロールの新しい申請を作成できません。反映するか、申請履歴から破棄してください。
- `basic_auth_parameter_name` を既定値から変更する場合、Lambda@Edge は環境変数を持てないため `packages/edge-auth/src/index.ts` の `CREDENTIALS_PARAMETER_NAME` も同じ値に書き換えて再ビルドする必要があります。
- `ip_allowlist_parameter_name` を既定値から変更する場合も同じで、`packages/edge-auth/src/index.ts` の `IP_ALLOWLIST_PARAMETER_NAME` を同じ値に書き換えて再ビルドする必要があります。
- `auth_mode_parameter_name`・`auth_cognito_parameter_name` を既定値から変更する場合も同じで、`packages/edge-auth/src/index.ts` の `AUTH_MODE_PARAMETER_NAME`・`AUTH_OIDC_PARAMETER_NAME` を同じ値に書き換えて再ビルドする必要があります。
- SPA のバンドルは Cloudscape を含むため、圧縮後でも JS 約 290 kB / CSS 約 230 kB あります。初回表示は相応に重くなります。
