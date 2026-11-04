#!/usr/bin/env bash
#
# CI（.github/workflows/ci.yml）と同じ検査を、手元で走らせる（Issue #199）。
#
# なぜ要るか: この CI は全ジョブが AWS の資格情報を持たない（公開リポジトリは CD を
# 持たない。docs/design/cd-config.md D-8）。したがって原理的に全ジョブを手元で再現できる。
# GitHub の利用上限で Actions が走らないときは、これが唯一の判定経路になる。
# 上限に関係なく、push の前に赤を潰す用途にも使う。
#
# 使い方:
#   ./.github/scripts/ci-local.sh                    # 全ジョブ
#   ./.github/scripts/ci-local.sh secrets iac-scan   # 指定したジョブだけ
#   ./.github/scripts/ci-local.sh --list             # ジョブの一覧
#
# 終了コード: 0 失敗なし / 1 失敗あり / 2 前提不足（版の不一致・ツールの不在など）
#
# 設計の決めごと:
#   - **固定版は ci.yml の env から読む。** スクリプトに書き写すと、CI と手元で別の版が
#     走る。手元のツールの版が違えば、黙って走らせずに FAIL にする。
#   - **npm ci は走らせない。** 既存の node_modules を消すうえ、手元の npm 9.6.2 は
#     依存の版を上げた直後に落ちることがある（.claude/rules/shell-and-aws-cli.md）。
#   - **terraform の検査は infra/ の複製に対して行う。** 直接走らせると
#     `init -backend=false` が手元の .terraform の backend 設定を壊す（実測）。
#     複製からは、CI の checkout に無いもの（backend.hcl・terraform.tfvars・.terraform）を
#     取り除く。CI と同じ入力にするためである。
#   - **埋まらない範囲は SKIP として出す。** 手元の Node が CI の版と違うときの検査を、
#     黙って飛ばして「全緑」に見せない。
#
# 未対応（CI にしか無いもの）:
#   - Node の matrix のうち、手元の Node と一致しない版（SKIP として報告する）
#   - ジョブサマリへの出力（カバレッジ・Trivy の全重大度の一覧）。合否ゲートではない

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
WORKFLOW="$ROOT/.github/workflows/ci.yml"
CACHE="$ROOT/.ci-local"
BIN="$CACHE/bin"

cd "$ROOT" || exit 2

# --- ci.yml から固定版を読む -------------------------------------------------

# `  NAME: "value"` の形を読む。見つからなければ空を返す（呼び出し側が落とす）。
workflow_env() {
  sed -nE "s/^  $1: *\"?([^\"]+)\"?$/\1/p" "$WORKFLOW" | head -1
}

TERRAFORM_VERSION="$(workflow_env TERRAFORM_VERSION)"
CFN_LINT_VERSION="$(workflow_env CFN_LINT_VERSION)"
TRIVY_VERSION="$(workflow_env TRIVY_VERSION)"
TRIVY_SHA256="$(workflow_env TRIVY_SHA256)"
GITLEAKS_VERSION="$(workflow_env GITLEAKS_VERSION)"

for pair in "TERRAFORM_VERSION=$TERRAFORM_VERSION" "CFN_LINT_VERSION=$CFN_LINT_VERSION" \
  "TRIVY_VERSION=$TRIVY_VERSION" "GITLEAKS_VERSION=$GITLEAKS_VERSION"; do
  if [[ -z "${pair#*=}" ]]; then
    echo "ci.yml の env から ${pair%%=*} を読めなかった。書式が変わっていないか確かめること" >&2
    exit 2
  fi
done

# Node の matrix（`        node: ["24"]`）。
NODE_MATRIX="$(sed -nE 's/^ +node: \[(.*)\]$/\1/p' "$WORKFLOW" | head -1 | tr -d '" ' | tr ',' ' ')"
if [[ -z "$NODE_MATRIX" ]]; then
  echo "ci.yml から Node の matrix を読めなかった。書式が変わっていないか確かめること" >&2
  exit 2
fi

# --- 要約の記録 --------------------------------------------------------------

RESULTS=()
FAILED=0
SKIPPED=0

record() { RESULTS+=("$1|$2|${3:-}"); }
pass() {
  printf '\n>>> PASS: %s\n' "$1"
  record "$1" PASS "${2:-}"
}
fail() {
  printf '\n>>> FAIL: %s\n' "$1"
  record "$1" FAIL "${2:-}"
  FAILED=$((FAILED + 1))
}
skip() {
  printf '\n>>> SKIP: %s — %s\n' "$1" "$2"
  record "$1" SKIP "$2"
  SKIPPED=$((SKIPPED + 1))
}

# コマンド列を順に実行し、最初の失敗で止める。各コマンドは `bash -c` に渡す文字列。
run_steps() {
  local job="$1"
  shift
  local step
  for step in "$@"; do
    printf '\n--- [%s] %s\n' "$job" "$step"
    if ! bash -c "$step"; then
      fail "$job" "失敗した手順: $step"
      return 1
    fi
  done
  return 0
}

# ツールの版が ci.yml と一致するか。一致しなければ 1 を返す（呼び出し側が FAIL にする）。
require_version() {
  local label="$1" want="$2" got="$3"
  if [[ "$got" != "$want" ]]; then
    printf '[%s] 版が CI と違う: 手元 %s / CI %s\n' "$label" "${got:-不明}" "$want" >&2
    return 1
  fi
  return 0
}

# --- trivy の導入（版を固定し、SHA-256 を照合する）---------------------------
#
# ci.yml の TRIVY_SHA256 は **Linux の tarball** の値である。Windows の zip は別物なので
# 同じ値では照合できない。プラットフォームごとに、照合する相手を変える:
#   Linux   → ci.yml の TRIVY_SHA256（CI とまったく同じ経路）
#   Windows → Release の *_checksums.txt の該当行（取得元は同じ Release）
ensure_trivy() {
  local exe="$BIN/trivy"
  local os
  os="$(uname -s)"
  [[ "$os" == MINGW* || "$os" == MSYS* || "$os" == CYGWIN* ]] && exe="$BIN/trivy.exe"

  # `--skip-version-check` は走査（trivy config）のフラグで、`--version` には無い
  # （付けると `unknown flag` で落ちる）。版の確認では付けない。
  if [[ -x "$exe" ]] && "$exe" --version 2>/dev/null | grep -qF "Version: $TRIVY_VERSION"; then
    TRIVY_BIN="$exe"
    return 0
  fi

  mkdir -p "$BIN" || return 1
  local base="https://github.com/aquasecurity/trivy/releases/download/v$TRIVY_VERSION"
  local tmp
  tmp="$(mktemp -d)" || return 1

  if [[ "$exe" == *.exe ]]; then
    local zip="$tmp/trivy.zip"
    curl -sSfL -o "$zip" "$base/trivy_${TRIVY_VERSION}_windows-64bit.zip" || return 1
    curl -sSfL -o "$tmp/checksums.txt" "$base/trivy_${TRIVY_VERSION}_checksums.txt" || return 1
    local want got
    want="$(grep -F "trivy_${TRIVY_VERSION}_windows-64bit.zip" "$tmp/checksums.txt" | awk '{print $1}')"
    got="$(sha256sum "$zip" | awk '{print $1}')"
    if [[ -z "$want" || "$want" != "$got" ]]; then
      echo "trivy の zip の SHA-256 が Release の checksums と一致しない" >&2
      return 1
    fi
    # Git Bash の tar は zip を展開できない（.claude/rules/shell-and-aws-cli.md）。
    powershell -NoProfile -Command \
      "Expand-Archive -Path '$(cygpath -w "$zip")' -DestinationPath '$(cygpath -w "$tmp/out")' -Force" || return 1
    cp "$tmp/out/trivy.exe" "$exe" || return 1
  else
    local tgz="$tmp/trivy.tar.gz"
    curl -sSfL -o "$tgz" "$base/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" || return 1
    echo "$TRIVY_SHA256  $tgz" | sha256sum -c - >/dev/null || return 1
    tar -xzf "$tgz" -C "$tmp" trivy || return 1
    cp "$tmp/trivy" "$exe" || return 1
    chmod +x "$exe" || return 1
  fi

  rm -rf "$tmp"
  TRIVY_BIN="$exe"
  "$TRIVY_BIN" --version | head -1
}

# --- ジョブ ------------------------------------------------------------------

# ci-job: node
job_node() {
  local job="node"
  local current major covered=() uncovered=() v
  current="$(node -v 2>/dev/null | sed 's/^v//')"
  major="${current%%.*}"
  for v in $NODE_MATRIX; do
    if [[ "$major" == "$v" ]]; then covered+=("$v"); else uncovered+=("$v"); fi
  done

  if [[ ${#covered[@]} -eq 0 ]]; then
    skip "$job" "手元の Node は $current で、CI の matrix（${NODE_MATRIX// /, }）に無い"
    return
  fi

  # npm ci は走らせない（冒頭の決めごと）。CI と違い、既存の node_modules を使う。
  run_steps "$job" \
    "npm run lint" \
    "npm run typecheck" \
    "npm run test:coverage" \
    "npm run build" || return

  local note="Node $current で実行（npm ci は走らせない）"
  if [[ ${#uncovered[@]} -gt 0 ]]; then
    note="$note。未実施の版: ${uncovered[*]}"
  fi
  pass "$job" "$note"
}

# ci-job: terraform
job_terraform() {
  local job="terraform"
  if ! require_version terraform "$TERRAFORM_VERSION" "$(terraform version 2>/dev/null | sed -nE 's/^Terraform v([0-9.]+).*/\1/p' | head -1)"; then
    fail "$job" "terraform の版が CI（$TERRAFORM_VERSION）と違う"
    return
  fi

  # 手元の .terraform（S3 バックエンドの設定）を壊さないよう、複製に対して実行する。
  local work="$CACHE/infra"
  rm -rf "$work" || true
  mkdir -p "$CACHE" || { fail "$job" "作業領域を作れない"; return; }
  cp -r "$ROOT/infra" "$work" || { fail "$job" "infra/ を複製できない"; return; }
  # CI の checkout に無いもの（gitignore 済み）を取り除く。CI と同じ入力にするため。
  rm -rf "$work/.terraform" "$work/.terraform.tfstate.lock.info"
  rm -f "$work/backend.hcl" "$work/terraform.tfvars" "$work/tfplan" "$work/tfplan.json" \
    "$work"/*.tfstate "$work"/*.tfstate.backup "$work/backend_override.tf"

  run_steps "$job" \
    "cd '$work' && terraform fmt -check -recursive -diff" \
    "cd '$work' && terraform init -backend=false -input=false >/dev/null" \
    "cd '$work' && terraform validate" \
    "cd '$work' && printf 'terraform {\n  backend \"local\" {}\n}\n' > backend_override.tf && terraform init -input=false -reconfigure >/dev/null && for mode in basic cognito; do echo \"--- auth_mode=\$mode ---\"; TF_VAR_auth_mode=\"\$mode\" terraform graph >/dev/null || exit 1; done; rm -f backend_override.tf" \
    "cd '$work/bootstrap' && terraform init -backend=false -input=false >/dev/null" \
    "cd '$work/bootstrap' && terraform validate" || return

  pass "$job" "infra/ の複製に対して実行（手元の .terraform は触らない）"
}

# ci-job: plan-guard
job_plan_guard() {
  local job="plan-guard"
  if ! command -v jq >/dev/null 2>&1; then
    fail "$job" "jq が無い"
    return
  fi
  run_steps "$job" "jq --version" "./.github/scripts/plan-guard.test.sh" || return
  pass "$job"
}

# ci-job: release-artifacts
job_release_artifacts() {
  local job="release-artifacts"
  if ! require_version cfn-lint "$CFN_LINT_VERSION" "$(cfn-lint --version 2>/dev/null | sed -nE 's/^cfn-lint ([0-9.]+).*/\1/p' | head -1)"; then
    fail "$job" "cfn-lint の版が CI（$CFN_LINT_VERSION）と違う。pip install \"cfn-lint==$CFN_LINT_VERSION\""
    return
  fi
  run_steps "$job" \
    "cfn-lint cloudformation/target-roles.yaml" \
    "./cloudformation/target-roles.test.sh" \
    "./.github/scripts/release.test.sh" \
    "./.github/scripts/guide-parity.test.sh" \
    "./.github/scripts/guide-parity.sh" || return
  pass "$job"
}

# ci-job: iac-scan
job_iac_scan() {
  local job="iac-scan"
  TRIVY_BIN=""
  if ! ensure_trivy; then
    fail "$job" "trivy $TRIVY_VERSION を用意できない（取得か SHA-256 の照合に失敗）"
    return
  fi
  # trivy config は対象を 1 つしか取れないので 2 回に分ける（Issue #92）。
  # --ignorefile を明示する（.trivyignore.yaml は明示しないと黙って無視される）。
  run_steps "$job" \
    "'$TRIVY_BIN' config infra --ignorefile .trivyignore.yaml --severity CRITICAL,HIGH --exit-code 1 --skip-version-check" \
    "'$TRIVY_BIN' config cloudformation --ignorefile .trivyignore.yaml --severity CRITICAL,HIGH --exit-code 1 --skip-version-check" || return
  pass "$job" "trivy $TRIVY_VERSION（$BIN に取得・SHA-256 照合済み）"
}

# ci-job: secrets
job_secrets() {
  local job="secrets"
  local gitleaks="${GITLEAKS_BIN:-gitleaks}"
  if ! require_version gitleaks "$GITLEAKS_VERSION" "$("$gitleaks" version 2>/dev/null | tr -d '\r' | head -1)"; then
    fail "$job" "gitleaks の版が CI（$GITLEAKS_VERSION）と違う。GITLEAKS_BIN で実行ファイルを指せる"
    return
  fi
  run_steps "$job" \
    "'$gitleaks' git . --no-banner --redact --exit-code 1" \
    "./.github/scripts/protected-values-guard.test.sh" \
    "./.github/scripts/protected-values-guard.sh" || return
  pass "$job"
}

# ci-job: deps
job_deps() {
  local job="deps"
  # 手元の npm 9.6.2 は high の勧告があっても exit 0 を返す。CI は npm 11 で走るので、
  # npx で版を揃える（.claude/rules/shell-and-aws-cli.md。Issue #194）。
  run_steps "$job" "npx -y npm@11 audit --audit-level=high" || return
  pass "$job" "npx npm@11 で実行（手元の npm は high でも exit 0 を返す）"
}

ALL_JOBS=(node terraform plan-guard release-artifacts iac-scan secrets deps)

# --- 入口 --------------------------------------------------------------------

if [[ "${1:-}" == "--list" ]]; then
  printf '%s\n' "${ALL_JOBS[@]}"
  exit 0
fi

TARGETS=("${ALL_JOBS[@]}")
if [[ $# -gt 0 ]]; then
  TARGETS=()
  for name in "$@"; do
    found=0
    for known in "${ALL_JOBS[@]}"; do
      [[ "$name" == "$known" ]] && found=1
    done
    if [[ $found -eq 0 ]]; then
      echo "知らないジョブ: $name（--list で一覧）" >&2
      exit 2
    fi
    TARGETS+=("$name")
  done
fi

printf 'CI と同じ検査を手元で走らせる（ci.yml の %d ジョブ中 %d 件）\n' "${#ALL_JOBS[@]}" "${#TARGETS[@]}"
printf '固定版: terraform %s / cfn-lint %s / trivy %s / gitleaks %s\n' \
  "$TERRAFORM_VERSION" "$CFN_LINT_VERSION" "$TRIVY_VERSION" "$GITLEAKS_VERSION"

for name in "${TARGETS[@]}"; do
  case "$name" in
    node) job_node ;;
    terraform) job_terraform ;;
    plan-guard) job_plan_guard ;;
    release-artifacts) job_release_artifacts ;;
    iac-scan) job_iac_scan ;;
    secrets) job_secrets ;;
    deps) job_deps ;;
  esac
done

# --- 要約 --------------------------------------------------------------------

echo
echo "================ 要約 ================"
for row in "${RESULTS[@]}"; do
  IFS='|' read -r name status note <<<"$row"
  printf '%-6s %-20s %s\n' "$status" "$name" "$note"
done
echo "======================================"
printf '失敗 %d / SKIP %d / 実行 %d\n' "$FAILED" "$SKIPPED" "${#RESULTS[@]}"

if [[ $SKIPPED -gt 0 ]]; then
  echo
  echo "!! SKIP が ${SKIPPED} 件ある。この実行は CI の全ジョブを覆っていない。"
  echo "!! 上の要約の SKIP 行の理由を読み、必要なら CI か別の環境で確かめること。"
fi

[[ $FAILED -eq 0 ]]
