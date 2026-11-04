/**
 * Terraform state のバックエンドを用意するブートストラップ構成。
 *
 * **この構成は任意実行である。** state を置く S3 バケットを既に持っている環境
 * （`jump` アカウントの `jump-s3-terraform-state-<account>-<region>` など）では
 * 実行しない。実行すると使われない 2 つ目のバケットができる。
 *
 * 実行するのは「state バケットが無い環境」— 主に Rolust を自分のアカウントで
 * セットアップする第三者（NFR-4 / SM-2 の判定経路）である。
 *
 * **backend ブロックを持たない（ローカル state）。** これは意図であって漏れではない。
 * `terraform init` は backend ブロックを読んだ直後にバケットへアクセスするため、
 * バケットを作る構成自体がリモート state を使うことはできない（鶏卵構造）。
 * 再帰の終端をここに置く。作るものはバケット 1 つで滅多に変更されず、
 * ローカル state を失っても `terraform import` で取り込み直せる。
 *
 * 詳細は
 * 旧リポジトリの `aidlc/spaces/default/intents/260728-rolust-iam-trust/construction/infrastructure-design/deployment-architecture.md`
 * § Terraform state のバックエンド。
 */

terraform {
  # S3 ネイティブロック（`use_lockfile`）を本体の backend で使うため 1.10 以上。
  # 1.10 未満では DynamoDB ロックテーブルが別途必要になる。
  required_version = ">= 1.10.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = var.project_name
      ManagedBy = "terraform"
    }
  }
}
