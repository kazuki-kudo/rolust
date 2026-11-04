#!/usr/bin/env bash
#
# protected-values-guard.sh と .githooks/commit-msg の回帰テスト（Issue #177）。
#
# なぜ要るか: 検査が静かに壊れると「全部落ちる」か「全部通る」のどちらかになり、
# 後者は実値を検査済みとして通す。ゲートそのものにゲートが要る。
#
# 方式: 使い捨ての git リポジトリに、検出すべき文字列と通すべき文字列を置き、
# 終了コードと出力を確かめる。実 AWS も実値も要らない。
# フィクスチャは文字列を連結して組み立てる（このファイル自身が検査で赤にならないように）。
#
# 使い方:
#   ./.github/scripts/protected-values-guard.test.sh
#   GITLEAKS_BIN=/path/to/gitleaks ./.github/scripts/protected-values-guard.test.sh
#
# 終了コード: 0 全件パス / 1 失敗あり / 2 前提不足

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
GUARD="$HERE/protected-values-guard.sh"
HOOK="$ROOT/.githooks/commit-msg"

if ! command -v "${GITLEAKS_BIN:-gitleaks}" >/dev/null 2>&1; then
  echo "gitleaks が必要である（CLAUDE.md の「保護値」の節）" >&2
  exit 2
fi
if [[ ! -f "$GUARD" ]]; then
  echo "protected-values-guard.sh が見つからない" >&2
  exit 2
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

PASS=0
FAIL=0

# --- フィクスチャ（連結して組み立てる）-------------------------------------
REAL_ID="2109""87654321"        # ダミーの形ではない 12 桁
DUMMY_ID="1111""2222""3333"     # aaaabbbbcccc 形
DUMMY_ID2="5555""6666""7777"
CF_BAD="dabcdef123456"".cloudfront.net"
CF_OK="dXXXXXXXXXXXXX"".cloudfront.net"
IP_BAD="198.18"".0.1"           # 文書用の範囲ではない
IP_BAD2="198.18"".0.2"
IP_OK="203.0.113"".5"
IP_PRIVATE="10.0"".0.1"
MAIL_BAD="someone@""company.co.jp"
MAIL_OK="someone@""example.com"

# assert <名前> <期待する終了コード> <出力に含まれるべき文字列 | -> <出力に含まれてはならない文字列 | -> <コマンド...>
assert() {
  local name="$1" want="$2" needle="$3" forbid="$4"
  shift 4
  local out rc ok=1

  out="$("$@" 2>&1)"; rc=$?

  [[ "$rc" -eq "$want" ]] || ok=0
  if [[ "$needle" != "-" ]] && ! grep -qF -- "$needle" <<< "$out"; then ok=0; fi
  if [[ "$forbid" != "-" ]] && grep -qF -- "$forbid" <<< "$out"; then ok=0; fi

  if [[ "$ok" -eq 1 ]]; then
    PASS=$((PASS+1)); printf 'PASS  %s\n' "$name"
  else
    FAIL=$((FAIL+1))
    printf 'FAIL  %s — exit=%s（期待 %s / 含む "%s" / 含まない "%s"）\n%s\n\n' \
      "$name" "$rc" "$want" "$needle" "$forbid" "$out"
  fi
}

# 使い捨ての git リポジトリを作り、そのパスを出力する。
new_repo() {
  local d
  d="$(mktemp -d "$WORK/repo.XXXXXX")"
  git -C "$d" init -q
  git -C "$d" config user.email "test@example.com"
  git -C "$d" config user.name "test"
  git -C "$d" config commit.gpgsign false
  echo "$d"
}
put() { mkdir -p "$(dirname "$1/$2")"; printf '%s\n' "$3" > "$1/$2"; }
commit_all() { git -C "$1" add -A 2>/dev/null && git -C "$1" commit -q -m "${2:-c}" 2>/dev/null; }
# repo_with <パス> <内容>: 1 ファイルをコミットしたリポジトリを作る。
repo_with() { local r; r="$(new_repo)"; put "$r" "$1" "$2"; commit_all "$r" init; echo "$r"; }

guard_in() { local d="$1"; shift; ( cd "$d" && bash "$GUARD" "$@" ); }
guard_in_base() { local d="$1" base="$2"; shift 2; ( cd "$d" && PROTECTED_BASE="$base" bash "$GUARD" "$@" ); }
guard_text() { printf '%s\n' "$1" | bash "$GUARD" text; }
guard_text_env() { printf '%s\n' "$2" | env "$1" bash "$GUARD" text; }

echo "== text: 通すもの =="
assert "ふつうの文章（件数・ポート・3 つ組の版）" 0 - - guard_text "件数は 12 件、port 8080、gitleaks 8.30.1"
assert "ダミーのアカウント ID（aaaabbbbcccc 形・123456789012・全桁同一）" 0 - - \
  guard_text "arn:aws:iam::${DUMMY_ID}:role/x ${DUMMY_ID2} 123456789012 000000000000 999999999999"
assert "英数字に挟まれた 12 桁（ハッシュ）" 0 - - guard_text "sha abc${REAL_ID}def"
assert "13 桁の数字" 0 - - guard_text "n=${REAL_ID}1"
assert "プレースホルダの CloudFront の DNS 名と、*.cloudfront.net の記述" 0 - - \
  guard_text "https://${CF_OK}/ と *.cloudfront.net の形"
assert "文書用の IPv4・ループバック・0.0.0.0" 0 - - \
  guard_text "${IP_OK} 192.0.2.7 198.51.100.200 127.0.0.1 0.0.0.0/0"
assert "オクテットが不正・3 つ組・4 つ目が 3 桁超は IPv4 ではない" 0 - - \
  guard_text "256.1.1.1 010.1.1.1 1.2.3 1.2.3.456"
assert "許可したメールアドレス" 0 - - \
  guard_text "${MAIL_OK} a@b.example.org x@users.noreply.github.com noreply@anthropic.com git@github.com:org/repo.git"
assert "行末の gitleaks:allow は通す" 0 - - guard_text "${IP_BAD} # gitleaks:allow"
assert "ダミー同士が _ でつながる（アカウント ID・IPv4）" 0 - - \
  guard_text "${DUMMY_ID}_${DUMMY_ID2}_${DUMMY_ID}_${DUMMY_ID2} ${IP_OK}_${IP_OK}_${IP_OK}"

echo
echo "== text: 検出するもの =="
assert "アカウント ID" 1 protected-account-id "$REAL_ID" guard_text "arn:aws:iam::${REAL_ID}:role/x"
assert "日本語に続く 12 桁" 1 protected-account-id "$REAL_ID" guard_text "アカウント${REAL_ID}です"
assert "アンダースコアに続く 12 桁" 1 protected-account-id "$REAL_ID" guard_text "role_${REAL_ID}_x"
assert "ダミーの直後に _ で続く実値（区切りの _ を前の値と共有する。Issue #182）" 1 protected-account-id "$REAL_ID" \
  guard_text "${DUMMY_ID}_${REAL_ID}"
assert "_ でつながる 4 つ目の実値（1 つおきに取り逃がさない）" 1 protected-account-id "$REAL_ID" \
  guard_text "${DUMMY_ID}_${DUMMY_ID2}_${DUMMY_ID}_${REAL_ID}"
assert "ダミーの IPv4 の直後に _ で続く実値の IPv4" 1 protected-ipv4 "$IP_BAD" guard_text "${IP_OK}_${IP_BAD}"
assert "ダミーの直後にカンマで続く実値（隣接する値）" 1 protected-account-id "$REAL_ID" \
  guard_text "${DUMMY_ID},${REAL_ID}"
assert "CloudFront の DNS 名" 1 protected-cloudfront "$CF_BAD" guard_text "https://${CF_BAD}/"
assert "IPv4" 1 protected-ipv4 "$IP_BAD" guard_text "from ${IP_BAD} to"
assert "カンマ区切りの IP の一覧の 2 つ目（隣接する値）" 1 protected-ipv4 "$IP_BAD" \
  guard_text "${IP_OK},${IP_BAD}"
assert "カンマ区切りの実値が 2 つ（隣接する値）" 1 protected-ipv4 "$IP_BAD2" \
  guard_text "${IP_BAD},${IP_BAD2}"
assert "文末のピリオドが付いた IPv4" 1 protected-ipv4 "$IP_BAD" guard_text "ここは ${IP_BAD}."
assert "私設アドレスも許可しない（文書用の範囲だけを通す）" 1 protected-ipv4 "$IP_PRIVATE" \
  guard_text "gw ${IP_PRIVATE}"
assert "メールアドレス" 1 protected-email "company.co.jp" guard_text "連絡先 ${MAIL_BAD}"
assert "許可ドメインを前置しただけのメール" 1 protected-email - guard_text "someone@example.com.""evil.jp"
assert "anthropic.com でも noreply 以外は検出" 1 protected-email - guard_text "bot@""anthropic.com"

echo
echo "== text: 入力の渡し方 =="
printf '%s\n' "x ${REAL_ID}" > "$WORK/body-bad.txt"
printf 'clean\n' > "$WORK/body-ok.txt"
assert "ファイルを渡せる（検出）" 1 protected-account-id "$REAL_ID" bash "$GUARD" text "$WORK/body-bad.txt"
assert "ファイルを渡せる（問題なし）" 0 - - bash "$GUARD" text "$WORK/body-ok.txt"
assert "読めないファイルは 2" 2 "読めない" - bash "$GUARD" text "$WORK/no-such-file.txt"
assert "--help は 0" 0 "使い方" - bash "$GUARD" --help

echo
echo "== 前提不足は 2（通さない）=="
assert "gitleaks が無ければ 2" 2 "見つからない" - guard_text_env "GITLEAKS_BIN=$WORK/no-such-gitleaks" "x"
assert "版が違えば 2" 2 "版が違う" - guard_text_env "GITLEAKS_VERSION=0.0.0" "x"
assert "不正なモードは 2" 2 "使い方" - bash "$GUARD" bogus

echo
echo "== tree: 追跡ファイルだけを、除外パスを除いて走査する =="
r="$(repo_with ok.txt "${DUMMY_ID} ${IP_OK}")"
assert "tree: 問題のないリポジトリ" 0 - - guard_in "$r" tree
r="$(repo_with docs/bad.txt "id ${REAL_ID}")"
assert "tree: 追跡ファイルの実値" 1 "docs/bad.txt" "$REAL_ID" guard_in "$r" tree
r="$(new_repo)"; put "$r" .gitignore "local.env"; put "$r" local.env "$REAL_ID"; put "$r" ok.txt ok; commit_all "$r" init
assert "tree: gitignore 済みのファイルは走査しない" 0 - - guard_in "$r" tree
r="$(new_repo)"; put "$r" a.txt clean; commit_all "$r" init; put "$r" untracked.txt "$REAL_ID"
assert "tree: 追跡していないファイルは走査しない" 0 - - guard_in "$r" tree
r="$(new_repo)"; put "$r" a.txt clean; commit_all "$r" init; put "$r" staged.txt "$REAL_ID"; git -C "$r" add staged.txt
assert "tree: ステージ済みのファイルは走査する" 1 "staged.txt" "$REAL_ID" guard_in "$r" tree
r="$(repo_with aidlc/x.md "$REAL_ID")"
assert "tree: aidlc/ は除外しない（旧リポジトリでは除いていた。この木では除かない。Issue #182）" 1 "aidlc/x.md" - guard_in "$r" tree
r="$(repo_with docs/superpowers/plans/p.md "$REAL_ID")"
assert "tree: docs/superpowers/plans/ は除外しない（plan も走査する。Issue #182）" 1 "plans/p.md" - guard_in "$r" tree
r="$(repo_with docs/superpowers/specs/s.md "$REAL_ID")"
assert "tree: docs/superpowers/specs/ は除外しない" 1 "specs/s.md" - guard_in "$r" tree
r="$(repo_with package-lock.json "$REAL_ID")"
assert "tree: package-lock.json は除外" 0 - - guard_in "$r" tree
r="$(repo_with packages/edge-auth/src/ip-allowlist.test.ts "$IP_BAD")"
assert "tree: ip-allowlist.test.ts の IPv4 は通す" 0 - - guard_in "$r" tree
r="$(repo_with packages/edge-auth/src/ip-allowlist.test.ts "$REAL_ID")"
assert "tree: ip-allowlist.test.ts でも IPv4 以外のルールは効く" 1 protected-account-id - guard_in "$r" tree
r="$(repo_with packages/edge-auth/src/other.test.ts "$IP_BAD")"
assert "tree: ほかのファイルの IPv4 は検出" 1 protected-ipv4 - guard_in "$r" tree
assert "tree: git の外では 2" 2 "git のリポジトリ" - bash -c 'cd "$1" && bash "$2" tree' _ "$WORK" "$GUARD"
r="$(repo_with docs/bad.txt "id ${REAL_ID}")"
assert "tree: MSYS_NO_PATHCONV=1 でも走査する（パス変換の差で空のディレクトリを走査して素通りしない）" 1   protected-account-id "$REAL_ID" bash -c 'cd "$1" && MSYS_NO_PATHCONV=1 bash "$2" tree' _ "$r" "$GUARD"
r="$(repo_with "backup-${REAL_ID}.txt" clean)"
assert "tree: ファイル名に保護値があれば検出する（中身はきれい）" 1 protected-account-id "$REAL_ID" guard_in "$r" tree
r="$(repo_with "n-${IP_BAD}.md" "ip ${IP_BAD}")"
assert "tree: ファイル名にも中身にも保護値があっても、報告にファイル名（値）を出さない" 1 protected-ipv4 "$IP_BAD"   guard_in "$r" tree

echo
echo "== history: 起点より後の差分とコミットメッセージを走査する =="
r="$(new_repo)"; put "$r" a.txt "$REAL_ID"; commit_all "$r" "old ${REAL_ID}"
base="$(git -C "$r" rev-parse HEAD)"
put "$r" b.txt clean; commit_all "$r" "new"
assert "history: 起点より前の実値（差分もメッセージも）は走査しない" 0 - - guard_in_base "$r" "$base" history
assert "history: 起点と HEAD が同じ（空の範囲）なら 0" 0 - - \
  guard_in_base "$r" "$(git -C "$r" rev-parse HEAD)" history
assert "history: 起点が空なら全履歴（最初のコミットを含む）" 1 protected-account-id - guard_in_base "$r" "" history
assert "history: PROTECTED_BASE を設定しないと全履歴を走査する（既定は空。Issue #182）" 1 protected-account-id - guard_in "$r" history
assert "history: 起点が見つからなければ 2" 2 "見つからない" - guard_in_base "$r" "deadbeef" history
put "$r" c.txt "$REAL_ID"; commit_all "$r" "add"
git -C "$r" rm -q c.txt; git -C "$r" commit -q -m "remove"
assert "history: 起点より後に足して消した実値も検出する" 1 protected-account-id "$REAL_ID" \
  guard_in_base "$r" "$base" history
r="$(new_repo)"; put "$r" a.txt clean; commit_all "$r" init; base="$(git -C "$r" rev-parse HEAD)"
git -C "$r" commit -q --allow-empty -m "fix: ${REAL_ID} を直す"
assert "history: 起点より後のコミットメッセージの実値" 1 protected-account-id "$REAL_ID" \
  guard_in_base "$r" "$base" history
r="$(new_repo)"; put "$r" a.txt clean; commit_all "$r" init; base="$(git -C "$r" rev-parse HEAD)"
git -C "$r" commit -q --allow-empty -m "feat: 追加する

Co-Authored-By: Claude <noreply@anthropic.com>"
assert "history: Co-Authored-By の noreply は通す" 0 - - guard_in_base "$r" "$base" history

r="$(new_repo)"; put "$r" a.txt clean; commit_all "$r" init; base="$(git -C "$r" rev-parse HEAD)"
put "$r" "backup-${REAL_ID}.txt" clean; commit_all "$r" "add"
assert "history: ファイル名の保護値も検出する（中身はきれい）" 1 protected-account-id "$REAL_ID"   guard_in_base "$r" "$base" history

echo
echo "== all: tree と history の両方 =="
r="$(repo_with a.txt clean)"; head="$(git -C "$r" rev-parse HEAD)"
assert "all: どちらも問題なし" 0 - - guard_in_base "$r" "$head" all
assert "all: 引数なしは all" 0 - - guard_in_base "$r" "$head"
r="$(repo_with bad.txt "$REAL_ID")"; head="$(git -C "$r" rev-parse HEAD)"
assert "all: tree だけが検出しても 1" 1 protected-account-id "$REAL_ID" guard_in_base "$r" "$head" all
assert "all: 引数なしでも同じ" 1 protected-account-id - guard_in_base "$r" "$head"

echo
echo "== commit-msg フック =="
if [[ ! -f "$HOOK" ]]; then
  echo ".githooks/commit-msg が見つからない" >&2
  exit 2
fi
msg="$WORK/msg.txt"
HOOK_REPO="$(new_repo)"
hook() { ( cd "$HOOK_REPO" && bash "$HOOK" "$1" ); }
printf 'feat: 追加する\n\n本文。件数は 3 件。\n\nCo-Authored-By: Claude <noreply@anthropic.com>\n' > "$msg"
assert "hook: 問題のないメッセージ" 0 - - hook "$msg"
printf 'fix: %s を直す\n' "$REAL_ID" > "$msg"
assert "hook: 実値を含むメッセージは 1" 1 protected-account-id "$REAL_ID" hook "$msg"
printf 'fix: 直す\n# コメント行 %s\n' "$REAL_ID" > "$msg"
assert "hook: # で始まる行も検査する（-m の本文では git が消さない）" 1 protected-account-id "$REAL_ID" hook "$msg"
printf 'fix: 直す\n\n# ------------------------ >8 ------------------------\n+ %s\n' "$REAL_ID" > "$msg"
assert "hook: 切り取り線より後の diff は検査しない" 0 - - hook "$msg"
printf 'fix: %s\n\n# ------------------------ >8 ------------------------\n' "$REAL_ID" > "$msg"
assert "hook: 切り取り線より前の実値は検出する" 1 protected-account-id - hook "$msg"

r="$(new_repo)"; git -C "$r" config core.hooksPath "$ROOT/.githooks"
assert "hook: 実値を含むメッセージのコミットは拒否される" 1 protected-account-id "$REAL_ID" \
  git -C "$r" commit -q --allow-empty -m "fix: ${REAL_ID} を直す"
assert "hook: 拒否されたコミットは残らない" 1 - - git -C "$r" rev-parse --verify -q HEAD
assert "hook: -m の本文の # で始まる行の実値も拒否される" 1 protected-account-id "$REAL_ID"   git -C "$r" commit -q --allow-empty -m "#177 ${REAL_ID} を直す"
assert "hook: 問題のないメッセージのコミットは通る" 0 - - git -C "$r" commit -q --allow-empty -m "feat: 追加する"
assert "hook: 通ったコミットは残る" 0 - - git -C "$r" rev-parse --verify -q HEAD

echo
echo "== commit-msg フック: 作者のメール（Issue #182）=="
r="$(new_repo)"; git -C "$r" config core.hooksPath "$ROOT/.githooks"
git -C "$r" config user.email "$MAIL_BAD"
assert "hook: 許可していない形の作者メールのコミットは拒否され、値は出ない" 1 protected-email "$MAIL_BAD" \
  git -C "$r" commit -q --allow-empty -m "feat: 追加する"
assert "hook: 拒否されたコミットは残らない（作者メール）" 1 - - git -C "$r" rev-parse --verify -q HEAD
ENV_REPO="$(new_repo)"; git -C "$ENV_REPO" config core.hooksPath "$ROOT/.githooks"
assert "hook: 環境変数で上書きした作者メールも検査する" 1 protected-email "$MAIL_BAD" \
  env GIT_AUTHOR_EMAIL="$MAIL_BAD" git -C "$ENV_REPO" commit -q --allow-empty -m "feat: 追加する"
assert "hook: 環境変数で上書きしたコミッタのメールも検査する" 1 protected-email "$MAIL_BAD" \
  env GIT_COMMITTER_EMAIL="$MAIL_BAD" git -C "$ENV_REPO" commit -q --allow-empty -m "feat: 追加する"
git -C "$r" config user.email "1234+someone@users.noreply.github.com"
assert "hook: noreply の作者メールのコミットは通る" 0 - - git -C "$r" commit -q --allow-empty -m "feat: 追加する"
r="$(new_repo)"; git -C "$r" config --unset user.email; git -C "$r" config user.useConfigOnly true
: > "$WORK/empty.gitconfig"
printf 'feat: 追加する\n' > "$msg"
assert "hook: 作者を決められなければ拒否する（通さない）" 1 - - \
  env GIT_CONFIG_GLOBAL="$WORK/empty.gitconfig" GIT_CONFIG_NOSYSTEM=1 bash -c 'cd "$1" && bash "$2" "$3"' _ "$r" "$HOOK" "$msg"
assert "hook: gitleaks が無ければ 2（通さない）" 2 "見つからない" - \
  env GITLEAKS_BIN="$WORK/no-such-gitleaks" bash -c 'cd "$1" && bash "$2" "$3"' _ "$HOOK_REPO" "$HOOK" "$msg"

# --- 集計 ---
echo
echo "== 結果: PASS ${PASS} / FAIL ${FAIL} =="
[[ "$FAIL" -eq 0 ]]
