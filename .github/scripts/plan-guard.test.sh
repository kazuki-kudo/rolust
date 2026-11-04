#!/usr/bin/env bash
#
# plan-guard.sh の回帰テスト。
#
# なぜ要るか: plan-guard は本番デプロイを止める側のコードである。静かに壊れると
# 「全部落ちる」か「全部通る」のどちらかになり、後者は検査していない差分を
# 検査済みとして通す。ゲートそのものにゲートが要る。
#
# 方式: testdata/plan-clean.json（赤信号のない plan）を jq で 1 箇所ずつ変異させ、
# 対応する赤信号が出ることを確かめる。実 AWS も実 state も要らない。
#
# 使い方:
#   ./.github/scripts/plan-guard.test.sh
#
# 終了コード: 0 全件パス / 1 失敗あり / 2 前提不足

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/plan-guard.sh"
CLEAN="$HERE/testdata/plan-clean.json"

if ! command -v jq >/dev/null 2>&1; then
  echo "jq が必要である" >&2
  exit 2
fi
if [[ ! -f "$GUARD" || ! -f "$CLEAN" ]]; then
  echo "plan-guard.sh または testdata/plan-clean.json が見つからない" >&2
  exit 2
fi

TMP="$(mktemp -t plan-guard-test.XXXXXX.json)"
trap 'rm -f "$TMP"' EXIT

PASS=0
FAIL=0

# assert <名前> <期待する終了コード> <出力に含まれるべき文字列> <jq の変異式>
assert() {
  local name="$1" want_exit="$2" want_needle="$3" mutation="$4"
  local out rc ok=1

  if ! jq "$mutation" "$CLEAN" > "$TMP" 2>/dev/null; then
    FAIL=$((FAIL+1)); printf 'FAIL  %s — テストの変異式が jq で評価できない\n' "$name"
    return
  fi

  out="$(bash "$GUARD" "$TMP" 2>&1)"; rc=$?

  [[ "$rc" -eq "$want_exit" ]] || ok=0
  if [[ -n "$want_needle" ]] && ! grep -q "$want_needle" <<< "$out"; then
    ok=0
  fi

  if [[ "$ok" -eq 1 ]]; then
    PASS=$((PASS+1)); printf 'PASS  %s\n' "$name"
  else
    FAIL=$((FAIL+1))
    printf 'FAIL  %s — exit=%s（期待 %s / "%s"）\n%s\n\n' "$name" "$rc" "$want_exit" "$want_needle" "$out"
  fi
}

APPLY='(.resource_changes[] | select(.address=="aws_iam_role_policy.apply_iam_write"))'
DIFF='(.resource_changes[] | select(.address=="aws_iam_role_policy.diff_iam_read"))'
DDB='(.resource_changes[] | select(.address=="aws_iam_role_policy.lambda_dynamodb[\"crud\"]"))'
CF='(.resource_changes[] | select(.address=="aws_cloudfront_distribution.rolust"))'
PAB='(.resource_changes[] | select(.address=="aws_s3_bucket_public_access_block.web"))'
SSM='(.resource_changes[] | select(.address=="aws_ssm_parameter.basic_auth"))'
CRUD='(.resource_changes[] | select(.address=="aws_iam_role_policy.crud_iam_read_tags"))'
CRUD_TRUST='(.resource_changes[] | select(.address=="aws_iam_role_policy.crud_iam_read_trust"))'
ROLE_EDGE='(.resource_changes[] | select(.address=="aws_iam_role.edge_auth"))'
IPSSM='(.resource_changes[] | select(.address=="aws_ssm_parameter.ip_allowlist"))'
ACCSSM='(.resource_changes[] | select(.address=="aws_ssm_parameter.allowed_account_ids"))'
A_CRUD='(.resource_changes[] | select(.address=="aws_iam_role_policy.crud_assume_target_reader"))'
A_DIFF='(.resource_changes[] | select(.address=="aws_iam_role_policy.diff_assume_target_reader"))'
A_APPLY='(.resource_changes[] | select(.address=="aws_iam_role_policy.apply_assume_target_manager"))'
M_PROXY='(.resource_changes[] | select(.address=="aws_api_gateway_method.proxy"))'
M_DIFF='(.resource_changes[] | select(.address=="aws_api_gateway_method.leaf[\"diff\"]"))'
M_APPLY='(.resource_changes[] | select(.address=="aws_api_gateway_method.leaf[\"apply\"]"))'
M_DRIFT='(.resource_changes[] | select(.address=="aws_api_gateway_method.leaf[\"drift\"]"))'
M_DRIFT_RESTORE='(.resource_changes[] | select(.address=="aws_api_gateway_method.drift_child[\"restore\"]"))'
M_DRIFT_ADOPT='(.resource_changes[] | select(.address=="aws_api_gateway_method.drift_child[\"adopt\"]"))'

echo "== 変異なし =="
assert "赤信号のない plan は緑" 0 "赤信号 0 件" '.'

echo
echo "== R-1 Allow の到達範囲がタグで絞られていない =="
# タグ方式移行（3.4 再実行 2026-08-24）で判定基準が変わった。
# 「Resource が role/* なら RED」ではなく「role/* かつ有効なタグ条件が無ければ RED」。
# 3.4 が示した迂回 3 形態（別キー / StringEquals 以外 / 値のワイルドカード）を
# それぞれ 1 本ずつ押さえる。押さえていなければ、押さえたことにならない。
assert "R-1 条件なし apply_iam_write" 1 "R-1"   "$APPLY.change.after.policy |= (fromjson | .Statement |= map(if .Effect==\"Allow\" then del(.Condition) else . end) | tojson)"
assert "R-1 条件なし diff_iam_read" 1 "R-1"   "$DIFF.change.after.policy |= (fromjson | .Statement |= map(del(.Condition)) | tojson)"
assert "R-1 迂回① 別のタグキーで絞っている" 1 "R-1"   "$DIFF.change.after.policy |= (fromjson | .Statement |= map(.Condition = {\"StringEquals\": {\"aws:ResourceTag/other:tag\": \"true\"}}) | tojson)"
assert "R-1 迂回② 演算子が StringLike" 1 "R-1"   "$DIFF.change.after.policy |= (fromjson | .Statement |= map(.Condition = {\"StringLike\": {\"aws:ResourceTag/rolust:managed\": \"true\"}}) | tojson)"
assert "R-1 迂回③ 値がワイルドカード" 1 "R-1"   "$DIFF.change.after.policy |= (fromjson | .Statement |= map(.Condition = {\"StringEquals\": {\"aws:ResourceTag/rolust:managed\": \"*\"}}) | tojson)"
assert "R-1 迂回③ 値が前方一致のワイルドカード" 1 "R-1"   "$APPLY.change.after.policy |= (fromjson | .Statement |= map(if .Effect==\"Allow\" then .Condition = {\"StringEquals\": {\"aws:ResourceTag/rolust:managed\": \"tr*\"}} else . end) | tojson)"

# 絞り込みは効くが、宣言された管理対象集合とは別の集合を指している。
# 到達範囲は広がらないので赤信号にはしない（終了コード 0）が、黙って通すのとも違う。
assert "R-1 値が managed_tag_value と不一致なら警告" 0 "警告"   "$DIFF.change.after.policy |= (fromjson | .Statement |= map(.Condition = {\"StringEquals\": {\"aws:ResourceTag/rolust:managed\": \"false\"}}) | tojson)"

# Issue #80: CRUD が紐づけ時に信頼ポリシーを読む `crud_iam_read_trust` も、R-1 の対象。
# Resource = role/* を取るので、タグ条件が外れると、CRUD がアカウント内の全ロールの信頼ポリシーを読める。
assert "R-1 条件なし crud_iam_read_trust" 1 "R-1"   "$CRUD_TRUST.change.after.policy |= (fromjson | .Statement |= map(del(.Condition)) | tojson)"
assert "R-1 迂回① 別のタグキーで絞っている crud_iam_read_trust" 1 "R-1"   "$CRUD_TRUST.change.after.policy |= (fromjson | .Statement |= map(.Condition = {\"StringEquals\": {\"aws:ResourceTag/other:tag\": \"true\"}}) | tojson)"
assert "R-1 迂回② 演算子が StringLike crud_iam_read_trust" 1 "R-1"   "$CRUD_TRUST.change.after.policy |= (fromjson | .Statement |= map(.Condition = {\"StringLike\": {\"aws:ResourceTag/rolust:managed\": \"true\"}}) | tojson)"
assert "R-1 迂回③ 値がワイルドカード crud_iam_read_trust" 1 "R-1"   "$CRUD_TRUST.change.after.policy |= (fromjson | .Statement |= map(.Condition = {\"StringEquals\": {\"aws:ResourceTag/rolust:managed\": \"*\"}}) | tojson)"

echo
echo "== R-3 一覧取得・実在検証の API が増える（FR-5.7 / C-4）=="
assert "R-3 crud_iam_read_trust に iam:ListUsers が増える" 1 "R-3"   "$CRUD_TRUST.change.after.policy |= (fromjson | .Statement[0].Action = [\"iam:GetRole\",\"iam:ListUsers\"] | tojson)"

echo
echo "== R-1 判定基準そのものが得られない場合（Q6 = B: fail closed）=="
# タグ方式では Resource = role/* が正常な形なので、期待するタグキーが分からないと
# 「正しく絞られている」と「事実上の無条件」を機械では区別できない。
assert "R-1 variables が無ければ赤信号" 1 "R-1" 'del(.variables)'
assert "R-1 managed_tag_key が無ければ赤信号" 1 "R-1" 'del(.variables.managed_tag_key)'
assert "R-1 managed_tag_key が空文字なら赤信号" 1 "R-1" '.variables.managed_tag_key.value = ""'

echo
echo "== R-9 CRUD の IAM ポリシーが、設計の Action 単体か =="
# Resource = role/* を条件なしで取る設計（RQ-6 = A）なので、Action が広がると
# アカウント内の全ロールに対してその操作ができる。R-1 とは判定基準が異なる。
assert "R-9 iam:GetRole が増える" 1 "R-9"   "$CRUD.change.after.policy |= (fromjson | .Statement[0].Action = [\"iam:ListRoleTags\",\"iam:GetRole\"] | tojson)"
assert "R-9 iam:ListRoles に差し替わる" 1 "R-9"   "$CRUD.change.after.policy |= (fromjson | .Statement[0].Action = \"iam:ListRoles\" | tojson)"
assert "R-9 iam:* のワイルドカード" 1 "R-9"   "$CRUD.change.after.policy |= (fromjson | .Statement[0].Action = \"iam:*\" | tojson)"
assert "R-9 policy が未確定なら警告" 0 "警告"   "$CRUD.change.after.policy = null | $CRUD.change.after_unknown.policy = true"

# Issue #80: CRUD が持ってよい IAM の Action は、2 つのポリシーのそれぞれ 1 つだけ。
# crud_iam_read_trust は iam:GetRole 単体。UpdateAssumeRolePolicy が紛れ込むと FR-3.2 の保証が外れる。
assert "R-9 crud_iam_read_trust に iam:UpdateAssumeRolePolicy が増える" 1 "R-9"   "$CRUD_TRUST.change.after.policy |= (fromjson | .Statement[0].Action = [\"iam:GetRole\",\"iam:UpdateAssumeRolePolicy\"] | tojson)"
assert "R-9 crud_iam_read_trust が iam:ListRoleTags に差し替わる" 1 "R-9"   "$CRUD_TRUST.change.after.policy |= (fromjson | .Statement[0].Action = \"iam:ListRoleTags\" | tojson)"
assert "R-9 crud_iam_read_trust の iam:* のワイルドカード" 1 "R-9"   "$CRUD_TRUST.change.after.policy |= (fromjson | .Statement[0].Action = \"iam:*\" | tojson)"
assert "R-9 crud_iam_read_tags が iam:GetRole に差し替わる（2 つのポリシーの Action は入れ替えられない）" 1 "R-9"   "$CRUD.change.after.policy |= (fromjson | .Statement[0].Action = \"iam:GetRole\" | tojson)"
assert "R-9 crud_iam_read_trust の policy が未確定なら警告" 0 "警告   R-9"   "$CRUD_TRUST.change.after.policy = null | $CRUD_TRUST.change.after_unknown.policy = true"
assert "R-9 crud_iam_read_trust の削除は対象外" 0 "赤信号 0 件"   "$CRUD_TRUST.change.actions = [\"delete\"]"

echo
echo "== R-2 DenySelfEscalation の消失・無力化・縮小 =="
assert "R-2 Deny の Statement が消える" 1 "R-2" \
  "$APPLY.change.after.policy |= (fromjson | .Statement |= map(select(.Sid != \"DenySelfEscalation\")) | tojson)"
assert "R-2 Deny が Allow に変わる" 1 "R-2" \
  "$APPLY.change.after.policy |= (fromjson | .Statement |= map(if .Sid==\"DenySelfEscalation\" then .Effect=\"Allow\" else . end) | tojson)"
assert "R-2 Deny の Resource が減る" 1 "R-2" \
  "$APPLY.change.after.policy |= (fromjson | .Statement |= map(if .Sid==\"DenySelfEscalation\" then .Resource = .Resource[0:2] else . end) | tojson)"

echo
echo "== R-10 plan 内の全 aws_iam_role が DenySelfEscalation に含まれるか =="
# Rolust が作るロールを増やして self_role_arns に加え忘れると、タグさえ付けば
# そのロールの信頼ポリシーを Rolust 経由で書き換えられる。R-2（件数の減少）では
# 追加漏れを捕まえられないので、plan に在るロールとの突き合わせで見る。
NEWROLE='{"address":"aws_iam_role.extra","mode":"managed","type":"aws_iam_role","name":"extra","change":{"actions":["create"],"before":null,"after":{"name":"rolust-extra","path":"/"},"after_unknown":{"arn":true,"id":true}}}'
assert "R-10 Deny に無いロールを新規作成する" 1 "R-10" \
  ".resource_changes += [$NEWROLE]"
assert "R-10 既存ロールの名前が変わる" 1 "R-10" \
  "$ROLE_EDGE.change.actions = [\"delete\",\"create\"] | $ROLE_EDGE.change.after.name = \"rolust-edge-auth-v2\""
assert "R-10 path が違えば別のロール" 1 "R-10" \
  "$ROLE_EDGE.change.after.path = \"/service/\""
assert "R-10 Deny のワイルドカードが覆っていれば緑" 0 "赤信号 0 件" \
  ".resource_changes += [$NEWROLE] | $APPLY.change.after.policy |= (fromjson | .Statement |= map(if .Sid==\"DenySelfEscalation\" then .Resource += [\"arn:aws:iam::111122223333:role/rolust-*\"] else . end) | tojson)"
assert "R-10 ロール名が未確定なら警告" 0 "警告   R-10" \
  ".resource_changes += [$NEWROLE | .change.after.name = null | .change.after_unknown.name = true]"
assert "R-10 Deny に無いロールの削除は対象外" 0 "赤信号 0 件" \
  ".resource_changes += [$NEWROLE | .change.actions = [\"delete\"] | .change.before = .change.after | .change.after = null]"

echo
echo "== R-3 一覧取得・実在検証の API が増える（FR-5.7 / C-4）=="
assert "R-3 iam:ListRoles" 1 "R-3" \
  "$DIFF.change.after.policy |= (fromjson | .Statement[0].Action = [\"iam:GetRole\",\"iam:ListRoles\"] | tojson)"
assert "R-3 iam:GetUser" 1 "R-3" \
  "$APPLY.change.after.policy |= (fromjson | .Statement[0].Action = [\"iam:GetRole\",\"iam:GetUser\"] | tojson)"
assert "R-3 iam:* のワイルドカード" 1 "R-3" \
  "$DIFF.change.after.policy |= (fromjson | .Statement[0].Action = \"iam:*\" | tojson)"

echo
echo "== R-12 別アカウントへの sts:AssumeRole の到達範囲（Issue #85）=="
# Lambda の実行ロールが引き受けられる範囲は、Reader（crud・diff）と Manager（apply）だけ。
# 取り違えは、CRUD・Diff に書き込み権限を渡す。ロール名にワイルドカードが入ると、
# 任意のロールを引き受けられる。アカウントの部分の * は正常な形（spec D-5）。
assert "R-12 crud の Action に iam:GetRole が増える" 1 "R-12" \
  "$A_CRUD.change.after.policy |= (fromjson | .Statement[0].Action = [\"sts:AssumeRole\",\"iam:GetRole\"] | tojson)"
assert "R-12 crud の Action が sts:* に広がる" 1 "R-12" \
  "$A_CRUD.change.after.policy |= (fromjson | .Statement[0].Action = \"sts:*\" | tojson)"
assert "R-12 diff の Action が sts:AssumeRoleWithWebIdentity に差し替わる" 1 "R-12" \
  "$A_DIFF.change.after.policy |= (fromjson | .Statement[0].Action = \"sts:AssumeRoleWithWebIdentity\" | tojson)"
assert "R-12 Resource のロール名にワイルドカード" 1 "R-12" \
  "$A_CRUD.change.after.policy |= (fromjson | .Statement[0].Resource = \"arn:aws:iam::*:role/RolustTrustPolicy*\" | tojson)"
assert "R-12 Resource が role/*" 1 "R-12" \
  "$A_APPLY.change.after.policy |= (fromjson | .Statement[0].Resource = \"arn:aws:iam::*:role/*\" | tojson)"
assert "R-12 Resource が *" 1 "R-12" \
  "$A_APPLY.change.after.policy |= (fromjson | .Statement[0].Resource = \"*\" | tojson)"
assert "R-12 Resource のロール名にパスを含む" 1 "R-12" \
  "$A_CRUD.change.after.policy |= (fromjson | .Statement[0].Resource = \"arn:aws:iam::*:role/path/RolustTrustPolicyReader\" | tojson)"
assert "R-12 Resource が 2 件（Reader と Manager）" 1 "R-12" \
  "$A_CRUD.change.after.policy |= (fromjson | .Statement[0].Resource = [\"arn:aws:iam::*:role/RolustTrustPolicyReader\",\"arn:aws:iam::*:role/RolustTrustPolicyManager\"] | tojson)"
assert "R-12 crud が Manager を指す（取り違え）" 1 "R-12" \
  "$A_CRUD.change.after.policy |= (fromjson | .Statement[0].Resource = \"arn:aws:iam::*:role/RolustTrustPolicyManager\" | tojson)"
assert "R-12 diff が Manager を指す（取り違え）" 1 "R-12" \
  "$A_DIFF.change.after.policy |= (fromjson | .Statement[0].Resource = \"arn:aws:iam::*:role/RolustTrustPolicyManager\" | tojson)"
assert "R-12 apply が Reader を指す（取り違え）" 1 "R-12" \
  "$A_APPLY.change.after.policy |= (fromjson | .Statement[0].Resource = \"arn:aws:iam::*:role/RolustTrustPolicyReader\" | tojson)"
assert "R-12 アカウントを 12 桁で固定するのは緑（範囲は狭まる）" 0 "赤信号 0 件" \
  "$A_CRUD.change.after.policy |= (fromjson | .Statement[0].Resource = \"arn:aws:iam::123456789012:role/RolustTrustPolicyReader\" | tojson)"
assert "R-12 partition が aws-cn でも、形式が合えば緑" 0 "赤信号 0 件" \
  "$A_CRUD.change.after.policy |= (fromjson | .Statement[0].Resource = \"arn:aws-cn:iam::*:role/RolustTrustPolicyReader\" | tojson)"
assert "R-12 variables の Reader 名が無ければ赤信号（判定基準が得られない）" 1 "R-12" \
  'del(.variables.target_reader_role_name)'
assert "R-12 variables の Manager 名が空文字なら赤信号" 1 "R-12" \
  '.variables.target_manager_role_name.value = ""'
assert "R-12 policy が未確定なら警告" 0 "警告   R-12" \
  "$A_CRUD.change.after.policy = null | $A_CRUD.change.after_unknown.policy = true"
assert "R-12 削除は対象外" 0 "赤信号 0 件" \
  "$A_CRUD.change.actions = [\"delete\"]"
# (d) 3 つ以外のポリシーに sts の Action が紛れ込む。
assert "R-12(d) 別のポリシーに sts:AssumeRole が増える" 1 "R-12" \
  "$DDB.change.after.policy |= (fromjson | .Statement[0].Action += [\"sts:AssumeRole\"] | tojson)"
assert "R-12(d) 別のポリシーの Action が *" 1 "R-12" \
  "$DDB.change.after.policy |= (fromjson | .Statement[0].Action = \"*\" | tojson)"
assert "R-12(d) Deny の sts は対象外" 0 "赤信号 0 件" \
  "$DDB.change.after.policy |= (fromjson | .Statement += [{\"Effect\":\"Deny\",\"Action\":\"sts:AssumeRole\",\"Resource\":\"*\"}] | tojson)"
assert "R-12(d) 別のポリシーの policy が未確定なら警告" 0 "警告   R-12" \
  "$DDB.change.after.policy = null | $DDB.change.after_unknown.policy = true"

echo
echo "== R-12 の強化: 大文字小文字・NotAction/NotResource・アタッチ・role 属性（Issue #85 の最終レビュー）=="
# IAM の Action 名は大文字小文字を区別しない。STS:AssumeRole でも sts:AssumeRole と同じ権限になる。
assert "R-12(d) 別のポリシーに STS:AssumeRole（大文字小文字を区別しない）" 1 "R-12" \
  "$DDB.change.after.policy |= (fromjson | .Statement[0].Action += [\"STS:AssumeRole\"] | tojson)"
assert "R-12(d) 別のポリシーに Sts:*（大文字小文字を区別しない）" 1 "R-12" \
  "$DDB.change.after.policy |= (fromjson | .Statement[0].Action += [\"Sts:*\"] | tojson)"
# Allow の NotAction は「それ以外の全部」を許す。sts:AssumeRole を含む。
assert "R-12(d) 別のポリシーに Allow の NotAction" 1 "R-12" \
  "$DDB.change.after.policy |= (fromjson | .Statement += [{\"Effect\":\"Allow\",\"NotAction\":\"iam:*\",\"Resource\":\"*\"}] | tojson)"
assert "R-12(d) Deny の NotAction は対象外" 0 "赤信号 0 件" \
  "$DDB.change.after.policy |= (fromjson | .Statement += [{\"Effect\":\"Deny\",\"NotAction\":\"iam:*\",\"Resource\":\"*\"}] | tojson)"
assert "R-12 crud のポリシーに NotResource を足す" 1 "R-12" \
  "$A_CRUD.change.after.policy |= (fromjson | .Statement[0].NotResource = \"arn:aws:iam::*:role/x\" | tojson)"
assert "R-12 crud のポリシーに NotAction の Allow を足す" 1 "R-12" \
  "$A_CRUD.change.after.policy |= (fromjson | .Statement += [{\"Effect\":\"Allow\",\"NotAction\":\"iam:*\",\"Resource\":\"*\"}] | tojson)"
# 実行ロールへの管理ポリシーのアタッチ・インラインポリシーは、ポリシーの中身を R-12 が読めない。
# 実行ロール = 名前が -exec で終わるロール（crud・diff・apply・edge-auth）。
# aws_iam_role を足すテストは R-10（DenySelfEscalation との突き合わせ）にも触れるので、Deny のワイルドカードで覆って切り分ける。
DENY_COVER="$APPLY.change.after.policy |= (fromjson | .Statement |= map(if .Sid==\"DenySelfEscalation\" then .Resource += [\"arn:aws:iam::111122223333:role/rolust-*\"] else . end) | tojson)"
attach_mut() { # <type> <actions> <after> <after_unknown>
  printf '.resource_changes += [{"address":"%s.extra","mode":"managed","type":"%s","name":"extra","change":{"actions":%s,"before":null,"after":%s,"after_unknown":%s}}]' "$1" "$1" "$2" "$3" "$4"
}
assert "R-12 crud の実行ロールに管理ポリシーをアタッチ" 1 "R-12" \
  "$(attach_mut aws_iam_role_policy_attachment '["create"]' '{"role":"rolust-crud-exec","policy_arn":"arn:aws:iam::aws:policy/AdministratorAccess"}' '{}')"
assert "R-12 edge-auth の実行ロールに管理ポリシーをアタッチ" 1 "R-12" \
  "$(attach_mut aws_iam_role_policy_attachment '["create"]' '{"role":"rolust-edge-auth-exec","policy_arn":"arn:aws:iam::aws:policy/AdministratorAccess"}' '{}')"
assert "R-12 aws_iam_policy_attachment の roles に実行ロール" 1 "R-12" \
  "$(attach_mut aws_iam_policy_attachment '["create"]' '{"roles":["rolust-apigw-logs","rolust-apply-exec"],"policy_arn":"arn:aws:iam::aws:policy/AdministratorAccess"}' '{}')"
assert "R-12 実行ロールでないロール（API Gateway のログ用）へのアタッチは緑" 0 "赤信号 0 件" \
  "$(attach_mut aws_iam_role_policy_attachment '["create"]' '{"role":"rolust-apigw-logs","policy_arn":"arn:aws:iam::aws:policy/service-role/AmazonAPIGatewayPushToCloudWatchLogs"}' '{}')"
assert "R-12 アタッチ先のロールが未確定なら警告" 0 "警告   R-12" \
  "$(attach_mut aws_iam_role_policy_attachment '["create"]' '{"role":null,"policy_arn":"arn:aws:iam::aws:policy/AdministratorAccess"}' '{"role":true}')"
assert "R-12 既存のアタッチ（変更なし）は対象外" 0 "赤信号 0 件" \
  "$(attach_mut aws_iam_role_policy_attachment '["no-op"]' '{"role":"rolust-crud-exec","policy_arn":"arn:aws:iam::aws:policy/AdministratorAccess"}' '{}')"
assert "R-12 アタッチの削除は対象外" 0 "赤信号 0 件" \
  "$(attach_mut aws_iam_role_policy_attachment '["delete"]' '{"role":"rolust-crud-exec","policy_arn":"arn:aws:iam::aws:policy/AdministratorAccess"}' '{}')"
assert "R-12 実行ロールに inline_policy が増える" 1 "R-12" \
  "$(attach_mut aws_iam_role '["create"]' '{"name":"rolust-crud-exec","path":"/","inline_policy":[{"name":"x","policy":"{}"}],"managed_policy_arns":[]}' '{}') | $DENY_COVER"
assert "R-12 実行ロールに managed_policy_arns が増える" 1 "R-12" \
  "$(attach_mut aws_iam_role '["create"]' '{"name":"rolust-crud-exec","path":"/","inline_policy":[],"managed_policy_arns":["arn:aws:iam::aws:policy/AdministratorAccess"]}' '{}') | $DENY_COVER"
assert "R-12 実行ロールの更新で inline_policy が変わらないなら緑（状態の読み直しの値は増加ではない）" 0 "赤信号 0 件" \
  ".resource_changes += [{\"address\":\"aws_iam_role.lambda[\\\"crud\\\"]\",\"mode\":\"managed\",\"type\":\"aws_iam_role\",\"name\":\"lambda\",\"change\":{\"actions\":[\"update\"],\"before\":{\"name\":\"rolust-crud-exec\",\"path\":\"/\",\"inline_policy\":[{\"name\":\"logs\",\"policy\":\"{}\"}],\"managed_policy_arns\":[],\"tags\":{}},\"after\":{\"name\":\"rolust-crud-exec\",\"path\":\"/\",\"inline_policy\":[{\"name\":\"logs\",\"policy\":\"{}\"}],\"managed_policy_arns\":[],\"tags\":{\"a\":\"b\"}},\"after_unknown\":{}}}] | $DENY_COVER"
# 3 ポリシーの role 属性: 別の実行ロールに付けると、引き受けられる範囲が入れ替わる。
assert "R-12 apply のポリシーの role が crud の実行ロール" 1 "R-12" \
  "$A_APPLY.change.after.role = \"rolust-crud-exec\""
assert "R-12 crud のポリシーの role が apply の実行ロール" 1 "R-12" \
  "$A_CRUD.change.after.role = \"rolust-apply-exec\""
assert "R-12 diff のポリシーの role が crud の実行ロール" 1 "R-12" \
  "$A_DIFF.change.after.role = \"rolust-crud-exec\""
assert "R-12 role が未確定なら警告" 0 "警告   R-12" \
  "$A_CRUD.change.after.role = null | $A_CRUD.change.after_unknown.role = true"
assert "R-12 role を読めなければ赤信号" 1 "R-12" \
  "del($A_CRUD.change.after.role)"
assert "R-12 variables の project_name が無ければ赤信号（期待する role を組めない）" 1 "R-12" \
  'del(.variables.project_name)'
assert "R-12 project_name を変えても、それに合う role なら緑" 0 "赤信号 0 件" \
  ".variables.project_name.value = \"acme\" | $A_CRUD.change.after.role = \"acme-crud-exec\" | $A_DIFF.change.after.role = \"acme-diff-exec\" | $A_APPLY.change.after.role = \"acme-apply-exec\""

echo
echo "== jq のプログラムは引数ではなくファイルで渡す（Windows の Git Bash のコマンドライン長の上限）=="
# プログラムを引数で渡すと、約 32KB を超えた時点で Windows の Git Bash では「Argument list too long」になり、全件が落ちる
# （Issue #85 の R-12 の強化で実際に起きた）。CI（Linux）では通るので、CI だけでは気づけない。手順書の apply 前の検査は
# Git Bash で走らせる。ここでは、渡し方そのものを固定する。
if grep -q 'jq -r -f ' "$GUARD" && ! grep -qE "jq -r '\$" "$GUARD"; then
  PASS=$((PASS+1)); printf 'PASS  %s\n' "jq のプログラムを -f（ファイル）で渡している"
else
  FAIL=$((FAIL+1)); printf 'FAIL  %s\n' "jq のプログラムを -f（ファイル）で渡している — 引数で渡すと、Windows の Git Bash で全件が落ちる"
fi

echo
echo "== R-4 dynamodb:Scan が増える（NFR-1 / NFR-2）=="
assert "R-4 dynamodb:Scan" 1 "R-4" \
  "$DDB.change.after.policy |= (fromjson | .Statement[0].Action += [\"dynamodb:Scan\"] | tojson)"
assert "R-4 dynamodb:* のワイルドカード" 1 "R-4" \
  "$DDB.change.after.policy |= (fromjson | .Statement[0].Action = [\"dynamodb:*\"] | tojson)"

echo
echo "== R-5 Basic 認証（Lambda@Edge）の関連付けが外れる（FR-6.1）=="
assert "R-5 default_cache_behavior から外れる" 1 "R-5" \
  "$CF.change.after.default_cache_behavior[0].lambda_function_association = []"
assert "R-5 /api/* から外れる" 1 "R-5" \
  "$CF.change.after.ordered_cache_behavior[0].lambda_function_association = []"
assert "R-5 event_type が viewer-request でなくなる" 1 "R-5" \
  "$CF.change.after.default_cache_behavior[0].lambda_function_association[0].event_type = \"origin-request\""

echo
echo "== R-6 カスタムエラー応答に 404 が増える =="
assert "R-6 error_code 404" 1 "R-6" \
  "$CF.change.after.custom_error_response += [{\"error_code\":404,\"response_code\":200,\"response_page_path\":\"/index.html\",\"error_caching_min_ttl\":0}]"

echo
echo "== R-7 SPA バケットの公開ブロックが外れる =="
assert "R-7 block_public_policy = false" 1 "R-7" \
  "$PAB.change.after.block_public_policy = false"
assert "R-7 restrict_public_buckets = false" 1 "R-7" \
  "$PAB.change.after.restrict_public_buckets = false"
assert "R-7 block_public_acls = false" 1 "R-7" \
  "$PAB.change.after.block_public_acls = false"

echo
echo "== R-8 SSM の資格情報が Terraform に上書きされる =="
assert "R-8 value に差分が出る" 1 "R-8" \
  "$SSM.change.actions = [\"update\"] | $SSM.change.before.value = \"honto-no-shikakujouhou\""
assert "R-8 許可リストの value に差分が出る" 1 "R-8" \
  "$IPSSM.change.actions = [\"update\"] | $IPSSM.change.before.value = \"203.0.113.0/24\""
assert "R-8 許可リストの文面は、制限が外れることを述べる" 1 "許可リスト" \
  "$IPSSM.change.actions = [\"update\"] | $IPSSM.change.before.value = \"203.0.113.0/24\""
assert "R-8 許可リストの value が未確定なら警告" 0 "警告   R-8" \
  "$IPSSM.change.actions = [\"update\"] | $IPSSM.change.after_unknown.value = true"
assert "R-8 許可リストの value に差分が無ければ緑" 0 "赤信号 0 件" \
  "$IPSSM.change.actions = [\"update\"]"
assert "R-8 許可アカウントの value に差分が出る（Issue #139）" 1 "R-8" \
  "$ACCSSM.change.actions = [\"update\"] | $ACCSSM.change.before.value = \"111122223333,444455556666\""
assert "R-8 許可アカウントの文面は、足したアカウントが消えることを述べる" 1 "許可アカウント" \
  "$ACCSSM.change.actions = [\"update\"] | $ACCSSM.change.before.value = \"111122223333,444455556666\""
assert "R-8 許可アカウントの value が未確定なら警告" 0 "警告   R-8" \
  "$ACCSSM.change.actions = [\"update\"] | $ACCSSM.change.after_unknown.value = true"
assert "R-8 許可アカウントの value に差分が無ければ緑" 0 "赤信号 0 件" \
  "$ACCSSM.change.actions = [\"update\"]"

echo
echo "== R-11 API Gateway の直 URL を塞ぐ設定が外れる（FR-6.3）=="
# (a) メソッドの作成・更新で api_key_required が true でない
assert "R-11 proxy が api_key_required = false に戻る" 1 "R-11" \
  "$M_PROXY.change.after.api_key_required = false"
assert "R-11 leaf[diff] が api_key_required = false に戻る" 1 "R-11" \
  "$M_DIFF.change.after.api_key_required = false"
assert "R-11 leaf[apply] が api_key_required = false に戻る" 1 "R-11" \
  "$M_APPLY.change.after.api_key_required = false"
assert "R-11 leaf[drift] が api_key_required = false に戻る（Issue #170）" 1 "R-11" \
  "$M_DRIFT.change.after.api_key_required = false"
assert "R-11 drift_child[restore] が api_key_required = false に戻る（Issue #172）" 1 "R-11" \
  "$M_DRIFT_RESTORE.change.after.api_key_required = false"
assert "R-11 drift_child[adopt] が api_key_required = false に戻る（Issue #172）" 1 "R-11" \
  "$M_DRIFT_ADOPT.change.after.api_key_required = false"
assert "R-11 メソッドの作成で api_key_required が無い（新しいルートの付け忘れ）" 1 "R-11" \
  "$M_PROXY.change.actions = [\"create\"] | $M_PROXY.change.before = null | del($M_PROXY.change.after.api_key_required)"
assert "R-11 変更の無いメソッドは検査しない（二段階の反映の途中を落とさない）" 0 "赤信号 0 件" \
  "$M_PROXY.change.actions = [\"no-op\"] | $M_PROXY.change.after.api_key_required = false"
assert "R-11 api_key_required が未確定なら警告" 0 "警告   R-11" \
  "$M_PROXY.change.after_unknown.api_key_required = true | $M_PROXY.change.after.api_key_required = null"
assert "R-11 メソッドの削除は対象外" 0 "赤信号 0 件" \
  "$M_PROXY.change.actions = [\"delete\"] | $M_PROXY.change.after = null"
# (b) CloudFront の API オリジンに x-api-key の custom_header が付いている
# fixture の origin[1] が api-gateway（origin[0] は s3-spa）
assert "R-11 API オリジンから custom_header が消える" 1 "R-11" \
  "$CF.change.after.origin[1].custom_header = []"
assert "R-11 別名のヘッダーでは足りない" 1 "R-11" \
  "$CF.change.after.origin[1].custom_header = [{\"name\":\"x-other\",\"value\":\"v\"}]"
assert "R-11 ヘッダー名は大文字小文字を区別しない" 0 "赤信号 0 件" \
  "$CF.change.after.origin[1].custom_header = [{\"name\":\"X-Api-Key\",\"value\":\"v\"}]"
assert "R-11 API オリジンが無い" 1 "R-11" \
  "$CF.change.after.origin = [$CF.change.after.origin[0]]"
assert "R-11 origin が未確定なら警告" 0 "警告   R-11" \
  "$CF.change.after_unknown.origin = true"
assert "R-11 ヘッダーの値だけが未確定でも、名前があれば緑" 0 "赤信号 0 件" \
  "$CF.change.after.origin[1].custom_header = [{\"name\":\"x-api-key\"}] | $CF.change.after_unknown.origin = [{},{\"custom_header\":[{\"value\":true}]}]"

echo
echo "== 未確定値は WARN（緑にも赤にもしない）=="
assert "policy が未確定なら警告" 0 "警告" \
  "$APPLY.change.after.policy = null | $APPLY.change.after_unknown.policy = true"
assert "cache behavior が未確定なら警告" 0 "警告" \
  "$CF.change.after_unknown.default_cache_behavior = true"
assert "公開ブロックが未確定なら警告" 0 "警告" \
  "$PAB.change.after_unknown.block_public_policy = true"

echo
echo "== 削除される差分は赤信号の対象外 =="
assert "delete は無視する" 0 "赤信号 0 件" \
  "$PAB.change.actions = [\"delete\"] | $PAB.change.after = null"

echo
echo "== 複数の赤信号が同時に出る =="
assert "R-1 と R-4 と R-7 が同時" 1 "R-7" \
  "$APPLY.change.after.policy |= (fromjson | .Statement |= map(if .Effect==\"Allow\" then del(.Condition) else . end) | tojson) | $DDB.change.after.policy |= (fromjson | .Statement[0].Action += [\"dynamodb:Scan\"] | tojson) | $PAB.change.after.block_public_acls = false"

echo
echo "== resource_changes が空でも落ちない =="
assert "空の plan" 0 "赤信号 0 件" '.resource_changes = []'

echo
echo "== Issue #20: 認証方式（auth_mode）の plan で、赤信号が出ない（決定 17）=="
# Cognito のリソースを作る plan と、auth-mode の値が変わる plan は、赤信号にしない。
# どの設定の誤りも edge-auth が 503（fail closed）にするので、認証が外れる経路が無い。
# 未知のリソース型や、ignore_changes の無い SSM パラメータで guard が落ちないことも、ここで押さえる。
COGNITO_CREATE='.resource_changes += [
  {"address":"aws_cognito_user_pool.admin[0]","type":"aws_cognito_user_pool","name":"admin","change":{"actions":["create"],"before":null,"after":{"name":"rolust-admins"},"after_unknown":{"id":true,"arn":true}}},
  {"address":"aws_cognito_user_pool_domain.admin[0]","type":"aws_cognito_user_pool_domain","name":"admin","change":{"actions":["create"],"before":null,"after":{"managed_login_version":1},"after_unknown":{"id":true,"domain":true}}},
  {"address":"aws_cognito_user_pool_client.admin[0]","type":"aws_cognito_user_pool_client","name":"admin","change":{"actions":["create"],"before":null,"after":{"generate_secret":false},"after_unknown":{"id":true,"callback_urls":true}}},
  {"address":"aws_ssm_parameter.auth_cognito[0]","type":"aws_ssm_parameter","name":"auth_cognito","change":{"actions":["create"],"before":null,"after":{"name":"/rolust/auth-cognito","type":"String"},"after_unknown":{"value":true,"arn":true}}}
]'
assert "auth_mode=cognito の plan（Cognito と auth-cognito の作成）は緑" 0 "赤信号 0 件" "$COGNITO_CREATE"
assert "auth-mode の値が basic から cognito に変わる plan は緑" 0 "赤信号 0 件" '.resource_changes += [{"address":"aws_ssm_parameter.auth_mode","type":"aws_ssm_parameter","name":"auth_mode","change":{"actions":["update"],"before":{"value":"basic"},"after":{"value":"cognito"},"after_unknown":{}}}]'
assert "auth_mode=basic に戻す plan（Cognito の破棄）は緑" 0 "赤信号 0 件" '.resource_changes += [{"address":"aws_cognito_user_pool.admin[0]","type":"aws_cognito_user_pool","name":"admin","change":{"actions":["delete"],"before":{"name":"rolust-admins"},"after":null,"after_unknown":{}}}]'

echo
echo "==== PASS=$PASS FAIL=$FAIL ===="
[[ "$FAIL" -eq 0 ]]
