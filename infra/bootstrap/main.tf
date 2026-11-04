data "aws_caller_identity" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id

  bucket_name = (
    var.state_bucket_name != ""
    ? var.state_bucket_name
    : "${var.project_name}-tfstate-${local.account_id}"
  )

  # 本体 `infra/` の state 鍵。共有バケットでも衝突しないよう
  # プロジェクト単位のプレフィックスを第 1 階層に置く。
  state_key = "${var.project_name}/infra/terraform.tfstate"
}

/**
 * state バケット。
 *
 * `force_destroy` を **false** にする（SPA の web バケットは true）。
 * state の誤削除は復旧不能に近く、`terraform destroy` の巻き添えで
 * 全リソースの管理情報を失うことを防ぐ。
 */
resource "aws_s3_bucket" "state" {
  bucket        = local.bucket_name
  force_destroy = false
}

# state を壊したときに前バージョンへ戻せる唯一の手段。
resource "aws_s3_bucket_versioning" "state" {
  bucket = aws_s3_bucket.state.id

  versioning_configuration {
    status = "Enabled"
  }
}

/**
 * SSE-KMS。
 *
 * `terraform plan` / `refresh` は `aws_ssm_parameter.basic_auth`（SecureString）を
 * refresh する際に**復号値を state に書き込む**（`docs/guide/limitations.md` の「Terraform の state に機微情報が入る」）。
 * したがって state バケットは機密を保持するバケットとして扱う。
 *
 * `kms_master_key_id` を省略すると AWS 管理キー `alias/aws/s3` が使われる。
 */
resource "aws_s3_bucket_server_side_encryption_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = var.kms_key_arn != "" ? var.kms_key_arn : null
    }

    # SSE-KMS の KMS リクエスト料を削減する。
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_public_access_block" "state" {
  bucket = aws_s3_bucket.state.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "state" {
  bucket = aws_s3_bucket.state.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

/**
 * 非現行バージョンの失効。
 *
 * apply のたびにバージョンが増えるため、履歴を残しつつ無制限の蓄積を避ける。
 * S3 ネイティブロックのロックオブジェクト（`<key>.tflock`）は apply の完了時に
 * 削除されるが、バージョニング下では削除マーカーが残る。それも同じ規則で失効させる。
 */
resource "aws_s3_bucket_lifecycle_configuration" "state" {
  bucket = aws_s3_bucket.state.id

  # バージョニングが有効になってからでないとルールが意味を持たない。
  depends_on = [aws_s3_bucket_versioning.state]

  rule {
    id     = "expire-noncurrent-state-versions"
    status = "Enabled"

    # 空の filter はバケット内の全オブジェクトに適用する意味になる。
    filter {}

    noncurrent_version_expiration {
      noncurrent_days = var.noncurrent_version_expiration_days
    }

    abort_incomplete_multipart_upload {
      days_after_initiation = 7
    }
  }
}

/**
 * HTTPS 以外のアクセスを拒否する。
 *
 * state には SecureString の復号値が入りうるため、平文経路を塞ぐ。
 */
resource "aws_s3_bucket_policy" "state" {
  bucket = aws_s3_bucket.state.id

  # public access block と同時に適用するとポリシー評価が競合しうるため順序を固定する。
  depends_on = [aws_s3_bucket_public_access_block.state]

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource = [
        aws_s3_bucket.state.arn,
        "${aws_s3_bucket.state.arn}/*",
      ]
      Condition = {
        Bool = {
          "aws:SecureTransport" = "false"
        }
      }
    }]
  })
}
