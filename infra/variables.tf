variable "project_name" {
  description = "リソース名の接頭辞。CloudWatch Logs の IAM ポリシー（3.6）が `<project_name>-*` で絞り込むため、変更する場合は全リソースで揃える。"
  type        = string
  default     = "rolust"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,30}$", var.project_name))
    error_message = "project_name は英小文字で始まる 2〜31 文字の英小文字・数字・ハイフンにしてください。"
  }
}

variable "region" {
  description = "DynamoDB / API Gateway / Lambda（CRUD・Diff・Apply）を置くリージョン。"
  type        = string
  default     = "ap-northeast-1"
}

variable "pool_id" {
  type        = string
  description = "この環境が管理するユーザプールの識別子（Issue #108）。DynamoDB のキー（POOL#<pool_id>）に使い、Lambda には環境変数 ROLUST_POOL_ID として渡る。既存の環境では、すでにあるユーザプールの識別子と同じ値にする（変えるとデータが見えなくなる）。"

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]{1,64}$", var.pool_id))
    error_message = "pool_id は英数字と . _ - のみ、1〜64 文字にしてください。"
  }
}

variable "state_table_name" {
  description = "DynamoDB の状態テーブル（UserPool・IamUser・Assignment・PoolRoleLink・IamRole・RoleLinkOwner）の名前。Lambda には環境変数 ROLUST_STATE_TABLE_NAME として渡る。"
  type        = string
  default     = "rolust-state"
}

variable "change_request_table_name" {
  description = "DynamoDB の申請テーブル（ChangeRequest・RoleLock）の名前。Lambda には環境変数 ROLUST_CHANGE_REQUEST_TABLE_NAME として渡る。"
  type        = string
  default     = "rolust-change-requests"
}

variable "basic_auth_parameter_name" {
  description = <<-EOT
    Basic 認証の資格情報を置く SSM パラメータ名（SecureString）。

    **既定値から変更する場合は `packages/edge-auth/src/index.ts` の
    `CREDENTIALS_PARAMETER_NAME` も同じ値に書き換えて再ビルドすること。**
    Lambda@Edge は環境変数を持てないため、パラメータ名はコード側の定数である。
  EOT
  type        = string
  default     = "/rolust/basic-auth"
}

variable "ip_allowlist_parameter_name" {
  description = <<-EOT
    IP アドレス制限の許可リストを置く SSM パラメータ名（String）。
    値は IPv4 アドレスまたは CIDR のカンマ区切り。初期値は全許可の `0.0.0.0/0`。

    **既定値から変更する場合は `packages/edge-auth/src/index.ts` の
    `IP_ALLOWLIST_PARAMETER_NAME` も同じ値に書き換えて再ビルドすること。**
    Lambda@Edge は環境変数を持てないため、パラメータ名はコード側の定数である。
  EOT
  type        = string
  default     = "/rolust/ip-allowlist"
}

variable "allowed_account_ids_parameter_name" {
  description = <<-EOT
    ユーザプールに登録できる IAM ユーザの AWS アカウント ID の許可リストを置く SSM パラメータ名（String。デプロイ先リージョン）。
    値は 12 桁のアカウント ID のカンマ区切り。初期値はデプロイ先のアカウント ID だけ（Issue #139）。

    読めない・空・不正なときは、ユーザの登録を拒否する（fail closed）。値は Terraform の管理外で、
    `put-parameter` で足す（出力 `set_allowed_account_ids_command`）。
  EOT
  type        = string
  default     = "/rolust/allowed-account-ids"

  validation {
    condition     = can(regex("^/[A-Za-z0-9_./-]+$", var.allowed_account_ids_parameter_name))
    error_message = "allowed_account_ids_parameter_name は、/ で始まる SSM パラメータ名（英数字と _ . - /）にしてください。"
  }
}

variable "auth_mode" {
  description = <<-EOT
    管理画面と API の認証方式。導入時に選ぶ。

    - `basic`（既定）: 単一の資格情報の Basic 認証。資格情報は SSM の SecureString に手で投入する。
    - `cognito`: Amazon Cognito のユーザープール（Lite・classic hosted UI）。複数の管理者が、それぞれの資格情報で
      Hosted UI からサインインする。ユーザの追加は `aws cognito-idp admin-create-user`（docs/guide/access-control.md）。

    切り替えると、apply の間と、Lambda@Edge のキャッシュ（最大 5 分）が切れるまで、どのアクセスも 503 になりうる。
    `cognito` から `basic` に戻すと、Cognito のユーザープールとそのユーザは破棄される。
  EOT
  type        = string
  default     = "basic"

  validation {
    condition     = contains(["basic", "cognito"], var.auth_mode)
    error_message = "auth_mode は \"basic\" か \"cognito\" にしてください。"
  }
}

variable "auth_mode_parameter_name" {
  description = <<-EOT
    認証方式を置く SSM パラメータ名（String。値は `basic` または `cognito`）。

    **既定値から変更する場合は `packages/edge-auth/src/index.ts` の
    `AUTH_MODE_PARAMETER_NAME` も同じ値に書き換えて再ビルドすること。**
    Lambda@Edge は環境変数を持てないため、パラメータ名はコード側の定数である。
  EOT
  type        = string
  default     = "/rolust/auth-mode"
}

variable "auth_cognito_parameter_name" {
  description = <<-EOT
    Cognito（OIDC）の接続情報を置く SSM パラメータ名（String。JSON）。`auth_mode = "cognito"` のときだけ作る。

    **既定値から変更する場合は `packages/edge-auth/src/index.ts` の
    `AUTH_OIDC_PARAMETER_NAME` も同じ値に書き換えて再ビルドすること。**
  EOT
  type        = string
  default     = "/rolust/auth-cognito"
}

variable "managed_tag_key" {
  description = <<-EOT
    Rolust が信頼ポリシーを読み書きしてよい IAM ロールを示す**タグのキー**。

    Diff / Apply Lambda の IAM ポリシーは `role/*` を Resource に取り、
    `aws:ResourceTag/<このキー>` が `managed_tag_value` に等しいことを条件に絞り込む。
    同じ値が Lambda の環境変数 ROLUST_MANAGED_TAG_KEY として渡り、ロール登録 API の入力検証にも使われる。登録時に弾かないと、反映まで進んだ末に
    AccessDenied として初めて現れるためである。

    **接頭辞方式からの移行で失われた層がある。** 以前の既定値 `RolustManaged-` は
    大文字始まりで、`project_name` が `^[a-z]` に制約されるため Rolust 自身の実行ロールと
    **原理的に**前方一致しなかった。タグはどのロールにも付きうるため、この層は無い。
    残る防御は `DenySelfEscalation`（`lambda.tf`）の明示 Deny のみである。

    **タグを付けるのは運用者である。** Rolust は `iam:TagRole` を持たない。管理対象の
    増減は Terraform の外で起き、`terraform plan` にも `plan-guard` にも現れない。
    統制点は `iam:TagRole` の保持者に移る。
  EOT
  type        = string
  default     = "rolust:managed"

  validation {
    # IAM タグキーは 1〜128 文字。使える文字は英数字と _ . : / = + - @ と空白。
    condition     = can(regex("^[A-Za-z0-9_.:/=+@ -]{1,128}$", var.managed_tag_key))
    error_message = "managed_tag_key は、IAM タグキーに使える文字（英数字と _ . : / = + - @ と空白）1〜128 文字にしてください。"
  }
}

variable "managed_tag_value" {
  description = <<-EOT
    `managed_tag_key` が取るべき**値**。この値に完全一致（StringEquals）するロールだけが
    Rolust の管理対象になる。

    空文字は許さない。空文字を許すと「タグは付いているが値が空」のロールが
    管理対象に入り、意図が読めない状態になるためである。
  EOT
  type        = string
  default     = "true"

  validation {
    # IAM タグ値は 0〜256 文字だが、Rolust では空を許さない（上記の理由）。
    condition     = length(var.managed_tag_value) >= 1 && length(var.managed_tag_value) <= 256
    error_message = "managed_tag_value は 1〜256 文字にしてください（空文字は許可されません）。"
  }
}

variable "target_reader_role_name" {
  description = <<-EOT
    クロスアカウントで、別アカウントの IAM ロールの信頼ポリシーを**読む**ために、CRUD・Diff の Lambda が
    引き受けるロールの名前。ターゲットアカウント側に、CloudFormation テンプレート
    （cloudformation/target-roles.yaml）で作る（docs/guide/cross-account.md。Terraform では作らない。
    Issue #92 により 2026-10-13 訂正。訂正前は手動で作るとしていた）。

    IAM ポリシーの Resource は `arn:aws:iam::*:role/<この名前>` になる。アカウントは絞らない: 開けるかどうかは、
    ターゲット側でこのロールを作り、信頼ポリシーで Rolust の実行ロールを名指しした管理者が決める。
    同じ値が Lambda の環境変数 ROLUST_TARGET_READER_ROLE_NAME として渡る。

    ワイルドカードとパスは許さない（任意のロールを引き受けられる範囲になるため。plan-guard の R-12 も見る）。
  EOT
  type        = string
  default     = "RolustTrustPolicyReader"

  validation {
    # IAM ロール名は 1〜64 文字。使える文字は英数字と + = , . @ _ -（* と / は含まない）。
    condition     = can(regex("^[A-Za-z0-9+=,.@_-]{1,64}$", var.target_reader_role_name))
    error_message = "target_reader_role_name は、IAM ロール名に使える文字（英数字と + = , . @ _ -）1〜64 文字にしてください。ワイルドカード（*）とパス（/）は使えません。"
  }
}

variable "target_manager_role_name" {
  description = <<-EOT
    クロスアカウントで、別アカウントの IAM ロールの信頼ポリシーを**更新する**ために、Apply の Lambda だけが
    引き受けるロールの名前。ターゲットアカウント側に、CloudFormation テンプレートで作る（docs/guide/cross-account.md。
    Issue #92 により 2026-10-13 訂正。訂正前は手動で作るとしていた）。

    `target_reader_role_name` と同じ名前にしてはならない。同じだと、CRUD・Diff の Lambda が更新用のロールを
    引き受けられる形になり、CRUD が AWS へ書き込めないという保証が外れる。
    同じ値が Lambda の環境変数 ROLUST_TARGET_MANAGER_ROLE_NAME として渡る。
  EOT
  type        = string
  default     = "RolustTrustPolicyManager"

  validation {
    condition     = can(regex("^[A-Za-z0-9+=,.@_-]{1,64}$", var.target_manager_role_name))
    error_message = "target_manager_role_name は、IAM ロール名に使える文字（英数字と + = , . @ _ -）1〜64 文字にしてください。ワイルドカード（*）とパス（/）は使えません。"
  }

  validation {
    condition     = var.target_manager_role_name != var.target_reader_role_name
    error_message = "target_manager_role_name は target_reader_role_name と別の名前にしてください。同じ名前だと、CRUD・Diff が更新用のロールを引き受けられます。CRUD は AWS へ書き込めないという保証が外れます。"
  }
}

variable "cloudfront_price_class" {
  description = "CloudFront のエッジロケーション範囲。poc では最小の PriceClass_100 で足りる。"
  type        = string
  default     = "PriceClass_100"
}

variable "log_retention_days" {
  description = "CloudWatch Logs の保持日数。"
  type        = number
  default     = 14
}
