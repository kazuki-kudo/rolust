# セキュリティ点検の記録（2026-10-23〜2026-10-24）

OSS 公開（Issue #11）の前に、Rolust 自体の脆弱性を横断的に点検した記録である（Issue #194）。**点検した観点・方法・発見・対処**を残す。これは設計の正本ではない — 設計の決定は `docs/design/` に、脆弱性の報告窓口は `SECURITY.md` にある。

Rolust は他アカウントの IAM ロールの信頼ポリシーを書き換える管理ツールなので、侵害時の影響（特権昇格、他アカウントへの足掛かり）が大きい。優先度はその性質で付けた。

実値（アカウント ID・配信ドメイン・IP・メール）は書かない（`CLAUDE.md` § 保護値）。実測の記録は、件数と種類だけを残している。

## 点検の方法

| 方法 | 対象 |
|---|---|
| コードの読み取り（攻撃経路を立てて否定する） | `packages/core`・`packages/api`・`packages/edge-auth`・`packages/web`、`infra/`、`cloudformation/`、`.github/workflows/`、`.github/scripts/` |
| 機械的な検査（CI と同じ版・同じ引数） | `npm audit`（依存の既知脆弱性）、`trivy config`（Terraform・CloudFormation）、`gitleaks` と保護値の検査、`cfn-lint`、`plan-guard`、`cloudformation/target-roles.test.sh` |
| 権限評価の実測 | `aws iam simulate-principal-policy`（期待値つき 29 件。読み取りだけで、IAM を書き換えない） |
| 実際の HTTP による実測 | API Gateway の直 URL、CloudFront の未認証アクセス、配信ヘッダ |
| 構成の実測 | S3・DynamoDB・SSM・API Gateway の設定を AWS CLI で読み出し、Terraform の定義と突き合わせる |

ユニットテストと統合テスト（`ROLUST_INTEGRATION=1`）は、この点検の手段ではなく、点検で入れた修正の回帰を固定する手段である。

## 直したもの

| | 深刻度 | 内容 | 対処 |
|---|---|---|---|
| F-1 | 高 | `npm audit --audit-level=high` が high 勧告で落ちる。手元の npm 9.6.2 が同じ lockfile で exit 0 を返すため、push 前の確認をすり抜けていた | 版を上げ、手元の確認を `npx -y npm@11 audit` に改めた（`.claude/rules/shell-and-aws-cli.md`） |
| F-2 | 高 | 脆弱性の報告経路が無い。公開後の既定の行き先は公開 Issue になり、修正前に再現手順が公開される | `SECURITY.md` を置いた |
| F-4 | 中 | サードパーティの GitHub Action が可変タグ参照。タグは別のコミットへ付け替えられる | commit SHA で固定した |
| F-5 | 中 | CI が取得する trivy・gitleaks の tarball を照合していない。どちらも混入を見張る側のコードである | SHA-256 で照合してから展開する |
| G-1 | 中 | 交点（Assignment）の保存が、プールに登録済みでない IAM ユーザでも通った。許可アカウント ID の許可リスト（FR-1.11）・ユーザの登録・命名規則の 3 つを迂回できた | 保存をプール登録済みのユーザだけに限り、それ以外は 409 で拒否する |
| G-2 | 中 | 反映が `Sid: RolustManagedPrincipals` を重複して作りうる（IAM は Sid の一意性を要求する） | 採用できない形で既にあるときは、Sid を重複させず、読める理由で反映前に拒否する |
| G-3 | 低 | Release の tarball に `SECURITY.md` が入っていない | 同梱した |
| H-1 | 低 | ロールの登録が Rolust 自身の実行ロール 5 本を拒否していない。`DenySelfEscalation` は効くが、違反は操作の連鎖の末尾（反映）で初めて現れる | 登録の時点で 400 で拒否する（`ROLUST_SELF_ROLE_ARNS`。`docs/design/requirements.md` FR-2.1 の注記） |

対応する PR: F-1〜F-5 は #195、G-1〜G-3 は #196、H-1 と本書は #197。

## 文書化だけにしたもの

| | 内容 | 判断 |
|---|---|---|
| F-3 | Basic 認証に総当たりへの対策（レート制限・ロックアウト・試行の記録）が無く、文書からそれが読み取れない | 文書に明記した（`docs/guide/access-control.md`）。IP 許可リストの既定（全開放）は変えない。WAF は導入しない |

## 許容して残したもの

直さないと決めた項目である。再提案しない。

| | 内容 | 理由 |
|---|---|---|
| F-6 | CloudFront のアクセスログを取っていない（trivy の `AWS-0010`、MEDIUM） | ログ用バケットが増え、`terraform apply` が作るものが増える。監視を持たない方針と整合する |
| F-7 | Cognito の MFA が無効（`mfa_configuration = "OFF"`） | 初回サインインの手順が増える。要る人は Terraform で有効にできる（F-3 の文書化で明示） |
| F-8 | ID トークンの有効期限が 1 日（Cognito の上限） | 失効させられないことは `docs/guide/access-control.md` に明記済み。短くすると再サインインが頻発する |
| F-9 | CloudFront に `minimum_protocol_version` を指定していない | 既定の証明書では指定できない。独自ドメインを持つまで選択肢が無い |
| F-10 | `pip install "cfn-lint==<版>"` が版の固定までで、hash を固定していない | requirements ファイルを別に持つ必要があり、PyPI の信頼モデルは GitHub Release と異なる。F-5 と同じ手当てでは閉じない |
| — | Release の tarball の build provenance（署名付き証明） | tarball と `SHA256SUMS` を添付し、同一経路であることの限界まで `docs/guide/setup.md` に書いてある。証明の追加は、現状の配布規模に対して過剰と判断した |

## 攻撃経路として立てて、否定したもの

塞がっていることをコードで確かめた項目である。**塞いでいる機構を弱める変更が来たら、ここに戻ること。**

### 認証・認可

- **`x-rolust-actor` の偽造** — `packages/edge-auth/src/index.ts` の `handler` が、どのプロバイダよりも先に `stripActor(request)` を無条件で呼ぶ。閲覧者が付けたヘッダは API に届かない
- **API Gateway の直 URL での認証回避** — CloudFront の `custom_header` の `x-api-key` と、メソッドの `api_key_required = true`（FR-6.3）。plan-guard の R-11 が外れを検出する
- **JWT の検証の抜け** — `jwt.ts` は `alg === "RS256"` を固定し、`kid` を要求し、署名を検証してからクレームを読み、`iss`・`aud`・`token_use`・`exp` を見る。鍵が取れなければ 503（fail-closed）
- **権限の判定の迂回** — ルートの `requires` を書き忘れたときの既定は `"apply"`（最上位）で fail-closed。画面側の有効・無効は表示の都合にすぎず、拒否は API が行う
- **オープンリダイレクト** — `providers/oidc.ts` の `safeReturnPath` が `//` と `/\` を拒否する
- **CSRF** — 状態を変える API は `PUT`/`POST`/`PATCH`/`DELETE` と `Content-Type: application/json` を要し、セッションの Cookie は `SameSite=Lax`。API は CORS ヘッダーを返さないのでプリフライトも通らない

### 権限昇格・アカウント境界

- **ターゲットアカウントでの自己昇格** — `cloudformation/target-roles.yaml` の Manager に Reader+Manager を対象とする `DenySelfEscalation`。デプロイ側は `infra/lambda.tf` の `apply_iam_write`
- **Reader と Manager の取り違え** — `sts:AssumeRole` の Resource はロール名固定で、CRUD・Diff は Reader だけ、Apply は Manager だけを引き受ける（FR-3.2）。plan-guard の R-12 が見張る
- **ターゲット側ロールの ExternalId（confused deputy）** — 信頼する Principal をデプロイ先の実行ロールの ARN に固定しているため不要と判断した。ExternalId は第三者のサービスが多数の顧客を代理する構図で要るもので、値を持たせても Lambda の環境に載るだけで新しい境界にならない
- **保全方式マージの不変条件** — `core/src/merge.ts` は、凍結入力に無い principal・Condition・Deny を触らない（`merge.test.ts`）

### 入力検証・インジェクション

- **信頼ポリシーの JSON によるプロトタイプ汚染** — `core/src/trust-policy.ts` の `validateDocument` はオブジェクトスプレッドで組み直す（`Object.assign` ではない）。`core/src/permission.ts` のグループ照合と `core/src/messages/render.ts` の ID 解決は `hasOwnProperty.call` / `Object.hasOwn` を使う。CSV の列名が `__proto__` のときも、自前のプロパティとして定義する（`core/src/user-csv.ts`）
- **DynamoDB の式の組み立て** — 属性名・値はすべてプレースホルダ（`#name`・`:value`）で渡す。利用者の入力が式の文字列に入る経路が無い
- **SPA の XSS** — `packages/web` に `dangerouslySetInnerHTML`・`innerHTML`・`eval`・`new Function`・`postMessage`・`iframe`・`Worker` の経路が無い。色の指定は許可リストを引く（`core/src/role-color.ts`）。`href` はコード中の定数パスか `encodeURIComponent` を通した内部パス
- **CSV インジェクション** — CSV は入力だけで、出力する経路が無い
- **ソースマップ・秘密のバンドルへの混入** — `sourcemap: false`。ビルド時に読む環境変数は API のベース URL だけ（本番は未設定）

### 配信・インフラ

- **CSP の実効性（Issue #13）** — `default-src 'none'` を起点に、`script-src 'self'`・`base-uri 'none'`・`form-action 'none'`・`frame-ancestors 'none'`。インラインスクリプトも `eval` も無いので、`script-src` に `'unsafe-inline'`／`'unsafe-eval'` を与えずに済んでいる
- **API 応答のキャッシュによる他人のデータの混入** — `/api/*` は `Managed-CachingDisabled`。SPA 側は Cookie をオリジンへ転送しない
- **S3 オリジンへの直接アクセス** — パブリックアクセスのブロック 4 項目と、`cloudfront.amazonaws.com` の `s3:GetObject` だけを `AWS:SourceArn` 付きで許すバケットポリシー（OAC）

### サプライチェーン・CI

- **Actions のスクリプトインジェクション** — `pull_request_target` を使わず、`run` に `github.event.*` を展開していない
- **CI から AWS へ到達する経路** — 公開リポジトリでは CD を持たない。引き受け先の CI ロールは削除済みで、ワークフローの `permissions` は最小（`contents: read`、Release のジョブだけ `contents: write`）
- **Release の tarball の内容** — `check-release.sh` が、`backend.hcl`・`terraform.tfvars`・`*.tfstate` が入っていないことを検査する

### 設定・構成・サプライチェーンの個別の判定

上の経路とは別に、設定値そのものを読んで判定した項目である。

| 観点 | 判定 |
|---|---|
| Cognito のパスワードポリシー | 12 文字以上、大小英字・数字・記号すべて必須、一時パスワードの有効期間 7 日。`prevent_user_existence_errors = "ENABLED"`（存在しないユーザ名と誤パスワードを区別させない）。OAuth は認可コードフローと `openid` スコープだけ（暗黙フローは無効） |
| IP 許可リストの迂回 | 判定に使うのは CloudFront が与える `request.clientIp` で、`X-Forwarded-For` は**使わない**（偽装できるため）。許可リストを読めなければ 503（fail-closed）。既定値は全開放で、これは F-3 の文書化の対象 |
| エラー応答・ログの漏洩 | 未処理の例外は定型文の 500 にし、原因はログにだけ残す。`ConfigurationError` の運用者向けの文も画面には返さない。`x-rolust-actor` の値はログに出さない（秘密でない保証が無いため）。5xx の本文に入る AWS のエラー詳細は、管理者がその操作で扱っている対象の情報に限る |
| Lambda の環境変数に載る値 | テーブル名・プール識別子・タグのキーと値・引き受けるロール名・認証方式・SSM のパラメータ名・自己ロールの ARN。**資格情報と秘密は載らない**（NFR-3） |
| Terraform state・tfvars | `terraform plan` が SecureString を復号して state に書くことと、その扱いは `docs/guide/limitations.md` に記録済み。構成側は `value = "REPLACE-ME-AFTER-APPLY"` と `ignore_changes = [value]` で、実値をコードに置かない |
| `.trivyignore.yaml` の例外 | 2 件（CloudFront に WAF を付けない、SPA バケットを SSE-S3 にする）。どちらも根拠が現行の決定と整合し、期限（2027-02-10）が生きている。CI ゲートの対象（CRITICAL / HIGH）以外は書かれていない |
| 依存の `install` 系スクリプト | 実際に走るのは `esbuild` の `postinstall` 1 件だけ。ほかに見える `prepare` は、レジストリからの導入では実行されない |
| 直接依存の保守状態 | 31 件のうち 30 件が直近 2 か月以内に公開され、`deprecated` の付いたものは無い。`aws-sdk-client-mock` だけ 2024-10-15 で止まっているが、テスト専用でバンドルに入らない |
| 申請者と反映者の分離 | **分離する仕組みは持たない**（`applier` ⊃ `editor` の階層なので、同じ人が申請して反映できる）。迂回する対象が無い、という意味で設計どおりである。ChangeRequest の状態遷移の排他（FR-5.8）は別に確認した。`docs/guide/access-control.md` に明記した |
| 利用者がターゲットアカウントへテンプレートを適用する経路 | `cloudformation/target-roles.yaml` は、パラメータに `AllowedPattern` を持ち、`Rules` で Reader と Manager の同名を拒否する（同名だと CRUD・Diff が更新用のロールを引き受けられる）。不変条件は `cloudformation/target-roles.test.sh` が CI で見張り、構文と型は `cfn-lint`（版を固定）が見る |

## 実測（2026-10-24）

### 権限境界（`simulate-principal-policy`、29 件）

期待値（`allowed` / `implicitDeny` / `explicitDeny`）を先に決めてから照合し、**食い違いは 0 件**だった。タグ条件は `--context-entries` で与え、「タグあり」「タグなし」の両方を引いた。

- Apply は管理タグの付いたロールだけ更新でき、タグなしは拒否（2 件）
- `DenySelfEscalation`: Rolust 自身の 5 ロールは、**タグが付いていても** `explicitDeny`（5 件）
- CRUD・Diff は更新権限を持たない（FR-3.2。2 件）、誰も `iam:TagRole` を持たない（3 件）
- 読み取り（`iam:GetRole`）もタグ条件つき（2 件）
- クロスアカウントの引き受けに Reader / Manager の取り違えが無い（6 件）、edge-auth は IAM を触れない（1 件）
- ターゲット側 Manager: タグ条件つきで更新でき（2 件）、Manager・Reader 自身は `explicitDeny`（2 件）、`iam:TagRole` なし（1 件）
- ターゲット側 Reader: 更新できず、読み取りもタグ条件つき（3 件）

いずれのロールも少なくとも 1 件は `allowed` を返した（存在しない ARN を指して全件が拒否に見える取り違えが起きていないことの確認）。

### 境界と配信

| 実測 | 結果 |
|---|---|
| API Gateway の直 URL（API キー無し／偽のキー） | いずれも 403 |
| CloudFront に未認証で `GET /` | 302（Cognito の認可エンドポイントへ） |
| CloudFront に未認証で `GET /api/me`・`POST /api/apply` | 401（HTML の 200 に化けない） |
| 配信ヘッダ | CSP・HSTS・X-Frame-Options・X-Content-Type-Options・Referrer-Policy が定義どおり（未認証の 302 にも付く） |
| S3 | パブリックアクセスのブロック 4 項目、既定の暗号化、バージョニング、OAC 条件付きのバケットポリシー |
| DynamoDB（2 テーブル） | 暗号化・PITR とも有効 |
| SSM | Basic 認証の資格情報だけが `SecureString` |
| API Gateway | メソッド 6 件すべて `apiKeyRequired=true` |

## 公開に伴う残作業（別 Issue）

- private vulnerability reporting の有効化は新リポジトリ側の作業（Issue #182・#183）
- `SECURITY.md` の参照先 URL は、新リポジトリの URL に追従させる（Issue #182）
- 公開後に Dependabot・secret scanning・push protection を有効にするかの判断（Issue #183）

## 点検で学んだ、運用に残る注意

- **依存監査（`npm audit`）は、依存を変えなくても時間の経過だけで赤くなる。** 2026-10-23 に vite、10-24 に undici・zod が新規の high 勧告で落ちた。赤を見たら、まず `npx -y npm@11 update <pkg>` で親の範囲内に収まるかを見て、収まらなければ宣言を上げる。どちらもできなければ、影響しない根拠を記録して扱いを決める（`.github/workflows/ci.yml` の注記）
- **手元とCI で監査の終了コードが違う。** npm 9.6.2 は high 勧告があっても exit 0 を返す。push 前の確認は `npx -y npm@11 audit --audit-level=high` で行う
- **基盤層だけの制約は、違反が操作の連鎖の末尾で現れる。** H-1 はこの形だった。制約は、それを作り込んだ操作の場（登録時など）でも検証して返す
