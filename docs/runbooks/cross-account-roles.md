# クロスアカウントの IAM ロールの操作 — 実測の手順書（旧 Issue #85）

- 日付: 2026-09-30（`docs/runbooks/` へ移したのは 2026-11-04。Issue 旧 #182）
- Issue: 旧 #85
- spec: `docs/superpowers/specs/2026-09-30-cross-account-roles-design.md`（4 節「検証」・成功基準 1〜4）
- plan: 旧リポジトリ（`rolust-legacy`）の plan（持ち越していない。この手順書は、その最終タスクの手順書を実値を抜いて起こしたもの）

この手順書は、**モックでは確かめられない層**（実 AWS の 2 アカウントをまたぐ AssumeRole と、特権昇格面）を、依頼者が引き取れる形で残したものである。ユニットテストと plan-guard の回帰テストは、この手順書の対象外である。

## 0. 前提と注意

- Rolust のデプロイ先を JUMP、ターゲットを DEV1 と呼ぶ。次の値は、実行する人が自分の環境の値を入れる（リポジトリには実値を書かない）。
  - `JUMP`・`DEV1`: デプロイ先・ターゲットのアカウント ID（`<DEPLOY_ACCOUNT_ID>`・`<TARGET_ACCOUNT_ID>`）
  - `DEPLOY_PROFILE`・`TARGET_PROFILE`: それぞれのアカウントの AWS CLI プロファイル名
  - `USER1_NAME`〜`USER3_NAME`: JUMP に実在する 3 つの IAM ユーザの名前。本文の `test1`〜`test3` はこの 3 人を指す
  - `EXISTING_ROLE`: 5 節の受け入れ確認で使う、DEV1 の既存のロール名（依頼者が決める）
- **本番は依頼者も同時に触る。** 検証は、検証用ロール（`rolust-verify-85-*`）の登録と、その割り当て・申請だけで行い、既存のロールと割り当てには触れない。プールは固定の 1 つで、依頼者のユーザと共用なので、プールのユーザを消すのは、この手順書が足した分だけにする。終わったら、検証で作ったものをすべて削除する（7 節）。
- **この手順書の API の経路は、2026-11-04 に現行のコード（`packages/api/src/handlers/`）から書き直した。書き直した 4.1・4.3・5 節の手順と 7 節は、まだ実測していない。** 旧版は `POST /api/pools`・`PUT /api/pools/<id>/roles` などを使っていたが、これらの経路は旧 #108（ユーザプールを固定の 1 つに）と旧 #135（登録＝紐づけ）で廃止された（現行は 404）。実測で食い違いが出たら、この手順書を直して来歴を付ける。
- **既存の資源を書き換える手順は、退避・復元・復元後の一致確認を必ず行う**（`CLAUDE.md` § テスト方針）。対象は、`$EXISTING_ROLE`（5 節）と、DEV1 の Manager の信頼ポリシー（4.5 節）。
- **書き込みを伴う手順は、実行の前に依頼者の承認を得る。** 各節の見出しに「承認」と付けた。承認は、その節ごとに得る。
- シェルは Git Bash。`/` で始まる引数は Windows のパスに変換されるので、`MSYS_NO_PATHCONV=1` を付ける。`jq` の出力は CRLF になるので、パスとして使う前に `tr -d '\r'` を通す（`.claude/rules/shell-and-aws-cli.md`）。
- **`AWS_PROFILE` は書き換えない。** Terraform の state（S3）は JUMP の資格情報で読むので、DEV1 の資格情報を環境変数に置くと、`terraform output` が失敗する。JUMP と DEV1 の呼び出しは、下の `jump`・`dev1` の関数で分ける。
- IAM のイベントは、グローバルサービスのため **us-east-1** にしか記録されない。STS の `AssumeRole` は、Lambda が呼んだリージョン（ap-northeast-1。見つからなければ us-east-1 も引く）に記録される。CloudTrail は数分遅れて現れる。**同じ時間帯の自分の呼び出し（`get-role` など）が現れてから、対象の呼び出しが無いことを判断する。**

```bash
export MSYS_NO_PATHCONV=1
export JUMP=<DEPLOY_ACCOUNT_ID>
export DEV1=<TARGET_ACCOUNT_ID>
export DEPLOY_PROFILE=<deploy-profile> TARGET_PROFILE=<target-profile>
export USER1_NAME=<iam-user-1> USER2_NAME=<iam-user-2> USER3_NAME=<iam-user-3>
export EXISTING_ROLE=<existing-role-in-target>
export REGION=ap-northeast-1
jump() { aws --profile "$DEPLOY_PROFILE" --region "$REGION" "$@"; }
dev1() { aws --profile "$TARGET_PROFILE" --region "$REGION" "$@"; }
export WORK="$(cygpath -m "$(mktemp -d)")"   # JSON と退避ファイルを置く。リポジトリの外。Windows 形式（C:/...）にする: MSYS_NO_PATHCONV=1 の下では、jq・aws に /tmp/... を渡しても読めない
echo "$WORK"
```

## 1. 事前確認と退避（読み取りだけ）

1.1 資格情報を確かめる。失効していれば、依頼者に `! aws sso login --profile "$DEPLOY_PROFILE"` と `! aws sso login --profile "$TARGET_PROFILE"` を頼む。**待つ間は、資格情報に依存しない作業（7 節の手順の確認など）を進める。**

```bash
jump sts get-caller-identity
dev1 sts get-caller-identity
```

期待: 2 つとも、`Account` が JUMP・DEV1 と一致する。

1.2 DEV1 のスイッチロール `$EXISTING_ROLE` の**現状を退避する**（5 節で書き換えるため）。

```bash
dev1 iam get-role --role-name $EXISTING_ROLE --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/dev1-c.trust.before.json"
dev1 iam list-role-tags --role-name $EXISTING_ROLE --output json | tr -d '\r' > "$WORK/dev1-c.tags.before.json"
jq -S . "$WORK/dev1-c.trust.before.json" | tr -d '\r'
jq -c . "$WORK/dev1-c.tags.before.json" | tr -d '\r'
```

1.3 DEV1 にまだ Reader・Manager が無いことを確かめる。

```bash
dev1 iam get-role --role-name RolustTrustPolicyReader 2>&1 | tr -d '\r' | tail -1
dev1 iam get-role --role-name RolustTrustPolicyManager 2>&1 | tr -d '\r' | tail -1
```

期待: どちらも `NoSuchEntity`。すでに在れば、内容を退避し（`get-role` と `list-role-policies`）、依頼者に確かめてから進む。

## 2. JUMP の反映（承認）

`docs/guide/setup.md` の「4. apply する」の手順で反映する（CD は持たず、反映は手元の `terraform apply`。`docs/design/cd-config.md` D-7・D-8）。プロファイルは `$DEPLOY_PROFILE`、リージョンは ap-northeast-1。

```bash
export AWS_PROFILE=$DEPLOY_PROFILE AWS_REGION=$REGION      # この節と 4.1 の terraform 用。DEV1 の呼び出しには使わない
npm run build
cd infra
terraform init -backend-config=backend.hcl
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
../.github/scripts/plan-guard.sh tfplan.json
```

期待:

- plan-guard が「赤信号 0 件」（R-12 を含む）。赤信号が出たら、apply しない。
- plan の変更が次のものに限られる: `aws_iam_role_policy` の 3 つの作成（`crud_assume_target_reader`・`diff_assume_target_reader`・`apply_assume_target_manager`）、Lambda 3 系統の更新（コードと環境変数）、SPA のアセットの入れ替え、出力の追加（`cross_account_target_setup`）。**これ以外の変更（特に IAM ポリシーの Resource の広がり、削除）があれば、apply せず、依頼者に報告する。**
- SPA のアセットの destroy は、名前が変わったアセットの入れ替えである。件数を plan で確かめる（`.claude/rules/aws-infra.md`）。

承認を得て apply する:

```bash
terraform apply tfplan
rm -f tfplan tfplan.json
terraform output -json cross_account_target_setup | tr -d '\r' > "$WORK/target-setup.json"
jq -r '.reader_trusted_roles[], .manager_trusted_roles[], .managed_tag' "$WORK/target-setup.json" | tr -d '\r'
cd ..
```

期待: Reader の信頼先が `rolust-crud-exec`・`rolust-diff-exec`、Manager の信頼先が `rolust-apply-exec`、`managed_tag` が `rolust:managed=true`。

## 3. DEV1 の準備（承認）

`docs/guide/cross-account.md` の「手順」の 1 のとおり、DEV1 に Reader と Manager を CloudFormation で作る（`terraform -chdir=infra output -raw target_roles_deploy_command` が出すコマンド。`--profile` は `"$TARGET_PROFILE"` に置き換える）。ターゲット側のロールはテンプレート（`cloudformation/target-roles.yaml`）が作るので、JSON を手で作る必要はない。（旧版は JSON を手で作る手順だった。ガイドの手順が CloudFormation に変わったので、この手順書もそれに合わせた。Issue 旧 #92）

作ったロールの信頼ポリシーを、2 節で控えた出力と突き合わせる（Reader は crud・diff、Manager は apply だけを名指しする）:

```bash
for pair in Reader:reader Manager:manager; do
  R="${pair%%:*}"; r="${pair##*:}"
  actual="$(dev1 iam get-role --role-name "RolustTrustPolicy$R" --query 'Role.AssumeRolePolicyDocument.Statement[].Principal.AWS' --output json | tr -d '\r' | jq -c '[.[] | if type=="array" then .[] else . end] | sort')"
  expected="$(jq -c ".${r}_trusted_roles | sort" "$WORK/target-setup.json" | tr -d '\r')"
  [ "$actual" = "$expected" ] && echo "$R trust: 一致" || echo "$R trust: 不一致 actual=$actual expected=$expected"
done
```

期待: 2 つとも「一致」。（`Principal.AWS` の配列は、順序が変わりうるので整列してから比べる。）

**Reader と Manager は、検証の後も残す**（依頼者の目的である DEV1 のロールの操作の成果物）。

## 4. 通し操作（本番。検証用ロールの登録と、その割り当て・申請。承認）

### 4.0 検証用のロールを作る

DEV1 に、管理対象タグを付けた検証用ロールと、タグを付けないロールを作る。信頼ポリシーは、JUMP の IAM ユーザ `$USER1_NAME` を 1 件だけ信頼する（取り込みの件数の確認に使う）。

```bash
cd "$WORK"
cat > verify-target-trust.json <<EOF
{"Version":"2012-10-17","Statement":[{"Sid":"Statement1","Effect":"Allow","Principal":{"AWS":"arn:aws:iam::$JUMP:user/$USER1_NAME"},"Action":"sts:AssumeRole"}]}
EOF
dev1 iam create-role --role-name rolust-verify-85-target --assume-role-policy-document file://verify-target-trust.json --tags Key=rolust:managed,Value=true
dev1 iam create-role --role-name rolust-verify-85-untagged --assume-role-policy-document file://verify-target-trust.json
```

### 4.1 API を呼ぶ準備

```bash
cd -                                                   # リポジトリのルートへ戻る
export CF="$(terraform -chdir=infra output -raw console_url | tr -d '\r')"; CF="${CF%/}"
BASIC="$(aws --profile "$DEPLOY_PROFILE" --region us-east-1 ssm get-parameter --name /rolust/basic-auth --with-decryption --query Parameter.Value --output text | tr -d '\r')"
api() { curl -sS -u "$BASIC" -H 'Content-Type: application/json' -w '\nHTTP %{http_code}\n' "$@"; }
TARGET_ARN="arn:aws:iam::$DEV1:role/rolust-verify-85-target"
```

日本語を引数で渡さない（Git Bash は CP932 に変換する）。以下の本文は ASCII だけなので、引数で渡してよい。日本語を含むときは、UTF-8 のファイルに書き、`--data-binary @file` で渡す。

**4.2 の前に**、`test1`〜`test3`（`USER1_NAME`〜`USER3_NAME`）が固定プールに登録済みであることを、画面 1 で確かめる（4.2 の登録が信頼ポリシーのユーザを取り込むとき、プールのユーザかどうかで「新規登録」の数が変わるため）。無いユーザは足し、足した名前を控える（7 節で消す）:

```bash
api -X POST "$CF/api/pool/users" --data-binary "{\"accountId\":\"$JUMP\",\"userNames\":[\"$USER1_NAME\",\"$USER2_NAME\",\"$USER3_NAME\"]}"
```

期待: 201。登録済みの名前は `skippedCount` に数えられる（`createdCount` が足した分）。

### 4.2 ロール登録（Reader の `iam:ListRoleTags`）

| 入力 | 期待 |
|---|---|
| 4.0 の検証用ロール（タグあり） | 201。Reader を引き受けてタグを読めた。登録は固定プールの列の末尾への紐づけを兼ね、信頼ポリシーにいる IAM ユーザを取り込む（応答の `imported`。4.3 で確かめる） |
| DEV1 のタグ無しのロール `rolust-verify-85-untagged` | 400。「管理対象のタグ … が付いていません」 |
| DEV1 に存在しないロール名 | 400。「存在しません」 |
| 未準備のアカウント（`000000000000`）のロール | 502。「アカウント 000000000000 のロール RolustTrustPolicyReader を引き受けられませんでした（AccessDenied）… クロスアカウント構成」 |

```bash
api -X POST "$CF/api/roles" --data-binary "{\"accountId\":\"$DEV1\",\"roleName\":\"rolust-verify-85-target\"}"
api -X POST "$CF/api/roles" --data-binary "{\"accountId\":\"$DEV1\",\"roleName\":\"rolust-verify-85-untagged\"}"
api -X POST "$CF/api/roles" --data-binary "{\"accountId\":\"$DEV1\",\"roleName\":\"rolust-verify-85-nonexistent\"}"
api -X POST "$CF/api/roles" --data-binary '{"accountId":"000000000000","roleName":"rolust-verify-85-target"}'
```

### 4.3 取り込みの確認（Reader の `iam:GetRole`）→ チェック → 申請

4.2 の最初の登録（タグあり）の応答で、取り込みを確かめる。期待: 応答の `imported` が `roleArn` = 検証用ロール、`userCount` = 1、`registeredCount` = 0（`test1` はプールに登録済みなので、新規登録は無い）。`skipped` の項目は無い。

```bash
api -X PUT "$CF/api/pool/assignments" \
  --data-binary "{\"userArn\":\"arn:aws:iam::$JUMP:user/$USER2_NAME\",\"roleArn\":\"$TARGET_ARN\",\"checked\":true}"
api -X POST "$CF/api/change-requests" --data-binary "{\"roleArns\":[\"$TARGET_ARN\"]}"
```

期待: 割り当ては 200。申請は 201 で、検証用ロールの下書きが 1 件でき、`changeRequestId` が返る（申請の元のプールは固定なので、本文に `poolId` は要らない）。

応答の `changeRequestId` を `CR_ID` に控える。

### 4.4 差分確認（Reader の `iam:GetRole`）

```bash
api "$CF/api/diff?ids=$CR_ID"
```

期待: 200。`readError` が `null`。`diff.added` に `$USER2_NAME`、`unmanaged` は空（`test1` は登録済みのユーザ）。

### 4.5 旧 #27 の再発防止の実測（引き受けに失敗しても、デプロイ先の同名ロールに作用しない）

**この節は、DEV1 のロールへの反映が一度も成功していない状態で行う。4.6 の反映より前である。** 理由: STS のセッションは、信頼ポリシーを書き換えても失効しない。Rolust は、引き受けた一時資格情報を Lambda の実行環境の中で、期限の約 5 分前（既定の有効期間 1 時間なら、約 55 分）までキャッシュする。DEV1 への反映が一度でも成功したあとでは、Manager の信頼ポリシーを外しても、温まった実行環境は AssumeRole を呼ばずに反映に成功しうる。そうなると、引き受けの失敗で止まることの証拠が得られない（性質が壊れたわけではない）。2 節の `terraform apply` で Lambda の実行環境は作り直されている。**3 節の後に、依頼者が DEV1 のロールを画面から反映していないことも、依頼者に確かめる。**

デプロイ先（JUMP）に、**同名で、管理対象タグの付いた検証用ロール**を作り、DEV1 の Manager を一時的に使えなくして、4.3 で作った申請 `CR_ID` の反映が失敗すること・JUMP の同名ロールが変わらないことを確かめる。

```bash
cd "$WORK"
cat > jump-verify-trust.json <<EOF
{"Version":"2012-10-17","Statement":[{"Sid":"Statement1","Effect":"Allow","Principal":{"AWS":"arn:aws:iam::$JUMP:user/$USER1_NAME"},"Action":"sts:AssumeRole"}]}
EOF
jump iam create-role --role-name rolust-verify-85-target --assume-role-policy-document file://jump-verify-trust.json --tags Key=rolust:managed,Value=true
jump iam get-role --role-name rolust-verify-85-target --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > jump-verify.before.json
cd -
```

**反映する前に**、DEV1 の Manager の信頼ポリシーを退避して、Rolust の apply 実行ロールを外す。

```bash
dev1 iam get-role --role-name RolustTrustPolicyManager --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/manager-trust.saved.json"
dev1 iam update-assume-role-policy --role-name RolustTrustPolicyManager \
  --policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"AWS":"arn:aws:iam::'"$DEV1"':root"},"Action":"sts:AssumeRole","Condition":{"StringEquals":{"sts:ExternalId":"never-used-verify-85"}}}]}'
```

反映を実行する:

```bash
api -X POST "$CF/api/apply" --data-binary "{\"changeRequestIds\":[\"$CR_ID\"]}"
```

期待: `ok: false`、状態「失敗」、`errorCode` が `AccessDenied`、`message` が「アカウント <DEV1> のロール RolustTrustPolicyManager を引き受けられませんでした … クロスアカウント構成」。

**`ok: true` になったら**: 温まった実行環境が、キャッシュした Manager の資格情報で反映した（上の理由）。まず下の確認の 1.・2.（JUMP の同名ロールが不変であること）を行い、3. で Manager の信頼ポリシーを復元する。そのうえで、60 分以上待ち、新しい申請（`$USER3_NAME` をチェックして `POST /api/change-requests`。4.3 と同じ。`CR_ID` を差し替える）で、この節をやり直す。DEV1 の `rolust-verify-85-target` には `test2` が加わった状態になるが、検証用のロールなので影響は無い。

確かめる（順に）:

1. **JUMP の同名ロールが変わっていない**:

   ```bash
   jump iam get-role --role-name rolust-verify-85-target --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/jump-verify.after.json"
   diff <(jq -S . "$WORK/jump-verify.before.json") <(jq -S . "$WORK/jump-verify.after.json") && echo "JUMP の同名ロール: 不変"
   ```

2. **JUMP の CloudTrail に、対象のロールへの `UpdateAssumeRolePolicy` が無い**（us-east-1。自分の `get-role` が現れてから判断する）:

   ```bash
   aws --profile "$DEPLOY_PROFILE" --region us-east-1 cloudtrail lookup-events \
     --lookup-attributes AttributeKey=EventName,AttributeValue=UpdateAssumeRolePolicy --max-results 30 \
     --query 'Events[].CloudTrailEvent' --output text | tr -d '\r' | tr '\t' '\n' \
     | jq -r 'select(.requestParameters.roleName=="rolust-verify-85-target") | [.eventTime, .userIdentity.arn] | @tsv' | tr -d '\r'
   ```

   期待: 何も出ない。

3. **Manager の信頼ポリシーを復元し、復元後に読み直して一致を確かめる**:

   ```bash
   dev1 iam update-assume-role-policy --role-name RolustTrustPolicyManager --policy-document "file://$WORK/manager-trust.saved.json"
   dev1 iam get-role --role-name RolustTrustPolicyManager --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/manager-trust.restored.json"
   diff <(jq -S . "$WORK/manager-trust.saved.json") <(jq -S . "$WORK/manager-trust.restored.json") && echo "Manager の信頼ポリシー: 復元済み・一致"
   ```

   （`Principal.AWS` の配列の順序だけの差なら、整列してから比べる。）

失敗した申請 `CR_ID` は、破棄しない。4.6 で、同じ申請を再反映する（失敗は未反映なので、ロールのロックを保持している）。

**復元が効くまで、数分かかる。** 信頼ポリシーの更新は結果整合で、実測（2026-10-02）では、復元してから再反映が最初に通るまで約 7 分かかった。その間の再反映は `AccessDenied` で失敗するが、Rolust は失敗を覚えず（STS のリクエスト ID が毎回別になる）、Lambda の再起動も要らない。4.6 は、`AccessDenied` のままなら 1 分おきに再試行する。

### 4.6 再反映（Manager の `iam:UpdateAssumeRolePolicy`）と、CloudTrail

Manager の信頼ポリシーを復元したあと（4.5 の 3.）、失敗した申請 `CR_ID` を、もう一度反映する（FR-5.6: 失敗からの再反映）。復元が効くまで数分かかるので（4.5 の末尾）、`AccessDenied` で失敗したら、1 分おきに、`ok: true` になるまで繰り返す。

```bash
dev1 iam get-role --role-name rolust-verify-85-target --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/verify-target.before.json"
api -X POST "$CF/api/apply" --data-binary "{\"changeRequestIds\":[\"$CR_ID\"]}"
dev1 iam get-role --role-name rolust-verify-85-target --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/verify-target.after.json"
diff <(jq -S . "$WORK/verify-target.before.json") <(jq -S . "$WORK/verify-target.after.json")
```

期待: 反映が `ok: true`、状態「反映済み」。DEV1 の信頼ポリシーに `test2` が加わり、`test1` は残る（保全方式）。

CloudTrail で、呼び出し元と対象を確かめる。CloudTrail は数分遅れて現れる。

DEV1 の IAM のイベント（us-east-1）: `UpdateAssumeRolePolicy` の呼び出し元が Manager のセッションであること。

```bash
aws --profile "$TARGET_PROFILE" --region us-east-1 cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=UpdateAssumeRolePolicy --max-results 20 \
  --query 'Events[].CloudTrailEvent' --output text | tr -d '\r' | tr '\t' '\n' \
  | jq -r 'select(.requestParameters.roleName=="rolust-verify-85-target") | [.eventTime, .userIdentity.arn, .userIdentity.sessionContext.sessionIssuer.userName] | @tsv' | tr -d '\r'
```

期待: `userIdentity.arn` が `arn:aws:sts::<DEV1>:assumed-role/RolustTrustPolicyManager/rolust-apply`、`sessionIssuer.userName` が `RolustTrustPolicyManager`。

STS の `AssumeRole`: DEV1 側に、Reader・Manager の引き受けが記録される。呼び出し元は JUMP の実行ロール（`rolust-crud`・`rolust-diff`・`rolust-apply` のセッション）。

```bash
dev1 cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRole --max-results 30 \
  --query 'Events[].CloudTrailEvent' --output text | tr -d '\r' | tr '\t' '\n' \
  | jq -r 'select(.requestParameters.roleArn | test("RolustTrustPolicy")) | [.eventTime, .userIdentity.arn, .requestParameters.roleArn, .requestParameters.roleSessionName] | @tsv' | tr -d '\r'
```

期待: `RolustTrustPolicyReader` を引き受けた行の呼び出し元が `rolust-crud-exec` または `rolust-diff-exec`、`RolustTrustPolicyManager` を引き受けた行の呼び出し元が `rolust-apply-exec`。

## 5. 依頼者の受け入れ確認（`$EXISTING_ROLE`。承認）

依頼者が、自分の画面で、実際の DEV1 のロール（`$EXISTING_ROLE`）を操作して確かめる。**書き換える前に 1.2 で退避してあること、確認の後に復元して一致を確かめること**（`CLAUDE.md` § テスト方針）。

1. `$EXISTING_ROLE` に、管理対象タグを付ける（`docs/guide/cross-account.md` の「手順」の 4）:

   ```bash
   dev1 iam tag-role --role-name $EXISTING_ROLE --tags Key=rolust:managed,Value=true
   ```

2. 画面で、ロールの登録（取り込みの件数が出る）、チェック、申請、差分確認、反映まで通す。
3. 確認: 差分確認が読み取りエラーにならず、反映が「反映済み」になること。DEV1 の信頼ポリシーが、申請どおりに変わっていること。4.6 と同じ手順で、`UpdateAssumeRolePolicy` の呼び出し元が Manager のセッションであること。
4. **復元する**: 信頼ポリシーとタグを、1.2 の退避に戻し、復元後に読み直して一致を確かめる。

   ```bash
   dev1 iam update-assume-role-policy --role-name $EXISTING_ROLE --policy-document "file://$WORK/dev1-c.trust.before.json"
   dev1 iam untag-role --role-name $EXISTING_ROLE --tag-keys rolust:managed      # 1.2 の退避で、このタグが無かった場合だけ
   dev1 iam get-role --role-name $EXISTING_ROLE --query 'Role.AssumeRolePolicyDocument' --output json | tr -d '\r' > "$WORK/dev1-c.trust.restored.json"
   diff <(jq -S . "$WORK/dev1-c.trust.before.json") <(jq -S . "$WORK/dev1-c.trust.restored.json") && echo "$EXISTING_ROLE: 復元済み・一致"
   dev1 iam list-role-tags --role-name $EXISTING_ROLE --output json | tr -d '\r' | jq -c . 
   ```

   タグは、1.2 の `dev1-c.tags.before.json` と一致すること。復元しない運用（依頼者が、そのまま使い続ける）を選ぶ場合は、依頼者の明示の指示を得る。

## 6. 特権昇格面の実測

IAM のポリシーシミュレータで確かめる（書き込みは無い）。

**6.1 Manager は、自分と Reader の信頼ポリシーを更新できない（明示 Deny）。ほかの管理対象ロールは更新できる。**

```bash
for target in RolustTrustPolicyManager RolustTrustPolicyReader; do
  for ctx in with-tag no-tag; do
    args=(); [ "$ctx" = with-tag ] && args=(--context-entries "ContextKeyName=aws:ResourceTag/rolust:managed,ContextKeyValues=true,ContextKeyType=string")
    printf 'Manager が %s の信頼ポリシーを更新（%s）: ' "$target" "$ctx"
    dev1 iam simulate-principal-policy --policy-source-arn arn:aws:iam::$DEV1:role/RolustTrustPolicyManager \
      --action-names iam:UpdateAssumeRolePolicy --resource-arns arn:aws:iam::$DEV1:role/$target "${args[@]}" \
      --query 'EvaluationResults[0].EvalDecision' --output text | tr -d '\r'
  done
done
```

期待: 4 つとも `explicitDeny`（管理対象タグが付いていても Deny される。自己昇格の閉路が閉じている）。リソースを 1 回で複数渡すと、シミュレータは結果を 1 行に畳み、リソース名がプレースホルダのまま返るので、リソースごとに分ける（2026-10-02 の実測で判明）。

```bash
dev1 iam simulate-principal-policy \
  --policy-source-arn arn:aws:iam::$DEV1:role/RolustTrustPolicyManager \
  --action-names iam:UpdateAssumeRolePolicy \
  --resource-arns arn:aws:iam::$DEV1:role/rolust-verify-85-target \
  --context-entries "ContextKeyName=aws:ResourceTag/rolust:managed,ContextKeyValues=true,ContextKeyType=string" \
  --query 'EvaluationResults[].[EvalResourceName,EvalDecision]' --output text | tr -d '\r'
```

期待: `allowed`。`--context-entries` を外すと `implicitDeny`（タグ条件が効く）。

**6.2 CRUD・Diff の実行ロールは Manager を引き受けられない。Apply の実行ロールは Reader を引き受けられない**（JUMP 側の IAM ポリシー）。

```bash
for role in crud diff apply; do
  for target in Reader Manager; do
    printf '%s -> %s: ' "rolust-$role-exec" "$target"
    jump iam simulate-principal-policy \
      --policy-source-arn arn:aws:iam::$JUMP:role/rolust-$role-exec --action-names sts:AssumeRole \
      --resource-arns arn:aws:iam::$DEV1:role/RolustTrustPolicy$target \
      --query 'EvaluationResults[0].EvalDecision' --output text | tr -d '\r'
  done
done
```

期待:

| 実行ロール | Reader | Manager |
|---|---|---|
| `rolust-crud-exec` | allowed | implicitDeny |
| `rolust-diff-exec` | allowed | implicitDeny |
| `rolust-apply-exec` | implicitDeny | allowed |

**6.3 ターゲット側の信頼ポリシーが、想定の主体だけを名指ししている**: 3 節の突き合わせが「一致」であること（Reader は crud・diff、Manager は apply だけ）。

## 7. 後片付け（承認）

検証で作ったものを、すべて消す。既存のロールと割り当て、依頼者のユーザには触れない。Reader・Manager は残す。

```bash
# 検証用ロールの登録を解除する（割り当てごと消える。未反映の申請があれば、先に破棄する:
#   api -X POST "$CF/api/change-requests/$CR_ID/discard"）
api -X DELETE "$CF/api/roles?arn=$TARGET_ARN"
# 4.1 で足したユーザだけを消す（プールは依頼者と共用。足していない名前は消さない）
for u in <4.1 で足した IAM ユーザ名>; do
  api -X DELETE "$CF/api/pool/users?arn=arn:aws:iam::$JUMP:user/$u"
done
```

期待: どちらも 200。登録を解除すると、ロールの割り当てが消える（応答の `removedAssignments`）。反映済みの割り当てが残るユーザは、削除が 409 で拒否されるので、ロールの登録解除を先に行う。

（プールの IamUser は Rolust の記録で、IAM のユーザそのものではない。登録の解除・ユーザの削除は IAM に触れない。）

検証用の IAM ロールを消す:

```bash
jump iam delete-role --role-name rolust-verify-85-target
dev1 iam delete-role --role-name rolust-verify-85-target
dev1 iam delete-role --role-name rolust-verify-85-untagged
```

最後に、消えたことを確かめる。

```bash
jump iam list-roles --query "Roles[?starts_with(RoleName,'rolust-verify-85')].RoleName" --output text | tr -d '\r'
dev1 iam list-roles --query "Roles[?starts_with(RoleName,'rolust-verify-85')].RoleName" --output text | tr -d '\r'
rm -rf "$WORK"
```

期待: どちらも空。Reader・Manager と `$EXISTING_ROLE` が想定どおりであること（3 節・5 節の一致）も、ここで確かめる。

## 8. 記録するもの

実測の結果は、PR の本文に、次の形で残す（成功基準の番号は spec の 1 節）。

| 成功基準 | 実測 | 結果 |
|---|---|---|
| 1 | 4.2〜4.4、4.6、5 | 登録・紐づけ・差分確認・反映が通る。UpdateAssumeRolePolicy の呼び出し元が Manager のセッション |
| 2 | 4.5 | 失敗し、JUMP の同名ロールは不変。JUMP の CloudTrail に UpdateAssumeRolePolicy が無い |
| 3 | 6.1・6.2 | 表のとおり |
| 4 | 4.2 | 未準備のアカウントは 502（原因と直し方つき） |
