# 運用: 更新・反映・アンインストール

## 新しいバージョンに更新する（経路 A）

Release の tarball で入れた環境を、新しい版に更新します。**この節のコマンドは、上から順に実行すれば更新できます。** [setup.md](setup.md) の途中に飛ぶ必要はありません（飛ぶと、`AWS_PROFILE` の設定や `cd infra` が抜けて失敗します）。

**始める前に、次を用意します。**

- 古い展開先（いま動いている版を apply したディレクトリ）と、そこにある `infra/terraform.tfvars`・`infra/backend.hcl`。**無いときは、先に「[設定ファイルを紛失したとき](#設定ファイルを紛失したとき)」を読んでください。**
- [setup.md の「前提」](setup.md#前提)のツール（Terraform 1.10 以上、bash、jq）と、AWS の認証情報。

シェルを開き直したら、手順 2 の `OLD` と、手順 3 の `export` をやり直します。

1. **変更履歴を読みます。** 同梱の [CHANGELOG.md](../../CHANGELOG.md)（Releases の本文の先頭にも、同じ内容があります）で、いま使っている版の次の版から、更新先の版までの節を読みます。「更新時にやること」の節がある版は、その作業にも従います（この節が無い版は、この手順だけで更新できます）。

2. **新しい版を、古い展開先とは別のディレクトリに展開します。** 古い展開先の外（その親のディレクトリなど）で実行します。`vX.Y.Z` は更新先の版です。`gh` が無いときは、Releases のページから取ります（[setup.md の「1. 入手する」](setup.md#1-入手する)）。

   ```bash
   OLD=$(cd <古い展開先のパス> && pwd)        # 絶対パスにして控える（次の cd のあとも使う）
   gh release download vX.Y.Z --repo kazuki-kudo/rolust
   # チェックサムが OK のときだけ、展開して移る
   sha256sum -c --ignore-missing SHA256SUMS && tar -xzf rolust-vX.Y.Z.tar.gz && cd rolust-vX.Y.Z

   ```

3. **AWS の資格情報を渡します。** `terraform` は `aws --profile` のようにプロファイルを引数で受けないので、環境変数で渡します。SSO を使っているときは、先に `aws sso login --profile <プロファイル>` を実行します。

   ```bash
   export AWS_PROFILE=<プロファイル> AWS_REGION=<リージョン>
   aws sts get-caller-identity --query Account --output text    # 意図したアカウントか確かめる

   ```

4. **古い展開先の設定ファイルを、新しい展開先の `infra/` にコピーします。** `pool_id` は変えないでください（変えると、それまでのデータが見えなくなります）。`backend.hcl` が同じなので、state も同じものが使われます。

   ```bash
   cp "$OLD/infra/terraform.tfvars" "$OLD/infra/backend.hcl" infra/
   grep -E '^[[:space:]]*pool_id' infra/terraform.tfvars        # 動いている環境の pool_id と同じ値か確かめる（読み方は、下の「設定ファイルを紛失したとき」の 2）

   ```

   **`infra/bootstrap/` で state バケットを作った環境では、そのローカル state も、同じ手順で持ち越します。** アンインストールの `bootstrap destroy` に要ります。持ち越さなかったときの対処は、[アンインストールの手順 5](#アンインストールする)にあります。`infra/bootstrap/` を使っていない環境（既存のバケットを使った環境）では、ファイルが無いので `cp` は失敗します。そのまま次へ進んでください。

   ```bash
   cp "$OLD"/infra/bootstrap/terraform.tfstate* infra/bootstrap/
   ```

5. **plan を取り、plan-guard を通します。** `infra/` の中で実行します。

   ```bash
   cd infra
   terraform init -backend-config=backend.hcl
   terraform plan -out=tfplan
   terraform show -json tfplan > tfplan.json
   ../.github/scripts/plan-guard.sh tfplan.json   # 赤信号があれば exit 1。そのときは次へ進まない

   ```

   - **plan の内容を確かめます。** `pool_id`・`auth_mode`・タグなど、設定の差分や、大量の destroy が出たときは、apply しないでください。持ち越した `terraform.tfvars` が、違うファイルか古いファイルのことが多いです。
   - 赤信号の意味と警告（WARN）の扱いは、[setup.md の「4. apply する」](setup.md#4-apply-する)にあります。

   赤信号が無く、警告の箇所を目視で確かめたら、apply します。

   ```bash
   terraform apply tfplan
   rm -f tfplan tfplan.json
   cd ..                                          # 展開先のルートへ戻る

   ```

6. **CloudFront の invalidation と、認証が働いていることの確認を行います。** 展開先のルートで実行します。`curl` は **`401` が正常**です（`auth_mode = "cognito"` では、画面のパスは `302`）。**`200` が返ったら認証が働いていません。** 詳しくは「[SPA を更新したとき](#spa-を更新したとき)」にあります（その節は、ソースからビルドする経路 B の手順で、`npm run build` から始まります。経路 A では、ビルドは要りません）。

   ```bash
   export MSYS_NO_PATHCONV=1                       # Git Bash で '/index.html' がパスに変換されるのを防ぐ
   aws cloudfront create-invalidation \
     --distribution-id "$(terraform -chdir=infra output -raw cloudfront_distribution_id)" \
     --paths '/index.html'
   curl -s -o /dev/null -w '%{http_code}\n' "$(terraform -chdir=infra output -raw console_url)"

   ```

7. **ターゲット側のロールが変わった版では、ターゲットのスタックを更新します。** `CHANGELOG.md` の「更新時にやること」にその旨があります。各ターゲットアカウントで、次のコマンドが表示するコマンドを実行し直します（スタックが更新されます）。展開先のルートで実行します。

   ```bash
   terraform -chdir=infra output -raw target_roles_deploy_command
   ```

前の版に戻すときは、前の版の tarball で同じ手順を行います（`docs/design/rollback-runbook.md`）。

## 設定ファイルを紛失したとき

更新で持ち越す `infra/terraform.tfvars` と `infra/backend.hcl` は、tarball に入っていません（環境ごとの値のため）。古い展開先を消してしまったときは、次の順で作り直します。**初回のセットアップのときに展開先の外へ控えを取っておけば、この作業は要りません**（[setup.md の「3. Terraform 変数を用意する」](setup.md#3-terraform-変数を用意する)の末尾）。

1. **資格情報を渡します。**

   ```bash
   export AWS_PROFILE=<プロファイル> AWS_REGION=<リージョン>
   aws sts get-caller-identity --query Account --output text    # 意図したアカウントか確かめる

   ```

2. **`pool_id` を、動いている環境の Lambda から読みます。** `project_name` を変えていなければ、関数名は `rolust-crud` です。

   ```bash
   aws lambda get-function-configuration --function-name rolust-crud --query 'Environment.Variables.ROLUST_POOL_ID' --output text
   ```

3. **`backend.hcl` を作り直します。** 新しい版の展開先で、雛形を写します。`key`・`encrypt`・`use_lockfile` は雛形のままで構いません。`bucket` と `region` を、state を置いたバケットの値にします。

   ```bash
   cp infra/backend.hcl.example infra/backend.hcl
   ```

   バケット名が分からないときは、`aws s3api list-buckets --query 'Buckets[].Name' --output text` で候補を出し、`aws s3api head-object --bucket <候補> --key rolust/infra/terraform.tfstate` が成功するバケットが、state を置いたバケットです（バケットのリージョンが違って 301 になるときは、`--region` にバケットのリージョンを指定します）。

4. **`terraform.tfvars` を作り直します。** 雛形を写し、`pool_id` を手順 2 の値にします。ほかの変数は、変えた覚えのあるものだけ戻します（雛形の既定値と同じなら、何もしません）。

   ```bash
   cp infra/terraform.tfvars.example infra/terraform.tfvars
   ```

5. **合っているかを、plan で確かめます。** 手順 3 の `backend.hcl` を使い、[「新しいバージョンに更新する」の手順 5](#新しいバージョンに更新する経路-a)の `plan`（`plan-guard` まで）を行います。**差分が Lambda のコードと SPA のファイルだけなら、設定は合っています。** `pool_id`・`auth_mode`・タグ・名前の差分が出たら、その変数が違います。直して plan し直してください。**差分があるまま apply しないでください。**

## アンインストールする

Rolust 本体（CloudFront・Lambda・API Gateway・DynamoDB・SSM・Cognito など、`terraform apply` が作ったもの）を削除します。**IAM のロール・ユーザ・信頼ポリシーには手を付けません。** それらは Rolust の資源ではなく、`terraform destroy` の対象でもありません。消す必要もありません（残るものと失うものは、下の「アンインストールで変わること」にあります）。

**apply したときと同じ展開先**で、同じ資格情報を使って行います（`terraform.tfvars` と `backend.hcl` がその展開先にあります）。Terraform は `aws --profile` のようにプロファイルを引数で受けられないので、環境変数で渡します（[setup.md の「前提」](setup.md#前提)）。

```bash
export AWS_PROFILE=<プロファイル> AWS_REGION=<リージョン>
```

1. **付けた権限を失効させたいかを、先に決めます。** 信頼ポリシーに反映済みの権限は、Rolust を消しても有効なままです。失効させたいなら、アンインストールの前に、マトリクスでチェックを外して申請・反映してください。Rolust を消した後は、IAM の信頼ポリシーを直接直すことになります。

2. **ターゲットアカウント**を使っていたら、そこのスタックを削除します（使っていなければ飛ばします）。

   ```bash
   aws cloudformation delete-stack --profile <ターゲットアカウントのプロファイル> --stack-name <project_name>-target-roles
   ```

3. 残したいものを退避します。
   - **DynamoDB のデータ**（`state_table_name`・`change_request_table_name` の 2 テーブル）。`terraform destroy` は削除します。**申請の履歴（監査記録）と、誰にどのロールを許可したかの台帳は、ここにしかありません。**
   - **API Gateway のアカウント設定**。同じアカウント・リージョンの他の REST API のログに使われているなら、destroy の前に `terraform state rm aws_api_gateway_account.this` を実行します（[setup.md の「4. apply する」](setup.md#4-apply-する)の「API Gateway のアカウント設定」の注記）。

4. **Rolust 本体を削除します。** `infra/` で実行します（「apply する」と同じく `-backend-config=backend.hcl` で init 済みであること）。確認には `yes` と答えます。

   ```bash
   cd infra
   terraform destroy
   ```

   SPA のバケットは `force_destroy = true` なので、中身ごと消えます。

   **Lambda@Edge の関数（`<project_name>-edge-auth`）の削除は、1 回目は `it is a replicated function` で失敗します。** CloudFront から外した後も、各リージョンのレプリカが消えるまで、AWS の仕様で時間がかかるためです（実測で、約 10〜13 分後に失敗して終わりました）。それ以外の資源は消えているので、**少し置いてから、同じコマンドをもう一度実行してください。** 残りの Lambda@Edge の関数と、その実行ロールが消えます。

   ```bash
   terraform destroy        # 失敗した場合。通るまで、置いてから繰り返す
   ```

   置く時間は一定ではありません。ある実測では約 30 分後の再実行で消え、別の実測では、それより短い間隔で通りました（AWS は数時間かかることがあるとしています）。

   終わったかは、state が空になったかで確かめます。

   ```bash
   terraform state list     # 何も出なければ完了
   ```

   念のため、SSM と DynamoDB に残りが無いかも確かめられます。SSM は 2 つのリージョンにあります（`allowed-account-ids` はデプロイ先のリージョン、認証の設定は us-east-1）。どれも、何も出なければ正常です。

   ```bash
   aws ssm describe-parameters --region us-east-1 --query 'Parameters[?starts_with(Name, `/rolust`)].Name' --output text
   aws ssm describe-parameters --region <リージョン> --query 'Parameters[?starts_with(Name, `/rolust`)].Name' --output text
   aws dynamodb list-tables --region <リージョン> --query 'TableNames' --output text

   ```

   最後に、**展開先のルートへ戻ります。** 次の手順のコマンドは、ルートから実行します。

   ```bash
   cd ..
   ```

5. **state 用のバケットを `infra/bootstrap/` で作った場合は、不要なら削除します。** 既に別のバケットを使っていた場合は、そのバケットは Rolust のものではないので、削除しません（この手順は飛ばします）。手順 4 の後でも、バケットには空の state ファイルとそのバージョンが残ります。

   **コマンドは、展開先のルート（`infra/` の中ではありません）で実行します。** `-chdir=infra/bootstrap` は相対パスなので、`infra/` の中では `infra/infra/bootstrap` を探して失敗します。

   1. **バケット名を調べます。** `infra/backend.hcl` の `bucket` が、state を置いたバケットです。ローカル state が無くても読めます。

      ```bash
      grep -E '^[[:space:]]*bucket[[:space:]]*=' infra/backend.hcl
      ```

   2. **バケットを空にします。** バケットは `force_destroy = false` なので、**先に中身を空にしないと削除できません。** AWS のマネジメントコンソールの S3 で、そのバケットの「空にする」を実行します（バージョンも含めて削除されます）。

   3. **バケットを削除します。** `infra/bootstrap/terraform.tfstate` が手元にあるかで、次のどちらかを選びます。

      ```bash
      ls infra/bootstrap/terraform.tfstate
      ```

      - **ある場合**: `bootstrap destroy` で削除します。`infra/bootstrap/` は backend を持たずローカル state で動くので、この手順が済むまで展開先を消さないでください。

        ```bash
        terraform -chdir=infra/bootstrap destroy
        ```

      - **無い場合**（新しい版へ更新したときに持ち越さなかったなど）: まず、`bootstrap apply` を行った古い展開先に `infra/bootstrap/terraform.tfstate` が残っていないかを探します。あれば、その展開先のルートで上の `bootstrap destroy` を実行します（資格情報は、この手順の冒頭の `export` と同じものを使います）。どこにも無ければ、バケットを直接削除します。`infra/bootstrap/` が作る資源は、バケットとその付属の設定（バージョニング・暗号化・パブリックアクセスのブロック・ライフサイクル・バケットポリシー）だけなので、バケットを消せばすべて消えます。

        ```bash
        aws s3api delete-bucket --bucket <手順 1 のバケット名> --region <バケットのリージョン>
        ```

### アンインストールで変わること

- **残るもの**: IAM のロール・ユーザ、信頼ポリシー（Rolust が足した IAM ユーザ、プレースホルダ `RolustPlaceholder` を含む）、管理対象タグ（既定は `rolust:managed=true`）。**権限は有効なままで、ユーザはロールを引き受け続けられます。** 失効させるには、手順 1 のとおり、アンインストールの前に反映で外します。
- **失うもの**: 誰にどのロールを許可したかの台帳と、申請の履歴（DynamoDB の 2 テーブル）。信頼ポリシーの変更は CloudTrail の `UpdateAssumeRolePolicy` にも記録されますが、保持期間は限られます。
- **再導入するとき**: ロールを登録すると、Rolust は信頼ポリシーにいる IAM ユーザを取り込みます（許可リストにあるアカウントのユーザだけ。[managed-roles.md](managed-roles.md)・[users.md](users.md)）。台帳は、IAM 側の状態から再構築できます。ただし、**ターゲットアカウントのスタックは作り直してください。** Rolust の Lambda の実行ロールが新しくなり、ターゲット側の信頼ポリシーの Principal が無効になるためです。
- **管理対象から外したいロール**は、タグを外します。タグが付いたロールは、同じアカウントに入れた Rolust が管理できる状態のままです。

  ```bash
  aws iam untag-role --role-name <ロール名> --tag-keys rolust:managed
  ```

## SPA を更新したとき

この節の手順は SPA に限らず、Lambda や Terraform の変更を含む更新全般に使います。このリポジトリには、反映する CD がありません。plan も plan-guard も反映も、ここに書いた手順で手元から行います（`docs/design/cd-config.md` D-7・D-8）。

**リポジトリのルートで実行してください**（[setup.md の「3. Terraform 変数を用意する」](setup.md#3-terraform-変数を用意する)以降は `infra/` にいるため、そのまま続けると失敗します）。

```bash
npm run build
terraform -chdir=infra plan -out=tfplan
terraform -chdir=infra show -json tfplan > infra/tfplan.json
./.github/scripts/plan-guard.sh infra/tfplan.json && terraform -chdir=infra apply tfplan   # 赤信号があれば apply しない。名前の変わった旧アセットは S3 から削除される
rm -f infra/tfplan infra/tfplan.json

export MSYS_NO_PATHCONV=1                       # Git Bash で '/index.html' がパスに変換されるのを防ぐ
aws cloudfront create-invalidation \
  --distribution-id "$(terraform -chdir=infra output -raw cloudfront_distribution_id)" \
  --paths '/index.html'

# 認証が働いていることを確かめる
curl -s -o /dev/null -w '%{http_code}\n' "$(terraform -chdir=infra output -raw console_url)"

```

> `cd infra` を使わないのは意図です。`infra/` に居る状態で `cd infra && terraform apply` を実行すると `cd` が失敗して **apply が飛ばされ**、続く `create-invalidation` だけが成功します。デプロイしていないのに「無効化に成功した」という結果が返る、気づきにくい失敗になります。

ハッシュ付きの資産（`assets/*`）は不変なので無効化は不要です。`index.html` だけを無効化してください。

反映の前から開いていた管理画面のタブでは、まだ開いていない画面へ移ると「画面を読み込めませんでした」と案内が出ます。旧アセットが削除されたためで、ページを再読込すれば直ります（`docs/design/deployment-strategy.md` § SPA の更新順序が持つ不整合）。旧い版で開いたままのタブは真っ白になることがあるので、再読込してください。

`plan-guard.sh` と `apply` を `&&` で連結しているので、赤信号（exit 1）では apply に進みません。警告（WARN）は exit 0 のため止まりません。更新で警告が出る見込みがあるとき（リソースを新しく作るときなど）は、`&&` 以降を外して plan-guard だけを先に実行し、目視の後に apply してください。

最後の `curl` は **`401` が正常**です（SSM の資格情報がプレースホルダのままなら `503`。`auth_mode = "cognito"` では、画面のパスは `302`、`/api/` は `401` が正常です）。**`200` が返ったら認証が働いていません。** 反映した変更を戻してください。`-chdir=infra` の下では `-out=tfplan` と `apply tfplan` のパスは `infra/` 基準になり、`>` のリダイレクト先だけがシェルの作業ディレクトリ基準になります。

## API キーを含む版へ、使用中の環境を更新するとき

CloudFront の更新が終わる前に API Gateway がキーを要求し始めると、その数分間、`/api/*` が 403 になります（CloudFront は 403 を `index.html` に書き換えるので、画面の API 呼び出しが失敗します）。使われていない環境では気にする必要はありません。止めたくないときは、`infra/apigateway.tf` の 3 つのメソッドの `api_key_required = true` の行を外した状態で先に apply し、CloudFront が Deployed になったのを確認してから、行を戻して apply してください。
