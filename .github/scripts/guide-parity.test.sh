#!/usr/bin/env bash
#
# guide-parity.sh の回帰テスト（Issue #205）。
#
# なぜ要るか: guide-parity.sh は「日本語版だけ更新して英語版が古くなる」事態を CI で止める関門である。
# 静かに壊れて何でも通す状態になると、構造のずれた英語版を配ってしまう。ゲートそのものにゲートが
# 要る（plan-guard.test.sh・release.test.sh と同じ理由）。
#
# 方式: 作業用ディレクトリに小さな日本語版・英語版の文書を作り、一致するときに通ること、
# 1 箇所ずつ崩すと落ちることを確かめる。
#
# 使い方: ./.github/scripts/guide-parity.test.sh
# 終了コード: 0 全件パス / 1 失敗あり / 2 前提不足

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/guide-parity.sh"

[[ -f "$SCRIPT" ]] || { echo "guide-parity.sh が見つからない" >&2; exit 2; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

PASS=0
FAIL=0

# expect <名前> <期待する終了コード> <コマンド...>
expect() {
  local name="$1" want="$2"
  shift 2
  local out got
  out="$("$@" 2>&1)"
  got=$?
  if [[ "$got" -eq "$want" ]]; then
    echo "  PASS $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $name（終了コード $got、期待 $want）"
    echo "$out" | sed 's/^/       /'
    FAIL=$((FAIL + 1))
  fi
}

# 出力に文字列が含まれないことを確かめる（見出しの本文を出さない検査）。
not_contains() {
  local needle="$1"
  shift
  local out
  out="$("$@" 2>&1)"
  if grep -qF -- "$needle" <<<"$out"; then
    echo "$out"
    return 1
  fi
  return 0
}

# 作業領域を作る。guide/ に日本語版、guide/en/ に英語版を置く。
#   mk <名前> <日本語版の本文> <英語版の本文>   （本文は printf に渡す書式。ファイル名は a.md）
mk() {
  local d="$TMP/$1"
  rm -rf "$d"
  mkdir -p "$d/en"
  printf '%b' "$2" > "$d/a.md"
  if [[ -n "${3-}" ]]; then printf '%b' "$3" > "$d/en/a.md"; fi
  echo "$d"
}

JA='# 題\n\n## 一\n\n### 一の一\n\n## 二\n'
EN_SAME='# Title\n\n## One\n\n### One-one\n\n## Two\n'

echo "== 正常系 =="
expect "階層の列が同じなら通る" 0 "$SCRIPT" "$(mk same "$JA" "$EN_SAME")"
expect "en/ が無ければ通る" 0 "$SCRIPT" "$(rm -rf "$TMP/noen"; mkdir -p "$TMP/noen"; printf '# a\n' > "$TMP/noen/a.md"; echo "$TMP/noen")"
expect "en/ が空なら通る" 0 "$SCRIPT" "$(rm -rf "$TMP/emptyen"; mkdir -p "$TMP/emptyen/en"; printf '# a\n' > "$TMP/emptyen/a.md"; echo "$TMP/emptyen")"
expect "日本語版だけあって英語版が無いファイルは見ない" 0 "$SCRIPT" "$(d="$(mk onlyja "$JA" "$EN_SAME")"; printf '# 別の文書\n' > "$d/b.md"; echo "$d")"
expect "コードブロック内の # 行は数えない（日本語版だけにコメントがある）" 0 "$SCRIPT" "$(mk fence \
  '# 題\n\n## 一\n\n```bash\n# 日本語のコメント\n# もう一つ\necho x\n```\n\n## 二\n' \
  '# Title\n\n## One\n\n```bash\necho x\n```\n\n## Two\n')"
expect "インデントされたフェンスの中の # 行も数えない（リスト項目内）" 0 "$SCRIPT" "$(mk indent \
  '# 題\n\n## 一\n\n1. 手順\n\n   ```bash\n   # コメント\n   echo x\n   ```\n\n## 二\n' \
  '# Title\n\n## One\n\n1. Step\n\n   ```bash\n   echo x\n   ```\n\n## Two\n')"
expect "CRLF の文書でも階層の列を比べられる" 0 "$SCRIPT" "$(mk crlf "$JA" "$(printf '%b' "$EN_SAME" | sed 's/$/\r/')")"

echo "== 異常系 =="
expect "英語版の節が足りなければ落ちる" 1 "$SCRIPT" "$(mk fewer "$JA" '# Title\n\n## One\n\n### One-one\n')"
expect "英語版に節が余分にあれば落ちる" 1 "$SCRIPT" "$(mk more "$JA" "${EN_SAME}\n## Three\n")"
expect "階層が違えば落ちる" 1 "$SCRIPT" "$(mk level "$JA" '# Title\n\n## One\n\n### One-one\n\n### Two\n')"
expect "順序が入れ替わっていれば落ちる" 1 "$SCRIPT" "$(mk order \
  '# 題\n\n## 一\n\n### 一の一\n\n## 二\n' \
  '# Title\n\n## One\n\n## Two\n\n### One-one\n')"
expect "日本語版の無い英語版は落ちる" 1 "$SCRIPT" "$(d="$(mk orphan "$JA" "$EN_SAME")"; printf '# x\n' > "$d/en/zzz.md"; echo "$d")"
expect "コードブロックの外のコメントのような # 行は数える" 1 "$SCRIPT" "$(mk outside \
  '# 題\n\n## 一\n' \
  '# Title\n\n```bash\necho x\n```\n')"
expect "食い違いの出力に見出しの本文を含まない" 0 not_contains "秘密の見出し" \
  "$SCRIPT" "$(mk secret '# 秘密の見出し\n\n## 一\n' '# Title\n')"
expect "食い違いは終了コード 1 で、ファイル名を出す" 0 bash -c "'$SCRIPT' '$(mk named "$JA" '# Title\n')' 2>&1 | grep -q 'NG: en/a.md'"

echo "== フェンスの閉じ方（開いた記号と同じで、長さが同じ以上の行だけが閉じる）=="
expect "バッククォートのフェンスの中の ~~~ は閉じにならない" 0 "$SCRIPT" "$(mk tildeinside \
  '# 題\n\n```\n~~~\n# コメント\n```\n\n## 一\n' \
  '# Title\n\n```\n~~~\n```\n\n## One\n')"
expect "4 個のフェンスの中の 3 個の行は閉じにならない" 0 "$SCRIPT" "$(mk longfence \
  '# 題\n\n````\n```\n# コメント\n```\n````\n\n## 一\n' \
  '# Title\n\n````\n```\n```\n````\n\n## One\n')"
expect "チルダのフェンスの中のシェルコメントも数えない" 0 "$SCRIPT" "$(mk tildefence \
  '# 題\n\n~~~bash\n# コメント\necho x\n~~~\n\n## 一\n' \
  '# Title\n\n~~~bash\necho x\n~~~\n\n## One\n')"
expect "情報文字列つきの行はフェンスを閉じない" 0 "$SCRIPT" "$(mk infostring \
  '# 題\n\n```bash\n```bash\n# コメント\n```\n\n## 一\n' \
  '# Title\n\n```bash\n```bash\n```\n\n## One\n')"

echo "== 使い方の誤り =="
expect "GUIDE_DIR が無ければ終了コード 2" 2 "$SCRIPT" "$TMP/does-not-exist"

echo
echo "結果: PASS=$PASS FAIL=$FAIL"
[[ "$FAIL" -eq 0 ]]
