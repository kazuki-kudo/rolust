#!/usr/bin/env bash
#
# 手順書の英語版（docs/guide/en/*.md）と日本語版（docs/guide/*.md）で、見出しの階層の列が
# 一致するかを検査する（Issue #205）。
#
# なぜ要るか: 日本語が正本で、英語は日本語から訳す。日本語版だけ更新して英語版が古くなると、
# 英語しか読めない人が古い手順に従う。節の追加・削除・入れ替え・階層の変更という構造のずれを、
# 機械で見つける。
#
# 見るもの: 各ファイルの見出し（行頭の `#`）の「`#` の数」を出現順に並べた列。
# フェンス付きコードブロック（``` と ~~~。リスト項目内のインデントされたものを含む）の中の
# `#` で始まる行（シェルのコメント）は見出しに数えない。
# 見ないもの: 見出しの文言、リンク、コードブロックの中身、本文の訳。言語ごとに違う文字列に
# なるため、これらはレビューで見る。
#
# 使い方: ./.github/scripts/guide-parity.sh [GUIDE_DIR]
#   GUIDE_DIR の既定はリポジトリの docs/guide。GUIDE_DIR/en/*.md の各ファイルを、
#   GUIDE_DIR/ の同名のファイルと比べる。英語版が無い日本語版は見ない（英訳しないページが正常）。
#   GUIDE_DIR/en/ が無い、または空のときは何もせず 0 で終わる。
# 終了コード: 0 すべて一致 / 1 食い違いあり / 2 GUIDE_DIR が無い
# 出力: 食い違いは標準エラーに `NG: en/<名前>: ...` で出す。見出しの本文は出さない。

set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${1:-$ROOT/docs/guide}"

if [[ ! -d "$DIR" ]]; then
  echo "手順書のディレクトリが無い: $DIR" >&2
  exit 2
fi

# 見出しの階層（`#` の数）を、出現順に 1 行ずつ出す。
levels() {
  # フェンスは CommonMark と同じく、開いた記号（` か ~）と同じ記号で、開いた長さ以上の行だけが閉じる
  # （閉じの行には情報文字列を付けない）。違う記号や短い行は、フェンスの中の本文として扱う。
  tr -d '\r' < "$1" | awk '
    {
      line = $0
      sub(/^[[:space:]]*/, "", line)
      if (line ~ /^(```|~~~)/) {
        c = substr(line, 1, 1)
        n = 0
        while (substr(line, n + 1, 1) == c) n++
        if (!fenced) { fenced = 1; fc = c; fn = n; next }
        if (c == fc && n >= fn && substr(line, n + 1) ~ /^[[:space:]]*$/) fenced = 0
        next
      }
    }
    !fenced && /^#+[[:space:]]/ { match($0, /^#+/); print RLENGTH }
  '
}

shopt -s nullglob
FAIL=0
for en in "$DIR"/en/*.md; do
  name="$(basename "$en")"
  ja="$DIR/$name"
  if [[ ! -f "$ja" ]]; then
    echo "NG: en/$name: 日本語版（$name）が無い" >&2
    FAIL=1
    continue
  fi

  ja_levels=()
  while IFS= read -r l; do ja_levels+=("$l"); done < <(levels "$ja")
  en_levels=()
  while IFS= read -r l; do en_levels+=("$l"); done < <(levels "$en")

  n_ja=${#ja_levels[@]}
  n_en=${#en_levels[@]}
  max=$((n_ja > n_en ? n_ja : n_en))
  first=0
  for ((i = 0; i < max; i++)); do
    if [[ "${ja_levels[i]-}" != "${en_levels[i]-}" ]]; then
      first=$((i + 1))
      break
    fi
  done

  if [[ "$first" -ne 0 ]]; then
    echo "NG: en/$name: 見出しの階層の列が日本語版と違う（日本語版 ${n_ja} 個、英語版 ${n_en} 個。最初の食い違いは ${first} 番目）" >&2
    FAIL=1
  fi
done

exit "$FAIL"
