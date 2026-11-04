/**
 * 管理者の認証に使う Cognito（FR-6.4、`auth_mode = "cognito"` のときだけ作る）。
 *
 * - 機能プランは Lite、Hosted UI は classic（`managed_login_version = 1`）。範囲（初回のパスワード変更と
 *   「忘れた」の再設定）は classic で足り、新規のプールは 10,000 MAU まで無料（2026-10-05 に公式で確認）。
 * - セルフサインアップは無効。ユーザは運用者が `admin-create-user` で作る（`docs/guide/access-control.md`）。
 * - クライアントは公開クライアント（シークレット無し）。認可コード + PKCE を `packages/edge-auth` が行う。
 * - ID トークンの有効期限は 1 日（Cognito の上限）。リフレッシュトークンは `edge-auth` が扱わない。
 * - ユーザープールとドメインは、デプロイ先のリージョン（既定のプロバイダー）に置く。`edge-auth` は設定の
 *   issuer とエンドポイントを使うので、リージョンに依存しない。
 *
 * **循環の回避**: クライアントのコールバック URL は CloudFront のドメインを参照する。CloudFront は Lambda@Edge の
 * IAM ポリシーに依存する。ポリシーが `auth_cognito` の ARN を参照すると循環するため、ポリシーの Resource は
 * ARN を文字列で組んでいる（`edge-auth.tf`）。CloudFront は `auth_cognito` に依存させない。
 * したがって切り替えの初回は、`auth_cognito` が CloudFront の更新の後に作られ、その間 Lambda が 503 を返しうる。
 */
locals {
  cognito_enabled = var.auth_mode == "cognito"

  cognito_issuer = local.cognito_enabled ? "https://cognito-idp.${var.region}.amazonaws.com/${aws_cognito_user_pool.admin[0].id}" : ""
  cognito_domain = local.cognito_enabled ? "https://${aws_cognito_user_pool_domain.admin[0].domain}.auth.${var.region}.amazoncognito.com" : ""
}

resource "aws_cognito_user_pool" "admin" {
  count = local.cognito_enabled ? 1 : 0

  name           = "${var.project_name}-admins"
  user_pool_tier = "LITE"

  mfa_configuration        = "OFF"
  auto_verified_attributes = ["email"]

  admin_create_user_config {
    allow_admin_create_user_only = true
  }

  account_recovery_setting {
    recovery_mechanism {
      name     = "verified_email"
      priority = 1
    }
  }

  email_configuration {
    email_sending_account = "COGNITO_DEFAULT"
  }

  password_policy {
    minimum_length                   = 12
    require_lowercase                = true
    require_uppercase                = true
    require_numbers                  = true
    require_symbols                  = true
    temporary_password_validity_days = 7
  }
}

resource "aws_cognito_user_pool_domain" "admin" {
  count = local.cognito_enabled ? 1 : 0

  # 接頭辞はグローバルに一意で、`aws`・`amazon`・`cognito` を含められない。
  domain                = "${var.project_name}-${local.account_id}"
  user_pool_id          = aws_cognito_user_pool.admin[0].id
  managed_login_version = 1
}

resource "aws_cognito_user_pool_client" "admin" {
  count = local.cognito_enabled ? 1 : 0

  name         = "${var.project_name}-console"
  user_pool_id = aws_cognito_user_pool.admin[0].id

  generate_secret = false

  allowed_oauth_flows_user_pool_client = true
  allowed_oauth_flows                  = ["code"]
  allowed_oauth_scopes                 = ["openid"]
  supported_identity_providers         = ["COGNITO"]

  callback_urls = ["https://${aws_cloudfront_distribution.rolust.domain_name}/callback"]
  logout_urls   = ["https://${aws_cloudfront_distribution.rolust.domain_name}/"]

  id_token_validity = 1
  token_validity_units {
    id_token = "days"
  }

  prevent_user_existence_errors = "ENABLED"
}

/**
 * Lambda@Edge が実行時に読む接続情報（FR-6.4）。秘密を含まないので String。
 * 型は OIDC の IdP に依らない（将来の外部 IdP も、値を差し替えるだけで載る）。
 */
resource "aws_ssm_parameter" "auth_cognito" {
  count    = local.cognito_enabled ? 1 : 0
  provider = aws.us_east_1

  name        = var.auth_cognito_parameter_name
  description = "Rolust 管理画面の OIDC（Cognito）の接続情報（JSON）。Terraform が書く。"
  type        = "String"
  value = jsonencode({
    issuer                = local.cognito_issuer
    clientId              = aws_cognito_user_pool_client.admin[0].id
    authorizationEndpoint = "${local.cognito_domain}/oauth2/authorize"
    tokenEndpoint         = "${local.cognito_domain}/oauth2/token"
    jwksUri               = "${local.cognito_issuer}/.well-known/jwks.json"
    logoutEndpoint        = "${local.cognito_domain}/logout"
  })
}

/**
 * 権限のグループ（Issue #141）。階層は apply ⊃ edit ⊃ view で、複数に属すときは最上位が効く（`docs/guide/access-control.md`）。
 * どのグループにも属さないユーザは何もできない。グループ名は packages/core/src/permission.ts の
 * PERMISSION_GROUPS と一致していなければならない。ユーザへの割り当ては運用者が CLI で行う（`docs/guide/access-control.md`）。
 */
locals {
  permission_groups = {
    viewer  = "参照のみ（マトリクス・申請履歴・差分確認の表示）"
    editor  = "参照に加え、マトリクスの編集・登録・削除・申請の作成と破棄"
    applier = "作成に加え、信頼ポリシーの反映"
  }
}

resource "aws_cognito_user_group" "permission" {
  for_each = local.cognito_enabled ? local.permission_groups : {}

  name         = each.key
  user_pool_id = aws_cognito_user_pool.admin[0].id
  description  = each.value
}
