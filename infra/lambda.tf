/**
 * API の Lambda 3 系統と実行ロール（`iam-policy-design-note.md` 2 節・3 節）。
 *
 * | Lambda | 権限 |
 * |---|---|
 * | CRUD  | DynamoDB + `iam:ListRoleTags` + `iam:GetRole`（**読み取りのみ**。3.4 再実行で `ListRoleTags`、Issue #80 で `GetRole`（タグ条件つき）を追加） |
 * | Diff  | DynamoDB + `iam:GetRole`（読み取りのみ） |
 * | Apply | DynamoDB + `iam:GetRole` + `iam:UpdateAssumeRolePolicy` |
 *
 * `iam:UpdateAssumeRolePolicy` を持つのは Apply の 1 系統だけである。
 * この分割により FR-3.2（マトリクス操作時に AWS へ一切書き込まない）は、
 * CRUD Lambda が**書き込み**権限を持たないことで構造的に保証される。
 *
 * **CRUD は 3.4 の再実行までは IAM 権限を一切持たなかった。** タグ方式への移行により
 * 登録時検証がタグの読み取りを要するようになり、`iam:ListRoleTags` を得た
 * （下記 `crud_iam_read_tags`）。Issue #80 では、ロールの紐づけ時に信頼ポリシーを読むため、
 * `iam:GetRole` を得た（下記 `crud_iam_read_trust`。タグ条件つき）。どちらも読み取り専用であり FR-3.2 の保証は保たれる。
 *
 * `iam:ListRoles` / `iam:ListUsers` / `iam:GetUser` はどの系統にも付与しない（FR-5.7 / C-4）。
 *
 * **別アカウントのロールは、ターゲット側の Reader・Manager を引き受けて操作する**（Issue #85）。3 系統の実行ロールが持つ
 * `sts:AssumeRole` は、下の `crud_assume_target_reader`・`diff_assume_target_reader`（Reader）と
 * `apply_assume_target_manager`（Manager）だけである。CRUD・Diff は Reader だけ、Apply は Manager だけを引き受けられる。
 */

locals {
  api_dist = "${path.module}/../packages/api/dist"

  lambda_functions = {
    crud  = { name = local.crud_function_name, role_name = local.crud_role_name }
    diff  = { name = local.diff_function_name, role_name = local.diff_role_name }
    apply = { name = local.apply_function_name, role_name = local.apply_role_name }
  }
}

# output_file_mode を固定しないと、zip に記録されるファイルモードが実行環境の OS に依存する
# （Windows では 0666、Linux の CI ランナーでは 0644）。中身が同じでも source_code_hash が変わり、
# 手動の apply と CD の plan が互いを差分として出し続けた（Issue #38。CD は Issue #181 で廃止した）。
data "archive_file" "lambda" {
  for_each = local.lambda_functions

  type             = "zip"
  source_dir       = "${local.api_dist}/${each.key}"
  output_path      = "${path.module}/.build/${each.key}.zip"
  output_file_mode = "0644"
}

resource "aws_iam_role" "lambda" {
  for_each = local.lambda_functions

  name               = each.value.role_name
  assume_role_policy = local.lambda_assume_role_policy
}

resource "aws_iam_role_policy" "lambda_logs" {
  for_each = local.lambda_functions

  name   = "logs"
  role   = aws_iam_role.lambda[each.key].id
  policy = local.logs_policy
}

resource "aws_iam_role_policy" "lambda_dynamodb" {
  for_each = local.lambda_functions

  name   = "dynamodb"
  role   = aws_iam_role.lambda[each.key].id
  policy = local.dynamodb_policy
}

# Diff Lambda — 信頼ポリシーの**読み取りのみ**（3.2 の ReadTrustPolicy）。
resource "aws_iam_role_policy" "diff_iam_read" {
  name = "iam-read-trust-policy"
  role = aws_iam_role.lambda["diff"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "ReadTrustPolicy"
      Effect    = "Allow"
      Action    = "iam:GetRole"
      Resource  = local.managed_role_arn_all
      Condition = local.managed_tag_condition
    }]
  })
}

# CRUD Lambda — 登録時検証のためのタグ読み取り（3.4 再実行の RQ-4 = A / RQ-6 = A）。
#
# **これは CRUD が持つ、条件なしの IAM 権限である**（Issue #80 で、タグ条件つきの `crud_iam_read_trust` が加わった）。タグ方式では「タグが付いているか」を
# 見るまで対象を絞れないため、`Resource` は `role/*` で条件を付けない（RQ-6 = A）。
# タグ条件で絞ると、タグの無いロールで `AccessDenied` が返り「タグが無い」と
# 「読めない」が区別できなくなる。判定の一意性を優先した。
#
# **引き受けたもの（受容リスク R-d）**: CRUD がアカウント内の全ロールのタグを列挙できる。
# 無関係な他システムのロールを含み、偵察情報になりうる。読み取り専用であり
# AWS の状態を変える能力は持たない（`iam:UpdateAssumeRolePolicy` は付与しない）。
#
# この権限は FR-2.1 / FR-7.2 の登録時検証を成立させるためにある。無いと、管理対象で
# ないロールの登録が反映の連鎖の末尾で `AccessDenied` として初めて現れる
# （`project.md` `cid:code-generation:round2-c8` — 誤りはそれが作られた場所で報せる）。
resource "aws_iam_role_policy" "crud_iam_read_tags" {
  name = "iam-read-role-tags"
  role = aws_iam_role.lambda["crud"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadRoleTagsForRegistrationCheck"
      Effect   = "Allow"
      Action   = "iam:ListRoleTags"
      Resource = local.managed_role_arn_all
    }]
  })
}

# CRUD Lambda — 紐づけ時の信頼ポリシーの読み取り（Issue #80。iam-policy-design-note.md 3.10）。
#
# ロールをユーザプールへ紐づけるとき、信頼ポリシーにいる IAM ユーザを Rolust の記録へ取り込む
# （`packages/api/src/services/role-import.ts`）。読める範囲は Diff の `diff_iam_read` と同じ
# （管理対象タグの付いたロールだけ）で、新しい偵察面は増えない。`crud_iam_read_tags`（ロール登録時のタグ検証。
# 条件なし）とは別のポリシーにしてある: あちらは「タグが無い」と「読めない」を区別するため条件を付けられないが、
# こちらはタグ条件で絞れる。
#
# 読み取り専用で、`iam:UpdateAssumeRolePolicy` は付与しない（FR-3.2 の保証は保たれる）。
# plan-guard の R-1・R-3 がタグ条件と一覧系の Action を、R-9 が Action が `iam:GetRole` 単体であることを見る。
resource "aws_iam_role_policy" "crud_iam_read_trust" {
  name = "iam-read-trust-policy"
  role = aws_iam_role.lambda["crud"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "ReadTrustPolicyForLinkImport"
      Effect    = "Allow"
      Action    = "iam:GetRole"
      Resource  = local.managed_role_arn_all
      Condition = local.managed_tag_condition
    }]
  })
}

# Apply Lambda — 読み取り + 更新（3.2）。
#
# `DenySelfEscalation` は**必須**。これがないと Rolust 自身の実行ロールの信頼ポリシーを
# Rolust 経由で書き換えられ、自己昇格の閉路ができる。
# 明示的な Deny は同一アカウント内のどの Allow よりも優先される。
#
# **タグ方式へ移行した後、この Deny は単層の最終防衛線になる。**
# 接頭辞方式では既定値 `RolustManaged-`（大文字始まり）が `project_name`（`^[a-z]` 制約）
# 由来の自ロール名と原理的に前方一致しないという層があったが、タグはどのロールにも
# 付きうるため `rolust-apply-exec` にもタグが付く可能性がある（受容リスク R-f）。
# Allow の形に依存せず自己昇格の閉路ができないことをここで保証する。
resource "aws_iam_role_policy" "apply_iam_write" {
  name = "iam-update-trust-policy"
  role = aws_iam_role.lambda["apply"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid       = "ReadTrustPolicy"
        Effect    = "Allow"
        Action    = "iam:GetRole"
        Resource  = local.managed_role_arn_all
        Condition = local.managed_tag_condition
      },
      {
        Sid       = "UpdateTrustPolicy"
        Effect    = "Allow"
        Action    = "iam:UpdateAssumeRolePolicy"
        Resource  = local.managed_role_arn_all
        Condition = local.managed_tag_condition
      },
      {
        Sid      = "DenySelfEscalation"
        Effect   = "Deny"
        Action   = "iam:UpdateAssumeRolePolicy"
        Resource = local.self_role_arns
      },
    ]
  })
}

# クロスアカウント（Issue #85。iam-policy-design-note.md 3.3）— 別アカウントのロールを引き受ける。
#
# ターゲットアカウントの信頼ポリシーの読み書きは、ターゲット側に CloudFormation テンプレートで作った 2 つのロールを引き受けて行う
# （`docs/guide/cross-account.md`。ターゲット側は Terraform では作らない。Issue #92 により 2026-10-13 訂正。訂正前は手動で作るとしていた）。
#   CRUD・Diff → Reader（`iam:GetRole` と `iam:ListRoleTags`。読み取り専用）
#   Apply      → Manager（`iam:GetRole` と `iam:UpdateAssumeRolePolicy`）
# CRUD が Manager を引き受けられる形にすると、FR-3.2（CRUD は AWS へ書き込まない）の保証が外れる。
# Action は `sts:AssumeRole` 単体、Resource はロール名固定（アカウントだけ `*`）に保つ。
# plan-guard の R-12 が、Action の広がり・ロール名のワイルドカード・Reader と Manager の取り違えを plan の時点で止める。
#
# 引き受けが失敗しても、Rolust はデプロイ先の資格情報で呼び直さない（#27 の再発防止。packages/api/src/aws/iam-client.ts）。
resource "aws_iam_role_policy" "crud_assume_target_reader" {
  name = "assume-target-reader"
  role = aws_iam_role.lambda["crud"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "AssumeTargetReader"
      Effect   = "Allow"
      Action   = "sts:AssumeRole"
      Resource = local.target_reader_role_arn
    }]
  })
}

resource "aws_iam_role_policy" "diff_assume_target_reader" {
  name = "assume-target-reader"
  role = aws_iam_role.lambda["diff"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "AssumeTargetReader"
      Effect   = "Allow"
      Action   = "sts:AssumeRole"
      Resource = local.target_reader_role_arn
    }]
  })
}

resource "aws_iam_role_policy" "apply_assume_target_manager" {
  name = "assume-target-manager"
  role = aws_iam_role.lambda["apply"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "AssumeTargetManager"
      Effect   = "Allow"
      Action   = "sts:AssumeRole"
      Resource = local.target_manager_role_arn
    }]
  })
}

/**
 * ユーザプールに登録できる IAM ユーザの AWS アカウント ID の許可リスト（Issue #139。FR-1.11）。
 *
 * 初期値はデプロイ先のアカウント ID だけ。別アカウントのユーザを使うときは、apply の後に `put-parameter` で足す
 * （出力 `set_allowed_account_ids_command`）。読めない・空・不正なときは、API が登録を拒否する（fail closed）。
 *
 * **値は Terraform の管理外**（`ignore_changes`）。外れると、apply が足したアカウントを初期値で上書きし、
 * 別アカウントのユーザを登録できなくなる。plan-guard の R-8 がこの差分を赤信号にする。
 */
resource "aws_ssm_parameter" "allowed_account_ids" {
  name        = var.allowed_account_ids_parameter_name
  description = "Rolust のユーザプールに登録できる IAM ユーザの AWS アカウント ID（12 桁のカンマ区切り）。初期値はデプロイ先のアカウントだけ。"
  type        = "String"
  value       = local.account_id

  lifecycle {
    ignore_changes = [value]
  }
}

# CRUD だけが、許可リストを読む（ユーザの登録・ロールの登録時の取り込みは CRUD 系統。Diff・Apply は登録しない）。
# 読むのは、このパラメータ 1 件だけ。SSM は String なので kms:Decrypt は要らない。
resource "aws_iam_role_policy" "crud_ssm_allowed_accounts" {
  name = "ssm-read-allowed-accounts"
  role = aws_iam_role.lambda["crud"].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid      = "ReadAllowedAccountIds"
      Effect   = "Allow"
      Action   = "ssm:GetParameter"
      Resource = aws_ssm_parameter.allowed_account_ids.arn
    }]
  })
}

resource "aws_cloudwatch_log_group" "lambda" {
  for_each = local.lambda_functions

  name              = "/aws/lambda/${each.value.name}"
  retention_in_days = var.log_retention_days
}

resource "aws_lambda_function" "api" {
  for_each = local.lambda_functions

  function_name    = each.value.name
  role             = aws_iam_role.lambda[each.key].arn
  handler          = "index.handler"
  runtime          = "nodejs24.x"
  architectures    = ["arm64"]
  timeout          = 30
  memory_size      = 512
  filename         = data.archive_file.lambda[each.key].output_path
  source_code_hash = data.archive_file.lambda[each.key].output_base64sha256

  environment {
    variables = {
      # NFR-3: AWS の認証情報は環境変数に置かない。実行ロール経由の認証情報チェーンを使う。
      ROLUST_STATE_TABLE_NAME          = aws_dynamodb_table.state.name
      ROLUST_CHANGE_REQUEST_TABLE_NAME = aws_dynamodb_table.change_requests.name
      # ユーザプールはデプロイにつき 1 つに固定する（Issue #108）。DynamoDB のキー POOL#<pool_id> に使う。
      ROLUST_POOL_ID = var.pool_id
      # 上の IAM ポリシーの `aws:ResourceTag/<key> = <value>` 条件と対になる値。
      # アプリ側の登録時検証（`iam:ListRoleTags` の結果との突き合わせ）で使う。
      # ハードコードせず環境変数で渡す（NFR-3）。
      ROLUST_MANAGED_TAG_KEY   = var.managed_tag_key
      ROLUST_MANAGED_TAG_VALUE = var.managed_tag_value
      # クロスアカウント（Issue #85）: 別アカウントで引き受けるロールの名前。上の `assume_target_*` ポリシーの Resource と対になる。
      ROLUST_TARGET_READER_ROLE_NAME  = var.target_reader_role_name
      ROLUST_TARGET_MANAGER_ROLE_NAME = var.target_manager_role_name
      # 権限の判定（Issue #141）。basic は全権限、cognito は ID トークンのグループで決める。未設定だと API は 500 で止まる。
      ROLUST_AUTH_MODE = var.auth_mode
      # ユーザの登録を許可するアカウント ID の SSM パラメータ名（Issue #139）。読むのは CRUD だけ（上の `crud_ssm_allowed_accounts`）。
      ROLUST_ALLOWED_ACCOUNT_IDS_PARAMETER = aws_ssm_parameter.allowed_account_ids.name
      # Rolust 自身の実行ロール（Issue #194）。下の `apply_iam_write` の `Sid: DenySelfEscalation` の
      # `Resource` と同じ `local` を参照するので、ポリシーとアプリの判定が食い違わない。
      # ロールの登録（`POST /roles`）が、これらのロールを登録時に拒否する（反映まで進んでから
      # AccessDenied になるのを避ける）。読むのは CRUD だけだが、3 系統で同じ環境を渡す。
      ROLUST_SELF_ROLE_ARNS = join(",", local.self_role_arns)
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}
