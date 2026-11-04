#!/usr/bin/env bash
#
# CHANGELOG.md から、指定した版の節の本文を取り出して標準出力に書く。
#
# 使い方: ./.github/scripts/changelog-section.sh <タグ（vX.Y.Z）> [CHANGELOG.md のパス（既定はリポジトリのルート）]
#
# 節の見出しは `## vX.Y.Z - 日付` の形である。見出しの行は出さず、次の `## ` の見出しの手前まで
# （ファイルの末尾なら末尾まで）を出す。本文の前後の空行は落とす。
# タグは文字列として比べる（正規表現にしない。`.` が任意の 1 文字に、`v1.2.3` が `v1.2.30` に当たるのを避ける）。
#
# 使う場所:
#   - release.yml: Release の本文の先頭に置く
#   - check-release.sh: 本番の版の tarball に、その版の節があることを確かめる
#
# 終了コード: 0 取り出せた / 1 ファイルが無い・節が無い・節が空 / 2 使い方の誤り

set -euo pipefail

TAG="${1:-}"
if [[ -z "$TAG" ]]; then
  echo "usage: $0 <vX.Y.Z> [CHANGELOG.md]" >&2
  exit 2
fi
FILE="${2:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/CHANGELOG.md}"

if [[ ! -f "$FILE" ]]; then
  echo "CHANGELOG が無い: $FILE" >&2
  exit 1
fi

# 節の中身を集めてから、前後の空行を落とす。awk はタグを `==` で比べる（文字列比較）。
# 節の見出しが無ければ awk は 3 で終わる（空の節との区別のため）。
rc=0
body="$(awk -v tag="$TAG" '
  { sub(/\r$/, "") }
  $1 == "##" && !seen && $2 == tag { seen = 1; inside = 1; next }
  inside && /^## / { exit }
  inside { lines[++n] = $0 }
  END {
    if (!seen) exit 3
    first = 1
    while (first <= n && lines[first] ~ /^[[:space:]]*$/) first++
    last = n
    while (last >= first && lines[last] ~ /^[[:space:]]*$/) last--
    for (i = first; i <= last; i++) print lines[i]
  }
' "$FILE")" || rc=$?

if [[ "$rc" -eq 3 ]]; then
  echo "CHANGELOG に $TAG の節が無い: $FILE" >&2
  exit 1
elif [[ "$rc" -ne 0 ]]; then
  echo "CHANGELOG を読めなかった（awk の終了コード $rc）: $FILE" >&2
  exit 1
fi
if [[ -z "$body" ]]; then
  echo "CHANGELOG の $TAG の節が空である: $FILE" >&2
  exit 1
fi

printf '%s\n' "$body"
