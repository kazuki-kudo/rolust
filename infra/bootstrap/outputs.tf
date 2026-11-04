output "state_bucket_name" {
  description = "作成した state バケット。本体 `infra/` の backend 設定で指す。"
  value       = aws_s3_bucket.state.id
}

output "state_key" {
  description = "本体 `infra/` の state 鍵。共有バケットでも衝突しないようプロジェクト名を第 1 階層に置く。"
  value       = local.state_key
}

/**
 * 本体 `infra/` の `backend.hcl` の中身をそのまま出力する。
 *
 * 手で書き写す余地を残さないための出力である。`docs/guide/setup.md` の手順は
 *
 *   terraform -chdir=infra/bootstrap output -raw backend_config_hcl > infra/backend.hcl
 *
 * として機械的に生成する。
 */
output "backend_config_hcl" {
  description = "infra/backend.hcl の内容。`terraform init -backend-config=backend.hcl` に渡す。"
  value       = <<-EOT
    bucket       = "${aws_s3_bucket.state.id}"
    key          = "${local.state_key}"
    region       = "${var.region}"
    encrypt      = true
    use_lockfile = true
  EOT
}
