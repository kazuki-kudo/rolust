#!/usr/bin/env bash
#
# Release の tarball を展開して検査する。通らなければ Release を作らない。
#
# 使い方: ./.github/scripts/check-release.sh <tarball>
#
# 設計: docs/superpowers/specs/2026-10-13-user-deploy-release-design.md 3.2
#
# 検査:
#   1. 必須のファイル（手順書 docs/guide を含む）があり、空でない（terraform validate は archive_file のファイルを
#      読まないので、dist が空でも通ってしまう。ここで存在とサイズを見る）
#   2. 環境固有の値・state・ソースが含まれない。Lambda のバンドルに第三者のコード（node_modules）が入っていない
#      （入ると、ライセンスの表示を載せる対象が増える。SPA の THIRD-PARTY-NOTICES.txt は SPA のビルドだけが作る。Issue #187）
#   3. plan-guard.sh・target-roles.yaml・LICENSE がリポジトリのものと同一で、plan-guard.sh に実行権限がある
#   4. スクリプトとテンプレートに CR（CRLF）が無い
#   5. 展開した infra/ と infra/bootstrap/ が terraform validate を通る
#   6. CHANGELOG.md があり、本番の版（タグに - を含まない）ではそのタグの節が空でない（Issue #240。
#      更新の手順書が「CHANGELOG を読む」ことを前提にするので、節が無い版は配らない。prerelease は
#      マージ前のブランチから実測のために打つので、節が無くてよい）
#
# 環境変数:
#   ROLUST_REPO_ROOT              突き合わせる元のリポジトリ（既定はスクリプトの 2 つ上）
#   CHECK_RELEASE_SKIP_TERRAFORM  1 なら terraform validate を飛ばす（回帰テスト用）
#
# 終了コード: 0 全件パス / 1 検査に失敗 / 2 前提不足

set -uo pipefail

TARBALL="${1:-}"
if [[ -z "$TARBALL" || ! -f "$TARBALL" ]]; then
  echo "usage: $0 <tarball>" >&2
  exit 2
fi
ROOT="${ROLUST_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
# --force-local: Windows 形式のパス（C:/...）を GNU tar が host:path（リモート）と解釈しないようにする。
tar --force-local -xzf "$TARBALL" -C "$WORK" || { echo "展開できない: $TARBALL" >&2; exit 1; }
DIR="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d -name 'rolust-v*' | head -1)"
if [[ -z "$DIR" ]]; then
  echo "rolust-v*/ が tarball に無い" >&2
  exit 1
fi

FAIL=0
ng() { echo "NG: $*" >&2; FAIL=1; }

# 1. 必須のファイル
REQUIRED=(
  infra/main.tf infra/.terraform.lock.hcl infra/terraform.tfvars.example infra/backend.hcl.example
  infra/bootstrap/main.tf
  .github/scripts/plan-guard.sh cloudformation/target-roles.yaml README.md README.ja.md LICENSE
  SECURITY.md CHANGELOG.md
  docs/guide/README.md docs/guide/setup.md
  docs/guide/en/setup.md docs/guide/en/access-control.md docs/guide/en/cross-account.md
  packages/api/dist/crud/index.js packages/api/dist/diff/index.js packages/api/dist/apply/index.js
  packages/edge-auth/dist/index.js packages/web/dist/index.html packages/web/dist/THIRD-PARTY-NOTICES.txt
)
for f in "${REQUIRED[@]}"; do
  [[ -s "$DIR/$f" ]] || ng "$f が無い、または空である"
done

# 2. 含まれてはならないもの
found="$(find "$DIR" \( -name 'terraform.tfvars' -o -name '*.tfvars' -o -name 'backend.hcl' \
  -o -name '*.tfstate' -o -name '*.tfstate.*' -o -name 'tfplan' -o -name 'tfplan.json' \
  -o -name '.env' -o -name '.terraform' -o -name '.build' -o -name 'node_modules' \) -print)"
[[ -z "$found" ]] || ng "含まれてはならないものがある: $(echo "$found" | sed "s|$DIR/||" | tr '\n' ' ')"
for s in "$DIR"/packages/*/src; do
  [[ -e "$s" ]] && ng "ソースが含まれている: ${s#"$DIR"/}"
done

# 第三者のライセンスの一覧（SPA のビルドが作る）に、パッケージが 1 件以上載っていること。
if [[ -s "$DIR/packages/web/dist/THIRD-PARTY-NOTICES.txt" ]]; then
  grep -q '^License: ' "$DIR/packages/web/dist/THIRD-PARTY-NOTICES.txt" \
    || ng "packages/web/dist/THIRD-PARTY-NOTICES.txt にパッケージが 1 件も載っていない"
fi

# Lambda のバンドルに第三者のコードが入っていないこと。esbuild は取り込んだモジュールごとに
# `// ../../node_modules/<パッケージ>/...` の行を残す。`@aws-sdk/*` は外部化していて、Lambda の
# ランタイムが提供するので、ここには出ない。出たら、そのコードのライセンスの表示を tarball に載せる
# 仕組みが要る（SPA の一覧は SPA のバンドルしか見ていない）。
for b in "$DIR"/packages/api/dist/*/index.js "$DIR"/packages/edge-auth/dist/index.js; do
  [[ -f "$b" ]] || continue
  if grep -q '^// [^ ]*node_modules/' "$b"; then
    ng "${b#"$DIR"/} に第三者のコード（node_modules）が入っている。ライセンスの表示を載せる仕組みが要る（Issue #187）"
  fi
done

# 3. リポジトリと同一であること、実行権限
for f in .github/scripts/plan-guard.sh cloudformation/target-roles.yaml LICENSE; do
  if [[ -f "$DIR/$f" && -f "$ROOT/$f" ]]; then
    cmp -s "$DIR/$f" "$ROOT/$f" || ng "$f がリポジトリのものと違う"
  fi
done
[[ -x "$DIR/.github/scripts/plan-guard.sh" ]] || ng "plan-guard.sh に実行権限が無い"

# 4. CR の混入
for f in .github/scripts/plan-guard.sh cloudformation/target-roles.yaml; do
  if [[ -f "$DIR/$f" ]]; then
    n="$(tr -cd '\r' < "$DIR/$f" | wc -c)"
    [[ "$n" -eq 0 ]] || ng "$f に CR（CRLF）がある"
  fi
done

# 5. terraform validate
if [[ "${CHECK_RELEASE_SKIP_TERRAFORM:-}" != "1" ]]; then
  if ! command -v terraform >/dev/null 2>&1; then
    echo "terraform が必要である" >&2
    exit 2
  fi
  for m in infra infra/bootstrap; do
    terraform -chdir="$DIR/$m" init -backend=false -input=false >/dev/null 2>&1 \
      || ng "$m: terraform init に失敗した"
    terraform -chdir="$DIR/$m" validate >/dev/null 2>&1 \
      || ng "$m: terraform validate に失敗した"
  done
fi

# 6. CHANGELOG.md に、そのタグの節があること（prerelease は除く）。タグは展開先のディレクトリ名（rolust-vX.Y.Z）から取る。
TAG="$(basename "$DIR")"
TAG="${TAG#rolust-}"
if [[ "$TAG" != *-* && -s "$DIR/CHANGELOG.md" ]]; then
  "$(dirname "${BASH_SOURCE[0]}")/changelog-section.sh" "$TAG" "$DIR/CHANGELOG.md" >/dev/null \
    || ng "CHANGELOG.md に $TAG の節が無い、または空である（'## $TAG - 日付' の節を書く）"
fi

if [[ "$FAIL" -eq 0 ]]; then
  echo "OK: $(basename "$TARBALL") の検査に通った"
fi
exit "$FAIL"
