/**
 * Lambda@Edge による認証（FR-6.1・FR-6.4）と、その設定を置く SSM パラメータ。
 *
 * 制約（`code-generation-questions.md` 質問 2 の帰結）:
 * - 関数と実行ロールは **us-east-1**。CloudFront に関連付けられるのはこのリージョンだけ。
 * - 実行ロールの信頼ポリシーには **`lambda.amazonaws.com` と `edgelambda.amazonaws.com` の
 *   両方**を Principal に含める。片方だけだと CloudFront への関連付けが失敗する。
 * - Lambda@Edge は**環境変数を持てない**ため、パラメータ名はコード側の定数
 *   （`packages/edge-auth/src/index.ts` の `CREDENTIALS_PARAMETER_NAME`）。
 * - viewer-request の関数は**バージョン指定（qualified ARN）**でしか関連付けられない。
 */

# output_file_mode を固定する理由は lambda.tf の archive_file と同じ（Issue #38）。
data "archive_file" "edge_auth" {
  type             = "zip"
  source_dir       = "${path.module}/../packages/edge-auth/dist"
  output_path      = "${path.module}/.build/edge-auth.zip"
  output_file_mode = "0644"
}

resource "aws_iam_role" "edge_auth" {
  provider = aws.us_east_1

  name = local.edge_role_name

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        # Lambda@Edge はこの 2 つの両方を必要とする。
        Service = ["lambda.amazonaws.com", "edgelambda.amazonaws.com"]
      }
      Action = "sts:AssumeRole"
    }]
  })
}

/**
 * Lambda@Edge のログは**リクエストを処理したエッジのリージョン**に出る。
 * ロググループ名は `/aws/lambda/<region>.<function-name>`。エッジのリージョンは選べないため、
 * 全リージョン分を先に作ることはしない。代わりに、書き込みを許すロググループを
 * Terraform 管理下の 3 件（`local.edge_log_group_arns`、monitoring.tf）に限る（Issue #9）。
 * それ以外のリージョンのエッジが処理した分は書き込みを拒否され、保持無期限の
 * ロググループが増えない代わりに、ログも残らない。
 *
 * この 1 系統だけ `logs:CreateLogGroup` を付与する（`iam-policy-design-note.md` 3.6 が
 * 「先に作れば不要」としているのは主リージョンの 3 系統）。3 リージョンでは Terraform が
 * ロググループを先に作るが、手で消されても書き込み時に作り直せるようにするため。
 */
resource "aws_iam_role_policy" "edge_auth_logs" {
  provider = aws.us_east_1

  name = "logs"
  role = aws_iam_role.edge_auth.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid    = "EdgeLogs"
      Effect = "Allow"
      Action = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
      # ロググループの ARN は末尾に `:*` を持たない。従来のポリシーと同じく、ロググループそのものと
      # `:*` 付き（ログストリームを含む）の 2 形を許可する。
      Resource = concat(
        local.edge_log_group_arns,
        [for arn in local.edge_log_group_arns : "${arn}:*"],
      )
    }]
  })
}

/**
 * SecureString の読み取り（3.7）。
 *
 * `kms:Decrypt` は `kms:ViaService` 条件で SSM 経由に限定する。AWS 管理キー
 * `alias/aws/ssm` は当該リージョンで最初に SecureString を作った時点で生成されるため、
 * キー ARN を data source で先に引くと初回 apply の順序に依存してしまう。
 * 条件付きの `Resource = "*"` はこの依存を作らずに用途を絞る標準的な書き方である。
 */
resource "aws_iam_role_policy" "edge_auth_ssm" {
  provider = aws.us_east_1

  name = "ssm-read-credentials"
  role = aws_iam_role.edge_auth.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ReadCredentials"
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = aws_ssm_parameter.basic_auth.arn
      },
      {
        Sid      = "ReadIpAllowlist"
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = aws_ssm_parameter.ip_allowlist.arn
      },
      {
        Sid      = "ReadAuthMode"
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = aws_ssm_parameter.auth_mode.arn
      },
      {
        # **ARN を resource への参照で書かない。** `auth_cognito` は Cognito のクライアントを参照し、クライアントの
        # コールバック URL は CloudFront のドメインを参照する。CloudFront はこのポリシーに依存するので
        # （`depends_on`）、参照にすると「ポリシー → パラメータ → クライアント → CloudFront → ポリシー」の循環になる。
        # パラメータの ARN は、名前とアカウントから決まるので、文字列で組む。
        Sid      = "ReadAuthCognito"
        Effect   = "Allow"
        Action   = "ssm:GetParameter"
        Resource = "arn:${local.partition}:ssm:us-east-1:${local.account_id}:parameter${var.auth_cognito_parameter_name}"
      },
      {
        Sid      = "DecryptViaSsm"
        Effect   = "Allow"
        Action   = "kms:Decrypt"
        Resource = "*"
        Condition = {
          StringEquals = {
            "kms:ViaService" = "ssm.us-east-1.amazonaws.com"
          }
        }
      },
    ]
  })
}

resource "aws_lambda_function" "edge_auth" {
  provider = aws.us_east_1

  function_name    = local.edge_function_name
  role             = aws_iam_role.edge_auth.arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  timeout          = 5
  memory_size      = 128
  filename         = data.archive_file.edge_auth.output_path
  source_code_hash = data.archive_file.edge_auth.output_base64sha256

  # viewer-request への関連付けにはバージョン付き ARN が要る。
  publish = true

  # Lambda@Edge は環境変数を持てない。architectures も x86_64 のみ。
  architectures = ["x86_64"]
}

/**
 * Basic 認証の資格情報（`<ユーザ名>:<パスワード>` の SecureString）。
 *
 * **値は Terraform の管理外**（`ignore_changes`）。作成時のプレースホルダは
 * 意図的に `:` を含まない — `packages/edge-auth` は書式不正を通さず 503 を返すため、
 * 実値を投入するまで管理画面は**閉じたまま**になる（fail closed）。
 *
 * 注意: `terraform refresh` / `plan` は SecureString の実値を読み取り**state に書き込む**。
 * state ファイルは暗号化されたバックエンド（S3 + SSE-KMS など）に置き、
 * アクセスを制限すること。詳細は `docs/guide/limitations.md` を参照。
 */
resource "aws_ssm_parameter" "basic_auth" {
  provider = aws.us_east_1

  name        = var.basic_auth_parameter_name
  description = "Rolust 管理画面の Basic 認証資格情報（<user>:<password>）。値は手動投入。"
  type        = "SecureString"
  value       = "REPLACE-ME-AFTER-APPLY"

  lifecycle {
    ignore_changes = [value]
  }
}

/**
 * IP 許可リスト（FR-6.2）。IPv4 アドレスまたは CIDR をカンマ区切りで並べた String。
 *
 * 初期値は `0.0.0.0/0`（全許可）で、反映直後の挙動を変えない（Basic 認証だけの状態と同じ）。
 * 絞るのは apply の後に `put-parameter` で行う（`docs/guide/access-control.md` の「IP アドレス制限」）。実行時に値が空・不正・取得不能
 * なら `packages/edge-auth` が 503 で通さない（fail closed）。
 *
 * **値は Terraform の管理外**（`ignore_changes`）。`ignore_changes` が外れると、apply が許可リストを
 * 初期値で上書きして IP 制限を外す。plan-guard の R-8 がこの差分を赤信号にする。
 */
resource "aws_ssm_parameter" "ip_allowlist" {
  provider = aws.us_east_1

  name        = var.ip_allowlist_parameter_name
  description = "Rolust 管理画面の IP 許可リスト（IPv4 アドレスまたは CIDR のカンマ区切り）。初期値は全許可。"
  type        = "String"
  value       = "0.0.0.0/0"

  lifecycle {
    ignore_changes = [value]
  }
}

/**
 * 認証方式（FR-6.4）。`basic` または `cognito`。Lambda@Edge が実行時に読み、5 分キャッシュする。
 *
 * **値は Terraform の管理下**（`ignore_changes` を付けない）。切り替えは `var.auth_mode` で行い、plan に差分が出る。
 * `basic_auth` と許可リストのように「手で入れた値を守る」性質のものではなく、構成そのものだからである。
 * CloudFront はこのパラメータにだけ依存する（`auth_cognito` には依存させない。循環を避けるため）。
 */
resource "aws_ssm_parameter" "auth_mode" {
  provider = aws.us_east_1

  name        = var.auth_mode_parameter_name
  description = "Rolust 管理画面の認証方式（basic または cognito）。値は var.auth_mode。"
  type        = "String"
  value       = var.auth_mode
}
