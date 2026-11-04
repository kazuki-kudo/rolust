# クロスアカウント構成

[English](en/cross-account.md) | **日本語**

Rolust は、**Rolust をデプロイしたアカウント（以下デプロイ先）以外のアカウント（以下ターゲット）の IAMロール**も、デプロイ先のロールと同じ手順で、登録・紐づけ・差分確認・反映できます。Rolust の Lambda が、ターゲットに作った 2 つのロール（CloudFormation テンプレートで作ります）を引き受けて（`sts:AssumeRole`）、IAM を呼びます。**ターゲット側のロールは Terraform では作りません**。**クロスアカウントで使うときだけ必要**です。デプロイ先アカウントのロールだけを管理するなら、要りません。

| ターゲット側のロール | 引き受ける Lambda | 権限 |
|---|---|---|
| `RolustTrustPolicyReader` | CRUD・Diff | `iam:GetRole`（管理対象タグの付いたロールだけ）、`iam:ListRoleTags` |
| `RolustTrustPolicyManager` | Apply だけ | `iam:GetRole`・`iam:UpdateAssumeRolePolicy`（どちらも管理対象タグの付いたロールだけ）。自分と Reader の信頼ポリシーの更新は Deny |

CRUD は Manager を引き受けられないので、「マトリクスの操作では AWS へ書き込まない」という保証は、ターゲットのロールでも保たれます。

デプロイ先のロールは、これまでどおり、実行ロール自身の資格情報で操作します（ターゲット側の準備は要りません）。Rolust は、ロールの ARN のアカウント ID が、デプロイ先（API Gateway の `requestContext.accountId`）と同じかどうかで、資格情報を選びます。

**引き受けに失敗しても、デプロイ先の資格情報で呼び直しません。** IAM の API はロール名だけで呼ばれ、呼び出しに使った資格情報のアカウントに対して解決されるため、呼び直すと、デプロイ先にある同名のロールを読み書きしてしまいます。失敗は、原因と直し方を含む文言で表示されます。

## 手順（ターゲットアカウントごとに 1 回）

前提: デプロイ先に `terraform apply` 済みであること（実行ロールの `sts:AssumeRole` の許可と、Lambda の環境変数が入ります）。tarball の展開先（またはリポジトリのルート）に `cloudformation/target-roles.yaml` があります。

1. **コマンドを確かめて実行する。** **以降のコマンドは、すべて展開先（またはリポジトリ）のルートで実行します**（`infra/` の中ではありません。`-chdir=infra` が `infra/` を指します）。デプロイ先の資格情報で、次を実行します。

   ```bash
   terraform -chdir=infra output -raw target_roles_deploy_command
   ```

   値（デプロイ先のアカウント ID、プロジェクト名、管理対象タグ、ロール名）は、この Terraform の変数で埋めてあります。表示された `aws cloudformation deploy …` の `--profile` を、**ターゲットアカウントの IAM を管理できる資格情報**のプロファイルに置き換えて、展開先（またはリポジトリのルート）で実行します。ロールが 2 本（`RolustTrustPolicyReader`・`RolustTrustPolicyManager`。名前は `target_reader_role_name`・`target_manager_role_name` で変えられます）できます。

   コマンドの先頭の `AWS_CLI_FILE_ENCODING=UTF-8` は消さないでください。テンプレートに日本語が含まれるため、Windows（文字コードが CP932）の AWS CLI は、これが無いと `'cp932' codec can't decode byte …` で失敗します（実測で判明しました。macOS・Linux では無害です）。PowerShell で実行するときは、先に `$env:AWS_CLI_FILE_ENCODING = "UTF-8"` を設定し、行頭の `AWS_CLI_FILE_ENCODING=UTF-8` を外してください。

   Terraform の変数（`project_name`・`managed_tag_key`・`managed_tag_value`・ロール名）を後から変えたときは、このコマンドを実行し直します。

2. **操作したいロールにタグを付ける**（ターゲットで。従来どおり。付けるのは運用者です）:

   ```bash
   aws iam tag-role --role-name <ロール名> --tags Key=rolust:managed,Value=true
   ```

3. **確かめる。** Rolust の画面 2 で、ターゲットのロールを新規登録します（アカウント ID にターゲットのものを入れます）。登録できれば、Reader を引き受けられ、タグを読めています。差分確認と反映は、Manager も含めて、そのロールの申請で確かめます。

作ったロールの内容は、`aws iam get-role --role-name RolustTrustPolicyReader` などで確かめられます。定義は `cloudformation/target-roles.yaml` だけにあります。

### 手作業で作った既存のロールを置き換えるとき

`aws iam create-role` などで手作業で作ったロールが既にある環境では、同じ名前のロールが既にあるため、スタックの作成が `AlreadyExists` で失敗します。**既存の 2 ロールを削除してから、スタックを作ります。** その間、そのターゲットのロールへの操作は失敗します。作り直した直後は、IAM の結果整合で、引き受けが数分のあいだ `AccessDenied` になることがあります（下の「注意」）。

## うまくいかないとき

| 表示 | 原因 | 直し方 |
|---|---|---|
| 「アカウント X のロール RolustTrustPolicyReader（または Manager）を引き受けられませんでした（AccessDenied）」 | ターゲットにそのロールが無い、または信頼ポリシーが Rolust の実行ロールを許可していない | 手順 1（スタックを作る。`project_name` などのパラメータが Terraform と合っているか確かめる） |
| 登録で「IAMロール「…」に管理対象のタグ「…」が付いていません」 | 対象のロールにタグが無い | 手順 2 |
| 登録で「…のタグを読み取れませんでした（AccessDenied）」に、Reader の `iam:ListRoleTags` の案内 | Reader の権限ポリシーが不足（テンプレートが古い） | 手順 1（最新の版のテンプレートでスタックを更新する） |
| ロールの登録で「信頼ポリシーを読み取れませんでした（AccessDenied）」 | 対象のロールにタグが無い、または Reader に `iam:GetRole` が無い | 手順 1・2 |
| 反映が「失敗」（Manager の引き受け、または `AccessDenied`） | Manager が無い・信頼ポリシーが `apply-exec` を許可していない、または対象のロールにタグが無い | 手順 1・2 |

## 注意

- **ターゲット側のロールの信頼ポリシーを直した直後は、数分のあいだ、引き受けが `AccessDenied` のままになることがあります**（IAM の結果整合。実測で、Manager の信頼ポリシーを元に戻してから最初に通るまで約 7 分かかりました）。Rolust は引き受けの失敗を覚えず、毎回 STS に問い合わせるので、Lambda の再起動は要りません。数分待って、同じ操作をやり直してください。
- **Rolust の実行ロールを削除・再作成すると（`terraform destroy` → `apply` など）、ターゲット側の信頼ポリシーが無効になります。** 信頼ポリシーの Principal はロールの ARN で書きますが、IAM は内部で一意の ID に置き換えて保持します。実行ロールを作り直すと、名前が同じでも一致せず、引き受けが `AccessDenied` になります。**`target_roles_deploy_command` を実行し直しても直りません**（CloudFormation は「No changes to deploy」と判断し、信頼ポリシーを更新しません）。ターゲットアカウントで、スタックを削除してから、もう一度 `target_roles_deploy_command` を実行してください（`aws cloudformation delete-stack` → 完了を待つ → コマンド。実測では、作り直した直後から引き受けられました）。その間、そのターゲットのロールへの操作は失敗します。実行ロール名は `project_name` 由来なので、通常は変わりません。この環境の Terraform は、実行ロールだけを `-replace` で作り直そうとすると `EntityAlreadyExists` で失敗し、ロールのインラインポリシーだけが消えます。その状態になったら、もう一度 `terraform plan` と `apply` を実行すると、消えたポリシーが戻ります。
- **ターゲット側のスタックのパラメータと、Terraform の変数は、合わせます。** 管理対象タグのキーと値、ロール名、プロジェクト名がずれると、登録（信頼ポリシーの取り込みを含む）・差分確認・反映が、上の表のとおり失敗します（黙って別のロールに作用することはありません）。`target_roles_deploy_command` は Terraform の変数で埋めてあるので、そのまま実行すれば合います。
- **ExternalId は使いません。** 信頼ポリシーが実行ロールの ARN を完全一致で名指しするので、ほかの主体は引き受けられません。ExternalId が防ぐのは、第三者のサービスが複数の顧客のロールを代理で引き受ける構図で、Rolust は運用者ごとに自分でデプロイするため、この構図は成立しません。
- Reader は `iam:ListRoleTags`（タグ条件なし）を持つので、ターゲットのすべてのロールのタグを、Rolust の CRUD と Diff が読めます（読み取り専用）。管理対象の増減（タグの付け外し）は、ターゲット側でも `terraform plan` に現れません。
- ターゲット側のロールは CloudFormation テンプレート（`cloudformation/target-roles.yaml`）で配布します。Terraform モジュールと StackSets は提供しません。設計は `docs/design/iam-policy-design-note.md` 3.3 にあります。
