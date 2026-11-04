/**
 * DynamoDB の状態テーブルと申請テーブル（`packages/api/TABLE-DESIGN.md`。Issue #36 で 1 本から 2 本に分けた）。
 *
 * | テーブル | エンティティ | pk | sk |
 * |---|---|---|---|
 * | 状態 | UserPool      | POOL#<poolId>      | META |
 * | 状態 | IamUser       | POOL#<poolId>      | USER#<userArn> |
 * | 状態 | Assignment    | POOL#<poolId>      | ASSIGN#<userArn>#<roleArn> |
 * | 状態 | PoolRoleLink  | POOL#<poolId>      | ROLE#<roleArn> |
 * | 状態 | IamRole       | ROLE               | ROLE#<roleArn> |
 * | 状態 | RoleLinkOwner | ROLELINK#<roleArn> | OWNER |
 * | 申請 | ChangeRequest | CR                 | CR#<changeRequestId> |
 * | 申請 | RoleLock      | ROLELOCK#<roleArn> | UNREFLECTED |
 *
 * GSI 名 `gsi1` は `packages/api/src/ddb/keys.ts` の `GSI1_NAME` と一致していなければならない。
 */
resource "aws_dynamodb_table" "state" {
  name         = var.state_table_name
  billing_mode = "PAY_PER_REQUEST"

  # AWS provider 6.57 は将来 `key_schema` へ寄せる予告として table 直下の
  # `hash_key` / `range_key` を deprecated と報告するが、table レベルの
  # `key_schema` ブロックはまだ実装されていない（GSI 側にのみ存在する）。
  # 実装され次第こちらも移行する。現状は `terraform validate` の警告のみで、
  # 動作・互換性に影響はない。
  hash_key  = "pk"
  range_key = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  attribute {
    name = "gsi1pk"
    type = "S"
  }

  attribute {
    name = "gsi1sk"
    type = "S"
  }

  # gsi1pk を持つアイテムだけが載る疎なインデックス。用途: UserPool 一覧（gsi1pk = POOLS）。
  global_secondary_index {
    name            = "gsi1"
    projection_type = "ALL"

    key_schema {
      attribute_name = "gsi1pk"
      key_type       = "HASH"
    }

    key_schema {
      attribute_name = "gsi1sk"
      key_type       = "RANGE"
    }
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

# 申請テーブル。GSI は持たない（ロール別の申請履歴 = アクセスパターン 10 は欠番）。
# RoleLock を ChangeRequest と同じテーブルに置くのは、「未反映の申請があればロックもある」（FR-4.6）を
# 1 テーブルに閉じ、テーブル単位で作り直しても破れないようにするため。
resource "aws_dynamodb_table" "change_requests" {
  name         = var.change_request_table_name
  billing_mode = "PAY_PER_REQUEST"

  # hash_key / range_key の deprecated 警告は上の state テーブルと同じ。
  hash_key  = "pk"
  range_key = "sk"

  attribute {
    name = "pk"
    type = "S"
  }

  attribute {
    name = "sk"
    type = "S"
  }

  point_in_time_recovery {
    enabled = true
  }

  server_side_encryption {
    enabled = true
  }
}

# 旧い単一テーブル `rolust` を、消さずに Terraform の管理から外す（Issue #36。spec D-7・D-12）。
# 状態のアイテムを写し、件数を突き合わせてから運用者が CLI で消す（docs/design/one-time-migrations.md「状態テーブルと申請テーブルへの分割」）。
# 旧テーブルを消した後も残す。state に旧テーブルが残る別のデプロイでも、apply が destroy せずに外すだけにするため。
removed {
  from = aws_dynamodb_table.rolust

  lifecycle {
    destroy = false
  }
}
