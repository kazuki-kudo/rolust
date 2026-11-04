#!/usr/bin/env bash
#
# build-release.sh・check-release.sh・changelog-section.sh の回帰テスト。
#
# なぜ要るか: check-release.sh は Release を作る前の最後の関門である。静かに壊れて
# 「何でも通す」状態になると、環境固有の値（terraform.tfvars・backend.hcl）や空の dist を
# 配ってしまう。ゲートそのものにゲートが要る（plan-guard.test.sh と同じ理由）。
#
# 方式: 合成した小さなリポジトリで tarball を作り、検査が通ること、1 箇所ずつ壊すと
# 検査が落ちることを確かめる。terraform は呼ばない（CHECK_RELEASE_SKIP_TERRAFORM=1）。
#
# 使い方: ./.github/scripts/release.test.sh
# 終了コード: 0 全件パス / 1 失敗あり / 2 前提不足

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD="$HERE/build-release.sh"
CHECK="$HERE/check-release.sh"
SECTION="$HERE/changelog-section.sh"

for c in git tar gzip sha256sum; do
  command -v "$c" >/dev/null 2>&1 || { echo "$c が必要である" >&2; exit 2; }
done
[[ -f "$BUILD" && -f "$CHECK" && -f "$SECTION" ]] \
  || { echo "build-release.sh・check-release.sh・changelog-section.sh のどれかが見つからない" >&2; exit 2; }

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

# 合成リポジトリを作る。追跡するもの（tf・テンプレート・README・手順書・plan-guard）と、
# 追跡しないもの（環境固有の値・dist）を分ける。
make_repo() {
  local r="$1"
  rm -rf "$r"
  mkdir -p "$r/infra/bootstrap" "$r/.github/scripts" "$r/cloudformation"
  (
    cd "$r" || exit 1
    git init -q .
    git config user.email test@example.com
    git config user.name test
    echo 'terraform {}' > infra/main.tf
    echo '# lock' > infra/.terraform.lock.hcl
    echo 'region = "x"' > infra/terraform.tfvars.example
    echo 'bucket = "x"' > infra/backend.hcl.example
    echo 'terraform {}' > infra/bootstrap/main.tf
    printf '#!/usr/bin/env bash\necho guard\n' > .github/scripts/plan-guard.sh
    chmod +x .github/scripts/plan-guard.sh
    echo 'AWSTemplateFormatVersion: "2010-09-09"' > cloudformation/target-roles.yaml
    echo '# readme' > README.md
    echo '# readme ja' > README.ja.md
    echo 'Apache License' > LICENSE
    echo '# security' > SECURITY.md
    printf '# 変更履歴\n\n## 未リリース\n\n### 変更\n- 次の版の変更\n\n## v1.2.3 - 2026-01-02\n\n### 変更\n- 変更 A\n\n### 更新時にやること\n- 作業 B\n\n## v1.2.2 - 2026-01-01\n\n### 変更\n- 古い変更\n' > CHANGELOG.md
    mkdir -p docs/guide/en docs/design
    echo '# guide' > docs/guide/README.md
    echo '# setup' > docs/guide/setup.md
    echo "# setup en" > docs/guide/en/setup.md
    echo "# access-control en" > docs/guide/en/access-control.md
    echo "# cross-account en" > docs/guide/en/cross-account.md
    echo '# design' > docs/design/requirements.md
    printf 'infra/terraform.tfvars\ninfra/backend.hcl\ninfra/.terraform/\npackages/\n' > .gitignore
    git add -A
    git commit -q -m init
    # 追跡しないもの
    echo 'secret = "x"' > infra/terraform.tfvars
    echo 'bucket = "real"' > infra/backend.hcl
    mkdir -p infra/.terraform && echo x > infra/.terraform/leftover
    mkdir -p packages/api/dist/crud packages/api/dist/diff packages/api/dist/apply \
             packages/edge-auth/dist packages/web/dist
    for d in crud diff apply; do echo "// $d" > "packages/api/dist/$d/index.js"; done
    echo '// edge' > packages/edge-auth/dist/index.js
    echo '<html></html>' > packages/web/dist/index.html
    printf 'THIRD-PARTY NOTICES

====
react@1.0.0
License: MIT

MIT License
' > packages/web/dist/THIRD-PARTY-NOTICES.txt
  )
}

REPO="$TMP/repo"
OUT="$TMP/out"
export ROLUST_REPO_ROOT="$REPO"
export CHECK_RELEASE_SKIP_TERRAFORM=1
make_repo "$REPO"

echo "== 正常系 =="
expect "tarball と SHA256SUMS を作れる" 0 "$BUILD" v1.2.3 "$OUT"
expect "作った tarball の検査が通る" 0 "$CHECK" "$OUT/rolust-v1.2.3.tar.gz"
expect "SHA256SUMS が tarball と一致する" 0 bash -c "cd '$OUT' && sha256sum -c SHA256SUMS"
expect "環境固有の値が tarball に入っていない" 1 bash -c "tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -E 'terraform\.tfvars\$|backend\.hcl\$|\.terraform/'"
expect "dist が tarball に入っている" 0 bash -c "tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'packages/web/dist/index.html'"
expect "手順書（docs/guide）が tarball に入っている" 0 bash -c "tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'docs/guide/setup.md'"
expect "英語の手順書（docs/guide/en）が tarball に入っている" 0 bash -c "tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'docs/guide/en/setup.md\$' && tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'docs/guide/en/access-control.md\$' && tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'docs/guide/en/cross-account.md\$'"
expect "日本語の README が tarball に入っている" 0 bash -c "tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'rolust-v1.2.3/README.ja.md\$'"
expect "第三者のライセンスの一覧が tarball に入っている" 0 bash -c "tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'packages/web/dist/THIRD-PARTY-NOTICES.txt'"
expect "LICENSE が tarball に入っている" 0 bash -c "tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'rolust-v1.2.3/LICENSE\$'"
# README が SECURITY.md を相対リンクで指すので、同梱しないと tarball 内で切れる（Issue #194）。
expect "SECURITY.md が tarball に入っている" 0 bash -c "tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'rolust-v1.2.3/SECURITY.md\$'"
expect "CHANGELOG.md が tarball に入っている" 0 bash -c "tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'rolust-v1.2.3/CHANGELOG.md\$'"
expect "設計の正本（docs/design）は tarball に入らない" 1 bash -c "tar -tzf '$OUT/rolust-v1.2.3.tar.gz' | grep -q 'docs/design/'"
expect "prerelease のタグも作れる" 0 "$BUILD" v0.0.0-rc.1 "$TMP/out-rc"
# prerelease は、マージ前のブランチから実測のために打つので、CHANGELOG に節が無くても通す（release.yml の祖先チェックと同じ扱い）。
expect "prerelease は CHANGELOG に節が無くても検査が通る" 0 "$CHECK" "$TMP/out-rc/rolust-v0.0.0-rc.1.tar.gz"
expect "本番の版は CHANGELOG に節が無ければ検査が落ちる" 1 bash -c "'$BUILD' v1.2.5 '$TMP/out-nosection' >/dev/null && '$CHECK' '$TMP/out-nosection/rolust-v1.2.5.tar.gz'"
FIRST="$(sha256sum "$OUT/rolust-v1.2.3.tar.gz" | cut -d' ' -f1)"
"$BUILD" v1.2.3 "$TMP/out2" >/dev/null 2>&1
SECOND="$(sha256sum "$TMP/out2/rolust-v1.2.3.tar.gz" | cut -d' ' -f1)"
expect "同じ内容から同じバイト列ができる" 0 test "$FIRST" = "$SECOND"

echo "== changelog-section.sh =="
CL="$TMP/CHANGELOG.md"
cp "$REPO/CHANGELOG.md" "$CL"
expect "節の本文を取り出せる" 0 bash -c "'$SECTION' v1.2.3 '$CL' | grep -q '変更 A'"
expect "「更新時にやること」も含めて取り出せる" 0 bash -c "'$SECTION' v1.2.3 '$CL' | grep -q '作業 B'"
expect "次の節の内容を含まない" 1 bash -c "'$SECTION' v1.2.3 '$CL' | grep -q '古い変更'"
expect "前の節（未リリース）の内容を含まない" 1 bash -c "'$SECTION' v1.2.3 '$CL' | grep -q '次の版の変更'"
expect "見出し行そのものは含まない" 1 bash -c "'$SECTION' v1.2.3 '$CL' | grep -q '^## '"
expect "最後の節も取り出せる" 0 bash -c "'$SECTION' v1.2.2 '$CL' | grep -q '古い変更'"
expect "節が無ければ落ちる" 1 "$SECTION" v9.9.9 "$CL"
# . をワイルドカードとして読むと、v1.2.3 の指定が v1x2x3 にも当たる。文字列として比べること。
printf '## v1x2x3 - 2026-01-03\n\n- 別の版\n' > "$TMP/dot.md"
expect "タグの . を任意の 1 文字として扱わない" 1 "$SECTION" v1.2.3 "$TMP/dot.md"
# v1.2.3 の指定が v1.2.30 の節に当たってはならない（前方一致にしない）。
printf '## v1.2.30 - 2026-01-03\n\n- 別の版\n' > "$TMP/prefix.md"
expect "タグを前方一致で扱わない" 1 "$SECTION" v1.2.3 "$TMP/prefix.md"
printf '## v1.2.3 - 2026-01-02\n\n\n## v1.2.2 - 2026-01-01\n\n- x\n' > "$TMP/empty.md"
expect "節が空なら落ちる" 1 "$SECTION" v1.2.3 "$TMP/empty.md"
expect "CHANGELOG が無ければ落ちる" 1 "$SECTION" v1.2.3 "$TMP/no-such-file.md"
expect "引数が足りなければ 2 で落ちる" 2 "$SECTION"

echo "== build-release.sh の拒否 =="
for bad in v1 1.2.3 v1.2.3- vX.Y.Z "v1.2.3 x"; do
  expect "形式の違うタグ「$bad」を拒否する" 2 "$BUILD" "$bad" "$TMP/out-bad"
done
mv "$REPO/packages/web/dist" "$TMP/web-dist-saved"
expect "dist が無ければ作らない" 1 "$BUILD" v1.2.4 "$TMP/out-nodist"
mv "$TMP/web-dist-saved" "$REPO/packages/web/dist"

echo "== check-release.sh の拒否（tarball を 1 箇所ずつ壊す） =="
# repack <名前> <展開後に実行するコマンド> : 正常な tarball を展開し、壊して、固め直す。
repack() {
  local name="$1" mutate="$2" w="$TMP/work-$1"
  rm -rf "$w"
  mkdir -p "$w"
  tar -xzf "$OUT/rolust-v1.2.3.tar.gz" -C "$w"
  (cd "$w/rolust-v1.2.3" && eval "$mutate")
  tar -czf "$w.tar.gz" -C "$w" rolust-v1.2.3
  echo "$w.tar.gz"
}
expect "terraform.tfvars が混ざっていれば落ちる" 1 "$CHECK" "$(repack tfvars 'echo x > infra/terraform.tfvars')"
expect "backend.hcl が混ざっていれば落ちる" 1 "$CHECK" "$(repack backend 'echo x > infra/backend.hcl')"
expect ".terraform/ が混ざっていれば落ちる" 1 "$CHECK" "$(repack tfdir 'mkdir infra/.terraform')"
expect "state が混ざっていれば落ちる" 1 "$CHECK" "$(repack state 'echo x > infra/terraform.tfstate')"
expect "ソース（packages/*/src）が混ざっていれば落ちる" 1 "$CHECK" "$(repack src 'mkdir -p packages/api/src && echo x > packages/api/src/a.ts')"
expect "Lambda のバンドルが空なら落ちる" 1 "$CHECK" "$(repack emptybundle ': > packages/api/dist/crud/index.js')"
expect "SPA の index.html が無ければ落ちる" 1 "$CHECK" "$(repack noindex 'rm packages/web/dist/index.html')"
expect "テンプレートが無ければ落ちる" 1 "$CHECK" "$(repack notemplate 'rm cloudformation/target-roles.yaml')"
expect "手順書（docs/guide/setup.md）が無ければ落ちる" 1 "$CHECK" "$(repack noguide 'rm docs/guide/setup.md')"
expect "英語の手順書（docs/guide/en/setup.md）が無ければ落ちる" 1 "$CHECK" "$(repack noguideensetup 'rm docs/guide/en/setup.md')"
expect "英語の手順書（docs/guide/en/access-control.md）が無ければ落ちる" 1 "$CHECK" "$(repack noguideenac 'rm docs/guide/en/access-control.md')"
expect "英語の手順書（docs/guide/en/cross-account.md）が無ければ落ちる" 1 "$CHECK" "$(repack noguideencross 'rm docs/guide/en/cross-account.md')"
expect "日本語の README が無ければ落ちる" 1 "$CHECK" "$(repack noreadmeja 'rm README.ja.md')"
expect "第三者のライセンスの一覧が無ければ落ちる" 1 "$CHECK" "$(repack nonotices 'rm packages/web/dist/THIRD-PARTY-NOTICES.txt')"
expect "第三者のライセンスの一覧にパッケージが 1 件も無ければ落ちる" 1 "$CHECK" "$(repack emptynotices 'echo header > packages/web/dist/THIRD-PARTY-NOTICES.txt')"
expect "Lambda のバンドルに第三者のコードが入っていれば落ちる" 1 "$CHECK" "$(repack bundled3p 'printf "// ../../node_modules/left-pad/index.js
module.exports = 1;
" >> packages/api/dist/crud/index.js')"
expect "Lambda@Edge のバンドルに第三者のコードが入っていれば落ちる" 1 "$CHECK" "$(repack bundled3pedge 'printf "// ../../node_modules/left-pad/index.js
" >> packages/edge-auth/dist/index.js')"
expect "LICENSE が無ければ落ちる" 1 "$CHECK" "$(repack nolicense 'rm LICENSE')"
expect "SECURITY.md が無ければ落ちる" 1 "$CHECK" "$(repack nosecurity 'rm SECURITY.md')"
expect "CHANGELOG.md が無ければ落ちる" 1 "$CHECK" "$(repack nochangelog 'rm CHANGELOG.md')"
expect "CHANGELOG.md にそのタグの節が無ければ落ちる" 1 "$CHECK" "$(repack nosection "printf '# 変更履歴\n\n## v1.2.2 - 2026-01-01\n\n- x\n' > CHANGELOG.md")"
expect "CHANGELOG.md のそのタグの節が空なら落ちる" 1 "$CHECK" "$(repack emptysection "printf '# 変更履歴\n\n## v1.2.3 - 2026-01-02\n\n## v1.2.2 - 2026-01-01\n\n- x\n' > CHANGELOG.md")"
expect "LICENSE がリポジトリのものと違えば落ちる" 1 "$CHECK" "$(repack licensediff 'echo "# x" >> LICENSE')"
expect "plan-guard.sh がリポジトリのものと違えば落ちる" 1 "$CHECK" "$(repack guarddiff 'echo "# x" >> .github/scripts/plan-guard.sh')"
# Windows（Git Bash）では chmod -x が効かない（実行権限が拡張子や #! から決まる）。
# 外せない環境ではこの検査を飛ばす（SKIP と表示する。CI の Linux では走る）。
probe="$TMP/probe.sh"
printf '#!/usr/bin/env bash\n' > "$probe"
chmod -x "$probe"
if [[ -x "$probe" ]]; then
  echo "  SKIP plan-guard.sh に実行権限が無ければ落ちる（この環境では実行権限を外せない。CI の Linux で走る）"
else
  expect "plan-guard.sh に実行権限が無ければ落ちる" 1 "$CHECK" "$(repack guardperm 'chmod -x .github/scripts/plan-guard.sh')"
fi
expect "CRLF のスクリプトが混ざっていれば落ちる" 1 "$CHECK" "$(repack crlf "printf '#!/usr/bin/env bash\r\necho guard\r\n' > .github/scripts/plan-guard.sh; cp .github/scripts/plan-guard.sh '$REPO/.github/scripts/plan-guard.sh'")"

echo
echo "パス $PASS / 失敗 $FAIL"
[[ "$FAIL" -eq 0 ]]
