#!/usr/bin/env bash
#
# 守る対象（AWS アカウント ID・CloudFront の DNS 名・自宅の IP・会社ドメインや作者のメール）が、
# リポジトリに入る文字列に混ざっていないかを検査する（Issue #177）。
#
# 実値の一覧は持たない。「プレースホルダの許可リスト」方式で、許可していない形の
# 12 桁の数字・*.cloudfront.net・IPv4・メールアドレスを検出する。ルールは
# .gitleaks-protected.toml だけにあり、このスクリプトは gitleaks を呼ぶ薄い層である。
#
# 使い方（カレントの git リポジトリを検査する。既定は all）:
#   protected-values-guard.sh [tree|history|all]
#     tree     追跡ファイル（インデックス）を走査する。gitignore 済み・未追跡のファイルは見ない
#     history  PROTECTED_BASE..HEAD の差分と、そのコミットメッセージを走査する
#   protected-values-guard.sh text [file]    標準入力かファイルの本文を検査する
#                                            （Issue・PR・コメントの投稿前、commit-msg フック）
#
# 環境変数:
#   GITLEAKS_BIN      gitleaks の実行ファイル（既定: PATH の gitleaks）
#   GITLEAKS_VERSION  要求する版（既定: 8.30.1。ci.yml の値と同じにする）
#   PROTECTED_BASE    history の起点コミット（既定: 空 = 全履歴。旧リポジトリでは #176 の merge を既定にしていた。Issue #182）。
#                     起点を指定すると PROTECTED_BASE..HEAD だけを走査する。
#
# 終了コード: 0 問題なし / 1 検出あり / 2 前提不足（gitleaks が無い・版が違う・git でない・引数が不正）
# 前提が足りないときは通さない（fail closed）。検査できないのに緑にしないため。

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG="$(cd "$HERE/../.." && pwd)/.gitleaks-protected.toml"
GITLEAKS="${GITLEAKS_BIN:-gitleaks}"
WANT_VERSION="${GITLEAKS_VERSION:-8.30.1}"
# 未設定でも空でも全履歴を走査する。`-` は `:-` と違い、設定済みの空を空のまま残す（起点を明示して絞るときの書き方）。
BASE="${PROTECTED_BASE-}"
# gitleaks の「検出あり」を、失敗（設定の誤りなど。終了コード 1）と区別するための値。
LEAK_EXIT=3

TMP_DIRS=()
cleanup() {
  local d
  for d in ${TMP_DIRS[@]+"${TMP_DIRS[@]}"}; do rm -rf "$d"; done
}
trap cleanup EXIT

usage() {
  cat <<'USAGE'
使い方:
  protected-values-guard.sh [tree|history|all]   カレントの git リポジトリを検査する（既定は all）
  protected-values-guard.sh text [file]          標準入力かファイルの本文を検査する
  protected-values-guard.sh -h|--help
USAGE
}

die() { echo "$*" >&2; exit 2; }

# gitleaks.exe は Windows のパスを取る。Git Bash の /c/... を C:/... にする。
native() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s\n' "$1"; fi
}

check_gitleaks() {
  command -v "$GITLEAKS" >/dev/null 2>&1 \
    || die "gitleaks が見つからない（版 ${WANT_VERSION} が要る）。入れ方は CLAUDE.md の「保護値」の節にある"
  [[ -r "$CONFIG" ]] || die "設定が読めない: $CONFIG"
  local got
  got="$("$GITLEAKS" version 2>/dev/null | tr -d '\r' | tail -n 1)"
  got="${got#v}"
  [[ "$got" == "$WANT_VERSION" ]] || die "gitleaks の版が違う（要求 ${WANT_VERSION} / 実際 ${got:-不明}）"
}

# 検出の報告に出す項目（ルール・ファイル・行・コミット）。値そのものも、値を含む行も出さない。
# `--redact` と `--verbose` の組み合わせでは、その検出の値しか伏せられず、同じ行にある別の実値
# （カンマ区切りの IP の一覧など）が平文で出る。CI のログは広く読まれるため、報告を自前で絞る。
# パス名にも値が入りうる（名前に ID を含むバックアップなど）。パス名から検出したときは
# （HIDE_FILES=1）、以後の報告からファイル名も伏せる。
REPORT_TPL=""
REPORT_TPL_NOFILE=""
HIDE_FILES=0
make_report_template() {
  REPORT_TPL="$(mktemp)" || die "一時ファイルを作れない"
  REPORT_TPL_NOFILE="$(mktemp)" || die "一時ファイルを作れない"
  TMP_DIRS+=("$REPORT_TPL" "$REPORT_TPL_NOFILE")
  printf '%s\n' \
    '{{ range . }}  {{ .RuleID }}  {{ if .File }}{{ .File }}{{ else }}(入力){{ end }}:{{ .StartLine }}{{ if .Commit }}  commit {{ .Commit }}{{ end }}' \
    '{{ end }}' > "$REPORT_TPL"
  printf '%s\n' \
    '{{ range . }}  {{ .RuleID }}  (ファイル名は伏せる):{{ .StartLine }}{{ if .Commit }}  commit {{ .Commit }}{{ end }}' \
    '{{ end }}' > "$REPORT_TPL_NOFILE"
}

# 保護値のルールで gitleaks を呼び、終了コードを 0（問題なし）/ 1（検出）/ 2（失敗）に写す。
gl() {
  local tpl="$REPORT_TPL"
  if [[ "$HIDE_FILES" -eq 1 ]]; then tpl="$REPORT_TPL_NOFILE"; fi
  "$GITLEAKS" "$@" --config "$(native "$CONFIG")" --no-banner --redact \
    --report-format template --report-template "$(native "$tpl")" --report-path - \
    --exit-code "$LEAK_EXIT"
  case $? in
    0) return 0 ;;
    "$LEAK_EXIT") return 1 ;;
    *) return 2 ;;
  esac
}

# パス名の一覧を標準入力から受けて、同じルールで走査する。gitleaks の内容ルールはパスを見ないので、
# 名前に値を含むファイル（backup-<ID>.txt など）はここで拾う。検出したら、以後の報告からファイル名を伏せる。
scan_paths() {
  local rc=0
  gl stdin || rc=$?
  if [[ "$rc" -eq 1 ]]; then
    HIDE_FILES=1
    echo "  ↑ パス名に保護値の形がある（番号は git ls-files か git log --name-only の行番号。名前は伏せる）" >&2
  fi
  return "$rc"
}

repo_root() {
  git rev-parse --show-toplevel 2>/dev/null
}

# 追跡ファイル（インデックス）だけを一時ディレクトリへ書き出して走査する。
# `gitleaks dir` を作業ツリーに当てると、gitignore 済みのファイル（node_modules・実値入りの
# infra/backend.hcl など）と .git/ の中身まで読むため。
scan_tree() {
  local repo tmp list rc=0 r expected actual
  HIDE_FILES=0
  repo="$(repo_root)" || die "git のリポジトリの中で実行する"
  tmp="$(mktemp -d)" || die "一時ディレクトリを作れない"
  list="$(mktemp)" || die "一時ファイルを作れない"
  TMP_DIRS+=("$tmp" "$list")
  git -C "$repo" -c core.quotepath=off ls-files > "$list" || die "追跡ファイルの一覧を取れない"
  # git.exe に渡すパスは Windows の形にする。MSYS_NO_PATHCONV=1 の下では /tmp/... が C:\tmp\... に
  # 読み替えられ、gitleaks が空のディレクトリを走査して「問題なし」になる（fail open）。
  git -C "$repo" checkout-index -a --prefix="$(native "$tmp")/" || die "追跡ファイルを書き出せない"
  expected="$(wc -l < "$list" | tr -d ' ')"
  actual="$(find "$tmp" \( -type f -o -type l \) | wc -l | tr -d ' ')"
  [[ "$expected" == "$actual" ]] \
    || die "追跡ファイルの書き出しが一覧と合わない（${actual}/${expected}）。空のディレクトリを走査して通さないよう、止める"
  scan_paths < "$list" || rc=$?
  ( cd "$tmp" && gl dir . ) || { r=$?; (( r > rc )) && rc=$r; }
  return "$rc"
}

# 起点より後の差分と、コミットメッセージを走査する。`gitleaks git` は差分しか見ず、
# コミットメッセージを走査しないので、メッセージは別に stdin で渡す。
scan_history() {
  local repo range rc=0 r list
  HIDE_FILES=0
  repo="$(repo_root)" || die "git のリポジトリの中で実行する"
  if [[ -n "$BASE" ]]; then
    git -C "$repo" rev-parse --verify --quiet "${BASE}^{commit}" >/dev/null \
      || die "PROTECTED_BASE（${BASE}）が見つからない。CI では fetch-depth: 0 にする"
    range="${BASE}..HEAD"
  else
    range="HEAD"
  fi
  list="$(mktemp)" || die "一時ファイルを作れない"
  TMP_DIRS+=("$list")
  git -C "$repo" -c core.quotepath=off log --format= --name-only "$range" > "$list" \
    || die "履歴のファイル名を取れない"
  scan_paths < "$list" || rc=$?
  ( cd "$repo" && gl git . --log-opts "$range" ) || { r=$?; (( r > rc )) && rc=$r; }
  git -C "$repo" log --format=%B "$range" | gl stdin || { r=$?; (( r > rc )) && rc=$r; }
  return "$rc"
}

scan_text() {
  if [[ $# -ge 1 ]]; then
    [[ -r "$1" ]] || die "読めない: $1"
    gl stdin < "$1"
  else
    gl stdin
  fi
}

# --- main -----------------------------------------------------------------

mode="${1:-all}"
case "$mode" in
  -h|--help) usage; exit 0 ;;
  tree|history|all|text) ;;
  *) usage >&2; exit 2 ;;
esac
[[ $# -gt 0 ]] && shift

check_gitleaks
make_report_template

rc=0
r=0
case "$mode" in
  tree) scan_tree; rc=$? ;;
  history) scan_history; rc=$? ;;
  all)
    scan_tree; rc=$?
    scan_history; r=$?
    (( r > rc )) && rc=$r
    ;;
  text) scan_text "$@"; rc=$? ;;
esac

case "$rc" in
  0) echo "保護値の検査: 問題なし（${mode}）" >&2 ;;
  1)
    cat >&2 <<'MSG'
保護値の検査: 守る対象の形をした文字列を検出した（値は伏せてある）。
  - 実値なら、プレースホルダ（CLAUDE.md の「保護値」の表）に置き換える。
  - 誤検知なら、その行の末尾に gitleaks:allow を付ける。
MSG
    ;;
esac
exit "$rc"
