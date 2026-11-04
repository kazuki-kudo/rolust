/**
 * ログと調査用のクエリ（observability-setup 4.4 の残り）。
 *
 * **Rolust は監視（アラーム・通知）を持たない。** 依頼者の判断（2026-09-28）で監視系の仕組みは
 * 過剰とし、4.4 で作ったアラーム M-1〜M-6 と、それだけが使うログメトリクスフィルタ F-1〜F-3 を
 * 外した（Issue #72）。ここに残るのは、障害のときに人が見に行く場所だけである。
 *
 * - CloudWatch Logs Insights の保存クエリ（反映の失敗・API Gateway の 5xx・edge-auth の失敗）
 * - Lambda@Edge が書き込むロググループ（既知の 3 リージョン）の保持期間と、書き込みを許す
 *   リージョンの一覧 `edge_log_group_arns`（#9）
 *
 * **ログの literal は保存クエリの契約である。** `packages/api/src/services/apply-service.ts` の
 * `console.error` の文字列（`[rolust] 反映に失敗しました` 等）を変えるときは、
 * 保存クエリ `apply_failures` の条件も同時に変える。一致しなくなってもエラーにはならず、
 * クエリが静かに 0 件を返すようになる。
 */

locals {
  # `apply-service.ts` の console.error の literal（先頭部分）。保存クエリ apply_failures が使う。
  apply_failed_literal   = "[rolust] 反映に失敗しました"
  apply_record_failed    = "[rolust] 失敗状態の記録に失敗しました"
  apply_abnormal_literal = "[rolust] 反映処理が異常終了しました"

  apply_log_group_name = aws_cloudwatch_log_group.lambda["apply"].name

  # Lambda@Edge が書き込むロググループ名。処理したエッジのリージョンに書かれる。
  edge_log_group_name = "/aws/lambda/us-east-1.${local.edge_function_name}"

  # Lambda@Edge の実行ロールが書き込みを許されるロググループ（下の 3 件）。edge-auth.tf の
  # IAM ポリシーがこの一覧に追従するので、リージョンを足すときはここにも足す（Issue #9）。
  edge_log_group_arns = [
    aws_cloudwatch_log_group.edge_auth_us_west_1.arn,
    aws_cloudwatch_log_group.edge_auth_eu_central_1.arn,
    aws_cloudwatch_log_group.edge_auth_us_east_1.arn,
  ]
}

# ---------------------------------------------------------------------------
# CloudWatch Logs Insights の保存クエリ（4.4 質問 Q4 = A: ダッシュボードの代わりの「見に行く場所」）
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_query_definition" "apply_failures" {
  name            = "${var.project_name}/apply-failures"
  log_group_names = [local.apply_log_group_name]

  query_string = <<-EOT
    fields @timestamp, @message
    | filter @message like "${local.apply_failed_literal}"
        or @message like "${local.apply_record_failed}"
        or @message like "${local.apply_abnormal_literal}"
    | sort @timestamp desc
    | limit 100
  EOT
}

resource "aws_cloudwatch_query_definition" "apigw_5xx" {
  name            = "${var.project_name}/apigw-5xx"
  log_group_names = [aws_cloudwatch_log_group.api_gateway.name]

  query_string = <<-EOT
    fields @timestamp, httpMethod, path, status, integrationErr, requestId
    | filter status like /^5/
    | sort @timestamp desc
    | limit 100
  EOT
}

# ---------------------------------------------------------------------------
# Lambda@Edge のログ（4.4 質問 Q5 = C。Issue #9 により 2026-09-29 改訂）
#
# Lambda@Edge は**リクエストを処理したエッジのリージョン**に
# `/aws/lambda/us-east-1.<function>` を書く。CloudFront が `PriceClass_100`
# （北米・欧州のエッジのみ）のため、日本からの閲覧は米国西海岸のエッジに接続され、
# 4.4 の実測では **us-west-1** に集中していた。
#
# **書き込みを許すのは、下の 3 リージョンに限る**（Issue #9 の決定 = B）。以前は実行ロールが
# 全リージョンへの書き込みを許していたため、別のエッジが使われるたびに、保持無期限・
# Terraform 管理外のロググループが自動作成されていた。4.7 の実測（2026-09-19）では
# 05:27:59Z に `eu-central-1`、05:28:00Z に `us-east-1` に作られ、`terraform plan` にも
# 現れなかった。この 2 件は質問 Q2 = A により `terraform import` で取り込み、保持 14 日を効かせている。
#
# 現在は `local.edge_log_group_arns` の外のリージョンへの書き込みを IAM が拒否する。新しい
# リージョンのエッジが使われても、ロググループは作られず、そのリージョンで処理された分の
# ログは残らない（受容している）。edge-auth の認証の動作は変わらない見込みだが、書き込みの
# 拒否が応答に影響しないことは実測していない（エッジのリージョンを選べないため）。
#
# **リージョンを足す**（そのリージョンのログを残したくなった）ときは、次の 3 点を同じ変更で行う。
#   1. provider alias を足す
#   2. そのリージョンの `aws_cloudwatch_log_group` を足す。自動作成済みなら取り込む:
#        terraform import aws_cloudwatch_log_group.<name> /aws/lambda/us-east-1.<project>-edge-auth
#      （import はリージョンごとの provider で行うので、`region` を合わせる）
#   3. `local.edge_log_group_arns` に ARN を足す（edge-auth.tf の IAM ポリシーが追従する）
# ---------------------------------------------------------------------------

provider "aws" {
  alias  = "us_west_1"
  region = "us-west-1"

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}

resource "aws_cloudwatch_log_group" "edge_auth_us_west_1" {
  provider = aws.us_west_1

  name              = local.edge_log_group_name
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_query_definition" "edge_auth_failures" {
  provider = aws.us_west_1

  name            = "${var.project_name}/edge-auth-failures"
  log_group_names = [aws_cloudwatch_log_group.edge_auth_us_west_1.name]

  query_string = <<-EOT
    fields @timestamp, @message
    | filter @message like "[rolust-edge-auth]"
    | sort @timestamp desc
    | limit 100
  EOT
}

# 4.7 質問 Q2 = A — エッジが使われて自動作成された 2 件を取り込んだ。
# 保持期間だけを Terraform の管理下に置く（ロググループ自体は Lambda@Edge が作った）。
#
#   terraform import aws_cloudwatch_log_group.edge_auth_eu_central_1 /aws/lambda/us-east-1.<project>-edge-auth
#   terraform import aws_cloudwatch_log_group.edge_auth_us_east_1    /aws/lambda/us-east-1.<project>-edge-auth

provider "aws" {
  alias  = "eu_central_1"
  region = "eu-central-1"

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}

resource "aws_cloudwatch_log_group" "edge_auth_eu_central_1" {
  provider = aws.eu_central_1

  name              = local.edge_log_group_name
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "edge_auth_us_east_1" {
  provider = aws.us_east_1

  name              = local.edge_log_group_name
  retention_in_days = var.log_retention_days
}
