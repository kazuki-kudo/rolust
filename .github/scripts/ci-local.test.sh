#!/usr/bin/env bash
#
# ci-local.sh の回帰テスト（Issue #199）。
#
# なぜ要るか: ci-local.sh は「CI と同じ検査を手元で走らせた」と言うための道具である。
# CI にジョブが増えたのに ci-local.sh が知らないままだと、**走らせていない検査を
# 走らせたつもりになる**。黙って減る側の壊れ方なので、一致を機械で見張る。
#
# 検査するもの:
#   1. ci.yml の jobs のキー集合と、ci-local.sh が宣言するジョブ一覧が一致する
#   2. ci-local.sh が固定版（Terraform・cfn-lint・trivy・gitleaks の版）をハードコードしていない
#      — 版は ci.yml の env から読む。二重管理すると、CI と手元で別の版が走る
#   3. ci.yml の env にある固定版の変数を、ci-local.sh がすべて読んでいる
#
# 使い方:
#   ./.github/scripts/ci-local.test.sh
#
# 終了コード: 0 全件パス / 1 失敗あり / 2 前提不足

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SCRIPT="$HERE/ci-local.sh"
WORKFLOW="$ROOT/.github/workflows/ci.yml"

if [[ ! -f "$SCRIPT" || ! -f "$WORKFLOW" ]]; then
  echo "ci-local.sh または .github/workflows/ci.yml が見つからない" >&2
  exit 2
fi

pass=0
fail=0

ok() {
  printf '  PASS %s\n' "$1"
  pass=$((pass + 1))
}

ng() {
  printf '  FAIL %s\n' "$1"
  if [[ $# -ge 2 ]]; then printf '       %s\n' "$2"; fi
  fail=$((fail + 1))
}

# --- 1. ジョブ一覧の一致 -----------------------------------------------------
#
# ci.yml の `jobs:` 直下のキー（2 スペースのインデント）を拾う。`on:` の `push:` などを
# 拾わないよう、`jobs:` の行以降だけを見る。
workflow_jobs="$(
  awk '
    /^jobs:/ { in_jobs = 1; next }
    in_jobs && /^[^ ]/ { in_jobs = 0 }
    in_jobs && /^  [a-zA-Z0-9_-]+:[[:space:]]*$/ {
      gsub(/^  /, ""); gsub(/:[[:space:]]*$/, ""); print
    }
  ' "$WORKFLOW" | sort
)"

# ci-local.sh は、対応するジョブを `# ci-job: <id>` の行で宣言する。
declared_jobs="$(grep -oE '^# ci-job: [a-zA-Z0-9_-]+' "$SCRIPT" | sed 's/^# ci-job: //' | sort)"

if [[ -z "$workflow_jobs" ]]; then
  ng "ci.yml から jobs を読めた" "jobs の抽出が 0 件。awk の条件が workflow の書式と合っていない"
elif [[ "$workflow_jobs" == "$declared_jobs" ]]; then
  ok "ci.yml の全ジョブが ci-local.sh に宣言されている（$(echo "$workflow_jobs" | wc -l | tr -d ' ') 件）"
else
  missing="$(comm -23 <(echo "$workflow_jobs") <(echo "$declared_jobs") | tr '\n' ' ')"
  extra="$(comm -13 <(echo "$workflow_jobs") <(echo "$declared_jobs") | tr '\n' ' ')"
  ng "ci.yml の全ジョブが ci-local.sh に宣言されている" \
    "ci-local.sh に無いジョブ: ${missing:-なし} / ci.yml に無い宣言: ${extra:-なし}"
fi

# --- 2. 固定版をハードコードしていない ---------------------------------------
#
# 版の文字列（1.10.5 など）がスクリプト本体に現れたら、二重管理になっている。
# コメントは対象外（説明に例として書くことがある）。
code_only="$(grep -vE '^[[:space:]]*#' "$SCRIPT")"
hardcoded=""
while IFS= read -r version; do
  [[ -z "$version" ]] && continue
  if grep -qF -- "\"$version\"" <<<"$code_only" || grep -qE "=[[:space:]]*'?${version//./\\.}'?([[:space:]]|$)" <<<"$code_only"; then
    hardcoded="$hardcoded $version"
  fi
done <<<"$(grep -E '^  [A-Z_]+_VERSION: ' "$WORKFLOW" | sed -E 's/.*: *"?([^"]+)"?$/\1/')"

if [[ -z "$hardcoded" ]]; then
  ok "固定版をハードコードしていない（ci.yml から読む）"
else
  ng "固定版をハードコードしていない" "本体に現れた版:$hardcoded"
fi

# --- 3. ci.yml の固定版の変数をすべて読んでいる ------------------------------
unread=""
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  grep -qF -- "$name" "$SCRIPT" || unread="$unread $name"
done <<<"$(grep -oE '^  [A-Z_]+_VERSION' "$WORKFLOW" | tr -d ' ')"

if [[ -z "$unread" ]]; then
  ok "ci.yml の *_VERSION をすべて参照している"
else
  ng "ci.yml の *_VERSION をすべて参照している" "参照していない変数:$unread"
fi

# --- 4. 実行権限 -------------------------------------------------------------
#
# Windows の chmod は git の index に残らない（`.claude/rules/shell-and-aws-cli.md`）。
# 100644 でコミットすると Linux では ./ci-local.sh が Permission denied になる。
mode="$(cd "$ROOT" && git ls-files -s .github/scripts/ci-local.sh 2>/dev/null | awk '{print $1}')"
if [[ "$mode" == "100755" ]]; then
  ok "ci-local.sh の実行権限が index に残っている（100755）"
elif [[ -z "$mode" ]]; then
  ok "ci-local.sh はまだ git の管理下に無い（コミット前）"
else
  ng "ci-local.sh の実行権限が index に残っている" "git ls-files -s が $mode を返した。git update-index --chmod=+x が要る"
fi

echo
echo "パス $pass / 失敗 $fail"
[[ $fail -eq 0 ]]
