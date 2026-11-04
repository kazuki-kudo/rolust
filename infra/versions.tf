terraform {
  # 1.10 以上。`backend.tf` の S3 バックエンドが **S3 ネイティブロック**
  # （`use_lockfile`）を使うためである。この機能は Terraform 1.10 で追加された。
  # 1.9 では DynamoDB ロックテーブルが別途必要になり、`backend.hcl` の
  # `use_lockfile = true` は `Unsupported argument` で `terraform init` が失敗する。
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.7"
    }
  }
}

# 主リージョン。DynamoDB / API Gateway / CRUD・Diff・Apply Lambda を置く。
provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}

# us-east-1 固定のリソース用。
#
# - **Lambda@Edge**（FR-6.1 の Basic 認証）は us-east-1 にしか作成できない。
#   実行ロールも同じ理由で us-east-1 側の文脈で扱う（IAM 自体はグローバル）。
# - **SSM パラメータ**も us-east-1 に置く。Lambda@Edge は環境変数を持てないため
#   `packages/edge-auth/src/index.ts` がリージョンを `us-east-1` の定数として持っており、
#   そこから読める場所に無ければならない。
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}
