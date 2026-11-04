#!/usr/bin/env bash
#
# terraform plan の差分から「承認せず差し戻す」差分（赤信号 R-1〜R-12）を機械的に探す。
#
# 設計と各シグナルの根拠は下記にある。
#   docs/design/cicd-pipeline.md
#     § 承認者のための plan 読み方
#
# なぜ機械化するか: IAM ポリシーは terraform plan の出力で JSON 文字列 1 行として
# 差分表示され、目視で差を見つけにくい。承認者の注意力に依存する統制は、
# 承認が日常化したときに最初に失われる。
#
# 使い方:
#   terraform plan -out=tfplan
#   terraform show -json tfplan > plan.json
#   ./.github/scripts/plan-guard.sh plan.json
#
# 反映は `docs/guide/` の手動経路（setup.md・operations.md）で行い、apply する者が
# このスクリプトを自分の plan に走らせ、赤信号があれば apply しない
# （docs/design/cd-config.md D-7。CD は持たない。D-8）。
#
# 終了コード:
#   0  赤信号なし（警告は出ていることがある）
#   1  赤信号あり。apply してはならない
#   2  使い方の誤り、または plan JSON を読めない
#
# 未知値の扱い: plan の時点で値が確定しない属性（初回 apply でのリソース新規作成など)
# は WARN として出し、緑にはしない。「見えなかった」を「問題なし」と取り違えると、
# 検査していない差分を検査済みとして通すことになる。

set -euo pipefail

usage() {
  echo "usage: $0 <plan.json>" >&2
  echo "  plan.json は 'terraform show -json <planfile>' の出力" >&2
}

if [[ $# -ne 1 ]]; then
  usage
  exit 2
fi

PLAN_JSON="$1"

if [[ ! -f "$PLAN_JSON" ]]; then
  echo "plan JSON が見つからない: $PLAN_JSON" >&2
  exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "jq が必要である（このスクリプトは plan JSON を jq で読む）" >&2
  exit 2
fi

if ! jq -e 'type == "object"' "$PLAN_JSON" >/dev/null 2>&1; then
  echo "plan JSON として読めない: $PLAN_JSON" >&2
  exit 2
fi

# 検査本体。1 行 1 件の "SEVERITY|CODE|address|detail" を出す。
#
# SEVERITY は RED（差し戻す）と WARN（plan 時点で値が確定せず検査できなかった）の 2 つ。
# jq のプログラムは、コマンドライン引数ではなく一時ファイルで渡す（jq -f）。
# Windows の Git Bash では、ネイティブの jq に渡せるコマンドラインが約 32KB に限られ、
# プログラムが育つと「Argument list too long」で全件が落ちる（Issue #85 の R-12 の強化で実際に起きた）。
# 手順書の apply 前の検査（`docs/guide/` の手順書・実測の手順書）は Git Bash で走らせるので、CI（Linux）で通るだけでは足りない。
JQ_PROGRAM="$(mktemp -t plan-guard-jq.XXXXXX)"
trap 'rm -f "$JQ_PROGRAM"' EXIT
cat > "$JQ_PROGRAM" <<'JQ_PROGRAM_EOF'
    # 文字列でも配列でも配列にそろえる（IAM の Action / Resource はどちらもありうる）。
    def as_array: if . == null then [] elif type == "array" then . else [.] end;

    # ポリシー文書は JSON 文字列として入っている。壊れていれば null を返す。
    def policy_doc($v): if $v == null then null else (try ($v | fromjson) catch null) end;

    def statements($doc): if $doc == null then [] else ($doc.Statement | as_array) end;

    # 対象リソースを address の前方一致で拾う（for_each のインデックス付きに対応）。
    def is_addr($base): (.address == $base) or (.address | startswith($base + "["));

    # 削除される差分は赤信号の対象外（消える権限は広がらない）。
    def not_deleting: (.change.actions | index("delete") | not) or (.change.actions | index("create") != null);

    # タグ条件の値がワイルドカードを含むか。含むなら「タグキーさえ在れば値を問わない」
    # のと同じであり、絞り込みとして機能しない。
    def has_wildcard: (type == "string") and (test("[*?]"));

    # Condition.StringEquals をオブジェクトとして取り出す。Condition が無い、
    # StringEquals が無い、オブジェクトでない、のいずれも {} に潰す。
    def string_equals: (.Condition.StringEquals // {}) | if type == "object" then . else {} end;

    # IAM の Resource の glob（* と ?）で $s に完全一致するか。入力がパターン。
    def glob_match($s):
      ("^" + (gsub("(?<c>[.+^$(){}\\[\\]|\\\\])"; "\\\(.c)") | gsub("\\*"; ".*") | gsub("\\?"; ".")) + "$") as $re
      | ($s | test($re));

    # 期待するタグキー / 値は plan JSON の variables から読む。ガード側に二重定義しない
    # （terraform show -json の出力は plan の variables を含む）。読めなければ $tagkey は
    # null になり、R-1 は RED を出す（後段の elif を参照）。
    ((.variables.managed_tag_key.value?) as $k
      | if ($k | type) == "string" and ($k | length) > 0 then $k else null end) as $tagkey
    | ((.variables.managed_tag_value.value?) as $v
      | if ($v | type) == "string" and ($v | length) > 0 then $v else null end) as $tagval
    # R-12 の突き合わせ先: 引き受けてよい Reader / Manager のロール名。読めなければ null になり、
    # R-12 は RED を出す（判定基準が無いまま通さない。R-1 と同じ扱い）。
    | ((.variables.target_reader_role_name.value?) as $r
      | if ($r | type) == "string" and ($r | length) > 0 then $r else null end) as $reader_name
    | ((.variables.target_manager_role_name.value?) as $m
      | if ($m | type) == "string" and ($m | length) > 0 then $m else null end) as $manager_name
    # R-12 が、3 つのポリシーの role 属性（付く先の実行ロール）を突き合わせるための project_name。
    # 実行ロールの名前は <project_name>-{crud,diff,apply}-exec（infra/main.tf）。読めなければ null で、R-12 は RED を出す。
    | ((.variables.project_name.value?) as $pn
      | if ($pn | type) == "string" and ($pn | length) > 0 then $pn else null end) as $project_name

    # R-10 の突き合わせ先: apply_iam_write の DenySelfEscalation の Resource（文字列の配列）。
    # ポリシーが plan に無い・削除される・未確定・Deny が無い、のいずれも null にする。
    # 無い・削除されるなら UpdateAssumeRolePolicy の Allow も無く、未確定と Deny の消失は
    # R-2 が WARN / RED を出すので、R-10 は重ねて出さない。
    | ([ .resource_changes // [] | .[]
         | select(is_addr("aws_iam_role_policy.apply_iam_write"))
         | select(not_deleting)
         | policy_doc(.change.after.policy)
         | select(. != null)
         | [ statements(.)[] | select(.Sid == "DenySelfEscalation" and .Effect == "Deny") ]
         | select(length > 0)
         | [ .[0].Resource | as_array | .[] | select(type == "string") ]
       ] | first // null) as $selfdeny
    |
    [
      .resource_changes // [] | .[]
      | select(not_deleting)
      | . as $rc
      | $rc.change.after as $after
      | $rc.change.before as $before
      | ($rc.change.after_unknown // {}) as $unknown

      | (
        # ---- R-1 / R-3: Rolust の IAM ポリシー 3 本（Diff・Apply・CRUD の信頼ポリシーの読み取り）の Allow が広がっていないか ----
        # Issue #80: CRUD の `crud_iam_read_trust`（紐づけ時に信頼ポリシーを読む）を対象に加えた。
        (
          select(is_addr("aws_iam_role_policy.diff_iam_read") or is_addr("aws_iam_role_policy.apply_iam_write") or is_addr("aws_iam_role_policy.crud_iam_read_trust"))
          | policy_doc($after.policy) as $doc
          | if $doc == null then
              (if ($unknown.policy // false) then
                 ["WARN|R-1/R-3|\($rc.address)|policy が plan 時点で未確定のため Allow の範囲を検査できなかった"]
               else
                 ["WARN|R-1/R-3|\($rc.address)|policy を JSON として読めず検査できなかった"]
               end)
            elif $tagkey == null then
              # ここだけは WARN にしない（ci-pipeline 再実行 2026-08-29 の Q6 = B）。
              # タグ方式では Resource = role/* が正常な形であり、期待するタグキーが
              # 分からないと「タグで正しく絞られている」と「事実上の無条件」を機械では
              # 区別できない。判定基準を得られないまま通すのは無検査と同じである。
              # ファイル冒頭の「未知値は WARN」方針からの意図的な逸脱である。
              ["RED|R-1|\($rc.address)|期待するタグキーを plan JSON の variables.managed_tag_key から読めず、Allow がタグで絞られているかを判定できなかった — 判定基準が無いまま apply させない（cicd-pipeline.md § R-1 の判定基準）"]
            else
              (
                # R-1: Allow の到達範囲が管理対象タグで絞られていない
                #
                # **判定するのは `Resource` の形ではなく到達範囲である。**
                # タグ方式（infrastructure-design 3.4 の再実行、2026-08-24）では
                # `Resource = role/*` が正常な形になり、絞り込みは `Condition` の
                # `aws:ResourceTag/<key>` が担う。「Resource が role/* なら RED」のままでは、
                # 正しい設計を差し戻す誤検知になる。統制の意図（到達範囲が広がっていないか）と
                # その実装（Resource の形）を取り違えると、絞り込みの表現場所が移った瞬間に
                # 統制は誤検知へ変わる。
                #
                # 緑の条件は「`aws:ResourceTag/<managed_tag_key の値>` に対する
                # `StringEquals` であり、値にワイルドカードを含まないこと」。
                # **「条件が付いていれば緑」では不足である** — 在るが効かない形が 3 つある:
                #   1. キーが managed_tag_key の値と異なる（別のタグで絞っている）
                #   2. 演算子が StringEquals 以外（StringLike はワイルドカードが一致しうる）
                #   3. 値が * などのワイルドカード（タグキーさえ在れば値を問わない）
                [ statements($doc)[]
                  | select(.Effect == "Allow")
                  | . as $st
                  | select([ ($st.Resource | as_array)[]
                             | select(type == "string" and (test(":role/\\*$"))) ] | length > 0)
                  | ($st | string_equals) as $eq
                  | ("aws:ResourceTag/" + $tagkey) as $ck
                  | ($st.Sid // "(Sid なし)") as $sid
                  | if ($eq | has($ck) | not) then
                      "RED|R-1|\($rc.address)|Sid: \($sid) の Allow が Resource = role/*（アカウント内の全ロール）でありながら、Condition の StringEquals に \($ck) が無い — 到達範囲が管理対象タグで絞られていない（別キー、または StringEquals 以外の演算子）"
                    elif ([ ($eq[$ck] | as_array)[] | select(has_wildcard) ] | length > 0) then
                      "RED|R-1|\($rc.address)|Sid: \($sid) の \($ck) の値にワイルドカードが含まれる（\($eq[$ck] | tostring)） — タグキーさえ在れば値を問わず、事実上の無条件である"
                    elif ($tagval != null and ([ ($eq[$ck] | as_array)[] | select(. == $tagval) ] | length == 0)) then
                      "WARN|R-1|\($rc.address)|Sid: \($sid) の \($ck) の値が \($eq[$ck] | tostring) で、variables.managed_tag_value（\($tagval)）と一致しない — 絞り込みは効くが、宣言された管理対象集合とは別の集合を指している"
                    else
                      empty
                    end
                ]
                +
                # R-3: 一覧取得・実在検証の API が増えた（FR-5.7 / C-4）
                [ statements($doc)[]
                  | select(.Effect == "Allow")
                  | (.Action | as_array)[]
                  | select(type == "string")
                  | select(test("^(iam:(ListRoles|ListUsers|GetUser)|iam:\\*|\\*)$"))
                  | "RED|R-3|\($rc.address)|Allow の Action に \(.) が含まれる — FR-5.7 / C-4（AWS からの一覧取得・実在検証は行わない）に反する"
                ]
              )
            end
        )
        //empty
      ),
      (
        # ---- R-9: CRUD の IAM ポリシーが、設計の Action 単体か ----
        #
        # Issue #80: 対象を 2 つに広げた。`crud_iam_read_tags` は iam:ListRoleTags 単体、
        # `crud_iam_read_trust`（紐づけ時に信頼ポリシーを読む）は iam:GetRole 単体。
        # CRUD が持ってよい IAM の Action は、この 2 つのそれぞれ 1 つだけである。
        # `crud_iam_read_trust` はタグ条件つきなので R-1 も当たるが、Action の範囲（iam:UpdateAssumeRolePolicy が
        # 紛れ込むなど）は R-1 では見えないので、ここで見る。
        #
        # `crud_iam_read_tags` はタグ方式移行（3.4 再実行の RQ-4 = A / RQ-6 = A）で新設された。
        # **R-1 と判定基準が異なるため番号を分けてある。** `Resource = role/*` を
        # **条件なしで**取るのが設計であり（タグを見る前に対象を絞れないため）、
        # R-1 の基準を当てると常に RED になる。ここで検査すべきは Action の範囲である。
        #
        # 無条件で role/* に届く以上、Action が広がるとアカウント内の全ロールに対して
        # その操作ができる。`crud_iam_read_tags` が持ってよいのは iam:ListRoleTags 単体だけである。
        (
          select(is_addr("aws_iam_role_policy.crud_iam_read_tags") or is_addr("aws_iam_role_policy.crud_iam_read_trust"))
          | (if is_addr("aws_iam_role_policy.crud_iam_read_trust") then "iam:GetRole" else "iam:ListRoleTags" end) as $want
          | policy_doc($after.policy) as $doc
          | if $doc == null then
              (if ($unknown.policy // false) then
                 ["WARN|R-9|\($rc.address)|policy が plan 時点で未確定のため Action を検査できなかった"]
               else
                 ["WARN|R-9|\($rc.address)|policy を JSON として読めず検査できなかった"]
               end)
            else
              [ statements($doc)[]
                | select(.Effect == "Allow")
                | . as $st
                | ($st.Action | as_array) as $acts
                | select($acts != [$want])
                | "RED|R-9|\($rc.address)|Allow の Action が \($acts | tostring) — このポリシーは \($want) 単体であることが設計（iam-policy-design-note.md 3.9・3.10）。Resource = role/* に届くため、Action が広がるとアカウント内のロールに対してその操作ができ、FR-3.2（CRUD は AWS へ書き込まない）の保証も外れうる"
              ]
            end
        )
        //empty
      ),
      (
        # ---- R-2: DenySelfEscalation が消えていないか / 対象が減っていないか ----
        (
          select(is_addr("aws_iam_role_policy.apply_iam_write"))
          | policy_doc($after.policy) as $doc
          | policy_doc($before.policy) as $bdoc
          | if $doc == null then
              ["WARN|R-2|\($rc.address)|policy が plan 時点で未確定のため DenySelfEscalation を検査できなかった"]
            else
              ( [ statements($doc)[] | select(.Sid == "DenySelfEscalation" and .Effect == "Deny") ] ) as $deny
              | ( [ statements($bdoc)[] | select(.Sid == "DenySelfEscalation" and .Effect == "Deny") ] ) as $bdeny
              | if ($deny | length) == 0 then
                  ["RED|R-2|\($rc.address)|Sid: DenySelfEscalation の Deny が無い — 自己昇格の閉路が開く（infra/lambda.tf L103-108）"]
                elif ($bdeny | length) > 0
                     and (([$deny[0].Resource | as_array] | flatten | length) < ([$bdeny[0].Resource | as_array] | flatten | length)) then
                  ["RED|R-2|\($rc.address)|DenySelfEscalation の Resource が \(([$bdeny[0].Resource | as_array] | flatten | length)) 件から \(([$deny[0].Resource | as_array] | flatten | length)) 件に減っている — 保護されない自ロールができる"]
                else
                  []
                end
            end
        )
        //empty
      ),
      (
        # ---- R-10: plan 内の全 aws_iam_role が DenySelfEscalation に含まれるか ----
        #
        # R-2 は Deny の件数が減ったことしか見ない。ロールを増やして self_role_arns に
        # 加え忘れると件数は減らないまま、タグさえ付けばそのロールの信頼ポリシーを
        # Rolust 経由で書き換えられる。タグ方式では Deny が単層の最終防衛線である。
        #
        # 新規作成のロールは arn が plan 時点で未確定なので、name と path で識別し、
        # Deny の各 ARN の ":role" より後ろ（/path/name）と glob で照合する。
        # Deny 側のワイルドカード（role/rolust-* など）は実際に保護が効くので覆うとみなす。
        (
          select($selfdeny != null)
          | select($rc.type == "aws_iam_role")
          | if (($after.name? | type) != "string") or ($unknown.name // false) or ($unknown.path // false) then
              ["WARN|R-10|\($rc.address)|ロール名または path が plan 時点で未確定のため、DenySelfEscalation に含まれるかを検査できなかった"]
            else
              ((($after.path // "/") | if type == "string" then . else "/" end) + $after.name) as $key
              | if ([ $selfdeny[]
                      | if . == "*" then "*"
                        elif test(":role/") then sub("^.*?:role"; "")
                        else empty end
                      | select(glob_match($key)) ] | length) > 0 then
                  []
                else
                  ["RED|R-10|\($rc.address)|ロール \($key) が DenySelfEscalation の Resource に含まれない — タグが付けば、このロールの信頼ポリシーを Rolust 経由で書き換えられる（infra/main.tf の self_role_arns に加える）"]
                end
            end
        )
        //empty
      ),
      (
        # ---- R-12: 別アカウントへの sts:AssumeRole の到達範囲（Issue #85）----
        #
        # Lambda の実行ロールが別アカウントのロールを引き受けられる範囲を、この 3 つのポリシーだけに閉じる。
        #   crud_assume_target_reader・diff_assume_target_reader: Reader だけ（読み取り専用）
        #   apply_assume_target_manager: Manager だけ（信頼ポリシーの更新）
        # Reader と Manager の取り違えは、CRUD・Diff に書き込み権限を渡す（FR-3.2 の保証が外れる）。
        # Resource は arn:<partition>:iam::<12 桁または *>:role/<固定名> の 1 件だけを許す。
        # アカウントの部分は * を取れる（開けるかどうかはターゲット側の信頼ポリシーが決める。spec D-5）が、
        # ロール名の部分にワイルドカードやパスを含めない。ターゲット側（手動）のロールの中身は検査しない。
        (
          select(is_addr("aws_iam_role_policy.crud_assume_target_reader") or is_addr("aws_iam_role_policy.diff_assume_target_reader") or is_addr("aws_iam_role_policy.apply_assume_target_manager"))
          | (if is_addr("aws_iam_role_policy.apply_assume_target_manager") then "Manager" else "Reader" end) as $tier
          | (if $tier == "Manager" then $manager_name else $reader_name end) as $want
          # このポリシーが付く実行ロール。crud・diff の実行ロールには Reader、apply の実行ロールには Manager だけ。
          | (if is_addr("aws_iam_role_policy.apply_assume_target_manager") then "apply"
             elif is_addr("aws_iam_role_policy.crud_assume_target_reader") then "crud"
             else "diff" end) as $sys
          | ($after.role? // null) as $role
          | policy_doc($after.policy) as $doc
          # role 属性の突き合わせ: 別の実行ロールに付けると、引き受けられるロールが入れ替わる
          # （例: crud の実行ロールに Manager のポリシーを付けると、CRUD が書き込める）。
          | (if ($unknown.role // false) then
               ["WARN|R-12|\($rc.address)|role が plan 時点で未確定のため、どの実行ロールに付くかを検査できなかった"]
             elif $project_name == null then
               ["RED|R-12|\($rc.address)|期待する実行ロールの名前を plan JSON の variables.project_name から読めず、role 属性を判定できなかった — 判定基準が無いまま apply させない"]
             elif $role != ($project_name + "-" + $sys + "-exec") then
               ["RED|R-12|\($rc.address)|role が \($role | tostring) — このポリシーが付いてよいのは \($project_name)-\($sys)-exec（\($sys) の実行ロール）だけ。別の実行ロールに付けると、引き受けられるロールが入れ替わる"]
             else [] end) as $role_findings
          | $role_findings + (
            if $doc == null then
              (if ($unknown.policy // false) then
                 ["WARN|R-12|\($rc.address)|policy が plan 時点で未確定のため sts:AssumeRole の到達範囲を検査できなかった"]
               else
                 ["WARN|R-12|\($rc.address)|policy を JSON として読めず検査できなかった"]
               end)
            elif $want == null then
              ["RED|R-12|\($rc.address)|期待する \($tier) のロール名を plan JSON の variables から読めず、sts:AssumeRole の Resource を判定できなかった — 判定基準が無いまま apply させない"]
            else
              [ statements($doc)[]
                | select(.Effect == "Allow")
                | . as $st
                | ($st.Sid // "(Sid なし)") as $sid
                | ($st.Action | as_array) as $acts
                | ($st.Resource | as_array) as $res
                | if ($st | has("NotAction") or has("NotResource")) then
                    "RED|R-12|\($rc.address)|Sid: \($sid) の Allow に NotAction / NotResource がある — 「指定した以外の全部」を許す形で、sts:AssumeRole の到達範囲を固定できない"
                  elif $acts != ["sts:AssumeRole"] then
                    "RED|R-12|\($rc.address)|Sid: \($sid) の Action が \($acts | tostring) — このポリシーは sts:AssumeRole 単体であることが設計（iam-policy-design-note.md 3.3）"
                  elif ($res | length) != 1 or (($res[0] | type) != "string") then
                    "RED|R-12|\($rc.address)|Sid: \($sid) の Resource が 1 件の文字列でない（\($res | tostring)） — 引き受けてよいロールは \($tier)（\($want)）だけ"
                  elif ($res[0] | test("^arn:[^:]+:iam::(\\*|[0-9]{12}):role/[A-Za-z0-9+=,.@_-]+$") | not) then
                    "RED|R-12|\($rc.address)|Sid: \($sid) の Resource が \($res[0]) — ロール名にワイルドカードやパスを含む、または形式が違う。ワイルドカードを取れるのはアカウントの部分だけ"
                  elif ($res[0] | sub("^.*:role/"; "")) != $want then
                    "RED|R-12|\($rc.address)|Sid: \($sid) の Resource が \($res[0]) — このポリシーが引き受けてよいのは \($tier)（\($want)）だけ。Reader と Manager の取り違えは、CRUD・Diff に書き込み権限を渡す"
                  else
                    empty
                  end
              ]
            end
          )
        )
        //empty
      ),
      (
        # ---- R-12(d): 上の 3 つ以外の IAM ポリシーに sts の Action が現れないか ----
        # sts:AssumeRole を持ってよいのは上の 3 つのポリシーだけである。ほかのポリシーに紛れ込むと、
        # R-12 の範囲の外で、別のロールを引き受けられる。
        (
          select($rc.type == "aws_iam_role_policy")
          | select((is_addr("aws_iam_role_policy.crud_assume_target_reader") or is_addr("aws_iam_role_policy.diff_assume_target_reader") or is_addr("aws_iam_role_policy.apply_assume_target_manager")) | not)
          | policy_doc($after.policy) as $doc
          | if $doc == null then
              (if ($unknown.policy // false) then
                 ["WARN|R-12|\($rc.address)|policy が plan 時点で未確定のため sts の Action を検査できなかった"]
               else
                 ["WARN|R-12|\($rc.address)|policy を JSON として読めず、sts の Action を検査できなかった"]
               end)
            else
              [ statements($doc)[]
                | select(.Effect == "Allow")
                # NotAction の Allow は「指定した以外の全 Action」を許すので、sts:AssumeRole を含む。
                | (if has("NotAction") then
                     "RED|R-12|\($rc.address)|Allow に NotAction がある — 指定した以外の全 Action（sts:AssumeRole を含む）を許すため、R-12 の範囲の外で別のロールを引き受けられる"
                   else empty end),
                  # IAM の Action 名は大文字小文字を区別しない（STS:AssumeRole は sts:AssumeRole と同じ権限になる）。
                  ((.Action | as_array)[]
                    | select(type == "string")
                    | select(ascii_downcase | test("^(sts:.*|\\*)$"))
                    | "RED|R-12|\($rc.address)|Allow の Action に \(.) が含まれる — sts:AssumeRole を持ってよいのは crud_assume_target_reader・diff_assume_target_reader・apply_assume_target_manager の 3 ポリシーだけである（iam-policy-design-note.md 3.3）")
              ]
            end
        )
        //empty
      ),
      (
        # ---- R-12(e): 実行ロールへの管理ポリシーのアタッチと、インラインポリシーの追加 ----
        #
        # 実行ロール = 名前が -exec で終わるロール（<project>-crud-exec・-diff-exec・-apply-exec・-edge-auth-exec）。
        # アタッチした管理ポリシーや、aws_iam_role の inline_policy / managed_policy_arns の中身は、R-12 が読めない。
        # sts:AssumeRole を含む管理ポリシーを付けられると、上の 3 ポリシーの外で別のロールを引き受けられる。
        # 変更（create・update）だけを見る。変更のないもの（状態の読み直しの値）は、権限の増加ではない。
        # Rolust が作るロールのうち、実行ロールでないもの（API Gateway のログ用ロール）へのアタッチは対象外。
        (
          select($rc.type == "aws_iam_role_policy_attachment" or $rc.type == "aws_iam_policy_attachment" or $rc.type == "aws_iam_role")
          | select(.change.actions | (index("create") != null) or (index("update") != null))
          | if $rc.type == "aws_iam_role_policy_attachment" then
              if ($unknown.role // false) then
                ["WARN|R-12|\($rc.address)|アタッチ先の role が plan 時点で未確定のため、実行ロールに付くかを検査できなかった"]
              elif (($after.role? | type) == "string") and ($after.role | test("-exec$")) then
                ["RED|R-12|\($rc.address)|実行ロール \($after.role) に管理ポリシー \($after.policy_arn // "(未確定)") をアタッチする — ポリシーの中身を R-12 が検査できない。sts:AssumeRole を持ってよいのは 3 ポリシーだけ（iam-policy-design-note.md 3.3）"]
              else [] end
            elif $rc.type == "aws_iam_policy_attachment" then
              if ($unknown.roles // false) then
                ["WARN|R-12|\($rc.address)|アタッチ先の roles が plan 時点で未確定のため、実行ロールに付くかを検査できなかった"]
              else
                [ ($after.roles? | as_array)[] | select(type == "string" and test("-exec$"))
                  | "RED|R-12|\($rc.address)|実行ロール \(.) に管理ポリシー \($after.policy_arn // "(未確定)") をアタッチする — ポリシーの中身を R-12 が検査できない。sts:AssumeRole を持ってよいのは 3 ポリシーだけ（iam-policy-design-note.md 3.3）" ]
              end
            else
              # aws_iam_role: 実行ロールの inline_policy / managed_policy_arns が、変更の前より増えた（または変わった）か。
              if (($after.name? | type) == "string") and ($after.name | test("-exec$")) then
                [ ("inline_policy", "managed_policy_arns") as $attr
                  | (($after[$attr]? // []) | as_array) as $now
                  | (($before[$attr]? // []) | as_array) as $was
                  | select(($now | length) > 0 and $now != $was)
                  | "RED|R-12|\($rc.address)|実行ロール \($after.name) の \($attr) が変わる — ポリシーの中身を R-12 が検査できない。sts:AssumeRole を持ってよいのは 3 ポリシーだけ（iam-policy-design-note.md 3.3）" ]
              else [] end
            end
        )
        //empty
      ),
      (
        # ---- R-4: DynamoDB に Scan が増えていないか（NFR-1 / NFR-2 の構造的担保） ----
        (
          select(is_addr("aws_iam_role_policy.lambda_dynamodb"))
          | policy_doc($after.policy) as $doc
          | if $doc == null then
              ["WARN|R-4|\($rc.address)|policy が plan 時点で未確定のため dynamodb:Scan を検査できなかった"]
            else
              [ statements($doc)[]
                | select(.Effect == "Allow")
                | (.Action | as_array)[]
                | select(type == "string")
                | select(test("^(dynamodb:Scan|dynamodb:\\*|\\*)$"))
                | "RED|R-4|\($rc.address)|Allow の Action に \(.) が含まれる — NFR-1 / NFR-2 の構造的担保が外れる（infra/main.tf L56-57）"
              ]
            end
        )
        //empty
      ),
      (
        # ---- R-5 / R-6: CloudFront ----
        (
          select(is_addr("aws_cloudfront_distribution.rolust"))
          | (
            # R-5: Basic 認証（Lambda@Edge の viewer-request）が default と /api/* の双方に付いているか
            (
              if $after == null then
                ["WARN|R-5|\($rc.address)|after が無く lambda_function_association を検査できなかった"]
              else
                (
                  [ ($after.default_cache_behavior | as_array)[]
                    | (.lambda_function_association | as_array)[]
                    | select(.event_type == "viewer-request") ] | length
                ) as $default_auth
                | (
                  [ ($after.ordered_cache_behavior | as_array)[]
                    | select(.path_pattern == "/api/*")
                    | (.lambda_function_association | as_array)[]
                    | select(.event_type == "viewer-request") ] | length
                ) as $api_auth
                | (
                  if ($unknown.default_cache_behavior // false) or ($unknown.ordered_cache_behavior // false) then
                    ["WARN|R-5|\($rc.address)|cache behavior が plan 時点で未確定のため Basic 認証の関連付けを検査できなかった"]
                  else
                    (if $default_auth == 0 then
                       ["RED|R-5|\($rc.address)|default_cache_behavior に viewer-request の Lambda@Edge が無い — Basic 認証が外れる（FR-6.1 違反）"]
                     else [] end)
                    +
                    (if $api_auth == 0 then
                       ["RED|R-5|\($rc.address)|/api/* の ordered_cache_behavior に viewer-request の Lambda@Edge が無い — API が認証なしで到達可能になる（FR-6.1 違反）"]
                     else [] end)
                  end
                )
              end
            )
            +
            # R-6: カスタムエラー応答に 404 が増えていないか
            (
              if $after == null then
                []
              else
                [ ($after.custom_error_response | as_array)[]
                  | select((.error_code | tostring) == "404")
                  | "RED|R-6|\($rc.address)|custom_error_response に error_code 404 がある — API の正当な 404 が index.html に化ける（infra/cloudfront.tf L212-223）"
                ]
              end
            )
            +
            # R-11(b): API オリジンに x-api-key の custom_header が付いているか（FR-6.3）。
            # ヘッダーの値は sensitive で plan から読めないので、名前だけを見る。
            (
              if $after == null then
                []
              elif ($unknown.origin == true) then
                ["WARN|R-11|\($rc.address)|origin が plan 時点で未確定のため x-api-key の custom_header を検査できなかった"]
              else
                (
                  [ ($after.origin | as_array)[]
                    | select(.origin_id == "api-gateway")
                    | (.custom_header | as_array)[]
                    | select(((.name // "") | ascii_downcase) == "x-api-key") ] | length
                ) as $api_key_headers
                | if $api_key_headers == 0 then
                    ["RED|R-11|\($rc.address)|API オリジン（api-gateway）に x-api-key の custom_header が無い — API Gateway の直 URL を塞ぐ API キーが CloudFront から渡らなくなる（FR-6.3 違反）"]
                  else
                    []
                  end
              end
            )
          )
        )
        //empty
      ),
      (
        # ---- R-7: SPA バケットの公開ブロックが外れていないか ----
        (
          select(is_addr("aws_s3_bucket_public_access_block.web"))
          | if $after == null then
              ["WARN|R-7|\($rc.address)|after が無く public access block を検査できなかった"]
            else
              # 注意: ここで `$after[$k] // false` と書いてはならない。jq の `//` は
              # 左辺が false のときも右辺を返すため、まさに検出したい false が消える。
              [ ["block_public_acls","block_public_policy","ignore_public_acls","restrict_public_buckets"][]
                | . as $k
                | if ($unknown | has($k)) and ($unknown[$k] == true) then
                    "WARN|R-7|\($rc.address)|\($k) が plan 時点で未確定のため検査できなかった"
                  elif ($after | has($k)) and ($after[$k] == false) then
                    "RED|R-7|\($rc.address)|\($k) が false — SPA バケットが公開されうる"
                  else
                    empty
                  end
              ]
            end
        )
        //empty
      ),
      (
        # ---- R-8: SSM の資格情報・IP 許可リスト・許可アカウントが Terraform に上書きされないか ----
        (
          select(is_addr("aws_ssm_parameter.basic_auth") or is_addr("aws_ssm_parameter.ip_allowlist") or is_addr("aws_ssm_parameter.allowed_account_ids"))
          | select($rc.change.actions | index("update"))
          | (if is_addr("aws_ssm_parameter.ip_allowlist")
               then "許可リスト（IP アドレス制限）が初期値の 0.0.0.0/0 で上書きされ、制限が外れる"
               elif is_addr("aws_ssm_parameter.allowed_account_ids")
               then "許可アカウントが初期値（デプロイ先のアカウントだけ）で上書きされ、足したアカウントのユーザを登録できなくなる（Issue #139）"
               else "実運用の資格情報がプレースホルダで上書きされる"
             end) as $impact
          | if ($unknown.value // false) then
              ["WARN|R-8|\($rc.address)|value が plan 時点で未確定のため上書きの有無を検査できなかった"]
            elif ($before != null and $after != null and $before.value != $after.value) then
              ["RED|R-8|\($rc.address)|value に差分がある — lifecycle { ignore_changes = [value] } が外れており、apply すると\($impact)"]
            else
              []
            end
        )
        //empty
      ),
      (
        # ---- R-11(a): API Gateway のメソッドが API キーを要求しているか（FR-6.3）----
        # 作成・更新だけを見る。変更の無いメソッドは検査しない（二段階の反映の途中の plan を
        # 落とさないため。メソッドが false のまま変わらない状態は、実測（直 URL の 403）で確かめる）。
        (
          select($rc.type == "aws_api_gateway_method")
          | select($rc.change.actions | (index("create") != null) or (index("update") != null))
          | if ($unknown.api_key_required // false) then
              ["WARN|R-11|\($rc.address)|api_key_required が plan 時点で未確定のため検査できなかった"]
            elif ($after.api_key_required == true) then
              []
            else
              ["RED|R-11|\($rc.address)|api_key_required が true でない — この経路は API キーなしで Lambda に届く（FR-6.3 違反）"]
            end
        )
        //empty
      )
    ]
    | flatten
    | .[]
JQ_PROGRAM_EOF

# ネイティブの jq には Windows 形式のパスで渡す（MSYS_NO_PATHCONV=1 の下では、/tmp/... を jq が読めない）。
JQ_PROGRAM_ARG="$JQ_PROGRAM"
if command -v cygpath >/dev/null 2>&1; then
  JQ_PROGRAM_ARG="$(cygpath -m "$JQ_PROGRAM")"
fi

FINDINGS="$(jq -r -f "$JQ_PROGRAM_ARG" "$PLAN_JSON")"

RED_COUNT=0
WARN_COUNT=0

if [[ -n "$FINDINGS" ]]; then
  while IFS='|' read -r severity code address detail; do
    [[ -z "$severity" ]] && continue
    case "$severity" in
      RED)
        RED_COUNT=$((RED_COUNT + 1))
        printf '赤信号 %s  %s\n    %s\n' "$code" "$address" "$detail"
        ;;
      WARN)
        WARN_COUNT=$((WARN_COUNT + 1))
        printf '警告   %s  %s\n    %s\n' "$code" "$address" "$detail"
        ;;
    esac
  done <<< "$FINDINGS"
  echo
fi

echo "plan-guard: 赤信号 ${RED_COUNT} 件 / 警告 ${WARN_COUNT} 件"

if [[ "$WARN_COUNT" -gt 0 ]]; then
  echo
  echo "警告は「検査できなかった」であって「問題なし」ではない。"
  echo "該当箇所は承認者が plan を目視で確認すること。"
  echo "  cicd-pipeline.md § 承認者のための plan 読み方 / § 読み方の実務"
fi

if [[ "$RED_COUNT" -gt 0 ]]; then
  echo
  echo "この plan は apply してはならない。"
  echo "赤信号の意味と対応は docs/design/cicd-pipeline.md § 赤信号 — 承認せず差し戻す にある。"
  echo "R-1 の判定の詳細は同文書の § R-1 の判定基準 にある。"
  exit 1
fi

# 黄信号（Y-1〜Y-5）は機械判定に載せていない。
# 「差分があること」自体は正常で、正しいかどうかが文脈依存だからである。
# 承認者が確認する（cicd-pipeline.md § 黄信号 — 影響を確認してから承認）。
echo "赤信号は無い。黄信号 Y-1〜Y-5 は人が確認すること。"
exit 0
