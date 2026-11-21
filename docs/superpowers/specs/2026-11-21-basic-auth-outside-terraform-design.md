# Basic 認証の SecureString を Terraform の管理から外す（Issue #266）

規模: 小さな変更（bounded）。短い設計として、チャットで承認済みの内容を記す。

## 意図と理由

`aws_ssm_parameter.basic_auth`（SecureString）は、`ignore_changes = [value]` を付けていても、refresh のたびに復号値を state に書き、`plan -out` の plan ファイルにも入る。`ignore_changes` は差分を抑えるだけで、これを止めない。Terraform の管理から外せば、Basic 認証の資格情報は state にも plan にも入らない。

## ゴール・非ゴール

- ゴール: 新規デプロイで state に Basic 認証の資格情報が入らない。既存環境は、パラメータを消さず、管理画面を閉じずに移行できる。
- 非ゴール: `aws_api_gateway_api_key` の値（CloudFront に渡すため state に残る）、`ip_allowlist`・`allowed_account_ids`（機微でない）、write-only 属性（`value_wo`。Terraform 1.11 以降が要り、保証も未確認）。
- アンチゴール: 移行で資格情報が失われる、または認証が開く（fail open）こと。

## 実測した前提（2026-11-21）

- **fail closed**: `createBasicProvider` は、資格情報の取得が例外になると 503 を返す。`ParameterNotFound` も SDK の例外で、この経路に乗る。テストにあるのは `AccessDeniedException` だけなので、`ParameterNotFound` のテストを足す。
- **`removed` ブロック**: Terraform 1.10.5 で、`terraform_data` を使って実測した。plan の JSON は `actions: ["forget"]` を出し、apply 後の `state list` は空になり、実体は削除されない。
- **plan-guard**: R-8 が見るのは `update` だけなので、`forget` は赤信号にならない。`forget` の fixture で回帰テストを足す。
- **cognito**: `setup.md` の手順は basic と cognito で分岐済み。直すのは `limitations.md` の「プレースホルダのまま作られます」の 1 文。

## 案

案 A（Issue の方針）の 1 つだけ。write-only 属性は上記の理由で採らない。他の案（SecureString の data source 経由など）は、復号値が state に入るので目的に反する。

## 設計

1. `infra/edge-auth.tf` の `aws_ssm_parameter.basic_auth` を削除する。
2. `removed { from = aws_ssm_parameter.basic_auth  lifecycle { destroy = false } }` を置き、**残し続ける**（私の判断）。版を飛ばして更新した利用者の state に `basic_auth` が残っていて、ブロックが無いと、SecureString が destroy される。資格情報が消え、管理画面が閉じる。
3. `edge_auth_ssm` の `ReadCredentials` の Resource は、`auth_cognito` と同じ形で、名前とアカウントから ARN の文字列を組む（`arn:${local.partition}:ssm:us-east-1:${local.account_id}:parameter${var.basic_auth_parameter_name}`）。既存環境の IAM ポリシーに差分が出ないことを、plan で確かめる。
4. `outputs.tf` の `basic_auth_parameter_name`・`set_basic_auth_command` は、変数 `basic_auth_parameter_name` から出す。コマンドは `--overwrite` を残す（私の判断）。`put-parameter --overwrite` は、無ければ作成、あれば更新になり、新規と移行済みの両方に使える。説明文を「作る（更新も同じコマンド）」に直す。
5. `plan-guard.sh` の R-8 から `basic_auth` の名指しと対応するメッセージを外す。新しい規則は足さない（`removed` を残すので足りる）。
6. 手順書は、資格情報の投入を「作成」にする（`setup.md`・`en/setup.md` を同時に）。`limitations.md` の「state に機微情報が入る」の節は、SSM の資格情報が入らなくなり、API キーだけが残る、と直す。「plan が state に書く」の不正確な記述も直す。

## 正本への反映

来歴は「Issue #266 により 2026-11-21 追記・訂正」の形で付ける。

- `docs/design/requirements.md`: **FR-6.1 の手段**の節（資格情報を SSM の SecureString に置く）に、Terraform の管理外であり state に入らない旨を追記する。FR の ID と本文は変えない。
- `docs/design/iam-policy-design-note.md`: 3.7 に同旨を追記する。3.8 の Lambda@Edge 実行ロールの表に、`basic-auth` の ARN の組み方（文字列）が書かれていれば合わせる。
- `docs/design/cicd-pipeline.md`（290 行付近・451 行付近・R-8 の行 533）: plan ロールが `basic_auth` を refresh して復号値を state・plan に書く、という記述を訂正する。plan ロールの `ssm:GetParameter` は、ほかのパラメータの refresh に要るので残る。
- `docs/design/cd-config.md`（101 行付近）、`deployment-strategy.md`（139・166 行付近）、`rollback-runbook.md`（93・191 行付近）、`docs/runbooks/cross-account-roles.md`: 同種の記述を grep で総当たりし、同じ来歴で直す。
- `infra/bootstrap/main.tf`（41 行付近）のコメント。
- 覆す ID: なし。足す ID: なし。

## テスト・検証

- TDD（`packages/edge-auth`）: `ParameterNotFound` で 503（fail closed）。
- `plan-guard.test.sh`: `forget` の fixture が赤信号にならないこと。R-8 が `ip_allowlist`・`allowed_account_ids` で働き続けること。
- Terraform: `fmt -check`・`validate`、新規相当の plan（`state list` に `basic_auth` が無い）、既存環境の plan（destroy が 0 件、`forget` が 1 件、IAM ポリシーに差分なし）。
- 手順書: 新規デプロイの手順を、経路として実行して確かめる。
- 実 AWS の反映と実測（既存環境の plan・apply）は、plan の最終タスクとして、`docs/guide/operations.md` の手順で依頼者が行う（CD は無い）。

## `CHANGELOG.md`

`## 未リリース` に追記する。`### 更新時にやること` に、既存環境の移行（`terraform plan` で `forget` が 1 件・destroy が 0 件であることを確かめてから apply。パラメータはそのまま使える）を書く。
