# セットアップ

[English](en/setup.md) | **日本語**

Rolust をデプロイ先のアカウントに入れる手順です。

Rolust を手に入れる経路は 2 つあります。**経路 A** は Release の tarball を展開して使う方法で、`npm` もリポジトリの取得も要りません。**経路 B** はリポジトリのソースを自分でビルドする方法で、Node.js と `npm` が要ります。詳細は「1. 入手する」にあります。

## 前提

| 必要なもの | バージョン / 条件 |
|---|---|
| Node.js | 24 以上（`package.json` の `engines`）。**Release の tarball から入れる場合（経路 A）は不要です** |
| npm | Node.js 同梱のもの。経路 A では不要です |
| Terraform | **1.10 以上**（state のロックに S3 ネイティブロック `use_lockfile` を使うため） |
| bash・jq | `plan-guard.sh` が使います（Windows では Git Bash）。経路 A でも必要です |
| Terraform state 用の S3 バケット | 1 つ。無い場合は `infra/bootstrap/` が作ります（手順 2） |
| AWSアカウント | Rolust のデプロイ先として 1 つ。管理対象の IAMロールは、同じアカウントにも、別のアカウント（ターゲット。[cross-account.md](cross-account.md) を参照）にも置けます。デプロイ先に管理対象のロールが無くても構いません |
| AWS 認証情報 | 標準の認証情報チェーン（`~/.aws/credentials`、`AWS_PROFILE`、SSO など）で解決できること。**`terraform` は `aws --profile` のようにプロファイルを引数で受けません。**`export AWS_PROFILE=<プロファイル> AWS_REGION=<リージョン>` で渡し、`aws sts get-caller-identity --profile <プロファイル> --region <リージョン>` で、意図したアカウントに解決されることを確かめます（手順 2 の冒頭と、下の注記） |

> **`terraform` が `No valid credential sources found` で落ちるとき**: 末尾に `ec2imds: GetMetadata ... connectex` などと出ますが、原因ではありません。標準の認証情報チェーンが、最後に IMDS を試して届かなかっただけです。`terraform init` は通るので気づきにくく、`plan` や `apply` で初めて落ちます。上の `AWS_PROFILE` / `AWS_REGION` を環境変数で渡すと通ります（`terraform` の provider はプロファイルを固定していません）。

**apply に必要な IAM 権限**: Terraform の実行者には S3 / CloudFront / API Gateway / Lambda / DynamoDB / SSM / CloudWatch Logs の作成権限に加えて、**IAMロールとポリシーの作成権限**が必要です。`iam:CreateRole` / `iam:PutRolePolicy` / `iam:PassRole` を含む権限がないと `terraform apply` は途中で失敗します。

## 1. 入手する

Rolust を手に入れる経路は 2 つあります。**手順 2 以降は、どちらの経路でも同じです。** 以降の `infra/`・`.github/` は、経路 A では tarball の展開先、経路 B ではリポジトリのルートからの相対パスです。

### A. Release の tarball から（利用者。`npm` もリポジトリの取得も不要）

1. GitHub の [Releases](https://github.com/kazuki-kudo/rolust/releases) で、使う版の **`rolust-vX.Y.Z.tar.gz`** と **`SHA256SUMS`** を、同じ場所にダウンロードします。`gh release download vX.Y.Z --repo kazuki-kudo/rolust` でも取れます。

   > **「Source code」の zip・tar.gz を取らないでください。** それはビルド前のソースで、Lambda のバンドルと SPA が入っていません。取ると `terraform apply` が失敗します。Release に**添付された** `rolust-vX.Y.Z.tar.gz` を使います。

2. チェックサムを確かめます。`OK` と出ることを確認してください。

   ```bash
   sha256sum -c --ignore-missing SHA256SUMS      # => rolust-vX.Y.Z.tar.gz: OK
   ```

   `SHA256SUMS` と tarball は同じ場所から取っています。同じ場所に置かれたファイルが差し替えられていたら、このチェックでは見つかりません。取得元が GitHub の Releases であることを確かめてください。

3. 展開して、展開先に移ります。

   ```bash
   tar -xzf rolust-vX.Y.Z.tar.gz
   cd rolust-vX.Y.Z

   ```

### B. ソースから（開発者）

```bash
npm install
npm run build

```

`npm run build` は次の 3 つを作ります。`terraform apply` はこれらを読むので、**apply の前に必ず実行してください**。

- `packages/api/dist/{crud,diff,apply}/index.js` — Lambda のバンドル
- `packages/edge-auth/dist/index.js` — Lambda@Edge のバンドル
- `packages/web/dist/` — SPA の静的ファイル

## 2. Terraform state の置き場所を決める

**先に、このシェルで AWS の認証情報を渡して確かめます。** `terraform` は `aws --profile` のようにプロファイルを引数で受けないので、環境変数で渡します（「前提」の注記を読んでください）。

```bash
export AWS_PROFILE=<プロファイル> AWS_REGION=<リージョン>
aws sts get-caller-identity --query Account --output text    # 意図したアカウントか確かめる

```

SSO を使っている場合は、先に `aws sso login --profile <プロファイル>` を実行します。確かめずに進めると、`terraform init` は通り、手順 2 の `apply`（または手順 4 の `plan`）で初めて `No valid credential sources found` で落ちます。**新しいシェルを開いたときは、もう一度 `export` します。**

state は S3 に置きます。`terraform plan` が SSM の SecureString を復号して state に書き込むため（[limitations.md](limitations.md) の「Terraform の state に機微情報が入る」）、暗号化されたバケットが必要です。

**A. 使える S3 バケットが既にある場合**

```bash
cp infra/backend.hcl.example infra/backend.hcl
```

`infra/backend.hcl` をエディタで開き、bucket と region を自分の値にします（Windows では `code infra/backend.hcl` か `notepad infra/backend.hcl` で開けます）。

**B. バケットが無い場合** — `infra/bootstrap/` が作ります。

```bash
terraform -chdir=infra/bootstrap init
terraform -chdir=infra/bootstrap apply

# backend.hcl を出力から生成する（手で書き写さない）
terraform -chdir=infra/bootstrap output -raw backend_config_hcl > infra/backend.hcl

```

`infra/bootstrap/` は **backend ブロックを持たずローカル state で動きます**。state バケットを作る構成自体がそのバケットを使うことはできないためです（`terraform init` は backend を読んだ直後にバケットへアクセスします）。作るのは S3 バケット 1 つだけで、ローカル state を失っても `terraform import aws_s3_bucket.state <バケット名>` で取り込み直せます。

> **既にバケットがある場合は bootstrap を実行しないでください。** 使われない 2 つ目のバケットができます。

## 3. Terraform 変数を用意する

```bash
cd infra
cp terraform.tfvars.example terraform.tfvars

```

`terraform.tfvars` をエディタで開きます（Windows では `code terraform.tfvars` か `notepad terraform.tfvars` で開けます）。

**雛形でコメントアウトされている行（`# auth_mode = "basic"` など）は、`infra/variables.tf` の既定値と同じ値です。変えるときだけ `#` を外して値を書き換えます。外さなければ、既定値が使われます。** 外した値は、以後の `terraform plan` と `terraform apply` のすべてで同じにしてください（変えると差分が出ます）。

**apply の前に決める変数は、次のとおりです。** 後から変えられますが、変えると 2 回目の apply になります。

| 変数 | 決めること |
|---|---|
| `pool_id` | **必須です（既定値がありません）。** 雛形の `"my-team"` は例なので、自分の識別子に書き換えます（下の注記） |
| `auth_mode` | 認証方式。`basic`（既定。単一の資格情報の Basic 認証）か、`cognito`（複数の管理者が、それぞれの資格情報でサインインする）。**apply の前に決めます。** 後から切り替えると、切り替えの間と、反映後の最大 5 分（Lambda@Edge のキャッシュ）は、どのアクセスも 503 になりえます。手順 5 の準備が方式ごとに違います。違いは [access-control.md](access-control.md) の「認証方式の選択」にあります |
| `managed_tag_key` / `managed_tag_value` | Rolust が扱えるロールを示すタグ。既定値は `rolust:managed` = `true`（下の注記） |
| `region` / `project_name` | 既定値は `ap-northeast-1` / `rolust`。変えないなら、そのままで構いません |

雛形でコメントアウトされていない他の変数（テーブル名、`basic_auth_parameter_name`、`ip_allowlist_parameter_name`、`cloudfront_price_class`、`log_retention_days`）も、既定値と同じ値です。雛形に載っていない変数（SSM パラメータ名の `allowed_account_ids_parameter_name`・`auth_mode_parameter_name`・`auth_cognito_parameter_name`）は、既定値が使われます。SSM パラメータ名（`*_parameter_name`）を変える場合は、Lambda@Edge の定数も書き換えて再ビルドが要ります（各変数の `description` と [limitations.md](limitations.md)）。変える理由がなければ、そのままにしてください。

`terraform.tfvars` に**資格情報を書かないでください**。Basic 認証の資格情報は apply 後に SSM へ投入します。

> **`pool_id` を決めてください**。Rolust は、デプロイにつき 1 つのユーザプールだけを管理します。`pool_id` はその識別子（英数字と `.` `_` `-`、1〜64 文字）で、DynamoDB のキーと Lambda の環境変数 `ROLUST_POOL_ID` になります。**既存のデプロイを更新するときは、すでにあるユーザプールの識別子と同じ値にしてください**（変えると、それまでのデータが見えなくなります）。以後の `terraform plan` と `terraform apply` では、`terraform.tfvars` の同じ値を使ってください。

> **`managed_tag_key` と `managed_tag_value` を先に決めてください。** Rolust が扱えるロールは、このタグが付いたものだけになります。既定値は `rolust:managed` = `true` です。詳細は [managed-roles.md](managed-roles.md) の「管理対象は IAMロールのタグで絞り込まれる」を読んでください。

> **`terraform.tfvars` と `backend.hcl` の控えを、展開先の外に取ってください。** 新しい版へ更新するとき、この 2 つを新しい展開先へ持ち越します（[operations.md](operations.md#新しいバージョンに更新する経路-a)）。tarball には入っておらず（環境ごとの値のため）、無くすと `pool_id` が分からなくなり、それまでのデータが見えなくなります。
>
> - 保管先は、展開先の外です（パスワードマネージャ、社内の非公開の保管場所など）。**公開のリポジトリにはコミットしないでください。** `backend.hcl` のバケット名に、アカウント ID が含まれることがあります。`terraform.tfvars` に資格情報は書かない決まりなので、中身は秘密情報ではありません。
> - 値を変えたら、控えも更新します。
> - `infra/bootstrap/` で state バケットを作った場合は、`infra/bootstrap/terraform.tfstate` も控えます（無くしても、手順 2 の `import` で取り込み直せます）。
> - 控えも無くしたときは、[operations.md の「設定ファイルを紛失したとき」](operations.md#設定ファイルを紛失したとき)で作り直せます。
>
> 展開先の外に控えを取るコマンド（`infra/` の中で実行します）:
>
> ```bash
> cp terraform.tfvars backend.hcl <展開先の外の保管先>/
> ```

## 4. apply する

手順 2 で `export` した `AWS_PROFILE` / `AWS_REGION` が、このシェルに残っていることを確かめてください（`echo "$AWS_PROFILE"`）。残っていないと、`plan` で `No valid credential sources found` になります。

```bash
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
../.github/scripts/plan-guard.sh tfplan.json   # 赤信号があれば exit 1。そのときは次へ進まない

```

赤信号が無く、警告（WARN）の箇所を目視で確かめた後に実行します。

```bash
terraform apply tfplan
rm -f tfplan tfplan.json
cd ..                                          # 展開先のルートへ戻る（手順 5 以降はルートで実行します）

```

手順 3 と 4 は `infra/` の中（手順 3 の `cd infra`）で実行しました。**手順 5 以降の `terraform output` は、展開先のルートから `terraform -chdir=infra output …` で実行します。** `infra/` の中で `-chdir=infra` を付けると、`infra/infra` を探して失敗します。ルートで `-chdir` を付けないと、構成が無いので「出力なし」の警告になります。

`-backend-config` を忘れると `terraform init` が backend の設定値を対話的に尋ねてきます。手順 2 で作った `backend.hcl` を必ず渡してください。

**`plan-guard.sh` は、plan の差分から権限範囲を静かに広げる変更（赤信号 R-1〜R-12）を探します。** 赤信号が出たら apply しないでください。意味と対応は `docs/design/cicd-pipeline.md` § 赤信号 — 承認せず差し戻す にあります。bash と jq が要ります（Windows では Git Bash）。

初回は、作成するリソースの値が plan の時点で確定しないため、警告（WARN）が出ます。警告は「検査できなかった」であって「問題なし」ではありません。該当箇所は `terraform show tfplan` で plan を目視で確かめてから apply してください。保存した plan を渡す `terraform apply tfplan` は、確認の入力を求めずに適用します。

`tfplan` と `tfplan.json` には SSM の SecureString の復号値が含まれうるため、apply の後に消してください（`.gitignore` 済み）。

作成されるもの:

- DynamoDB の状態テーブル（`rolust-state`、GSI1 つき）と申請テーブル（`rolust-change-requests`）（どちらも PAY_PER_REQUEST）
- Lambda 3 系統（crud / diff / apply）と、それぞれの実行ロール
- API Gateway (REST) — CloudFront の `/api/*` のオリジン
- S3 バケット（非公開。CloudFront の OAC 経由でのみ読める）と SPA のアップロード
- CloudFront ディストリビューション（viewer-request に Lambda@Edge を関連付け）
- Lambda@Edge と実行ロール（**us-east-1**）
- SSM パラメータ（SecureString、**値はプレースホルダ**）
- SSM パラメータ（String、IP 許可リスト。**初期値は全許可の `0.0.0.0/0`**）
- SSM パラメータ（String、ユーザプールに登録できる IAMユーザのアカウント ID の許可リスト。**初期値はデプロイ先のアカウントだけ**。デプロイ先リージョン）
- API Gateway の API キーと usage plan（CloudFront が `x-api-key` に付け、API Gateway の直 URL を塞ぐ）
- **API Gateway のアカウント設定**（CloudWatch Logs へ書くためのロール `<project_name>-apigw-logs` と、それを指す `cloudwatchRoleArn`）。**これは Rolust の資源ではなく、アカウント × リージョン単位の設定です。** 同じアカウント・リージョンの他の REST API も同じロールでログを書くようになり、既に別のロールが設定されていれば上書きします（plan の差分に出ます）。`terraform destroy` はこの設定をリセットするので、残したい場合は destroy の前に `terraform state rm aws_api_gateway_account.this` を実行してください

CloudFront の作成には数分〜十数分かかります。

## 5. 認証の準備

手順 3 で決めた `auth_mode` に合わせて、次のどちらかを行います。もう一方は飛ばします。

### `auth_mode = "basic"`（既定）の場合: 資格情報を投入する

SSM パラメータの**値は Terraform の管理外**です（`lifecycle { ignore_changes = [value] }`）。apply 直後のプレースホルダは意図的に `:` を含まない不正な値であり、`packages/edge-auth` はこれを通さず `503` を返します。**実値を入れるまで管理画面は閉じたまま**です（fail closed）。

```bash
# 展開先のルートで実行する
terraform -chdir=infra output -raw set_basic_auth_command      # 実行すべきコマンドを表示する（下と同じ内容。export 行も含む）

export MSYS_NO_PATHCONV=1                         # Git Bash で '/rolust/basic-auth' がパスに変換されるのを防ぐ
aws ssm put-parameter \
  --region us-east-1 \
  --name '/rolust/basic-auth' \
  --type SecureString \
  --overwrite \
  --value '<user>:<password>'
```

> **Git Bash（Windows）を使っている場合**: `MSYS_NO_PATHCONV=1` を付けないと `/rolust/basic-auth` が Windows のパスに変換され、`ValidationException ... Parameter name must be a fully qualified name` で止まります（`get-parameter` では ParameterNotFound になります）。`terraform output` が表示するコマンドには、この `export` の行が入っています。macOS / Linux では不要です。

Lambda@Edge は資格情報を実行コンテキストに **5 分** キャッシュします（`CACHE_TTL_MS`）。投入直後は反映まで最大 5 分かかります。

### `auth_mode = "cognito"` の場合: 管理者のユーザを作る

Cognito のユーザープールは、手順 4 の apply で作られています。管理者のユーザの作成と、権限のグループの割り当てを、[access-control.md](access-control.md) の「認証方式の選択」の 3 と「管理者の権限」に従って行います。**ユーザを作っただけでは、何もできません。** `viewer` / `editor` / `applier` のどれか 1 つに割り当てる必要があります。この節は、`basic` の資格情報の投入（上）を行いません。

## 6. 動作を確認する

```bash
# 展開先のルートで実行する
terraform -chdir=infra output -raw console_url
```

1. 表示された URL をブラウザで開く → `basic` では Basic 認証のダイアログが出る。`cognito` では Cognito のサインイン画面へ移る（**どちらも出なければ認証が働いていません**）
2. 誤った資格情報 → `401`（`cognito` では、サインイン画面に誤りが表示される）
3. 正しい資格情報 → 「IAMユーザ」画面が表示される（`cognito` では、[access-control.md](access-control.md) の「認証方式の選択」で作ったユーザでサインインする）
4. 「ユーザを新規登録」→ AWSアカウントID・IAMユーザ名を入力して登録
5. **登録したいロールにタグを付ける**（画面ではなく AWS 側の作業です。Rolust は `iam:TagRole` を持たないため、これは運用者が行います）:

   ```bash
   # 現在の管理対象タグを確認する（展開先のルートで実行する）
   terraform -chdir=infra output -raw managed_role_tag        # => rolust:managed=true

   aws iam tag-role --role-name <RoleName> --tags Key=rolust:managed,Value=true

   ```

6. 「IAMロール管理」→ ロールを新規登録（**このアカウントに実在し、かつ手順 5 のタグが付いたロール**を入れてください。タグが無い・値が違う・ロールが存在しない場合は登録の時点で拒否され、どれに当たるかがモーダル内に表示されます）
7. 「IAMロール割り当て」→ プールを選び、交点にチェックを入れる（この時点では AWS に何も書き込まれません）
8. 「申請を作成」→ 差分確認画面で追加/削除されるプリンシパルを確認 → 「選択した n 件を反映」
9. AWS CLI で結果を確認する:

   ```bash
   aws iam get-role --role-name <RoleName> \
     --query 'Role.AssumeRolePolicyDocument' --output json
   ```

10. 「申請履歴」→ 状態が「反映済み」になっていること

### 参考: 空の信頼ポリシーのロールを作る（IAMユーザがまだ 1 人もいないロール）

手順 5 のタグ付けを作成時に済ませ、信頼ポリシーには `RolustPlaceholder` だけを置くロールを作る例です。最初のユーザを追加して反映すると、Rolust がプレースホルダを取り除きます（[managed-roles.md](managed-roles.md) の「信頼ポリシーは『空』にできない」）。

```bash
# 展開先のルートで実行する（ロールを作りたいアカウントの資格情報で。デプロイ先と別のアカウントなら、下の注記）
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')   # 画面に出さない
TAG=$(terraform -chdir=infra output -raw managed_role_tag | tr -d '\r')                # => rolust:managed=true
echo "$TAG"                                       # キー=値の形か確かめる。空なら先へ進まない

POLICY='{"Version":"2012-10-17","Statement":[{"Sid":"RolustPlaceholder","Effect":"Allow","Principal":{"AWS":"arn:aws:iam::'"$ACCOUNT_ID"':root"},"Action":"sts:AssumeRole","Condition":{"DateLessThan":{"aws:CurrentTime":"1970-01-01T00:00:00Z"}}}]}'

aws iam create-role --role-name <RoleName> \
  --assume-role-policy-document "$POLICY" \
  --tags "Key=${TAG%%=*},Value=${TAG#*=}"

```

- **`Sid` は `RolustPlaceholder` のまま変えないでください。** Rolust はプレースホルダを `Sid` だけで見分けます。変えると、最初のユーザを追加しても取り除かれません。
- **`Effect` を `Deny` にしないでください。** 明示的 Deny は後から足す Allow に勝つため、ロールが恒久的に引き受け不能になります。
- **管理対象タグは作成時に付けます。** 付けないと手順 6 の登録が拒否されます。キーと値は `terraform -chdir=infra output -raw managed_role_tag` で確かめます（上の `TAG` は `キー=値` の形で、`${TAG%%=*}` がキー、`${TAG#*=}` が値です）。
- **`TAG` が空のまま `create-role` に進まないでください。** 空だと `Invalid length for parameter Tags[0].Key` で失敗し、原因（`terraform output` が失敗したこと）が分かりにくくなります。`terraform output` が失敗する主な原因は、実行場所（展開先のルートで、`-chdir=infra` を付ける）と、資格情報（次の注記）です。
- **ロールを作るアカウントが、Rolust のデプロイ先と別のとき**は、資格情報を 2 つに分けます。`terraform output` は、state があるアカウント（デプロイ先）の資格情報でないと、S3 の `HeadObject` が 403 で失敗します。`aws iam create-role` は、ロールを作りたいアカウントの資格情報で実行します。`TAG` は、次のどちらかで決めます。
  - `terraform.tfvars` で `managed_tag_key`・`managed_tag_value` を変えていなければ、既定値を直接書きます: `TAG='rolust:managed=true'`。変えていれば、その値にします（`grep -E 'managed_tag_(key|value)' infra/terraform.tfvars` で確かめます。コメントアウトのままなら既定値です）。state に触れないので、資格情報を使い分けずに済みます。
  - デプロイ先の資格情報で読みます: `TAG=$(AWS_PROFILE=<デプロイ先のプロファイル> terraform -chdir=infra output -raw managed_role_tag | tr -d '\r')`。
- **`ACCOUNT_ID` は、信頼ポリシーの `Principal`（プレースホルダ）に入るだけです。ロールが作られるアカウントは決めません。** 作られるアカウントは、`create-role` を実行する資格情報で決まります。
- 別アカウントのロールを Rolust の画面から登録して操作するには、ターゲット側に `RolustTrustPolicyReader` と `RolustTrustPolicyManager` が要ります（[cross-account.md](cross-account.md)）。
- **Git Bash（Windows）では、`--assume-role-policy-document file://...` がパスの変換で失敗することがあります。** 上のように JSON を変数に入れ、インラインで渡してください。`aws` の出力に付く `\r` は `tr -d '\r'` で除きます。
- アカウント ID は変数に取り、画面やログ、Issue・PR に貼らないでください。

IP アドレスの制限（任意）は、[access-control.md](access-control.md) の「IP アドレス制限」を参照してください。
