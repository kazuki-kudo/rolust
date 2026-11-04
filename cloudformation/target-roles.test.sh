#!/usr/bin/env bash
#
# cloudformation/target-roles.yaml の不変条件の回帰テスト。
#
# なぜ要るか: このテンプレートはターゲットアカウントの権限を決める。plan-guard の R-12 は
# デプロイ先の Terraform だけを見るので、ターゲット側の権限（Reader が書き込めないこと、
# Manager の DenySelfEscalation、書き込みのタグ条件）は、ここで機械的に見張る。
#
# 方式: テンプレートを PyYAML で読み、Ref と Fn::Sub を解決（描画）して、jq で検査する。
# 既定値と、既定値以外（取り違えや固定値の残りを見つけるため）の両方で描画する。
# 実 AWS は要らない。組み込み関数は長い形式（Fn::Sub:・Ref:）で書くこと。
#
# 使い方:
#   ./cloudformation/target-roles.test.sh
#   PYTHON=/path/to/python ./cloudformation/target-roles.test.sh   # PyYAML のある Python を指す
#
# 終了コード: 0 全件パス / 1 失敗あり / 2 前提不足

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE="$HERE/target-roles.yaml"
VARIABLES="$HERE/../infra/variables.tf"
# PyYAML を import できる Python を探す（Issue #199 により 2026-10-25 訂正。訂正前は
# `command -v python3 || command -v python` で、**最初に見つかった方だけ**を試した）。
# Windows の PATH には Microsoft Store のスタブ `python3` が入ることがあり、これは
# 何も実行せずに終わる。先に見つかるだけで採られると、yaml を持つ `python` があっても
# 前提不足（終了コード 2）で止まった。
if [[ -z "${PYTHON:-}" ]]; then
  for candidate in python3 python py; do
    path="$(command -v "$candidate" 2>/dev/null)" || continue
    if "$path" -c 'import yaml' >/dev/null 2>&1; then
      PYTHON="$path"
      break
    fi
  done
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq が必要である" >&2
  exit 2
fi
if [[ -z "${PYTHON:-}" ]] || ! "$PYTHON" -c 'import yaml' >/dev/null 2>&1; then
  echo "PyYAML のある Python が必要である（pip install cfn-lint で入る。PYTHON= で指す）" >&2
  exit 2
fi
if [[ ! -f "$TEMPLATE" || ! -f "$VARIABLES" ]]; then
  echo "target-roles.yaml または infra/variables.tf が見つからない" >&2
  exit 2
fi

# render <key=value>... : Ref と Fn::Sub を解決した Resources と、素の Parameters・Rules を JSON で出す。
# 出力は ASCII のみ（ensure_ascii の既定）。Windows の Python は標準出力が cp932 で、日本語を UTF-8 で
# 出せず、jq が読めなくなるため。
render() {
  "$PYTHON" - "$TEMPLATE" "$@" <<'PY'
import json, re, sys, yaml

with open(sys.argv[1], encoding="utf-8") as f:
    tpl = yaml.safe_load(f)

params = {k: v["Default"] for k, v in tpl["Parameters"].items() if "Default" in v}
params["DeployAccountId"] = "111122223333"
params["AWS::Partition"] = "aws"
params["AWS::AccountId"] = "999999999999"
for kv in sys.argv[2:]:
    k, v = kv.split("=", 1)
    params[k] = v

def sub(s):
    return re.sub(r"\$\{([^}]+)\}", lambda m: str(params[m.group(1)]), s)

def walk(n):
    if isinstance(n, dict):
        if set(n) == {"Ref"}:
            return params[n["Ref"]]
        if set(n) == {"Fn::Sub"}:
            return sub(n["Fn::Sub"])
        return {k: walk(v) for k, v in n.items()}
    if isinstance(n, list):
        return [walk(v) for v in n]
    return n

res = walk(tpl["Resources"])
for r in res.values():
    for p in r["Properties"].get("Policies", []):
        if isinstance(p["PolicyDocument"], str):
            p["PolicyDocument"] = json.loads(p["PolicyDocument"])

json.dump({"resources": res, "parameters": tpl["Parameters"], "rules": tpl.get("Rules", {})}, sys.stdout)
PY
}

# tf_default <変数名> : infra/variables.tf の default を読む（CRLF を除く）。
tf_default() {
  tr -d '\r' < "$VARIABLES" | awk -v v="$1" '
    $0 ~ "^variable \"" v "\"" { f = 1 }
    f && /^[[:space:]]*default[[:space:]]*=/ { sub(/^[^"]*"/, ""); sub(/".*$/, ""); print; exit }'
}

PASS=0
FAIL=0

# check <名前> <jq の式> <描画の JSON> : 式が true を返せばパス。
check() {
  local name="$1" expr="$2" json="$3"
  if jq -e "$expr" <<<"$json" >/dev/null 2>&1; then
    echo "  PASS $name"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $name"
    FAIL=$((FAIL + 1))
  fi
}

SAMPLE="$(render ProjectName=acme ManagedTagKey=acme:managed ManagedTagValue=yes \
  ReaderRoleName=AcmeReader ManagerRoleName=AcmeManager)" || { echo "描画に失敗した" >&2; exit 1; }
DEFAULTS="$(render)" || { echo "既定値での描画に失敗した" >&2; exit 1; }

echo "== 非既定値での描画 =="
ARN='arn:aws:iam::111122223333:role'
check "Reader のロール名がパラメータどおり" '.resources.Reader.Properties.RoleName == "AcmeReader"' "$SAMPLE"
check "Manager のロール名がパラメータどおり" '.resources.Manager.Properties.RoleName == "AcmeManager"' "$SAMPLE"
check "Reader を引き受けられるのは crud と diff の実行ロールだけ" \
  "[.resources.Reader.Properties.AssumeRolePolicyDocument.Statement[].Principal.AWS] | flatten | sort == [\"$ARN/acme-crud-exec\", \"$ARN/acme-diff-exec\"]" "$SAMPLE"
check "Manager を引き受けられるのは apply の実行ロールだけ" \
  "[.resources.Manager.Properties.AssumeRolePolicyDocument.Statement[].Principal.AWS] | flatten == [\"$ARN/acme-apply-exec\"]" "$SAMPLE"
check "Reader は iam:UpdateAssumeRolePolicy を持たない（FR-3.2）" \
  '[.resources.Reader.Properties.Policies[].PolicyDocument.Statement[] | select(.Effect == "Allow") | (.Action | if type == "array" then . else [.] end)[] | ascii_downcase] | (index("iam:updateassumerolepolicy") == null) and (map(contains("*")) | any | not)' "$SAMPLE"
check "Manager の GetRole と UpdateAssumeRolePolicy の Allow は、すべて管理対象タグの条件つき" \
  '[.resources.Manager.Properties.Policies[].PolicyDocument.Statement[] | select(.Effect == "Allow")] | length >= 2 and all(.Condition.StringEquals["aws:ResourceTag/acme:managed"] == "yes")' "$SAMPLE"
check "Reader の GetRole の Allow は管理対象タグの条件つき" \
  '.resources.Reader.Properties.Policies[].PolicyDocument.Statement[] | select(.Action == "iam:GetRole") | .Condition.StringEquals["aws:ResourceTag/acme:managed"] == "yes"' "$SAMPLE"
check "Manager に DenySelfEscalation があり、Reader と Manager の両方を含む" \
  '.resources.Manager.Properties.Policies[].PolicyDocument.Statement[] | select(.Sid == "DenySelfEscalation") | (.Effect == "Deny") and (.Action == "iam:UpdateAssumeRolePolicy") and ((.Resource | sort) == ["arn:aws:iam::999999999999:role/AcmeManager", "arn:aws:iam::999999999999:role/AcmeReader"])' "$SAMPLE"
# インラインポリシー名（rolust-reader・rolust-manager）は、旧 README と同じ正当な固定値である。
check "固定値（rolust）が残っていない（インラインポリシー名を除く）" \
  '[.resources | .. | strings | select(test("rolust|Rolust")) | select(. != "rolust-reader" and . != "rolust-manager")] == []' "$SAMPLE"

echo "== 既定値での描画（Terraform の既定値と一致するか） =="
check "ProjectName の既定値が Terraform の project_name と同じ" \
  ".parameters.ProjectName.Default == \"$(tf_default project_name)\"" "$DEFAULTS"
check "ManagedTagKey の既定値が managed_tag_key と同じ" \
  ".parameters.ManagedTagKey.Default == \"$(tf_default managed_tag_key)\"" "$DEFAULTS"
check "ManagedTagValue の既定値が managed_tag_value と同じ" \
  ".parameters.ManagedTagValue.Default == \"$(tf_default managed_tag_value)\"" "$DEFAULTS"
check "ReaderRoleName の既定値が target_reader_role_name と同じ" \
  ".parameters.ReaderRoleName.Default == \"$(tf_default target_reader_role_name)\"" "$DEFAULTS"
check "ManagerRoleName の既定値が target_manager_role_name と同じ" \
  ".parameters.ManagerRoleName.Default == \"$(tf_default target_manager_role_name)\"" "$DEFAULTS"

echo "== パラメータの制約 =="
check "DeployAccountId は必須で 12 桁に限る" \
  '(.parameters.DeployAccountId | has("Default") | not) and (.parameters.DeployAccountId.AllowedPattern == "^[0-9]{12}$")' "$DEFAULTS"
check "Reader と Manager は同じ名前にできない" '.rules | has("DistinctRoleNames")' "$DEFAULTS"

# タグのキーと値は、ポリシーの JSON 文字列に埋め込まれる。引用符・バックスラッシュ・改行を許すと、
# JSON が壊れる、または別の条件を注入できる。AllowedPattern の文字列ではなく、実際の挙動で確かめる。
pattern_rejects() {
  "$PYTHON" - "$TEMPLATE" "$1" <<'PY'
import re, sys, yaml
with open(sys.argv[1], encoding="utf-8") as f:
    tpl = yaml.safe_load(f)
p = re.compile(tpl["Parameters"][sys.argv[2]]["AllowedPattern"])
bad = ['a"b', 'a\\b', 'a\nb', 'a","b']
ok = ["rolust:managed", "acme/x_y-z.1", "true"]
sys.exit(0 if all(not p.match(b) for b in bad) and all(p.match(o) for o in ok) else 1)
PY
}
for name in ManagedTagKey ManagedTagValue; do
  if pattern_rejects "$name"; then
    echo "  PASS $name は JSON を壊す文字を許さない"
    PASS=$((PASS + 1))
  else
    echo "  FAIL $name は JSON を壊す文字を許さない"
    FAIL=$((FAIL + 1))
  fi
done

echo
echo "パス $PASS / 失敗 $FAIL"
[[ "$FAIL" -eq 0 ]]
