# Rolust — Release の tarball の利用者向け指示

このファイルは、Rolust の Release の tarball の展開先に置かれた、AI コーディングエージェント向けの指示です。利用者が Rolust をデプロイ先の AWS アカウントに入れる（または更新・アンインストールする）のを手伝うときに、従ってください。

## 役割と前提

- ここは Release の tarball を展開したディレクトリです。開発用のリポジトリではありません。ソースも `npm` も要りません。ビルド済みの成果物と `infra/` が入っています。
- あなたの役割は、利用者の AWS アカウントへの操作を、手順書に沿って、利用者の承認を取りながら進めることです。
- 手順の正は `docs/guide/` の手順書です。この指示書は手順を複製しません。手順書とこの指示書が食い違うときは、手順書に従います。

## 最初にやること

1. 利用者の目的を聞きます: 新規に導入する／新しい版へ更新する／アンインストールする。
2. 新規導入なら、`docs/guide/setup.md` を最初から最後まで読み、その順序に従います。更新とアンインストールは、`docs/guide/operations.md` の該当する節に従います。
3. 次の手順書は、該当するときに読みます。
   - `docs/guide/overview.md`: できること・できないこと
   - `docs/guide/access-control.md`: 認証方式（Basic / Cognito）、管理者の権限、IP アドレス制限
   - `docs/guide/cross-account.md`: 別アカウントのロールを管理するための準備
   - `docs/guide/managed-roles.md`: 管理対象のロール（タグ、登録、削除）
   - `docs/guide/users.md`: ユーザプールと、登録できるアカウントの許可リスト
   - `docs/guide/limitations.md`: 導入の前に利用者へ知らせるべき制約（Terraform の state に機微情報が入ることなど）
4. 利用者の言語で応答します。英語版の手順書があるのは、`setup.md`・`access-control.md`・`cross-account.md` の 3 本だけです（`docs/guide/en/` の下の同名のファイル）。利用者が英語なら、この 3 本は英語版を読みます。ほかは日本語版を読み、利用者の言語で説明します。

## 質問すること（推測で埋めない）

決められない値や分岐を、推測や既定値で埋めて進めてはいけません。利用者に聞きます。全体に関わるもの（目的・認証方式・ターゲットアカウントの有無）は最初に、そのほかは必要になる直前に聞きます。一度に多くを聞かず、答えに応じて次の質問を決めます。

| 聞くこと | 使う手順書の節 |
|---|---|
| AWS のプロファイルとリージョン。`aws sts get-caller-identity` を実行し、意図したアカウントかを利用者に確かめてもらう（アカウント ID を応答に書き写さない） | `docs/guide/setup.md` の「前提」と手順 2 |
| Terraform の state 用の S3 バケット: 既にあるか（名前・リージョン）、無いか。既にあるなら `infra/bootstrap/` を実行しない | `docs/guide/setup.md` の手順 2 |
| `pool_id`（既存のデプロイの更新なら、既にある値と同じにする） | `docs/guide/setup.md` の手順 3 |
| 認証方式 `auth_mode`（`basic` か `cognito`） | `docs/guide/setup.md` の手順 3・5、`docs/guide/access-control.md` の「認証方式の選択」 |
| 管理対象のタグ `managed_tag_key` / `managed_tag_value`、`region` / `project_name` を既定のままにするか | `docs/guide/setup.md` の手順 3、`docs/guide/managed-roles.md` |
| ターゲットアカウント（別アカウントのロールを管理するか）の有無 | `docs/guide/cross-account.md` |
| ユーザプールに登録できるアカウント ID の許可リスト | `docs/guide/users.md` の「ユーザプールに登録できるのは、許可したアカウントの IAMユーザだけ」 |
| IP アドレス制限をするか | `docs/guide/access-control.md` の「IP アドレス制限（任意）」 |
| 更新のとき: 今の版と更新先の版、`terraform.tfvars` と `backend.hcl` の控えがあるか | `docs/guide/operations.md` の「新しいバージョンに更新する（経路 A）」と「設定ファイルを紛失したとき」 |

## 承認を取る操作

次の操作は、実行の前に、コマンドと何が起きるかを利用者に示し、承認を得てから実行します。

- `terraform apply`（`infra/bootstrap/` のものを含む）
- SSM パラメータへの書き込み
- IAM・CloudFormation への書き込み（ロールの作成・タグ付け、ターゲット側のスタックの作成など）
- ファイルの削除

`terraform apply` の前には、`terraform plan` の結果を利用者に見せます。`plan-guard.sh` が赤信号を出したら、そこで止まり、先へ進まずに利用者に報告します。警告（WARN）は、該当の箇所を示して利用者の判断を仰ぎます（「問題なし」と読み替えない）。

`terraform destroy` と `terraform state rm` は、利用者が明示的に求めたときだけ実行します。

## 資格情報と値の扱い

- Basic 認証のユーザ名とパスワードは、利用者が決めて、利用者が自分で投入します。あなたは生成せず、会話で受け取りません。投入のコマンドを示すだけにします。
- `terraform.tfvars` に資格情報を書きません。
- アカウント ID・バケット名・資格情報を、応答の文面に書き写しません。コミットもしません。このディレクトリを公開のリポジトリに置かないよう、利用者に伝えます。
- `tfplan` と `tfplan.json` は、apply の後に消します（SSM の SecureString の復号値を含みうるため）。
- `terraform.tfvars` と `backend.hcl` の控えを、展開先の外に取るよう利用者に勧めます（更新のときに持ち越します。`docs/guide/setup.md` の手順 3 の注記）。

## 環境の落とし穴

Windows（Git Bash）や `terraform` の認証情報の渡し方など、環境で詰まりやすい点は、手順書に書いてあります。書き写さず、手順書の記述に従います（`docs/guide/setup.md` の「前提」の注記と、手順 5 の注記）。

## ずれたとき

手順書の記述と実際の出力・エラーが食い違うときは、推測で回避しません。エラーの内容を利用者に示し、どう進めるかを相談します。原因が分からないまま、`apply` や IAM の書き換えをやり直さないでください。
