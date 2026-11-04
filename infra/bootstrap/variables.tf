variable "project_name" {
  description = "リソース名と state 鍵の接頭辞。本体 `infra/` の `project_name` と揃えること。"
  type        = string
  default     = "rolust"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.project_name))
    error_message = "project_name は英小文字で始まる 2〜31 文字の英小文字・数字・ハイフンにしてください。"
  }
}

variable "region" {
  description = "state バケットを置くリージョン。本体 `infra/` の `region` と揃えること。"
  type        = string
  default     = "ap-northeast-1"
}

variable "state_bucket_name" {
  description = <<-EOT
    state を格納する S3 バケット名。

    空文字なら `<project_name>-tfstate-<account_id>` を導出する。S3 の名前空間は
    グローバルであるため、導出名が他アカウントに取られている場合は明示的に指定する。

    **既にバケットを持っている環境ではこの構成自体を実行しないこと。** 本変数は
    「新しく作るバケットの名前」であって「既存バケットを指す」ものではない。
  EOT
  type        = string
  default     = ""
}

variable "kms_key_arn" {
  description = <<-EOT
    state の暗号化に使う KMS キーの ARN。

    空文字なら AWS 管理キー `alias/aws/s3` を使う（追加費用なし。同一アカウント内なら
    IAM ポリシーだけでアクセスが成立する）。CMK を使うと鍵ポリシーで principal を
    絞り込めるが、月額 $1 と鍵ポリシーの管理が増える。
  EOT
  type        = string
  default     = ""
}

variable "noncurrent_version_expiration_days" {
  description = <<-EOT
    非現行バージョンの state を保持する日数。

    バージョニングは state を壊したときに戻せる唯一の手段だが、apply のたびに
    バージョンが増えるため無制限に溜まる。履歴を残しつつ蓄積を抑える。
  EOT
  type        = number
  default     = 90

  validation {
    condition     = var.noncurrent_version_expiration_days >= 1
    error_message = "noncurrent_version_expiration_days は 1 以上にしてください。"
  }
}
