# Rollback Runbook — Rolust

> **追記注記**（Issue #178 により 2026-10-18 訂正）: `README.md` の利用者向けの手順を `docs/guide/` に分けたため、README の節・手順を指していた参照を `docs/guide/` の文書に張り替えた（対応は `docs/superpowers/specs/2026-10-18-readme-split-design.md`）。NFR-4・SM-2 の「README と Terraform」という総称は、変えない（Issue #179 により 2026-10-19 訂正: 訂正前は「Issue #179 で扱うので変えていない」とした。README は入口で手順は `docs/guide/` にあるが、総称は今も通じるため）。ID と節番号は変えない。
> **追記注記**（Issue #93 により 2026-10-08）: 画面名と操作の表示名を改めた。ID と節番号は変えない。画面 1「ユーザプール」→「IAMユーザ」、画面 2「IAMロール」→「IAMロール管理」、画面 3「割り当てマトリクス」→「IAMロール割り当て」、「ユーザを登録」→「ユーザを新規登録」、「ロールを登録」→「ロールを新規登録」、属性の「編集モード」→「属性一括編集モード」、「属性列を編集」→「属性の項目を編集」、IAMユーザ・IAMロールの行の「削除」→「登録を解除」（AWS 上の信頼ポリシーには触れない動作は変えない）、IamUser・IamRole の表示 → IAMユーザ・IAMロール、principal の表示 → プリンシパル。コード識別子とドメイン用語（UserPool・IamUser・属性列など）は変えない。
> **正本注記**（Issue #5 により 2026-09-27 追記）
>
> - **位置づけ**: 本書は Rolust のロールバック手順（判断基準・経路別の手順・データとの非対称性・ロールバック後の確認・エスカレーション）の正本である。症状から入る障害対応の手順（RB-1〜RB-8）は凍結文書の `runbooks.md` にあり、本書の手順の一部はその実測で裏づけた形に改めた。変更は `CLAUDE.md` § 開発フロー の規則に従い、実装と同じ PR で行う。
> - **複写元**: `aidlc/spaces/default/intents/260728-rolust-iam-trust/operation/deployment-pipeline/rollback-runbook.md`（2026-08-10 作成、2026-08-31 最終更新、2026-09-27 複写）。複写元は凍結した経緯として残る。
> - **照合の範囲**: `docs/superpowers/specs/2026-09-27-rollback-runbook-design.md` 3.2 の源泉から列挙した食い違い（K-1〜K-12）を、コード（`infra/`・`.github/workflows/cd.yml`・`packages/api/TABLE-DESIGN.md`）と凍結文書の実測の記録（`runbooks.md` RB-1・RB-2・RB-4・RB-6、`deployment-log.md`）に照合して訂正した。AWS での実測は行っていない。それ以外の記述は照合していない（未照合）。
> - **訂正の全体像**: Stage・Scope・最終更新の行と、上流の成果物が揃った経緯の段落を削除した。CD は反映しない（`cd-config.md` D-7）ことに合わせ、CD 経由の反映・承認つき apply・二重経路の記述を改めた。apply は実行済みで SPA の経路は実測済みであることを反映した。基本形と SPA の手順に `plan-guard.sh` を足し、AWS CLI に Git Bash とリージョンの注意を足した。認証が外れた場合の無効化を RB-1 の手順にした。旧アセットは destroy されるという事実に改めた。IAM を戻す内容を CloudTrail（`us-east-1`）から辿る手順を足し、`RoleLock` のキーを `TABLE-DESIGN.md` に合わせた。未決事項 1 を改め、3 を解消とした。最終レビューの指摘により、CloudTrail の照会の窓を 90 日に広げ、基本形に `main` を `git revert` で戻す手順を足し、残っていた `cd infra` を `-chdir=infra` に改めた。
> - **未決**: (1) ~~§ SPA だけを戻す場合 の恒久策（旧アセットを残すか、消えることを受容するか）は Issue #4 で決める。~~ 解消: 旧アセットは残さず、画面が再読込を案内する（`interaction-spec.md` GI-11。Issue #4 により 2026-09-27 訂正）。(2) § エスカレーション の `resourcegroupstaggingapi get-resources` は未検証で、IAM ロールを列挙するときの実行リージョンが確定していない。(3) § 未決事項 2（ロールバックの所要時間）。
> - 本文がファイル名だけで名指す凍結文書（`runbooks.md`・`incident-plan.md` など。`deployment-strategy.md` は Issue #4 により 2026-09-27 正本に切り出した）とソースタグの所在は `docs/design/README.md` にある。

> **追記注記**（Issue #24 により 2026-09-27 追記）
>
> - **変更の全体像**: plan-guard に赤信号 R-10（`DenySelfEscalation` 対象の網羅）を足したことに合わせ、現行の赤信号の範囲を R-1〜R-10 に改めた（冒頭の段落・§ ロールバックの基本形）。

> **追記注記**（Issue #76 により 2026-09-29 追記）
>
> - **変更の全体像**: plan-guard に赤信号 R-11（API Gateway の直 URL を塞ぐ設定が外れていないか）を足したことに合わせ、現行の赤信号の範囲を R-1〜R-11 に改めた（冒頭の段落・§ ロールバックの基本形）。Issue #76 より前のコミットへ戻すと制限が外れる旨を § ロールバックの基本形に足した。

`cd-config.md`（パイプライン構成）と `deployment-strategy.md`（置き換え特性）を前提とする。

> **追記注記**（Issue #85 により 2026-09-30 追記）
>
> - **変更の全体像**: plan-guard に赤信号 R-12（別アカウントへの `sts:AssumeRole` の到達範囲）を足したことに合わせ、現行の赤信号の範囲を R-1〜R-12 に改めた（冒頭の段落・§ ロールバックの基本形）。Issue #85 より前のコミットへ戻すと、別アカウントのロールを操作できなくなる旨を § ロールバックの基本形に足した。
> - **設計**: `docs/superpowers/specs/2026-09-30-cross-account-roles-design.md`

> **追記注記**（Issue #20 により 2026-10-05 追記）
>
> - **変更の全体像**: 認証方式（`auth_mode`。`basic` / `cognito`）を足したため、判断基準の表の `console_url` の判定を、方式別に読むよう注記した。方式を戻す手順を足した。
> - **設計**: `docs/superpowers/specs/2026-10-05-admin-auth-cognito-design.md`

**ロールバックの前に、そもそも壊れた apply を通さない仕組みがある。**
反映は `docs/guide/` の手動経路（Issue #178 により 2026-10-18 訂正）だけで行い（CD は反映しない。`cd-config.md` D-7）、赤信号 R-1〜R-12（Issue #24 により 2026-09-27 訂正。Issue #76 により 2026-09-29 訂正。Issue #85 により 2026-09-30 訂正）は
apply の前に手元の `plan-guard.sh` が機械で検査して止める（`docs/guide/setup.md` § apply する（Issue #178 により 2026-10-18 訂正））。本 runbook が扱うのは、
それをすり抜けた壊れ方である（Issue #5 により 2026-09-27 訂正: CD の `guard` が承認の前に R-1〜R-8 を落とす、を改めた）。

**通しで実測した経路は SPA だけである。** `terraform apply` は初回デプロイ（4.3、2026-09-17〜19）で実行済みであり、
§ SPA だけを戻す場合 は `runbooks.md` RB-6 で往復を実測した（2026-09-19）。それ以外の経路の手順は
Terraform の構成と部分的な実測から導いたものであり、通しでは実行していない（Issue #5 により 2026-09-27 訂正: 「一度も実行されていない」「`terraform apply` 自体が未実行」を改めた）。

## ロールバックの基本形

**git のリビジョンを戻して再デプロイする。** 成果物レジストリを持たない
（`ci-config.md` D-2）ため、「前のビルドを取り出す」経路は存在しない。ソースが唯一の真実である。

リポジトリのルートで実行する。手順は `docs/guide/operations.md` § SPA を更新したとき（Issue #178 により 2026-10-18 訂正） と同じ形である（Issue #5 により 2026-09-27 訂正: `plan-guard.sh` を通し、`cd infra` を `-chdir=infra` にした）。

```bash
export MSYS_NO_PATHCONV=1                       # Git Bash で '/index.html' がパスに変換されるのを防ぐ
git checkout <戻したいコミット>
npm ci
npm run build
terraform -chdir=infra plan -out=tfplan
terraform -chdir=infra show -json tfplan > infra/tfplan.json
./.github/scripts/plan-guard.sh infra/tfplan.json && terraform -chdir=infra apply tfplan   # 赤信号があれば apply しない
rm -f infra/tfplan infra/tfplan.json
aws cloudfront create-invalidation \
  --distribution-id "$(terraform -chdir=infra output -raw cloudfront_distribution_id)" \
  --paths '/index.html'
```

手元の `terraform apply` には `terraform init -backend-config=backend.hcl` が先に要る
（P-1 の解消により state はリモートになった）。`infra/backend.hcl` を持っていない場合は
`infra/backend.hcl.example` から作る。

`git checkout <戻したいコミット>` は、そのコミット時点の `plan-guard.sh` も戻した版にする。古い版は現行の赤信号（R-1〜R-12。Issue #24 により 2026-09-27 訂正。Issue #76 により 2026-09-29 訂正。Issue #85 により 2026-09-30 訂正）を
すべては持たないことがあるので、検査は現行の `main` の `plan-guard.sh`（`git show main:.github/scripts/plan-guard.sh`）でも通す。

**Issue #85（クロスアカウント）より前のコミットへ戻す場合は、別アカウントのロールを操作できなくなる**（Issue #85 により 2026-09-30 追記）。戻した木は、`sts:AssumeRole` のポリシーと環境変数を持たず、コードは別アカウントのロールを IAM を呼ばずに止める（エラーコード `CrossAccountRoleNotSupported`）。ターゲット側の Reader・Manager は残るが、使われない。別アカウントのロールの登録済みの紐づけと申請の記録はそのまま残り、デプロイ先のロールは影響を受けない。次に `main` に戻れば、別アカウントのロールを再び操作できる。権限が広がる方向の変更ではないので、Issue #76 の場合と違い、制限が外れることは無い。

**Issue #76（IP 許可リスト・API キー）より前のコミットへ戻す場合は、制限が外れる**（Issue #76 により 2026-09-29 追記）。戻した木は、API Gateway のメソッドに `api_key_required` を持たず、CloudFront が `x-api-key` を付けず、edge-auth が IP 許可リストを見ない。したがって直 URL が再び開き、IP 制限が効かなくなる。古い版の `plan-guard.sh` は R-11 を持たないが、上のとおり現行の `main` の `plan-guard.sh` でも通せば、`api_key_required` が `true` から外れる差分が R-11 の赤信号になる。壊れた変更が Issue #76 の変更でないなら、Issue #76 を含む状態のどれかへ戻す。Issue #76 より前へ戻すのがやむを得ないときは、赤信号を承知のうえで反映し、戻した後すぐに、この変更を含む状態へ復旧する。
復旧した後は、壊れた変更を `main` から取り除く `git revert` を PR で取り込み、`git checkout main` に戻る。`main` に壊れた変更が
残ったままだと、次に `main` から手元で反映した人がそれを再び配る（Issue #5 により 2026-09-27 追記: 最終レビューの指摘。
CD 経由の revert の記述を削除した後に、`main` を戻す手順が抜けていた）。

反映の経路は手元の apply だけである（CD は plan と guard だけを実行し、反映しない。`cd-config.md` D-7。
Issue #5 により 2026-09-27 訂正: CD 経由で revert コミットを承認つき apply に通す経路と、二重経路の前提を削除した）。
state のロックは S3 ネイティブ（`backend.hcl` の `use_lockfile = true`）であり、別の人の apply や
CD の `plan` ジョブが同時に走っていれば、手元の apply はロック待ちで止まる（Issue #181 により 2026-10-19 訂正: CD は廃止した。ロック待ちになるのは、他の端末・他の人の plan・apply だけである）。

急いでいても `use_lockfile` を無効にしたり `-lock=false` を付けたりしてはならない。
別の apply と衝突すると state が壊れ、ロールバックより重い復旧になる（Issue #5 により 2026-09-27 訂正: 衝突の相手を CD の apply から別の apply に改めた）。

## 判断基準

（Issue #20 により 2026-10-05 追記: 下の 200・401・503 の判定は `auth_mode = "basic"` のもの。`cognito` では、認証なしの `console_url` は **302（Cognito の `/oauth2/authorize` へ）** が正常で、`/api/` は 401 が正常。**200 が返ったら認証が働いていない**（即時ロールバック）。503 が続くときは、`MSYS_NO_PATHCONV=1 aws ssm get-parameter --region us-east-1 --name /rolust/auth-mode` の値が `basic` か `cognito` か、`cognito` なら `/rolust/auth-cognito` が JSON として存在するかを確認する。方式を戻すときは `auth_mode` を変えて apply し直す（空白期間がある。`cognito` から `basic` に戻すと、Cognito のユーザープールとユーザは破棄される）。）

| 症状 | 判断 | 初動 |
|---|---|---|
| `console_url` が **200 を返す**（Basic 認証のダイアログが出ない） | **即時ロールバック** | FR-6.1 が破れている。管理画面が無防備。下記「認証が外れた場合」へ |
| `console_url` が 503 を返し続ける | 資格情報の未投入か不正値。**ロールバック不要** | `MSYS_NO_PATHCONV=1 aws ssm get-parameter --region us-east-1 --name /rolust/basic-auth --with-decryption --query Parameter.Value --output text \| grep -c ':'` で値の形式（`user:password`、コロンを含む）を確認する。1 なら形式は正しい（値そのものは画面に出さない）。反映まで最大 5 分（Issue #5 により 2026-09-27 訂正: SSM は `us-east-1` にあり、Git Bash では `/` 始まりの引数がパスに変換されるため、リージョンと `MSYS_NO_PATHCONV=1` を足した） |
| 画面は出るが API が 5xx | Lambda かデータ層。**ロールバック候補** | CloudWatch Logs で crud / diff / apply のどれかを特定 |
| 反映（apply）が `AccessDenied` で失敗する | IAM のタグ条件。**ロールバック候補になるとは限らない** | まず `terraform output -raw managed_role_tag` で管理対象タグを確認し、`aws iam list-role-tags` で対象ロールの実際のタグと突き合わせる。**タグが剥がされただけならデプロイの問題ではなく、ロールバックしても直らない**（タグ付けは Terraform の外で起きる）。タグ変数を変えた apply が原因なら下記「管理対象タグを戻す場合」 |
| SPA が 403 / 白画面 | CloudFront キャッシュとアセットの不整合 | 下記「SPA だけを戻す場合」 |
| 申請が「失敗」で滞留する | アプリケーションの不具合。**ロールバックでは直らないことがある** | 信頼ポリシーは既に書き換わっている可能性がある。下記「データとの非対称性」 |

## 経路別の手順

### 認証が外れた場合（最優先）

Lambda@Edge の関連付けが外れたか、`edge-auth` が全リクエストを通している状態である。
**ロールバックの完了を待つ間、管理画面は無防備である。**

即座に到達性を落とす手段として、CloudFront ディストリビューションを**無効化**する。

```bash
export MSYS_NO_PATHCONV=1
D=$(terraform -chdir=infra output -raw cloudfront_distribution_id)
# 1. 現在の設定と ETag を取る（ETag は If-Match に要る。無いと PreconditionFailed）
aws cloudfront get-distribution-config --id "$D" > dist.json
ETAG=$(jq -r .ETag dist.json | tr -d '\r')      # Git Bash の jq は行末に \r を付ける
# 2. DistributionConfig だけを取り出して Enabled を false にする（ETag を含めたまま渡すと拒否される）
jq '.DistributionConfig | .Enabled = false' dist.json > dist-disabled.json
# 3. 無効化。file:// は相対パスで渡す（Git Bash の /tmp は Windows 側に無い）
aws cloudfront update-distribution --id "$D" --if-match "$ETAG" \
  --distribution-config file://dist-disabled.json --query 'Distribution.Status' --output text
aws cloudfront wait distribution-deployed --id "$D"
```

手順 1〜2 は `runbooks.md` RB-1 で実測した（2026-09-19）。手順 3 の `update-distribution` と、その後の再有効化
（新しい `ETag` を取り直して `.Enabled = true` で繰り返すか、`terraform apply` で戻す）は実行していない。
無効化中の応答コードも未実測である（Issue #5 により 2026-09-27 訂正: `/tmp` に置く骨組みを RB-1 の手順に改めた）。

そのうえで通常のロールバックを行う。Lambda@Edge の複製に時間がかかるため
（下記「Lambda@Edge の制約」）、無効化の方が速く効く。

### SPA だけを戻す場合

```bash
export MSYS_NO_PATHCONV=1
git checkout <戻したいコミット> -- packages/web       # 依存が変わっていれば npm ci も
npm run build -w @rolust/web                          # web だけを build する。npm 9 は失敗しても exit 0 を返すので出力で成否を見る
terraform -chdir=infra plan -out=tfplan               # S3 オブジェクトの add / change / destroy だけであること
terraform -chdir=infra show -json tfplan > infra/tfplan.json
./.github/scripts/plan-guard.sh infra/tfplan.json && terraform -chdir=infra apply tfplan
rm -f infra/tfplan infra/tfplan.json
aws cloudfront create-invalidation --distribution-id "$(terraform -chdir=infra output -raw cloudfront_distribution_id)" --paths '/index.html'
```

手順は `runbooks.md` RB-6 で往復を実測した形である（Issue #5 により 2026-09-27 訂正: `plan-guard.sh` を足し、web だけを build するようにした）。

**旧アセットは残らない。** `infra/cloudfront.tf` の `aws_s3_object.web` は `for_each = fileset(local.web_dist, "**")` であり、
`npm run build` が `dist/` を作り直すため、直前のアセットは for_each のキーから外れて destroy される
（RB-6 で `16 to destroy` を実測。SPA の通常の反映でも毎回起きる）。反映時に画面を開いたままの利用者は、
まだ読んでいない画面へ遷移すると、消えたチャンクを取れずに読み込みに失敗する（Issue #141 により 2026-10-07 訂正: 訂正前は、代わりに `index.html` を受け取って失敗していた。CloudFront のカスタムエラー応答は外した）。
Issue #4 を含む版では、画面は真っ白にならず再読込を案内する（`interaction-spec.md` GI-11）。開いていたタブの版と戻し先の版がどちらも Issue #4 以降なら、反映・戻しの後に周知しなくてよい。
Issue #4 より前の版が関わる反映・戻し（この変更を初めて反映するとき、#4 より前の版へ戻すとき、そこから現行へ戻すとき）では、開いていたタブは案内を出せず真っ白になるので、従来どおり再読込を周知する
（Issue #5 により 2026-09-27 訂正: 「旧アセットを削除しないこと」は `terraform apply` を使う限り守れないため改めた。
Issue #4 により 2026-09-27 訂正: 旧アセットは残さず、画面の案内で受け止めることにした。`deployment-strategy.md` § SPA の更新順序が持つ不整合）。

戻した作業ツリーは、復旧後に `git checkout HEAD -- packages/web` で現行に戻し、上の手順で現行を反映し直す
（戻したままにすると、次の apply が戻した版を配る）。戻し先は直前にデプロイした版（`git log -- packages/web`）にする。
古い版は現行の API と整合しないことがある（Issue #5 により 2026-09-27 追記: RB-6 の実測から）。

### 管理対象タグを戻す場合

`managed_tag_key` / `managed_tag_value` を変更した apply を戻すときは、**IAM ポリシーの
`Condition` と Lambda の環境変数の両方が同時に戻る**ことを確認する。片方だけだと、登録は
通るのに反映で `AccessDenied` になる（あるいはその逆）状態が生まれる。

```bash
terraform -chdir=infra output -raw managed_role_tag

# CRUD は登録時検証に、apply は反映に同じ値を使う。両方を見る。
for fn in crud apply; do
  aws lambda get-function-configuration --function-name "<project>-$fn" \
    --query 'Environment.Variables.{key:ROLUST_MANAGED_TAG_KEY,value:ROLUST_MANAGED_TAG_VALUE}'
done
```

三者が一致していることを確認する。IAM ポリシーの `StringEquals` は**完全一致**であり、
`true` と `True` は別の値である。

**タグそのものはロールバックの対象ではない。** 対象ロールに付いたタグは Terraform の
管理外にあり、apply を戻しても変わらない。変数を戻せば、旧タグを持つロールが再び
管理対象に復帰する。

### Lambda@Edge の制約

Lambda@Edge は他の要素と非対称である。

- **複製に数分〜十数分かかる。** ロールバックも同じだけ遅い。
- **レプリカが残っている間は関数を削除できない。** 関連付けを外した後、AWS が全エッジから
  レプリカを削除するまで**数時間**かかることがある。この間 `terraform destroy` は失敗し続ける。
- **us-east-1 にしか作れない。** リージョンを取り違えると `terraform apply` の時点で失敗する。

したがって **`edge-auth` の変更はロールバックが最も高くつく**。変更を入れる前に、
`packages/edge-auth` のユニットテスト 7 件が通ることに加え、
`basic_auth_parameter_name` とコード内の `CREDENTIALS_PARAMETER_NAME` が一致していることを
必ず確認すること（`docs/guide/limitations.md` § そのほか（Issue #178 により 2026-10-18 訂正））。

### state のロックが残った場合

P-1 の解消により state はリモート（S3）になり、**手元の plan・apply と CD の `plan` ジョブが同じ state のロックを取る**（Issue #181 により 2026-10-19 訂正: CD を廃止したので、ロックを取るのは手元の操作だけである）（Issue #5 により 2026-09-27 訂正: CD は apply せず plan だけを実行する。`cd-config.md` D-7）。
apply が途中で死ぬと、ロックだけが残って以後の `terraform` が待たされる。

S3 ネイティブロックの実体は state と同じ場所に置かれる `<key>.tflock` オブジェクトである
（DynamoDB テーブルは使わない）。まず**本当に誰も走っていない**ことを確かめる。
他の誰かが手元で plan・apply していないこと（Issue #181 により 2026-10-19 訂正: CD の `plan` ジョブは廃止したので、`gh run list --workflow cd.yml` での確認は要らない）
（Issue #5 により 2026-09-27 訂正: CD は plan だけを実行する。state バケットの実体は `us-east-1` にあるため、下のコマンドにリージョンを足した）。

```bash
# 誰が・いつ取ったロックかを見る
aws s3 cp --region us-east-1 "s3://<bucket>/rolust/infra/terraform.tfstate.tflock" - | jq .
```

確認できたら Terraform の作法で解除する（`ID` は上の出力または待たされている
`terraform` のエラーメッセージにある）。

```bash
terraform -chdir=infra force-unlock <ID>
```

**S3 のオブジェクトを直接消してはならない。** `force-unlock` は Terraform が
整合性を確認したうえで外すが、直接削除は「まだ走っている apply」のロックまで消せてしまう。
二重 apply は state の破損を招き、ロールバックより重い復旧になる。

## データとの非対称性

**コードのロールバックは、既に AWS へ反映された信頼ポリシーを戻さない。**

Rolust の主作用は `iam:UpdateAssumeRolePolicy` であり、これは Rolust の外側にある IAM の状態を
変える。アプリケーションを前の版に戻しても、実行済みの反映は取り消されない。

| 対象 | ロールバックで戻るか |
|---|---|
| Lambda のコード / SPA / API Gateway / CloudFront 設定 | **戻る** |
| DynamoDB のデータ（UserPool / IamRole / Assignment / ChangeRequest） | **戻らない**（テーブル定義が変わらないため何も起きない） |
| **反映済みの IAM 信頼ポリシー** | **戻らない** |

反映を取り消す必要がある場合は、**Rolust の外で** IAM を直接操作する。戻す内容は CloudTrail から辿る。
**Rolust は反映前の信頼ポリシーの全文を保存しない。** 申請の履歴（`ChangeRequest`、画面 5「申請履歴」）に残るのは差分
（追加・削除される principal）だけである（Issue #5 により 2026-09-27 訂正: 「戻すべき内容の記録は `ChangeRequest` の履歴にある」を改めた）。

**IAM はグローバルサービスであり、CloudTrail のイベントは `us-east-1` にしか記録されない。** `--region us-east-1` を付けずに
`ap-northeast-1` で `lookup-events` を打つと 0 件が返り、「記録が無い」ように見える（`runbooks.md` RB-2 で 2026-09-19 に実測。
Issue #5 により 2026-09-27 追記）。

```bash
export MSYS_NO_PATHCONV=1
R=<RoleName>

# 1. 誰が・いつ書き換えたか（Rolust の反映は Username = rolust-apply、人手は SSO のユーザ名）
aws cloudtrail lookup-events --region us-east-1 \
  --lookup-attributes AttributeKey=ResourceName,AttributeValue=$R \
  --start-time "$(date -u -d '90 days ago' +%Y-%m-%dT%H:%M:%SZ)" \
  --query 'Events[?EventName==`UpdateAssumeRolePolicy`].[EventTime,Username,EventId]' --output table

# 2. 各イベントの requestParameters.policyDocument は「その更新の後の全文」である。
#    戻したい時点の直前のイベントの policyDocument が「戻す内容」になる。
aws cloudtrail lookup-events --region us-east-1 \
  --lookup-attributes AttributeKey=EventId,AttributeValue=<EventId> \
  --query 'Events[0].CloudTrailEvent' --output text \
  | jq -r '.requestParameters.policyDocument | fromjson' > restore.json
cat restore.json                       # 内容を目で確認する（管理外プリンシパルが入っていること）

# 3. 現在値を退避してから復元し、一致を確かめる
aws iam get-role --role-name $R --query 'Role.AssumeRolePolicyDocument' --output json > before-restore.json
aws iam update-assume-role-policy --role-name $R --policy-document file://restore.json
aws iam get-role --role-name $R --query 'Role.AssumeRolePolicyDocument' --output json | jq -S . \
  | diff - <(jq -S . restore.json) && echo RESTORED
```

`AttributeKey=ResourceName` で引けるのは Resources 欄を持つイベントであり、`UpdateAssumeRolePolicy` はこれを持つ
（`GetRole` は持たないので、この形では引けない）。当該ロールに `UpdateAssumeRolePolicy` の記録が無い（作成時のまま）場合は、
`CreateRole` イベントの `requestParameters.assumeRolePolicyDocument` が初期値である。90 日より前のイベントは `lookup-events` で
見えない（CloudTrail のイベント履歴の窓）。Rolust は証跡（Trail）を持たないため、それより古い内容は復元できない
（Issue #5 により 2026-09-27 追記: RB-2 から。一致確認は整形の差を除くため `jq -S` で比べる形にした。
手順 1 の窓は RB-2 の 7 日ではなく、イベント履歴の窓いっぱいの 90 日にした。7 日で 0 件を「記録が無い」と読み、
`CreateRole` の初期値へ戻すと、その後の正当な変更まで消えるため）。

### 滞留した申請の扱い

1 IAMロールにつき未反映（下書き / 失敗）の申請は 1 件までである（FR-4.6）。失敗した申請を
放置すると、そのロールの新しい申請を作成できない。**反映するか、申請履歴から破棄する。**

破棄時にロック解放が失敗した場合は `lockWarning` が表示される。漏れたロックは
`RoleLock` アイテムとして DynamoDB に残るため、製品内に解放手段は無い。

```bash
export AWS_REGION=ap-northeast-1                  # ワークロードのリージョン（terraform.tfvars の region）
T=$(terraform -chdir=infra output -raw change_request_table_name)   # ロックは申請テーブルにある（Issue #36 により 2026-09-27 訂正）
K='{"pk":{"S":"ROLELOCK#arn:aws:iam::<AccountId>:role/<RoleName>"},"sk":{"S":"UNREFLECTED"}}'
aws dynamodb get-item --table-name "$T" --key "$K"      # changeRequestId と status を確かめる
aws dynamodb delete-item --table-name "$T" --key "$K"
```

`get-item` が返す `changeRequestId` の申請が、申請履歴で破棄済みであることを確かめてから消す。キーの形は
`packages/api/TABLE-DESIGN.md` § FR-4.6 のロックアイテム のとおりである（Issue #5 により 2026-09-27 訂正:
例示の `"pk":"ROLELOCK"`・`"sk":"<roleId>"` は古い形だった。`runbooks.md` RB-4 の形に合わせ、申し送りの経緯の文を削除した）。

## ロールバック後の確認

```bash
terraform -chdir=infra output -raw console_url          # 1. 開いて認証が働くこと（basic は 401、cognito は 302。200 は異常）
terraform -chdir=infra output -raw managed_role_tag     # 2. 管理対象タグが意図した値であること
```

コマンドはリポジトリのルートから `-chdir=infra` で実行する。`cd infra` は失敗しても後続が走り、節をまたいで作業ディレクトリが
ずれる（`docs/guide/operations.md` § SPA を更新したとき（Issue #178 により 2026-10-18 訂正）。Issue #5 により 2026-09-27 訂正: § 管理対象タグを戻す場合・§ state のロックが残った場合・
本節の `cd infra` を `-chdir=infra` に改めた）。

> `managed_role_arn_scope` は `role/*` を返すが、これは**正常**である。タグ方式では
> 実効的な絞り込みを `Condition` が担う。`Resource` だけを見て「絞り込みが無効」と
> 読んではならない（`docs/guide/managed-roles.md` § 管理対象は IAMロールのタグで絞り込まれる（Issue #178 により 2026-10-18 訂正））。

3. 「IAMロール管理」画面で、タグの付いたロールを新規登録できること（タグ検証が働くこと）。
   タグの無いロールが 400 で弾かれることも併せて確認する
4. 「IAMロール割り当て」でチェックを入れても AWS に書き込まれないこと（FR-3.2）
5. CloudWatch Logs に新しいエラーが出ていないこと

## エスカレーション

本プロジェクトは poc であり、常設の運用体制を持たない。

| 事象 | 連絡先 | 判断者 |
|---|---|---|
| 認証が外れた（`console_url` が 200） | 依頼者（`jump` アカウントの管理者） | 依頼者 |
| 意図しないロールの信頼ポリシーが書き換わった | 同上 + 当該ロールの所有者 | 依頼者 |
| Terraform state の破損 / ロックの残留 | 依頼者 | 依頼者 |

重大度（SEV1〜SEV4）ごとの一次対応者・判断者・期限は、凍結文書の `escalation-matrix.md` がこの表を拡張している（Issue #5 により 2026-09-27 追記）。

**本番アカウントへの導入は推奨されていない**（`docs/guide/managed-roles.md` § 管理対象は IAMロールのタグで
絞り込まれる）（Issue #178 により 2026-10-18 訂正）。事故時の影響範囲は管理対象タグが付いたロールに限られるが、その範囲内では
管理画面に到達できる者が任意ロールの信頼ポリシーを書き換えられる。

**タグ方式では影響範囲の把握に AWS 側への照会が要る。** 接頭辞方式では範囲が Terraform
変数を読めば分かったが、いまは実際に誰がどのロールにタグを付けたかを見ないと分からない。
事故時は次で列挙する。

```bash
aws resourcegroupstaggingapi get-resources \
  --resource-type-filters iam:role \
  --tag-filters "Key=<managed_tag_key>,Values=<managed_tag_value>"
```

この照会には `tag:GetResources` が要る。**Rolust の実行ロールは持っていない**（持たせると
管理対象の列挙能力を製品側に与えることになる）。運用者の権限で実行すること。
**この `resourcegroupstaggingapi` の照会は未検証である。** IAM ロールを列挙するときの実行リージョンも確定していない（Issue #5 により 2026-09-27 追記: 正本注記の未決 (2)）。

## 未決事項

1. **通しで実測したのは SPA の経路だけである**（`runbooks.md` RB-6、2026-09-19）。基本形・認証が外れた場合・
   管理対象タグ・state のロック・IAM の復元の各経路は通しで試していない（Issue #5 により 2026-09-27 訂正: apply は 4.3 で実行済み）。
2. **ロールバックの所要時間を測っていない。** 特に Lambda@Edge の複製時間は
   `jump` アカウントでの実測が要る。
3. **解消。** 重大度（SEV1〜SEV4）と事後レビューの様式は、incident-response (4.5) の `incident-plan.md` と
   `escalation-matrix.md` で定まった（Issue #5 により 2026-09-27 訂正: 「post-incident review の様式を定めていない」を改めた）。

## ユーザプールを 1 つに固定した変更の切り戻し（Issue #108）

（Issue #108 により 2026-10-05 追記）Issue #108 は、Lambda 3 系統の環境変数 `ROLUST_POOL_ID` と SPA を変えました。DynamoDB のキーは変えていないので、前の版へ戻してもデータは見えます。

- **前の版へ戻したときの見え方**: ユーザプールの一覧が出ます（本番は `jump-account` の 1 つ）。1 ロール 1 プールの検証（ロールの持ち主）が再び効きます。本番に残っているロールの持ち主のアイテムは、1 ロール 1 プールの不変条件を満たしたまま残っているので、整合しています。ユーザプールの表示名（`displayName`）は、META に残っていれば再び表示されます。
- **戻す手順**: SPA と Lambda を前の版に戻す（「経路別の手順」の SPA だけを戻す場合と同じ）。`pool_id` は前の版の Terraform には無いので、戻した版でそのまま plan すると、変数の削除として表れる。
- **戻さなくてよい理由**: この変更の間に作ったデータは、前の版でもそのまま読めます（新しい属性やアイテムの種類は足していません）。

## 状態テーブルと申請テーブルへの分割の切り戻し（Issue #36）

（Issue #36 により 2026-09-27 追記）分割（`one-time-migrations.md`「状態テーブルと申請テーブルへの分割（Issue #36、一度だけ）」。Issue #178 により 2026-10-18 訂正。訂正前は README）を戻す手順。**反映後に画面で行った変更（状態・申請とも）は失われる。**

旧テーブル `rolust` をまだ消していないとき:

1. 分割の PR を revert する PR を作り、マージする。
2. 旧テーブルを Terraform の管理に戻してから反映する（revert した構成には `aws_dynamodb_table.rolust` があり、`removed` が無い）。

   ```bash
   export AWS_PROFILE=<デプロイ先のプロファイル> AWS_REGION=<デプロイ先のリージョン>
   terraform -chdir=infra init -backend-config=backend.hcl
   terraform -chdir=infra import aws_dynamodb_table.rolust rolust
   terraform -chdir=infra plan -out=tfplan
   terraform -chdir=infra show -json tfplan > plan.json
   ./.github/scripts/plan-guard.sh plan.json
   terraform -chdir=infra apply tfplan
   ```

   plan では `aws_dynamodb_table.state` と `aws_dynamodb_table.change_requests` が destroy、Lambda 3 本と実行ロールのポリシーが update になる。`aws_dynamodb_table.rolust` に create や `-/+` があれば apply しない（import が効いていない）。`aws_dynamodb_table.rolust` 自身が PITR・SSE・タグに限った in-place の update になるのは許容します（Issue #36 により 2026-09-27 追記）。

旧テーブルを消した後: 退避（`rolust-before-split`）から `rolust` を復元してから、上の手順を行う。

```bash
aws dynamodb list-backups --table-name rolust --query "BackupSummaries[?BackupName=='rolust-before-split'].BackupArn" --output text
aws dynamodb restore-table-from-backup --target-table-name rolust --backup-arn <上の ARN> \
  --sse-specification-override Enabled=true,SSEType=KMS
aws dynamodb wait table-exists --table-name rolust
aws dynamodb update-continuous-backups --table-name rolust --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
```

復元したテーブルは PITR が無効で作られるので、最後の行で有効にする（Terraform の定義と合わせる）。`--sse-specification-override` は Terraform の `server_side_encryption { enabled = true }`（AWS 管理キー）に合わせるためのものです（Issue #36 により 2026-09-27 追記）。この節の `rolust` は `one-time-migrations.md`「状態テーブルと申請テーブルへの分割（Issue #36、一度だけ）」（Issue #178 により 2026-10-18 訂正）の `ROLUST_LEGACY_TABLE_NAME`（旧 Terraform 変数 `table_name` の値。既定は `rolust`）と同じ名前です。上の import・restore の各コマンドも、`table_name` を上書きしていたらその値に読み替えてください（Issue #36 により 2026-09-27 追記）。
