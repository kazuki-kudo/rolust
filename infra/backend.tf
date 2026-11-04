/**
 * Terraform state のバックエンド（partial config）。
 *
 * 実値は `backend.hcl` から与える。
 *
 *   terraform init -backend-config=backend.hcl
 *
 * ここに literal で書かない理由は、バケット名にアカウント ID が含まれるためである。
 * 第三者が自分のアカウントでセットアップする（NFR-4 / SM-2）ときにバケット名が変わる。
 *
 * `backend.hcl` は `.gitignore` に入れてある。雛形は `backend.hcl.example`。
 * state バケットを持たない環境では `infra/bootstrap/` を apply して
 *
 *   terraform -chdir=infra/bootstrap output -raw backend_config_hcl > infra/backend.hcl
 *
 * で生成する。
 *
 * **ロックは S3 ネイティブ**（`backend.hcl` の `use_lockfile = true`）であり、
 * DynamoDB ロックテーブルを使わない。Terraform 1.10 以降の機能であるため
 * `versions.tf` の `required_version` は `>= 1.10.0` である。
 *
 * ロックが必要なのは、`docs/guide/` の手動 `terraform plan` / `apply`（複数の人・端末から
 * 走りうる）が同じ state のロックを取るためである。
 * 反映は手動経路だけで、CD は持たない（`docs/design/cd-config.md` D-7・D-8。
 * Issue #55 により 2026-09-27 訂正: 手動 apply と CD の二重の反映経路という前提を改めた。
 * 当初の設計は旧リポジトリの `aidlc/.../construction/infrastructure-design/deployment-architecture.md`
 * § Terraform state のバックエンド にある）。
 */
terraform {
  backend "s3" {}
}
