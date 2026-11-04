data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition

  crud_function_name  = "${var.project_name}-crud"
  diff_function_name  = "${var.project_name}-diff"
  apply_function_name = "${var.project_name}-apply"
  edge_function_name  = "${var.project_name}-edge-auth"

  # 3 系統の実行ロール名。`DenySelfEscalation`（3.2）の Deny 対象でもある。
  crud_role_name  = "${var.project_name}-crud-exec"
  diff_role_name  = "${var.project_name}-diff-exec"
  apply_role_name = "${var.project_name}-apply-exec"
  edge_role_name  = "${var.project_name}-edge-auth-exec"

  # 信頼ポリシーを読み書きしてよいロールの範囲。
  #
  # **タグ方式**（environment-provisioning 4.2 の質問 R-1 = B、
  # infrastructure-design 3.4 の再実行 RQ-3 = A で確定）。
  # 以前はロール名の接頭辞で絞り込んでいたが、Resource をアカウント内の全ロールへ広げ、
  # 代わりに `aws:ResourceTag/<key>` の条件で絞る形へ移行した。
  #
  # **タグはどのロールにも付きうる。** 接頭辞方式が持っていた「自ロールと原理的に
  # 前方一致しない」という層は失われ、残る防御は `DenySelfEscalation` の明示 Deny
  # のみになる（`infrastructure-specification.md` § 移行が失うもの — 5 層から 2 層へ）。
  managed_role_arn_all = "arn:${local.partition}:iam::${local.account_id}:role/*"

  # 管理対象を示すタグの条件。Allow 側の 3 つの Statement で共有する。
  #
  # **`iam:TagRole` は誰にも付与しない。** Rolust はタグを読むだけであり、付けるのは
  # 運用者である。管理対象の増減が Terraform の外に出ることが、この移行の本質的な
  # 変化である（受容リスク R-e: 範囲変更が `terraform plan` に出ない）。
  managed_tag_condition = {
    StringEquals = {
      "aws:ResourceTag/${var.managed_tag_key}" = var.managed_tag_value
    }
  }

  # クロスアカウント（Issue #85。iam-policy-design-note.md 3.3）: 別アカウントのロールを引き受けるときの Resource。
  #
  # アカウントは `*`（開けるかどうかは、ターゲット側の信頼ポリシーが決める）。ロール名は固定で、ワイルドカードを含めない
  # （変数の validation と、plan-guard の R-12 が見る）。Reader は CRUD・Diff（読み取り専用）、Manager は Apply
  # （信頼ポリシーの更新）だけが引き受ける。Reader と Manager を取り違えると、CRUD・Diff に書き込み権限を渡すことになる（FR-3.2）。
  target_reader_role_arn  = "arn:${local.partition}:iam::*:role/${var.target_reader_role_name}"
  target_manager_role_arn = "arn:${local.partition}:iam::*:role/${var.target_manager_role_name}"

  # Rolust が作る IAM ロールすべて（Lambda の実行ロール 4 本 + API Gateway のサービスロール）。
  # ここへの `iam:UpdateAssumeRolePolicy` は必ず Deny する。
  # `<project>-apigw-logs` は API Gateway サービスが引き受けるロールで Rolust のコードは引き受けないが、
  # 誤って管理対象タグが付いても Rolust 経由で信頼ポリシーを書き換えられないよう一律に含める
  # （旧 Issue #1 / 旧リポジトリの aidlc/spaces/default/intents/260920-apigw-account-docs/inception/requirements-analysis/requirements.md FR2.1、2026-09-21）。ロールを増やしたらここにも加えること。
  # 加え忘れは plan-guard の赤信号 R-10 が plan の時点で落とす（Issue #24、docs/design/cicd-pipeline.md § 赤信号 — 承認せず差し戻す）。
  self_role_arns = [
    "arn:${local.partition}:iam::${local.account_id}:role/${local.crud_role_name}",
    "arn:${local.partition}:iam::${local.account_id}:role/${local.diff_role_name}",
    "arn:${local.partition}:iam::${local.account_id}:role/${local.apply_role_name}",
    "arn:${local.partition}:iam::${local.account_id}:role/${local.edge_role_name}",
    "arn:${local.partition}:iam::${local.account_id}:role/${var.project_name}-apigw-logs",
  ]

  # 3.1 実行ロールの信頼ポリシー（CRUD / Diff / Apply の 3 系統共通）。
  lambda_assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  # 3.6 CloudWatch Logs（3 系統共通）。
  # ロググループを Terraform で先に作るため `logs:CreateLogGroup` は付与しない。
  logs_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "Logs"
      Effect   = "Allow"
      Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
      Resource = "arn:${local.partition}:logs:${var.region}:${local.account_id}:log-group:/aws/lambda/${var.project_name}-*:*"
    }]
  })

  # 3.4 DynamoDB。**`dynamodb:Scan` は付与しない**（NFR-1 / NFR-2）。
  # Scan を書けばテストではなく実環境で AccessDenied として現れる — 二重の担保である。
  dynamodb_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "RolustTables"
      Effect = "Allow"
      Action = [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchGetItem",
      ]
      Resource = [
        aws_dynamodb_table.state.arn,
        "${aws_dynamodb_table.state.arn}/index/*",
        aws_dynamodb_table.change_requests.arn,
      ]
    }]
  })
}
