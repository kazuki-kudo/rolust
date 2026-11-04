output "console_url" {
  description = "Rolust 管理画面の URL。auth_mode = \"basic\" で資格情報を投入するまでは 503 が返る。cognito では Cognito のサインイン画面へ飛ぶ。"
  value       = "https://${aws_cloudfront_distribution.rolust.domain_name}/"
}

output "cloudfront_distribution_id" {
  description = "CloudFront ディストリビューション ID（SPA 更新後のキャッシュ無効化に使う）。"
  value       = aws_cloudfront_distribution.rolust.id
}

output "web_bucket_name" {
  description = "SPA を置く S3 バケット。CloudFront の OAC 経由でのみ読める。"
  value       = aws_s3_bucket.web.id
}

output "state_table_name" {
  description = "DynamoDB の状態テーブルの名前。"
  value       = aws_dynamodb_table.state.name
}

output "change_request_table_name" {
  description = "DynamoDB の申請テーブルの名前。"
  value       = aws_dynamodb_table.change_requests.name
}

output "basic_auth_parameter_name" {
  description = "Basic 認証の資格情報を投入する SSM パラメータ名（us-east-1）。"
  value       = aws_ssm_parameter.basic_auth.name
}

output "set_basic_auth_command" {
  description = "apply 後に 1 度だけ実行する資格情報の投入コマンド。<user> と <password> を置き換えること。"
  value       = <<-EOT
    aws ssm put-parameter \
      --region us-east-1 \
      --name '${aws_ssm_parameter.basic_auth.name}' \
      --type SecureString \
      --overwrite \
      --value '<user>:<password>'
  EOT
}

output "ip_allowlist_parameter_name" {
  description = "IP 許可リストの SSM パラメータ名（us-east-1）。初期値は全許可の 0.0.0.0/0。"
  value       = aws_ssm_parameter.ip_allowlist.name
}

output "set_ip_allowlist_command" {
  description = "IP 許可リストを変更するコマンド。--value を許可する IP または CIDR に置き換えること。反映まで最大 5 分かかる。"
  value       = <<-EOT
    aws ssm put-parameter \
      --region us-east-1 \
      --name '${aws_ssm_parameter.ip_allowlist.name}' \
      --type String \
      --overwrite \
      --value '203.0.113.0/24,198.51.100.7'
  EOT
}

output "allowed_account_ids_parameter_name" {
  description = "ユーザプールに登録できる IAM ユーザの AWS アカウント ID の許可リストの SSM パラメータ名（デプロイ先リージョン）。初期値はデプロイ先のアカウント ID だけ。"
  value       = aws_ssm_parameter.allowed_account_ids.name
}

output "set_allowed_account_ids_command" {
  description = "許可するアカウント ID を変更するコマンド。--value を、許可するアカウント ID のカンマ区切りに置き換えること（デプロイ先のアカウントも含める）。反映まで最大 5 分かかる。"
  value       = <<-EOT
    aws ssm put-parameter \
      --region ${var.region} \
      --name '${aws_ssm_parameter.allowed_account_ids.name}' \
      --type String \
      --overwrite \
      --value '${local.account_id},111122223333'
  EOT
}

output "auth_mode" {
  description = "管理画面と API の認証方式（basic または cognito）。"
  value       = var.auth_mode
}

output "cognito_user_pool_id" {
  description = "Cognito のユーザープール ID（`auth_mode = \"cognito\"` のときだけ。`basic` では null）。"
  value       = one(aws_cognito_user_pool.admin[*].id)
}

output "create_cognito_user_command" {
  description = "Cognito にユーザを足すコマンド（`auth_mode = \"cognito\"` のときだけ。`basic` では null）。<...> を置き換えること。一時パスワードはコマンドの中で乱数から作られる（メールで本人に届く。手で決めない）。初回のサインインでパスワードの設定を求められる。"
  value = local.cognito_enabled ? join("\n", [
    "aws cognito-idp admin-create-user \\",
    "  --region ${var.region} \\",
    "  --user-pool-id ${aws_cognito_user_pool.admin[0].id} \\",
    "  --username '<ユーザ名>' \\",
    "  --user-attributes Name=email,Value='<メールアドレス>' Name=email_verified,Value=true \\",
    "  --temporary-password \"$(printf '%sAa1!' \"$(openssl rand -base64 12 | tr -dc 'A-Za-z0-9')\")\"",
  ]) : null
}

output "api_gateway_invoke_url" {
  description = <<-EOT
    API Gateway のステージ URL。**この URL を配布しないこと。**
    CloudFront を経由しない経路であり、Basic 認証と IP 許可リストは効かない。
    CloudFront が付ける API キー（x-api-key）が無いリクエストは 403 になる。
    デバッグ以外では使わない。
  EOT
  value       = aws_api_gateway_stage.rolust.invoke_url
}

output "apply_lambda_role_arn" {
  description = "iam:UpdateAssumeRolePolicy を持つ唯一の実行ロール。監査時の確認対象。"
  value       = aws_iam_role.lambda["apply"].arn
}

output "managed_role_tag" {
  description = <<-EOT
    Rolust の管理対象を示すタグ。**管理画面の利用者に伝えること。**
    このタグが付いていないロールは登録の時点で 400 で弾かれ、IAM 側でも
    Allow の条件に一致しないため反映できない。

    タグを付けるのは運用者である（Rolust は iam:TagRole を持たない）。
    管理対象の増減は terraform plan に現れない。
  EOT
  value       = "${var.managed_tag_key}=${var.managed_tag_value}"
}

output "managed_role_arn_scope" {
  description = <<-EOT
    Apply / Diff Lambda が iam:GetRole / iam:UpdateAssumeRolePolicy を持つ範囲。
    監査時の確認対象。Resource は role/*（アカウント内の全ロール）であり、
    実効的な絞り込みは aws:ResourceTag 条件が担う。**Resource だけを見て
    「絞り込みが無効」と読んではならない。**
  EOT
  value       = local.managed_role_arn_all
}

output "cross_account_target_setup" {
  description = <<-EOT
    別アカウントのロールを操作するために、ターゲットアカウントに作るロールの情報
    （docs/guide/cross-account.md。ターゲット側は Terraform では作らず、CloudFormation テンプレート
    cloudformation/target-roles.yaml で作る。コマンドは出力 target_roles_deploy_command。Issue #92 により 2026-10-13 訂正）。

    reader_trusted_roles / manager_trusted_roles は、ターゲット側のロールの信頼ポリシーの Principal に
    書く Rolust の実行ロール。Reader は CRUD・Diff、Manager は Apply だけを名指しする。
    **実行ロールを作り直すと（replace）、ターゲット側の信頼ポリシーの Principal は一意の ID に置き換わって
    無効になる。** 作り直したら、ターゲット側の信頼ポリシーを更新し直すこと。

    managed_tag は、ターゲット側の権限ポリシーの `aws:ResourceTag` 条件に、手で合わせる値。
  EOT
  value = {
    reader_role_name      = var.target_reader_role_name
    reader_trusted_roles  = [aws_iam_role.lambda["crud"].arn, aws_iam_role.lambda["diff"].arn]
    manager_role_name     = var.target_manager_role_name
    manager_trusted_roles = [aws_iam_role.lambda["apply"].arn]
    managed_tag           = "${var.managed_tag_key}=${var.managed_tag_value}"
  }
}

output "target_roles_deploy_command" {
  description = <<-EOT
    ターゲットアカウントに Reader・Manager のロールを作る CloudFormation のコマンド（docs/guide/cross-account.md）。
    ターゲットアカウントごとに 1 回、**ターゲットアカウントの IAM を管理できる資格情報**で、tarball の展開先
    （またはリポジトリのルート）から実行する。`--profile` の値を置き換えること。値は、この Terraform の変数
    （project_name・managed_tag_key・managed_tag_value・target_reader_role_name・target_manager_role_name）と
    デプロイ先のアカウント ID で埋めてある。Terraform の変数を変えたら、このコマンドを実行し直す。
    先頭の AWS_CLI_FILE_ENCODING=UTF-8 は、日本語を含むテンプレートを Windows（CP932）の AWS CLI に読ませるために要る
    （無いと cp932 の復号エラーで失敗する）。macOS・Linux では無害。
  EOT
  value       = <<-EOT
    AWS_CLI_FILE_ENCODING=UTF-8 aws cloudformation deploy \
      --profile <ターゲットアカウントのプロファイル> \
      --region ${var.region} \
      --stack-name ${var.project_name}-target-roles \
      --template-file cloudformation/target-roles.yaml \
      --capabilities CAPABILITY_NAMED_IAM \
      --parameter-overrides \
        DeployAccountId=${local.account_id} \
        ProjectName=${var.project_name} \
        ManagedTagKey=${var.managed_tag_key} \
        ManagedTagValue=${var.managed_tag_value} \
        ReaderRoleName=${var.target_reader_role_name} \
        ManagerRoleName=${var.target_manager_role_name}
  EOT
}
