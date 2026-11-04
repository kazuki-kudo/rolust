# 信頼ポリシーの乖離を直す操作 — 実測の手順書（旧 Issue 旧 #172）

- 日付: 2026-10-16（`docs/runbooks/` へ移したのは 2026-11-04。Issue 旧 #182）
- Issue: 旧 #172
- spec: `docs/superpowers/specs/2026-10-16-drift-repair-design.md`（§7「実測」1〜5）
- plan: 旧リポジトリ（`rolust-legacy`）の plan（持ち越していない。この手順書は、その実測の手順書を実値を抜いて起こしたもの）

この手順書は、**モックでは確かめられない層**（実 IAM の信頼ポリシーの更新と、デプロイした Rolust の画面・Lambda・DynamoDB の一連の動き）を、依頼者が引き取れる形で残したものである。ユニットテストは DynamoDB と IAM をモックで差し替えている。統合テスト（`packages/api/src/integration/drift-repair.integration.test.ts`）は実 IAM を呼ぶが、DynamoDB はメモリ上の写しで、デプロイ先＝ロールのアカウントとして直接読み書きする（Lambda の実行ロール・AssumeRole・API Gateway・画面は通らない）。

**実測の結果**（旧 Issue 旧 #172、2026-10-17）: 1〜6 節と 8 節を本番で実測し、すべて期待と一致した（7 節の統合テストは別途実施済み）。実測の日時・申請 ID・CloudTrail の記録など、実値を含む詳細は旧リポジトリの記録にあり、この手順書には持ち越していない。下の追記は、実測で見つけた手順書の訂正の来歴である。

> **追記**（Issue 旧 #172 により 2026-10-17、本番の実測の後）: 1〜5 節と 8 節を本番で実測した（6 節は対象アカウント未定のため、7 節は実施済みのため省いた）。実測で見つけた手順書の誤りを訂正した: 2 節（2 つの操作の位置。フッタではなく本文の下）、3.1（画面 4 に種別のバッジは出ない。出るのは注記だけ。正本 `mockups.md` 画面 4 のとおり）、5.1（マトリクスの「申請を作成」は選んだロールの列だけが対象。検証用ロールだけを選ぶ）。各箇所に来歴を付けた。
>
> **追記**（Issue 旧 #172 により 2026-10-17、6 節の実測の後）: 依頼者が対象に DEV1（`<TARGET_ACCOUNT_ID>`）を選び、6 節を本番で実測した。6.3 を訂正した: adopt の後に自分の `UpdateAssumeRolePolicy`（同じ内容の書き込み）を 1 回足す。訂正前の対照（自分の書き換え）は `$T_ADOPT` より前のイベントで、`$T_ADOPT` 以降の記録が届いたことを示せなかった（4 節は 5.2 の書き換えが後ろの対照になっていたが、6 節には後続の手順が無い）。あわせて、期待の「自分の書き換えの 1 件だけ」を、検索の余裕で 6.2 のイベントが入ることに合わせて直し、登録時の `GetRole`（`RolustTrustPolicyReader/<project>-crud`）を期待に足した。

## 0. 前提と注意

- 対象は本番（`auth_mode = "cognito"`。JUMP `<DEPLOY_ACCOUNT_ID>`、リージョン ap-northeast-1、`pool_id` は自分の Terraform の値）。**本番は依頼者も同時に触る。** 次の値は、実行する人が自分の環境の値を入れる（リポジトリには実値を書かない）。
  - `JUMP`: デプロイ先のアカウント ID
  - `DEPLOY_PROFILE`・`TARGET_PROFILE`: デプロイ先・ターゲット（6 節）の AWS CLI プロファイル名
  - `POOL_ID`: Terraform の `pool_id`
  - `USER1_NAME`〜`USER3_NAME`: JUMP に実在する 3 つの IAM ユーザの名前。本文の `test1`〜`test3` はこの 3 人を指す
- **既存の管理対象ロールは書き換えない。** 検証は、承認を得て新規作成する検証用ロール（`rolust-verify-172-*`）だけで行う。終わったら、DynamoDB の登録と IAM ロールを消す（8 節）。新規作成の資源なので退避・復元は要らないが、消えたことを読み直して確かめる。
- **書き込みを伴う手順は、実行の前に依頼者の承認を得る。** 各節の見出しに「承認」と付けた。
- 実測の前に、本番へ Terraform（`/api/drift/restore`・`/api/drift/adopt` の経路）・Lambda（diff）・SPA を反映済みであること（`docs/guide/operations.md` の手順。CD は持たず、反映は手元の `terraform apply`。`docs/design/cd-config.md` D-7・D-8）。
- 画面の操作は、検証専用の Cognito ユーザ（`rolust-verify-172`、グループ `applier`。`applier` は `editor` を含む）で入る。管理者のパスワードは受け取らない。
- シェルは Git Bash。`/` で始まる引数は Windows のパスに変換されるので `MSYS_NO_PATHCONV=1` を付ける。`jq` の出力は CRLF になるので `tr -d '\r'` を通す。日本語を含む DynamoDB の出力は `jq` が読めないことがあるので、`--projection-expression` で絞るか `--output text` で取り出す（`.claude/rules/shell-and-aws-cli.md`）。
- IAM の CloudTrail イベント（`GetRole`・`UpdateAssumeRolePolicy`）は **us-east-1** にしか記録されない。`--region us-east-1` を付け、`AttributeKey=EventName` で引き、`requestParameters.roleName` と `userIdentity` で絞る。記録は数分遅れて現れる。**同じ時間帯の自分の呼び出し（`aws iam get-role` など）が現れてから、対象の呼び出しが無いことを判断する。**
- `Principal.AWS` の配列は、読むたびに順序が変わりうる。前後の比較は `jq -S` と配列の整列をしてから行う。

```bash
export MSYS_NO_PATHCONV=1
export JUMP=<DEPLOY_ACCOUNT_ID>
export DEPLOY_PROFILE=<deploy-profile> TARGET_PROFILE=<target-profile>
export POOL_ID=<pool_id>
export USER1_NAME=<iam-user-1> USER2_NAME=<iam-user-2> USER3_NAME=<iam-user-3>
export REGION=ap-northeast-1
jump() { aws --profile "$DEPLOY_PROFILE" --region "$REGION" "$@"; }
export STATE_TABLE="$(terraform -chdir=infra output -raw state_table_name | tr -d '\r')"
export CR_TABLE="$(terraform -chdir=infra output -raw change_request_table_name | tr -d '\r')"
export POOL_ID_COGNITO="$(terraform -chdir=infra output -raw cognito_user_pool_id | tr -d '\r')"
export TAG_KEY="rolust:managed" TAG_VALUE="true"   # 本番の値は `terraform -chdir=infra output managed_role_tag` で確かめる
export VERIFY_ROLE=rolust-verify-172-a
export U1="arn:aws:iam::$JUMP:user/$USER1_NAME"
export U2="arn:aws:iam::$JUMP:user/$USER2_NAME"
export U3="arn:aws:iam::$JUMP:user/$USER3_NAME"
export WORK="$(cygpath -m "$(mktemp -d)")"   # リポジトリの外。Windows 形式（C:/...）
# 正規化: Statement ごとに Principal.AWS を配列にして整列し、キーを並べる
norm() { jq -S '.Statement |= map(if (.Principal.AWS? // null) != null then .Principal.AWS = ([.Principal.AWS] | flatten | sort) else . end)' "$1" | tr -d '\r'; }
```

資格情報が失効していれば、依頼者に `! aws sso login --profile "$DEPLOY_PROFILE"` を頼む。**待つ間は、資格情報に依存しない作業（手順の読み合わせ）を進める。**

## 1. 準備（承認）

1.1 資格情報を確かめる。

```bash
jump sts get-caller-identity --query Account --output text
```

期待: `$JUMP` と一致する。

1.2 test3 がユーザプールに登録済みかを確かめる（2 節で「余分」を作るのに、プールのユーザである必要がある。プールに無いユーザは管理外として扱われ、乖離に数えない）。

```bash
jump dynamodb get-item --table-name "$STATE_TABLE" \
  --key '{"pk":{"S":"POOL#'"$POOL_ID"'"},"sk":{"S":"USER#'"$U3"'"}}' --query 'Item.arn.S' --output text
```

期待: `$U3` が出る。`None` なら、画面 1（ユーザプール）で `$USER3_NAME`（アカウント `<DEPLOY_ACCOUNT_ID>`）を登録し、**8 節で消すために、ここで登録したことを控える**。test1・test2 も同じく確かめる（無ければ 1.4 の登録で取り込まれる）。

1.3 検証専用の Cognito ユーザを作る。

```bash
jump cognito-idp admin-create-user --user-pool-id "$POOL_ID_COGNITO" --username rolust-verify-172 --message-action SUPPRESS
jump cognito-idp admin-set-user-password --user-pool-id "$POOL_ID_COGNITO" --username rolust-verify-172 --password '<その場で生成した値>' --permanent
jump cognito-idp admin-add-user-to-group --user-pool-id "$POOL_ID_COGNITO" --username rolust-verify-172 --group-name applier
```

1.4 検証用ロールを作り、画面で登録する。信頼ポリシーは test1・test2（実在する IAM ユーザ。実在しない principal は IAM が拒否する）。

```bash
cat > "$WORK/trust.initial.json" <<EOF
{"Version":"2012-10-17","Statement":[{"Sid":"Statement1","Effect":"Allow","Principal":{"AWS":["$U1","$U2"]},"Action":"sts:AssumeRole"}]}
EOF
jump iam create-role --role-name "$VERIFY_ROLE" --assume-role-policy-document "file://$WORK/trust.initial.json" \
  --tags "Key=$TAG_KEY,Value=$TAG_VALUE" --description "Rolust drift-repair verification. Safe to delete." --query Role.Arn --output text
```

画面（`rolust-verify-172` でサインイン）の「IAM ロール」で、アカウント ID `<DEPLOY_ACCOUNT_ID>`・ロール名 `rolust-verify-172-a` を登録する。

期待: 登録が成功し、test1・test2 が反映済みとして取り込まれる。「信頼ポリシーを確認」を押すと、このロールの行が「✓ 一致」。

## 2. 外から信頼ポリシーを書き換え、足りない・余分・管理外を作る（承認）

test2 を外し（足りない）、test3 を足し（余分）、管理外のサービスを足す。

```bash
cat > "$WORK/trust.tampered.json" <<EOF
{"Version":"2012-10-17","Statement":[
 {"Sid":"Statement1","Effect":"Allow","Principal":{"AWS":["$U1","$U3"]},"Action":"sts:AssumeRole"},
 {"Sid":"ExternalService","Effect":"Allow","Principal":{"Service":"ec2.amazonaws.com"},"Action":"sts:AssumeRole"}]}
EOF
jump iam update-assume-role-policy --role-name "$VERIFY_ROLE" --policy-document "file://$WORK/trust.tampered.json"
jump iam get-role --role-name "$VERIFY_ROLE" --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/trust.tampered.read.json"
diff <(norm "$WORK/trust.tampered.json") <(norm "$WORK/trust.tampered.read.json") && echo SAME
```

期待: `SAME`。画面 2 で「信頼ポリシーを確認」を押すと、このロールが「! 乖離 2 件」。「詳細」を開くと:

- 「Rolust は引き受けられる状態と記録しているが、IAM 上に無い」: `$USER2_NAME`
- 「Rolust の記録に無い（未反映）のに、IAM 上にある」: `$USER3_NAME`
- 「参考: Rolust の管理外の principal」: `ec2.amazonaws.com`
- 本文の下（3 つの一覧の後）に「IAM を記録に合わせる（申請を作成）」と「記録を IAM に合わせる」が有効で出る。フッタは「閉じる」だけ（Issue 旧 #172 により 2026-10-17 訂正。訂正前は「フッタに」。実装 `DriftDetailModal` は 2 つの操作を本文に置き、フッタを確認の状態でだけ [キャンセル / 記録を合わせる] に替える）。

## 3. A: IAM を記録に合わせる（restore → 差分確認 → 反映）（承認）

3.1 詳細モーダルで「IAM を記録に合わせる（申請を作成）」を押す。

期待: 画面 4（`/requests?ids=<id>`）へ遷移し、申請のカード見出しの説明（ARN・申請 ID の下）に「IAM を記録に合わせるための申請です。」が出る。種別のバッジ（「乖離の修復（IAM を記録に合わせる）」）は画面 5 にだけ出て、画面 4 には出ない（Issue 旧 #172 により 2026-10-17 訂正。訂正前は画面 4 にもバッジを期待していた。正本 `mockups.md` 画面 4・`interaction-spec.md` FR-7.4 は注記だけを定める）。差分は 追加 test2・削除 test3。`ec2.amazonaws.com` は管理外として保全の側に出る（削除に挙がらない）。申請 ID を控える（`$CR_A`）。

3.2 画面 4 で「反映」する。

期待: 状態「反映済み」、結果「信頼ポリシーを更新しました（追加 1 / 削除 1）」。

```bash
jump iam get-role --role-name "$VERIFY_ROLE" --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/trust.after-restore.json"
norm "$WORK/trust.after-restore.json"
```

期待: Allow の IAM ユーザが test1・test2 だけ（test3 が無い）。`ExternalService`（`ec2.amazonaws.com`）の Statement が 2 節と同じ内容で残っている。

3.3 画面 2 で「信頼ポリシーを確認」を押す。

期待: このロールが「✓ 一致」（確認結果は使い捨てなので、画面 2 に戻ったら押し直す）。

3.4 申請履歴（画面 5）で、`$CR_A` に「乖離の修復」のバッジ、作成者・反映者が `rolust-verify-172` で並ぶ。ロールのロックが解放され、同じロールで通常の申請が作れる（マトリクスでこのロールの列が「下書き」「失敗」になっていない）。

## 4. B: 記録を IAM に合わせる（adopt）と、AWS を書かないことの確認（承認）

4.1 2 節と同じ書き換えをもう一度行い（`trust.tampered.json`）、画面 2 で「信頼ポリシーを確認」→「! 乖離 2 件」を確かめる。**書き換えの前に**時刻を控える（`$T_TAMPER`、UTC）。CloudTrail は、この時刻から余裕（5 分。手元の時計と AWS のずれを見込む）を引いた時刻から引く（`$T_LOOKUP`）。書き換えの後に控えると、書き換えのイベントが検索範囲の外になり、4.5 の対照（自分の書き換えが 1 件見える）が 0 件になって、「呼んでいない」を確かめられなくなる。

```bash
export T_TAMPER="$(date -u +%Y-%m-%dT%H:%M:%SZ)"                      # 書き換えの前
export T_LOOKUP="$(date -u -d "$T_TAMPER - 5 minutes" +%Y-%m-%dT%H:%M:%SZ)"
jump iam update-assume-role-policy --role-name "$VERIFY_ROLE" --policy-document "file://$WORK/trust.tampered.json"
jump iam get-role --role-name "$VERIFY_ROLE" --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/trust.before-adopt.json"
```

4.2 詳細モーダルで「記録を IAM に合わせる」を押す。確認モーダルを確かめる。

期待: 見出し「rolust-verify-172-a: 記録を IAM に合わせる」。「記録に取り込む（IAM にいる）」に test3 の ARN 全文、「記録から外す（IAM にいない）」に test2 の ARN 全文。「AWS の信頼ポリシーは書き換えません」と「これらのユーザの未反映の編集（チェックの変更）は上書きされます。」が出る。実行ボタン「記録を合わせる」は primary ではない。

4.3 **押す直前に**時刻を控え（`$T_ADOPT`、UTC）、「記録を合わせる」を押す。4.1 の書き換えから 1 分以上空けて押す（`$T_ADOPT` の前後で書き換えと adopt のイベントを取り違えないため）。

```bash
export T_ADOPT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"   # 押す直前
```

期待: モーダルが閉じ、「2 件を記録に合わせました。AWS は書き換えていません。…」が出る。このロールの行が「再確認が必要」になる。「信頼ポリシーを確認」を押すと「✓ 一致」。マトリクスで test3 のセルがチェック済み（反映済み）、test2 のセルが未チェック（未反映の変更なし）。

4.4 IAM の信頼ポリシーが前後で同じであることを確かめる。

```bash
jump iam get-role --role-name "$VERIFY_ROLE" --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/trust.after-adopt.json"
diff <(norm "$WORK/trust.before-adopt.json") <(norm "$WORK/trust.after-adopt.json") && echo SAME
```

期待: `SAME`。

4.5 CloudTrail で、adopt が `UpdateAssumeRolePolicy` を呼んでいないことを確かめる（数分待ってから引く）。

**前の手順のイベントと adopt を分ける**: 検索の余裕（5 分）のせいで、前の手順（3 節の反映・4.1 の書き換えなど）のイベントが検索範囲に入り、`$T_ADOPT` 以降のイベントと混ざる。前の手順の最後のイベントから adopt（`$T_ADOPT`）まで少なくとも 5 分空ける。空けられなかったときは、各行の `eventTime` を `$T_ADOPT` と比べて「以降」だけを数える。

```bash
ct() {  # $1 = EventName
  aws --profile "$DEPLOY_PROFILE" --region us-east-1 cloudtrail lookup-events \
    --lookup-attributes AttributeKey=EventName,AttributeValue="$1" --start-time "$T_LOOKUP" --max-results 50 \
    --query 'Events[].CloudTrailEvent' --output text | tr '\t' '\n' \
    | jq -r 'select(.requestParameters.roleName=="'"$VERIFY_ROLE"'") | [.eventTime, .userIdentity.arn] | @tsv' | tr -d '\r'
}
ct GetRole
ct UpdateAssumeRolePolicy
```

期待:

- `GetRole`: 4.1 の自分（`$DEPLOY_PROFILE` の SSO ロール）の呼び出しと、`$T_ADOPT` 前後に Diff Lambda の実行ロール（`assumed-role/<project>-diff-exec/...` など、`terraform -chdir=infra output` の diff の実行ロール）の呼び出しが現れる。**まず自分の呼び出しが現れたことを確かめてから、次を判断する。**
- `UpdateAssumeRolePolicy`: 4.1 の自分の書き換え（`$T_TAMPER`、`$DEPLOY_PROFILE`）の 1 件だけ。`$T_ADOPT` 以降の呼び出し、Lambda の実行ロールからの呼び出しは 0 件。

4.6 監査の ChangeRequest を確かめる。

```bash
jump dynamodb query --table-name "$CR_TABLE" --key-condition-expression 'pk = :pk' \
  --filter-expression 'roleArn = :r AND #k = :adopt' \
  --expression-attribute-values '{":pk":{"S":"CR"},":r":{"S":"arn:aws:iam::'$JUMP':role/'$VERIFY_ROLE'"},":adopt":{"S":"adopt"}}' \
  --projection-expression 'changeRequestId,#s,addUserArns,removeUserArns,createdAt,appliedAt,createdBy.#n,appliedBy.#n' \
  --expression-attribute-names '{"#k":"kind","#s":"status","#n":"name"}' --output json | tr -d '\r'
```

（`result` は日本語の文言を含むので、`jq` が読めなくならないよう射影から外している。）

期待: 1 件。`status = applied`、`addUserArns = [test3]`、`removeUserArns = [test2]`、`createdAt = appliedAt`、作成者・反映者が `rolust-verify-172`。画面 5 に「記録の取り込み（AWS は書き換えていません）」のバッジで、状態「反映済み」で並ぶ。ロック（`ROLELOCK#…`）は作られていない。

```bash
jump dynamodb get-item --table-name "$CR_TABLE" \
  --key '{"pk":{"S":"ROLELOCK#arn:aws:iam::'$JUMP':role/'$VERIFY_ROLE'"},"sk":{"S":"UNREFLECTED"}}' --query 'Item.changeRequestId.S' --output text
```

期待: `None`。

## 5. 未反映の申請があるロールでは、B が拒否される（承認）

5.1 マトリクスで、検証用ロールの test1 のセルを外して保存し、「申請を作成」する（下書きができる）。申請 ID を控える（`$CR_DRAFT`）。「申請を作成」は列で選んだロールだけを対象にする（`POST /api/change-requests` の `roleArns`）。**検証用ロールの列だけを選ぶ**。本番では依頼者の未反映の変更が他のロールにありうるので、他のロールの申請を作らない（Issue 旧 #172 により 2026-10-17 追記）。

5.2 乖離を作る。4 節の後は記録が test1・test3 なので、`trust.initial.json`（test1・test2）を書き込むと、test2 が余分・test3 が足りない。画面 2 で「信頼ポリシーを確認」→「! 乖離 2 件」。

```bash
jump iam update-assume-role-policy --role-name "$VERIFY_ROLE" --policy-document "file://$WORK/trust.initial.json"
```

5.3 詳細モーダルで「記録を IAM に合わせる」→「記録を合わせる」を押す。

期待: 「未反映の申請（下書き: `$CR_DRAFT`）があるため実行できません。申請履歴で、反映するか破棄してから実行してください。」が出る。記録は変わらない（マトリクスのセルがそのまま）。`CR_TABLE` に新しい `adopt` の申請が無い（4.6 の query が 1 件のまま）。

5.4 同じロールで「IAM を記録に合わせる（申請を作成）」を押すと、同じく除外の理由と `$CR_DRAFT` が出て、申請は作られない。

5.5 申請履歴で `$CR_DRAFT` を破棄する。マトリクスで test1 のセルを元に戻して保存する。

## 6. 別アカウントのロールでも A・B が通る（承認）

Diff Lambda が Reader を、Apply Lambda が Manager を引き受ける経路（旧 Issue 旧 #85。`docs/runbooks/cross-account-roles.md`）を通す。本番の Rolust（JUMP）を信頼する Reader・Manager（`RolustTrustPolicyReader`・`RolustTrustPolicyManager`）があるアカウントでしか通らない。

6.0 ターゲットの選択（依頼者に確かめる）:

```bash
aws --profile "$TARGET_PROFILE" --region "$REGION" iam get-role --role-name RolustTrustPolicyReader --query Role.Arn --output text 2>&1 | tr -d '\r' | tail -1
```

- ターゲットに Reader・Manager が無ければ、(a) `terraform -chdir=infra output -raw target_roles_deploy_command` のスタックを作る（承認。終わったらスタックを消す）か、(b) Reader・Manager が既にある別のアカウントで行うかを、依頼者が選ぶ。
- 対象のアカウントが SSM の許可リスト（旧 Issue 旧 #139）の対象かは、ユーザの登録にだけ効く。この節は JUMP のユーザ（test1〜3）を使うので、許可リストは変えない。

以下、選んだアカウントを `$TGT`・プロファイルを `tgt` とする。

```bash
export TGT=<TARGET_ACCOUNT_ID>
tgt() { aws --profile "$TARGET_PROFILE" --region "$REGION" "$@"; }
export VERIFY_ROLE_X=rolust-verify-172-x
tgt iam create-role --role-name "$VERIFY_ROLE_X" --assume-role-policy-document "file://$WORK/trust.initial.json" \
  --tags "Key=$TAG_KEY,Value=$TAG_VALUE" --description "Rolust drift-repair verification. Safe to delete." --query Role.Arn --output text
```

6.1 画面で、アカウント `$TGT`・ロール名 `rolust-verify-172-x` を登録する（test1・test2 が取り込まれる）。

CloudTrail は**ターゲットのアカウント**で引く。検索の開始時刻は、4.1 と同じく**書き換えの前に**控えた時刻から 5 分を引いたものにする。

```bash
ctx() {  # $1 = EventName, $2 = 開始時刻
  aws --profile "$TARGET_PROFILE" --region us-east-1 cloudtrail lookup-events \
    --lookup-attributes AttributeKey=EventName,AttributeValue="$1" --start-time "$2" --max-results 50 \
    --query 'Events[].CloudTrailEvent' --output text | tr '\t' '\n' \
    | jq -r 'select(.requestParameters.roleName=="'"$VERIFY_ROLE_X"'") | [.eventTime, .userIdentity.arn] | @tsv' | tr -d '\r'
}
```

6.2 乖離を作り、3 節（A）を同じ手順で行う。期待は 3 節と同じ。

```bash
export T_LOOKUP_A="$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"   # 書き換えの前
tgt iam update-assume-role-policy --role-name "$VERIFY_ROLE_X" --policy-document "file://$WORK/trust.tampered.json"
# 3 節の反映の後、数分待ってから:
ctx UpdateAssumeRolePolicy "$T_LOOKUP_A"
ctx GetRole "$T_LOOKUP_A"
```

期待: `UpdateAssumeRolePolicy` に、自分の書き換え（`$TARGET_PROFILE` の SSO ロール）と、反映の `assumed-role/RolustTrustPolicyManager/<project>-apply` の 2 件。`GetRole` に `assumed-role/RolustTrustPolicyReader/<project>-diff` が現れる（6.1 の登録の時刻なら `RolustTrustPolicyReader/<project>-crud` も。登録時の取り込みの読み取り。Issue 旧 #172 により 2026-10-17 追記）。

6.3 もう一度乖離を作り、4 節（B）を同じ手順で行う（`$T_ADOPT` は押す直前に控える）。期待は 4 節と同じ。

```bash
export T_LOOKUP_B="$(date -u -d '5 minutes ago' +%Y-%m-%dT%H:%M:%SZ)"   # 書き換えの前
tgt iam update-assume-role-policy --role-name "$VERIFY_ROLE_X" --policy-document "file://$WORK/trust.tampered.json"
# 4.3 と同じく、1 分以上空けて、押す直前に T_ADOPT を控えて adopt する。
# adopt の後（4.4 の読み取りの後）に、後ろの対照として同じ内容を書き込む（信頼ポリシーは変わらない）:
tgt iam update-assume-role-policy --role-name "$VERIFY_ROLE_X" --policy-document "file://$WORK/trust.after-adopt.json"
# 数分待ってから:
ctx UpdateAssumeRolePolicy "$T_LOOKUP_B"
ctx GetRole "$T_LOOKUP_B"
```

前の手順（6.2 の反映・書き換え）の最後のイベントから adopt（`$T_ADOPT`）まで少なくとも 5 分空ける（4.5 と同じ。検索の余裕で前のイベントが範囲に入るため。空けられなければ `eventTime` で `$T_ADOPT` 以降だけを数える）。

期待: `UpdateAssumeRolePolicy` は、6.3 の自分の書き換えと、adopt の後の自分の書き込み（後ろの対照。**これが見えてから**判断する）。その間（adopt を含む）は 0 件。検索の余裕で 6.2 の書き換え・反映（Manager）も範囲に入りうるが、`$T_ADOPT` より前なので数えない。`GetRole` は `$T_ADOPT` 以降に Reader 経由（`RolustTrustPolicyReader`）の呼び出しがある（Issue 旧 #172 により 2026-10-17 訂正。訂正前は後ろの対照が無く、期待が「自分の書き換えの 1 件だけ」だった。自分の書き換えは `$T_ADOPT` より前で、adopt の時間帯の記録が届いたことを示さない）。

## 7. 統合テスト（任意。承認）

検証用ロール `rolust-it-drift-<乱数>` を JUMP に作って消す統合テストを走らせる。既存の管理対象ロールの信頼ポリシーを書き換える `real-iam.integration.test.ts` も同時に走るので、**このファイルだけを指定する**。

```bash
ROLUST_INTEGRATION=1 AWS_REGION=ap-northeast-1 npx vitest run --config vitest.integration.config.ts packages/api/src/integration/drift-repair.integration.test.ts
jump iam list-roles --query "Roles[?starts_with(RoleName, 'rolust-it-drift-')].RoleName" --output text
```

期待: 3 件とも成功。2 つ目のコマンドの出力が空（テストが作ったロールが残っていない）。残っていれば、テストの出力に出たロール名で `jump iam delete-role --role-name <名前>` する。

## 8. 後片付け（承認）

8.1 画面の「IAM ロール」で、`rolust-verify-172-a`（と 6 節の `rolust-verify-172-x`）の登録を解除する（割り当てごと消える）。

8.2 IAM ロールを消す。

```bash
jump iam delete-role --role-name "$VERIFY_ROLE"
tgt iam delete-role --role-name "$VERIFY_ROLE_X"        # 6 節を行った場合
jump iam get-role --role-name "$VERIFY_ROLE" 2>&1 | tr -d '\r' | tail -1
tgt iam get-role --role-name "$VERIFY_ROLE_X" 2>&1 | tr -d '\r' | tail -1
```

期待: どちらも `NoSuchEntity`。6.0 でスタックを作った場合は、スタックを消し、`RolustTrustPolicyReader`・`RolustTrustPolicyManager` が残っていないことを確かめる。

8.3 DynamoDB に登録が残っていないことを確かめる。

```bash
jump dynamodb query --table-name "$STATE_TABLE" --key-condition-expression 'pk = :pk AND begins_with(sk, :p)' \
  --expression-attribute-values '{":pk":{"S":"ROLE"},":p":{"S":"ROLE#arn:aws:iam::"}}' \
  --query "Items[?contains(arn.S, 'rolust-verify-172')].arn.S" --output text
jump dynamodb query --table-name "$STATE_TABLE" --key-condition-expression 'pk = :pk AND begins_with(sk, :p)' \
  --expression-attribute-values '{":pk":{"S":"POOL#'"$POOL_ID"'"},":p":{"S":"ASSIGN#"}}' \
  --query "Items[?contains(roleArn.S, 'rolust-verify-172')].sk.S" --output text
```

期待: どちらも空。申請（`CR#…`）は履歴として残る（ChangeRequest は件数無制限に蓄積する。CLAUDE.md の決定済みの仕様）。ロック（`ROLELOCK#…rolust-verify-172…`）が残っていないこと（5.5 で破棄済み）。

8.4 1.2 で登録したユーザ（あれば）を画面 1 から削除する。検証専用の Cognito ユーザを消す。

```bash
jump cognito-idp admin-delete-user --user-pool-id "$POOL_ID_COGNITO" --username rolust-verify-172
jump cognito-idp list-users --user-pool-id "$POOL_ID_COGNITO" --query 'Users[].Username' --output text
```

期待: `rolust-verify-172` が一覧に無い。

