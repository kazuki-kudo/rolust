---
paths:
  - "infra/**"
  - ".github/**"
---

# AWS・Terraform・CI/CD の規則

## 管理対象ロールの範囲（現状）

- 信頼ポリシーを読み書きしてよいロールは、タグ条件 `aws:ResourceTag/<managed_tag_key>` = `<managed_tag_value>`（既定は `rolust:managed` = `true`）で絞る。Resource はアカウント内の全ロール（`role/*`）。以前のロール名接頭辞による方式は廃止済みで、旧リポジトリの `aidlc/` の記録に残る接頭辞前提の記述は現行ではない。
- `iam:TagRole` は誰にも付与しない。タグを付けるのは運用者であり、管理対象の増減は `terraform plan` に現れない（受容リスク R-e）。
- タグはどのロールにも付きうるため、Rolust 自身のロールを守る明示の防御は `DenySelfEscalation` だけである。Rolust が作る IAM ロールを増やしたら、その ARN を `infra/main.tf` の `self_role_arns` に必ず加える。加え忘れは plan-guard の赤信号 R-10 が落とす（Issue #24）。
- 別アカウントのロールは、ターゲットアカウントに作った `RolustTrustPolicyReader`（CRUD・Diff）と `RolustTrustPolicyManager`（Apply）を AssumeRole して操作する（Issue #85。`docs/guide/cross-account.md`）。ターゲット側は Terraform の管理外で、CloudFormation テンプレート `cloudformation/target-roles.yaml` が唯一の定義である（Issue #92 により 2026-10-13 訂正。訂正前は手動で作るとしていた）。デプロイ先の `sts:AssumeRole` は `infra/lambda.tf` の `crud_assume_target_reader`・`diff_assume_target_reader`・`apply_assume_target_manager` の 3 ポリシーだけである。plan-guard の赤信号 R-12 が、Action・Resource のロール名・Reader と Manager の取り違え（ポリシーの `role` 属性を含む）・ほかのポリシーへの `sts` の Action の混入（大文字小文字と `NotAction` を含む）・実行ロール（名前が `-exec` で終わるロール）への管理ポリシーのアタッチやインラインポリシーの追加を見る。ターゲット側の権限（Manager の `DenySelfEscalation` など）は R-12 の対象外なので、`cloudformation/target-roles.test.sh`（CI の `release-artifacts` ジョブ）と実測で確かめる（Issue #92 により 2026-10-13 訂正。訂正前は README の JSON との突き合わせ）。テンプレートを変えたら、このテストも同じ PR で直す。
- Rolust の Lambda の実行ロールを作り直す（replace）と、ターゲット側の信頼ポリシーの Principal（ロールの ARN。IAM が一意の ID に置き換えて保持する）が無効になり、別アカウントの引き受けが `AccessDenied` になる。作り直したら、ターゲットのスタックを削除して作り直す（`target_roles_deploy_command` の再実行だけでは CloudFormation が「変更なし」と判断して直らない。Issue #92 により 2026-10-13 実測、訂正前は信頼ポリシーを更新し直すとしていた）。
- 別アカウントの操作で、AssumeRole に失敗したときに、デプロイ先の資格情報で呼び直してはならない（Issue #27 の再発防止）。IAM の API は `RoleName` しか受け取らず、呼び出しに使った資格情報のアカウントに対して解決される。資格情報の選択は `packages/api/src/aws/iam-client.ts` の `resolveClient` に閉じてある。

## Terraform

- state は jump アカウントの共有 state バケットに置き、鍵は `rolust/infra/terraform.tfstate`。ロックは S3 ネイティブ（`use_lockfile`、Terraform 1.10 以上）で、DynamoDB テーブルは使わない。実バケット名は `infra/backend.hcl`（gitignore 済み）にある。
- `infra/bootstrap/` は、state バケットを持たない第三者向けの任意経路として残す。jump は既存バケットを指すだけで bootstrap を実行しない。削除すると第三者が `terraform init` で行き止まりになり、NFR-4 / SM-2 が成立しない。
- 自分が使う Terraform backend は、自分の設定では管理できない（鶏卵構造）。そこへ加えた統制は IaC に載らないため、再現コマンドと「IaC 管理外である」事実を文書に明記する。
- リソース名は属性を保証しない。state バケット名に ap-northeast-1 とあっても、実体は us-east-1 でありうる（`terraform init` が HTTP 301 で落ちて判明した）。名前から読み取らず、`aws s3api head-bucket` などで実測する。
- `aws_s3_object` を `for_each = fileset()` で管理しているため、ビルドで名前が変わったアセットは for_each のキーから外れて destroy される。SPA を反映・ロールバックするたびに直前のアセットが消え、開いたままのタブの遅延チャンクが壊れる。前提は文面ではなく plan の destroy 件数で確かめる。
- 設計文書が「X の全権限に加えて」と書きつつ差分だけを列挙していたら、文言ではなく意図に合わせて実装する（`terraform apply` は refresh を伴うため、plan で要る読み取り権限は apply でも要る）。
- apply の前に確かめるべき前提（例: `iam:GetRole` のタグ条件の Access Analyzer による実測）は、apply する時点ではなく、それより前に実環境へ到達できる段階で実測する。失敗が apply の直前で初めて見えるのを避けるため。
- `archive_file` には `output_file_mode = "0644"` を必ず付ける。付けないと zip に記録されるファイルモードが OS に依存し（Windows では 0666、Linux では 0644）、中身が同じでも `source_code_hash` が変わる。手動の apply（Windows）と CD の plan（Linux）が互いを差分として出し続けた（Issue #38。CD は Issue #181 で廃止した。OS をまたいで plan・apply する導入先には今も効く）。

## Lambda@Edge・CloudFront

- Lambda@Edge の実行ロールの信頼ポリシーには `lambda.amazonaws.com` と `edgelambda.amazonaws.com` の両方を含める（片方だけではレプリケーションできない）。関数とロールは us-east-1 に作る。
- CloudFront のカスタムエラー応答（`custom_error_response`）は置かない。ディストリビューション全体に効くため、403 を割り当てると API の 403（権限なし。FR-6.5）が、404 を割り当てると API の正当な 404 が HTML の 200 に化ける（Issue #141 で 403 の書き換えを外した。応答ヘッダー `x-cache: Error from cloudfront` で見分けられる）。SPA のディープリンクは、Lambda@Edge（`packages/edge-auth` の `rewriteSpaRoute`）が、認証を通した後に uri を `/index.html` へ書き換える。
- API Gateway の直 URL（`https://<id>.execute-api.<region>.amazonaws.com/<stage>`）は、CloudFront を通らないので Basic 認証（FR-6.1）も IP 許可リスト（FR-6.2）も効かない。CloudFront の API オリジンが `x-api-key` を付け、メソッドが `api_key_required = true` でそれを要求することで、直 URL を Lambda に届かせない（FR-6.3、Issue #76）。API Gateway のメソッドを足すときは `api_key_required = true` を付ける。付け忘れや外れは plan-guard の赤信号 R-11 が落とす。メソッドの設定は `aws_api_gateway_deployment` の `triggers` にも入れる（入れないと、変えても再デプロイされず、apply が成功したのに挙動が古いまま残る）。
- `auth_mode = "cognito"` の Cognito のクライアントのコールバック URL は CloudFront のドメインを参照し、CloudFront は `edge_auth_ssm` に依存する。ポリシーの Resource に `aws_ssm_parameter.auth_cognito` の ARN を参照で書くと、「ポリシー → パラメータ → クライアント → CloudFront → ポリシー」の循環になる。`auth_cognito` の ARN は名前とアカウントから文字列で組み、CloudFront の `depends_on` に `auth_cognito` を入れない（Issue #20）。依存の循環は `terraform validate` では見えず、`TF_VAR_auth_mode=cognito terraform graph`（S3 バックエンドのままだと資格情報を要求するので、`backend_override.tf` で local バックエンドに差し替えて init してから）で検出する。CI の `terraform` ジョブに同じ検査がある。

## 監視

- メトリクスの名前は意味を保証しない。監視対象を決める前に、ハンドラの例外経路を読む。`AWS/Lambda` の `Errors` は、例外を捕捉して正常終了する実装では増えず、最も起きやすい失敗を計上しない。

## CI/CD

- 承認ゲートが成立しない特権経路は、ワークフローの変数を置かないことではなく、引き受け先のロールを消して塞ぐ。引き受けの可否を決めるのは信頼ポリシーであり、変数はワークフローがロールを使わないようにするだけである（`environment: production` を持つジョブを `main` で走らせれば、ARN の直書きで引き受けられた）。この理由で `rolust-ci-apply` を削除した（Issue #51、`docs/design/cd-config.md` D-7）。
- 外部サービスの副作用で生まれた中間状態は、削除すれば「無かったこと」にできるかを確かめてから扱いを決める。（`cd.yml` は Issue #181 で廃止した。以下は当時の判断の記録である。）`cd.yml` は参照時に GitHub Environment を自動作成するため、削除しても「無い」状態は保てない。残して branch policy で強化する方が実効的だった。ロールを削除した後も、Environment `production` は `main` 限定の branch policy を付けて残してある（同 D-7）。
- このリポジトリの OIDC トークンの `sub` は**不変 ID の形式**である（リポジトリの設定が `use_immutable_subject: true`）。CI ロールの信頼ポリシーはこの形式の完全一致で書く。現行の値は `docs/design/cicd-pipeline.md` § 信頼ポリシー にある。旧リポジトリの `aidlc/` の記録にある、所有者名とリポジトリ名だけの形式の値は現行ではない。CI ロール（`rolust-ci-plan`・`rolust-ci-apply`）は、どちらも削除した（`rolust-ci-apply` は Issue #51、`rolust-ci-plan` は Issue #181。CD を持たないため）。再作成するときは、Terraform の管理外（タグ `ManagedBy=manual-4.2`）で、`aws iam create-role` などの CLI で行う（Issue #38）。
- （`rolust-ci-plan` を再作成した場合）CI ロールの権限（インラインポリシー `terraform-plan`）も Terraform の管理外であり、`infra/` に資源型を足しても自動では追従しない。資源型を足したら、refresh が呼ぶ API を洗い出して plan ロールに足す。洗い出しは、自分の管理者プロファイル（`AWS_PROFILE`）で `TF_LOG_PROVIDER=DEBUG terraform plan -lock=false` を走らせてデバッグログの `HTTP Request Sent` から `rpc.method` を抜き（記録は複数行にまたがり、サービス名は空白を含む）、IAM アクションに写像して `aws iam simulate-principal-policy` にかける。追従を怠った例（監視 4.4 のアラーム）と、足したアクションは、`docs/design/cicd-pipeline.md` § 権限ポリシー の注記にある（Issue #38・#40）。
- `rolust-ci-apply` を再作成するときは、書き込み権限をアクションの列挙ではなくサービス単位（`<service>:*`）で足す。書き込み側のアクションは plan のログに現れず、列挙の漏れは apply の途中で初めて現れるため（Issue #40）。
- CI ロールの信頼ポリシーや権限ポリシーを変えたら、`docs/design/cicd-pipeline.md` の JSON も同じ PR で直す。実体が IaC の外にあるため、文書との食い違いを機械が検知しない。直した後、`aws iam get-role`・`get-role-policy` の出力と正本の JSON を `jq -S` で比べる（Issue #39）。
- デバッグログから `rpc.method` を抜くときは、引用符付きの値（`rpc.method="API Gateway/GetRestApi"` のようにサービス名が空白を含むもの）も拾う。拾い漏らすと API Gateway と CloudWatch Logs が丸ごと抜け、57 操作のはずが 46 操作になる。抜いた後、SSO と STS を除いた操作数を前回の実測（2026-09-26 時点で 57 操作・50 アクション）と突き合わせる。デバッグログには SSO のベアラートークンが平文で残るため、抽出が済んだら削除する（Issue #40）。
- OIDC の `sub` は既定の形式を仮定しない。`gh api repos/<owner>/<repo>/actions/oidc/customization/sub` で設定を読み、実際に届いた値は CloudTrail の `AssumeRoleWithWebIdentity`（STS を呼んだリージョン）の `userIdentity.userName` で確かめる。形式の食い違いは `Not authorized to perform sts:AssumeRoleWithWebIdentity` としか現れず、CD が 1 か月間一度も成功しなかった。
- CI ゲートの対象外である重大度の検出（Trivy の MEDIUM 以下など）を `.trivyignore.yaml` に書かない。書くと「その重大度も見ている」という誤った印象を与える。代替の監査手段があるなら手順書に記す。
