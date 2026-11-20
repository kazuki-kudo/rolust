#!/usr/bin/env bash
#
# Release の配布物（tarball と SHA256SUMS）を作る。
#
# 使い方: ./.github/scripts/build-release.sh <タグ（vX.Y.Z）> <出力先>
#   前提: npm run build 済みであること（packages/{api,edge-auth,web}/dist）
#
# 設計: docs/superpowers/specs/2026-10-13-user-deploy-release-design.md 3.1
#
# 追跡しているファイルだけを入れる（git ls-files）。作業ツリーに置かれた terraform.tfvars・
# backend.hcl・.terraform/ は追跡外なので、手元で作っても環境固有の値が混ざらない。
# 配置は作業ツリーと同じにする。infra/ が ../packages/*/dist を読む構造と、`docs/guide/setup.md` の
# plan-guard の呼び出し（../.github/scripts/plan-guard.sh）を、利用者と開発者で揃えるため。
#
# 終了コード: 0 成功 / 1 成果物が無い / 2 使い方の誤り

set -euo pipefail

VERSION="${1:-}"
OUT="${2:-}"
if [[ -z "$VERSION" || -z "$OUT" ]]; then
  echo "usage: $0 <vX.Y.Z> <出力先>" >&2
  exit 2
fi
if ! [[ "$VERSION" =~ ^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.]+)?$ ]]; then
  echo "タグの形式が違う: $VERSION（例: v1.2.3、v0.0.0-rc.1）" >&2
  exit 2
fi

ROOT="${ROLUST_REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
NAME="rolust-${VERSION}"
DISTS=(packages/api/dist packages/edge-auth/dist packages/web/dist)

mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"

cd "$ROOT"
for d in "${DISTS[@]}"; do
  if [[ ! -d "$d" || -z "$(ls -A "$d")" ]]; then
    echo "ビルド済みの成果物が無い: $d（先に npm run build を実行する）" >&2
    exit 1
  fi
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/$NAME"

git ls-files -z -- infra cloudformation/target-roles.yaml .github/scripts/plan-guard.sh README.md README.ja.md LICENSE SECURITY.md CHANGELOG.md docs/guide \
  | tar --null -T - -cf - \
  | tar -xf - -C "$STAGE/$NAME"

# 利用者向けのエージェント指示書（Issue #262）。正本を AGENTS.md として tarball の直下に複写し、
# CLAUDE.md は @AGENTS.md の 1 行にする（内容を 1 か所に保つ）。正本そのものは入れない。
AGENT_SRC=docs/tarball-agent-instructions.md
if ! git ls-files --error-unmatch -- "$AGENT_SRC" >/dev/null 2>&1; then
  echo "追跡された指示書の正本が無い: $AGENT_SRC" >&2
  exit 1
fi
cp "$AGENT_SRC" "$STAGE/$NAME/AGENTS.md"
printf '@AGENTS.md\n' > "$STAGE/$NAME/CLAUDE.md"

for d in "${DISTS[@]}"; do
  mkdir -p "$STAGE/$NAME/$(dirname "$d")"
  cp -R "$d" "$STAGE/$NAME/$d"
done

EPOCH="${SOURCE_DATE_EPOCH:-$(git log -1 --format=%ct)}"

# 同じ内容から同じバイト列ができるようにする（並び順・所有者・時刻・gzip のヘッダを固定）。
tar --sort=name --owner=0 --group=0 --numeric-owner --mtime="@${EPOCH}" \
    -cf - -C "$STAGE" "$NAME" | gzip -n -9 > "$OUT/$NAME.tar.gz"

(cd "$OUT" && sha256sum "$NAME.tar.gz" > SHA256SUMS)
echo "作成: $OUT/$NAME.tar.gz"
