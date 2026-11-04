/**
 * API Gateway (REST) — CloudFront の `/api/*` ビヘイビアのオリジン。
 *
 * 経路の割り当て（`iam-policy-design-note.md` 2 節の 3 系統に対応）:
 *
 * | パス | Lambda |
 * |---|---|
 * | `/api/diff`     | Diff（`iam:GetRole` まで） |
 * | `/api/drift`    | Diff（`iam:GetRole` まで。登録済みの割り当てと実際の信頼ポリシーの乖離の確認。Issue #170） |
 * | `/api/drift/restore`・`/api/drift/adopt` | Diff（`iam:GetRole` まで。乖離を直す操作。IAM は書かない。Issue #172） |
 * | `/api/apply`    | Apply（`iam:UpdateAssumeRolePolicy` を持つ唯一の系統） |
 * | `/api/{proxy+}` | CRUD（IAM は読み取りのみ: `iam:ListRoleTags`・タグ条件つきの `iam:GetRole`） |
 *
 * API Gateway は完全一致のリソースを greedy proxy より優先するため、
 * `/api/diff`・`/api/drift`・`/api/apply` は CRUD へ落ちない。
 *
 * 利用者の認可はここに置かない。入口は CloudFront の viewer-request（Lambda@Edge の
 * IP 許可リストと Basic 認証）1 箇所に閉じる（FR-6.1・FR-6.2）。API Gateway のエンドポイントを
 * 直接叩かれるとこれらを迂回できてしまうため、CloudFront が付ける API キーをメソッドが
 * 要求して直 URL を塞ぐ（FR-6.3、Issue #76。ファイル末尾の API キー）。`outputs.tf` は
 * その URL を「配布しないこと」と注記して出す。
 */

resource "aws_api_gateway_rest_api" "rolust" {
  name        = "${var.project_name}-api"
  description = "Rolust の管理 API（CloudFront の /api/* から到達する）"

  endpoint_configuration {
    types = ["REGIONAL"]
  }
}

resource "aws_api_gateway_resource" "api" {
  rest_api_id = aws_api_gateway_rest_api.rolust.id
  parent_id   = aws_api_gateway_rest_api.rolust.root_resource_id
  path_part   = "api"
}

locals {
  # `/api` 直下の固定パス → 専用 Lambda。それ以外は greedy proxy で CRUD へ。
  api_leaf_routes = {
    diff  = { path_part = "diff", target = "diff" }
    drift = { path_part = "drift", target = "diff" }
    apply = { path_part = "apply", target = "apply" }
  }
}

resource "aws_api_gateway_resource" "leaf" {
  for_each = local.api_leaf_routes

  rest_api_id = aws_api_gateway_rest_api.rolust.id
  parent_id   = aws_api_gateway_resource.api.id
  path_part   = each.value.path_part
}

# api_key_required: CloudFront が付ける x-api-key を要求し、直 URL を Lambda に届かせない（FR-6.3）。
# 外れると plan-guard の R-11 が落とす。
resource "aws_api_gateway_method" "leaf" {
  for_each = local.api_leaf_routes

  rest_api_id      = aws_api_gateway_rest_api.rolust.id
  resource_id      = aws_api_gateway_resource.leaf[each.key].id
  http_method      = "ANY"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "leaf" {
  for_each = local.api_leaf_routes

  rest_api_id = aws_api_gateway_rest_api.rolust.id
  resource_id = aws_api_gateway_resource.leaf[each.key].id
  http_method = aws_api_gateway_method.leaf[each.key].http_method

  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api[each.value.target].invoke_arn
}

locals {
  # `/api/drift` の子（乖離を直す操作。Issue #172）。`drift` はリーフ（子を持たない）ので、
  # 子の経路は greedy proxy に落ちず 403 になる。足さないと届かない。Diff へ統合する。
  api_drift_child_routes = {
    restore = { path_part = "restore" }
    adopt   = { path_part = "adopt" }
  }
}

resource "aws_api_gateway_resource" "drift_child" {
  for_each = local.api_drift_child_routes

  rest_api_id = aws_api_gateway_rest_api.rolust.id
  parent_id   = aws_api_gateway_resource.leaf["drift"].id
  path_part   = each.value.path_part
}

# api_key_required: 直 URL を Lambda に届かせない（FR-6.3）。外れると plan-guard の R-11 が落とす。
resource "aws_api_gateway_method" "drift_child" {
  for_each = local.api_drift_child_routes

  rest_api_id      = aws_api_gateway_rest_api.rolust.id
  resource_id      = aws_api_gateway_resource.drift_child[each.key].id
  http_method      = "ANY"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "drift_child" {
  for_each = local.api_drift_child_routes

  rest_api_id = aws_api_gateway_rest_api.rolust.id
  resource_id = aws_api_gateway_resource.drift_child[each.key].id
  http_method = aws_api_gateway_method.drift_child[each.key].http_method

  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api["diff"].invoke_arn
}

resource "aws_api_gateway_resource" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.rolust.id
  parent_id   = aws_api_gateway_resource.api.id
  path_part   = "{proxy+}"
}

resource "aws_api_gateway_method" "proxy" {
  rest_api_id      = aws_api_gateway_rest_api.rolust.id
  resource_id      = aws_api_gateway_resource.proxy.id
  http_method      = "ANY"
  authorization    = "NONE"
  api_key_required = true
}

resource "aws_api_gateway_integration" "proxy" {
  rest_api_id = aws_api_gateway_rest_api.rolust.id
  resource_id = aws_api_gateway_resource.proxy.id
  http_method = aws_api_gateway_method.proxy.http_method

  type                    = "AWS_PROXY"
  integration_http_method = "POST"
  uri                     = aws_lambda_function.api["crud"].invoke_arn
}

resource "aws_lambda_permission" "api_gateway" {
  for_each = local.lambda_functions

  statement_id  = "AllowAPIGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.api[each.key].function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_api_gateway_rest_api.rolust.execution_arn}/*/*"
}

resource "aws_api_gateway_deployment" "rolust" {
  rest_api_id = aws_api_gateway_rest_api.rolust.id

  # 経路や統合が変わったら必ず再デプロイする。これを怠ると
  # 「terraform apply は成功したのに API の挙動が古いまま」という無言の失敗になる。
  triggers = {
    redeployment = sha1(jsonencode([
      aws_api_gateway_resource.api.id,
      [for key in keys(local.api_leaf_routes) : aws_api_gateway_resource.leaf[key].id],
      [for key in keys(local.api_leaf_routes) : aws_api_gateway_integration.leaf[key].id],
      [for key in keys(local.api_drift_child_routes) : aws_api_gateway_resource.drift_child[key].id],
      [for key in keys(local.api_drift_child_routes) : aws_api_gateway_integration.drift_child[key].id],
      aws_api_gateway_resource.proxy.id,
      aws_api_gateway_integration.proxy.id,
      # メソッドの設定も含める。含めないと、api_key_required を変えても再デプロイされず、
      # 「apply は成功したのに、API が古い挙動のまま」になる（FR-6.3、Issue #76）。
      [for key in keys(local.api_leaf_routes) : aws_api_gateway_method.leaf[key].api_key_required],
      [for key in keys(local.api_drift_child_routes) : aws_api_gateway_method.drift_child[key].api_key_required],
      aws_api_gateway_method.proxy.api_key_required,
    ]))
  }

  lifecycle {
    create_before_destroy = true
  }
}

/**
 * API Gateway のアカウント設定（CloudWatch Logs へ書くためのロール）。
 *
 * REST API のステージがアクセスログを書くには、**アカウント × リージョン単位**の設定
 * `cloudwatchRoleArn` が先に要る。これが無いと `aws_api_gateway_stage` の
 * `access_log_settings` は `BadRequestException: CloudWatch Logs role ARN must be set
 * in account settings to enable logging` で失敗する（4.3 の初回 apply で実測。
 * deployment-log.md § 初回 apply の失敗）。
 *
 * **これは Rolust の資源ではなくアカウントの設定である。** この account/region の
 * すべての REST API が同じロールを使う。Rolust の Terraform が所有する帰結:
 *
 * - 同じ account/region に他の REST API があると、その API のログもこのロールで書かれる
 * - `terraform destroy` すると provider（v6 系）は設定を**リセットする**（`cloudwatchRoleArn` が空に戻る）。
 *   他の API のログを止めたくない場合は、destroy の前に
 *   `terraform state rm aws_api_gateway_account.this` で state から外し、設定を残す
 * - 既に別のロールが設定されている account/region に apply すると、その値を**上書きする**
 *   （plan の差分に `cloudwatch_role_arn` の変更として現れる。承認者は確認すること）
 */
resource "aws_iam_role" "apigw_logs" {
  name = "${var.project_name}-apigw-logs"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "apigateway.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "apigw_logs" {
  role       = aws_iam_role.apigw_logs.name
  policy_arn = "arn:${local.partition}:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"
}

resource "aws_api_gateway_account" "this" {
  cloudwatch_role_arn = aws_iam_role.apigw_logs.arn

  depends_on = [aws_iam_role_policy_attachment.apigw_logs]
}

resource "aws_cloudwatch_log_group" "api_gateway" {
  name              = "/aws/apigateway/${var.project_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_api_gateway_stage" "rolust" {
  rest_api_id   = aws_api_gateway_rest_api.rolust.id
  deployment_id = aws_api_gateway_deployment.rolust.id
  stage_name    = "prod"

  # アクセスログはアカウント設定（上の aws_api_gateway_account）が先に無いと有効化できない。
  depends_on = [aws_api_gateway_account.this]

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_gateway.arn
    format = jsonencode({
      requestId      = "$context.requestId"
      httpMethod     = "$context.httpMethod"
      path           = "$context.path"
      status         = "$context.status"
      responseLength = "$context.responseLength"
      integrationErr = "$context.integrationErrorMessage"
    })
  }
}

/**
 * API Gateway の直 URL の遮断（FR-6.3）。
 *
 * CloudFront は API オリジンへ `x-api-key` ヘッダーを付けて転送する（`cloudfront.tf`）。
 * メソッドが `api_key_required = true` のとき、API Gateway はこのキーが無い・違うリクエストを、
 * Lambda を呼ぶ前に 403 で拒否する。Basic 認証（FR-6.1）と IP 許可リスト（FR-6.2）は
 * CloudFront の側にあり、直 URL には効かないので、これが直 URL を塞ぐ唯一の仕組みである。
 *
 * API キーは認証の唯一の手段にしない（AWS の案内）。ここでは「CloudFront を通ったか」を確かめる
 * 共有の秘密で、多層防御の一層である。値は AWS が自動生成し、sensitive として扱われる。
 * usage plan は、キーを検証するために必須の入れ物で、スロットリングと割り当ては設けない。
 *
 * 鍵の入れ替え: `terraform apply -replace=aws_api_gateway_api_key.rolust`。CloudFront の更新が
 * 終わるまでの数分、`/api/*` は 403 になる。
 */
resource "aws_api_gateway_api_key" "rolust" {
  name    = "${var.project_name}-cloudfront-origin"
  enabled = true
}

resource "aws_api_gateway_usage_plan" "rolust" {
  name = "${var.project_name}-cloudfront-origin"

  api_stages {
    api_id = aws_api_gateway_rest_api.rolust.id
    stage  = aws_api_gateway_stage.rolust.stage_name
  }
}

resource "aws_api_gateway_usage_plan_key" "rolust" {
  key_id        = aws_api_gateway_api_key.rolust.id
  key_type      = "API_KEY"
  usage_plan_id = aws_api_gateway_usage_plan.rolust.id
}
