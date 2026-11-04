# サイトの IP アドレス制限と、API Gateway の直 URL の遮断 — 設計

- 日付: 2026-09-29
- Issue: #76
- ブランチ: `feat/76-ip-allowlist`
- 状態: 設計承認済み（brainstorming の第 1〜2 部）、spec レビュー待ち

> **追記（Issue #177 により 2026-10-18）**: 実値の混入を防ぐ検査（`.gitleaks-protected.toml`）の導入に伴い、本文の例示の IPv4 のうち文書用の範囲（RFC 5737）に無いもの（81 行目のホストビットの例と、186 行目の不正な入力の例のうち 5 つ組とプレフィックス付きの 4 件）を、`203.0.113.x` に置換した。いずれも例示値で、実値ではない。検証の意味（ホストビットのマスク、プレフィックスの範囲外、5 つ組、先頭の 0）は変わらない。実装のテストデータ（`packages/edge-auth/src/ip-allowlist.test.ts`）は、境界値を表すために非文書用の値を使い、検査側で許可している。

## 1. 背景と目的

### 起きていること

- **IP 制限が無い。** `infra/` に WAF・IP セット・API Gateway のリソースポリシーは無く、CloudFront の地理制限も `none`。README「Basic 認証は「最小限のアクセス制限」である」も、IP 制限は行っていないと明記している。管理画面への制限は、Lambda@Edge（`packages/edge-auth`）の Basic 認証だけである。
- **API Gateway の直 URL は認証なしで Lambda に届く。** REGIONAL エンドポイントの 3 メソッド（`diff`・`apply`・`{proxy+}`）は `authorization = "NONE"` で、リソースポリシー・API キー・オリジン向けのシークレットヘッダーも無い。2026-09-29 に実測した。認証なしで直 URL に `GET /api/x-probe-76`（存在しないパス）を送ると、アプリの 404 JSON（`RouteNotFound`）が返る。同じパスを CloudFront 経由で送ると 401 になる。この経路は受容したリスク R-a として記録されている（`requirements.md` FR-6.1 の注記、`iam-policy-design-note.md` § 4）。
- したがって、CloudFront の側に IP 制限を足しても、直 URL には効かない。反映の API（`/api/apply`）がその先にある。

### 依頼の内容

Issue #76（依頼者、2026-09-29）:

- サイトに IP アドレス制限を追加する。許可する IP アドレスは SSM パラメータストアに登録する。
- CIDR 形式（`/24` など）をサポートする。CIDR を指定しなければ、その IP アドレスだけをピンポイントで許可する。カンマ区切りで複数登録できる。
- CloudFront でガードする。コストを掛けないため、現行の Lambda@Edge 関数に組み込む。

追加の決定（2026-09-29、依頼者が直 URL について質問し、範囲に含めると決めた）: API Gateway の直 URL を塞ぐ。方式は CloudFront が付ける API キー（案 A）。

### 前提（実測・確認）

- 本番の CloudFront は IPv6 が無効（`IsIPV6Enabled=False`）、`PriceClass_100`、既定のルートオブジェクトは `index.html`。ビューアーは IPv4 でしか到達できない。
- 単一の関数 `rolust-edge-auth` が、default と `/api/*` の両方の viewer-request に付いている。viewer-request はキャッシュヒット時にも実行される（`infra/cloudfront.tf`）。
- 関数は SSM（us-east-1）から資格情報を読み、実行コンテキストに 5 分キャッシュする（`CACHE_TTL_MS`）。取得できない、または書式が不正なときは 503 で通さない（fail closed）。
- CI の plan ロール（`rolust-ci-plan`）は `ssm:GetParameter*` を `Resource: "*"` で持つ（`cicd-pipeline.md` § 権限ポリシー）。新しい SSM パラメータを読むのに、ロールの変更は要らない。
- plan-guard の R-8 は `aws_ssm_parameter.basic_auth` だけを見る。R-5 は CloudFront の関連付け、R-10 は `DenySelfEscalation` の網羅を見る。
- `aws_api_gateway_deployment` の `triggers` は、リソースと統合の ID だけを入れている。メソッドの設定（`api_key_required`）を変えても再デプロイされない。
- リポジトリ内に、API Gateway の直 URL を叩く道具・テスト・CI は無い（grep）。README の `VITE_ROLUST_API_BASE_URL` は、API が CORS ヘッダーを付けない設計（`packages/api/src/http.ts`）のため、デプロイ済みの API を別オリジンから直接叩く用途には元から使えない。
- AWS プロバイダーは `~> 6.0`。`aws_api_gateway_api_key` は値を自動生成し、sensitive として扱う。`random` プロバイダーは要らない。

### 成功基準

1. 許可リストに含まれない IP からのアクセスが、`/` と `/api/...` の両方で 403 になる。含まれる IP からは、Basic 認証の判定に進む（認証なしなら 401）。
2. 許可リストが空・不正・取得不能のときは、どのアクセスも通さない（503）。
3. 反映直後（初期値 `0.0.0.0/0`）の挙動は、現状と同じである（認証なしで 401）。
4. API Gateway の直 URL に、キーなしまたは誤ったキーでリクエストすると 403 になり、Lambda が呼ばれない。CloudFront 経由の API は動く。
5. `plan-guard` が、許可リストの値の上書き（R-8 の拡張）と、直 URL を再び開く変更（R-11）を赤信号にする。回帰テストが緑である。
6. 反映後の `terraform plan` が No changes で、`main` の CD が緑になる。
7. 正本（4 節）が実装と一致し、`R-1〜R-10` などの古い記述が現行の一覧として残っていない。
8. README の設定手順と復旧手順を、経路として実行して通っている。

## 2. 決定事項

| # | 決定 | 根拠 |
|---|---|---|
| 1 | 現行の edge-auth に組み込む。WAF・CloudFront Functions は使わない | 依頼者の制約（コストを掛けない、現行の関数に組み込む）。WAF は固定費がかかり、CloudFront Functions は従量課金と新しい部品が増える。標準の SSM パラメータは無料 |
| 2 | 許可リストの初期値は `0.0.0.0/0`。実行時に空・不正・取得不能なら 503（Q1 = A） | 反映直後は現状と同じ挙動で、締め出しが起きない。設定の異常は必ず閉じる側に倒れる（fail closed）。IP 制限を使わない第三者は、初期値のままでよい |
| 3 | 直 URL の遮断を #76 に含める。方式は API キー（案 A） | 依頼者の決定（Q2）。IP 制限の目的（外部から反映の API を叩かせない）を、実際に果たすため。Lambda を呼ぶ前に弾け、アプリのコードを変えず、直叩きの 403 を機械的に実測できる |
| 4 | リソースポリシーの `aws:SourceIp` は使わない | CloudFront の送信元 IP は共有で、他人の CloudFront からも同じ IP で届く。絞れない |
| 5 | IPv4 の CIDR 判定は自前で書く。ライブラリは入れない | 32 ビット整数の演算で足りる。依存を増やさず、バンドルと `npm audit` の対象を増やさない |
| 6 | 判定に使う IP は `request.clientIp`。`X-Forwarded-For` は使わない | `clientIp` は CloudFront が見た接続元で、ビューアーが偽装できない。ヘッダーは偽装できる |
| 7 | 判定の順序は IP、次に Basic 認証。拒否は 403 | 拒否した IP には資格情報の取得も認証の情報も渡さない。401 と区別できる |
| 8 | 許可リストは String の SSM パラメータ。名前はコードの定数。キャッシュは資格情報と同じ 5 分 | 許可リストは秘密ではない。Lambda@Edge は環境変数を持てない。変更の反映は最大 5 分かかり、既存の Basic 認証の資格情報と同じ扱いで単純 |
| 9 | 書式の不正は、1 要素でも全体を不正とする | 一部だけを有効にすると、意図しない範囲が許可または拒否される。資格情報の書式不正を 503 にする既存の方針と揃える |
| 10 | 既存の本番への反映は、API キーを二段階にする | 一度に反映すると、API Gateway が先にキーを要求し、CloudFront がヘッダーを付けるまでの数分間、CloudFront 経由の API が 403 になる。CloudFront は 403 を `index.html` に書き換えるので画面が壊れる |
| 11 | R-11 は、メソッドの作成・更新時に判定する。R-8 は新パラメータも対象にする | 二段階の反映の (b) の plan（メソッドは変わらない）を落とさないため。許可リストが黙って初期値に戻る事故は、R-8 の型で防げる |
| 12 | IPv6 は扱わない | 本番は IPv6 が無効で、到達できない。将来有効にしても、IPv6 の `clientIp` は許可リストに一致せず 403 になる（テストで固定する） |

## 3. 設計

### 3.1 edge-auth: IP 許可リストの判定（TDD）

**新モジュール `packages/edge-auth/src/ip-allowlist.ts`**（純粋関数。AWS SDK に依存しない）

```ts
export interface Cidr { network: number; mask: number }   // 符号なし 32 ビット
export function parseAllowlist(value: string): Cidr[]     // 不正なら例外
export function isAllowed(clientIp: string | undefined, list: readonly Cidr[]): boolean
```

`parseAllowlist` の規則:

- `,` で分割し、各要素の前後の空白を除く。要素が 1 件も無い、または空の要素（末尾のカンマ、`,,`）があれば不正。
- 形式は `a.b.c.d` または `a.b.c.d/n`。オクテットは 0〜255 の 10 進で、先頭に 0 を付けない（`010` は不正。8 進と読む実装との食い違いを避ける）。`n` は 0〜32 の 10 進で、先頭に 0 を付けない。プレフィックスが無ければ `/32`。
- ホストビットが立った CIDR（`203.0.113.9/24`。Issue #177 により 2026-10-18 置換）は、マスクして受け入れる。
- IPv6 の書式、その他の文字列は不正。
- 1 要素でも不正なら、全体を不正として例外にする。
- **実装上の注意**: JavaScript のシフト演算は 32 ビット幅で、32 ビットのシフトは 0 ビットのシフトと同じになる。`/0` を `(0xFFFFFFFF << 32)` で作ると全ビットが立つ。`/0` は別扱いにし（マスクは 0）、`>>> 0` で符号なしに戻す。

`isAllowed`:

- `clientIp` を同じ規則で厳密に解釈する。IPv4 でない（`undefined`、IPv6、文字列）ときは `false`。

**`packages/edge-auth/src/index.ts`**

- 定数 `IP_ALLOWLIST_PARAMETER_NAME = "/rolust/ip-allowlist"` を足す（`CREDENTIALS_PARAMETER_NAME` と同じ理由でコードの定数）。
- 許可リストの取得は `GetParameterCommand`（`WithDecryption` は不要）。結果は資格情報とは別のキャッシュに、`CACHE_TTL_MS` で保持する。取得と解釈に成功したときだけ保持し、失敗と不正な値は保持しない。
- `resetCredentialCache()` は、許可リストのキャッシュも捨てる（テストと手動リセット）。
- ハンドラの流れ:

```
request が無い                        → 503（従来どおり）
許可リストの取得・解釈に失敗            → console.error → 503
isAllowed(request.clientIp) でない     → 403
以降は従来の Basic 認証                 （資格情報の取得失敗は 503、不一致は 401）
```

- 403 の応答は `Forbidden` の固定本文と `Cache-Control: no-store` だけを持ち、許可リストの情報を含めない。
- ログは `[rolust-edge-auth]` で始め、取得・解釈の失敗だけを `console.error` で残す（保存クエリ `edge_auth_failures` に一致する）。拒否したリクエスト自体は記録しない（監視は持たない方針。Issue #72）。

### 3.2 Terraform: IP 許可リスト

- `infra/variables.tf`: `ip_allowlist_parameter_name`（既定 `/rolust/ip-allowlist`）を足す。`basic_auth_parameter_name` と同じく、「既定値から変更する場合は `IP_ALLOWLIST_PARAMETER_NAME` も書き換えて再ビルドすること」と説明に書く。`terraform.tfvars.example` にも足す。
- `infra/edge-auth.tf`: `aws_ssm_parameter.ip_allowlist`（`provider = aws.us_east_1`、`type = "String"`、値は `0.0.0.0/0`、`lifecycle { ignore_changes = [value] }`）を足す。値は Terraform の管理外で、以降は `put-parameter` で変える。
- `edge_auth_ssm` に、新パラメータの `ssm:GetParameter` を足す（新しい Statement。KMS は要らない）。
- **順序**: `aws_cloudfront_distribution.rolust` に `depends_on = [aws_ssm_parameter.ip_allowlist, aws_iam_role_policy.edge_auth_ssm]` を足す。新しいコードが動き始める（関連付けの更新）前に、パラメータと権限が揃うようにする。揃っていないと、反映の途中で数秒の 503 が出うる。
- `infra/outputs.tf`: `ip_allowlist_parameter_name` と `set_ip_allowlist_command`（`set_basic_auth_command` と同じ位置づけ。`--type String --overwrite`）を足す。

### 3.3 Terraform: API Gateway の直 URL の遮断

`infra/apigateway.tf`:

- `aws_api_gateway_api_key.rolust`: 値は自動生成。
- `aws_api_gateway_usage_plan.rolust`: `api_stages` に REST API とステージ `prod` を指定する。スロットリングと割り当ての制限値は設けない。
- `aws_api_gateway_usage_plan_key.rolust`: キーを usage plan に紐づける（`key_type = "API_KEY"`）。
- 3 つのメソッド（`leaf["diff"]`・`leaf["apply"]`・`proxy`）に `api_key_required = true` を付ける（(c) の段階で有効にする。3.4）。
- **`aws_api_gateway_deployment` の `triggers` に、メソッドの `api_key_required` を足す。** 足さないと、メソッドだけを変えても再デプロイされず、「apply は成功したのに API の挙動が古いまま」になる。

`infra/cloudfront.tf`: API オリジン（`api-gateway`）に `custom_header { name = "x-api-key", value = aws_api_gateway_api_key.rolust.value }` を足す。CloudFront は、オリジンのカスタムヘッダーと同名のヘッダーをビューアーが送ってきても、ビューアーの値を上書きする。

`infra/outputs.tf`: `api_gateway_invoke_url` の説明を、「キーが無いと 403 になる。それでも配布しないこと」に改める。

鍵の入れ替え: `terraform apply -replace=aws_api_gateway_api_key.rolust`。切り替えの間（CloudFront の更新が終わるまで）は、API が短時間 403 になる。

### 3.4 反映の順序（既存の本番のみ二段階）

| 段階 | 内容 | 効果 |
|---|---|---|
| (a) | IP 許可リスト（3.1・3.2）。初期値が `0.0.0.0/0` なので、挙動は変わらない | 挙動は現状と同じ。ここで IP 判定を実測する |
| (b) | 鍵・usage plan・usage plan key・CloudFront のヘッダー（`api_key_required` は付けない） | API は変わらず動く。ヘッダーが付くだけ |
| (c) | (b) の CloudFront が「反映済み」になったことを確かめ、`api_key_required = true` にして、`triggers` を効かせて再デプロイする | 直 URL が 403 になる。CloudFront 経由は、すでにキーを付けているので影響なし |

- (a) と (b) は同じ apply にまとめてよい。(c) は必ず (b) の後に単独で行う。
- ブランチのコミットは、(c) を独立したコミットにして、(b) までの状態でも `apply` できるようにする。
- 第三者の新規構築は、使われていないので 1 回の apply でよい。README には、既存環境の更新では数分の窓が出うることを注記する。

### 3.5 plan-guard

**R-8 の拡張**（`.github/scripts/plan-guard.sh`）: 対象を `aws_ssm_parameter.ip_allowlist` にも広げる。`value` に差分があれば赤信号にする。文面は「許可リストが初期値（`0.0.0.0/0`）で上書きされ、制限が外れる」とする。`basic_auth` の文面は変えない。

**R-11（新設）: API Gateway の直 URL を塞ぐ設定が外れていないか（FR-6.3）**

- (a) `aws_api_gateway_method` の作成または更新で、`after.api_key_required` が `true` でなければ赤信号（直 URL が Lambda に届く）。未確定なら警告。
- (b) `aws_cloudfront_distribution.rolust` の `origin_id` が `api-gateway` のオリジンに、`x-api-key` の `custom_header` が無ければ赤信号。オリジンが未確定なら警告。
- 値は検査しない（sensitive で、plan からは読めない）。ヘッダーの値が正しいかは、実測で確かめる。
- 判定を変更時に限る理由は、決定事項 11。既知の限界: メソッドが `false` のまま変わらない状態（(b) の後）は、R-11 では検知されない。(c) の apply を忘れても赤にならないので、直 URL の 403 を実測で確かめる。

`plan-guard.test.sh` に、R-8 の拡張と R-11 の回帰テストを足す。基準になる plan の fixture に、`aws_api_gateway_method` と、API オリジンの `custom_header` を含める。

### 3.6 文書（正本の更新は 4 節）

**`README.md`**

- 反映後の設定: IP 許可リストの登録（`terraform output -raw set_ip_allowlist_command`）。初期値が `0.0.0.0/0`（全許可）であること。CIDR・単体・カンマ区切りの書き方。
- 変更が効くまで最大 5 分かかること（キャッシュ）。
- 締め出されたときの復旧: どの回線からでも `aws ssm put-parameter` で値を戻せる（SSM の API は、この IP 制限の対象外）。戻してからも、最大 5 分は入れない。
- 「Basic 認証は「最小限のアクセス制限」である」の節を、IP 制限と API キーを含む記述に改める。
- 「API Gateway のエンドポイントを直接公開しないでください」の注記を、キーが無ければ 403 になることを含む記述に改める。
- 「機微情報の扱い」に、API キーが state と plan の成果物に入ることを足す。
- 鍵の入れ替え手順。既存環境の更新で、API が数分 403 になりうること（3.4）。

**`.claude/rules/aws-infra.md`** § Lambda@Edge・CloudFront: 「API Gateway のメソッドを足すときは `api_key_required = true` を付ける。付け忘れは plan-guard の R-11 が落とす」を 1 項目足す。

**`docs/design/rollback-runbook.md`**: この変更より前のコミットへ戻すと、IP 制限が外れ、直 URL が再び開くことを注記する。古い版の `plan-guard.sh` は R-11 を持たないが、runbook の手順（現行の `main` の `plan-guard.sh` でも通す）に従えば、`api_key_required` が外れる差分を R-11 が赤信号にする。壊れた変更がこの変更でないなら、この変更を含む状態のどれかへ戻す。

### 3.7 検証

| 層 | 判定 |
|---|---|
| `packages/edge-auth` | TDD。`ip-allowlist` の表形式のテスト（下）と、ハンドラのテスト。`npm run lint`・`typecheck`・`test`・`build` |
| Terraform | `terraform fmt -check -recursive`・`terraform validate`・plan-guard。`infra/` を変えるので Trivy（CRITICAL/HIGH） |
| plan-guard | `plan-guard.test.sh`（R-8 の拡張と R-11 を含む） |
| 文書 | 現行の一覧を指す `R-1〜R-10` を grep で総当たりして直す。`git diff --numstat` で差分が意図した箇所だけであること |
| 秘密情報 | `gitleaks git . --no-banner --redact --exit-code 1`（gitleaks 8.30.1）。依存は変えないので `npm audit` は対象外 |
| AWS | 下の実測 |

`ip-allowlist` のテスト:

- 有効: 単体、`/24`、`/32`、`/0`、複数（空白あり）、ホストビットのマスク、重複。
- 不正: 空文字、空白だけ、末尾のカンマ、`,,`、`1.2.3`、`203.0.113.4.5`、`256.1.1.1`、`010.1.1.1`、`203.0.113.4/33`、`203.0.113.4/`、`203.0.113.4/08`、`::1`、`abc`、負の数（5 つ組と、プレフィックス付きの例を文書用の範囲に置換。Issue #177 により 2026-10-18）。
- 一致: `/24` の最初と最後のアドレス、範囲のすぐ外側、`/0` は全アドレス、`/32` は完全一致、複数の要素のいずれか。
- `isAllowed`: IPv6・`undefined`・不正な文字列は `false`。

ハンドラのテスト:

- 拒否された IP は 403 で、資格情報の取得を呼ばない。
- 許可された IP と有効な Basic 認証は通る。
- 許可された IP で認証なしは 401。
- 許可リストの取得の失敗と不正な値は 503。
- 許可リストのキャッシュ（TTL 内は再取得しない、失敗は保持しない、`resetCredentialCache` で捨てる）。

**実 AWS の実測**（jump-admin、`ap-northeast-1`。手順は README と本表を、依頼者が引き取れる形で使う）:

| 段階 | 操作 | 期待 |
|---|---|---|
| (a) 反映直後 | 認証なしで `/` と `/api/x` | どちらも 401（現状と同じ） |
| (a) 許可 | 許可リストを自分の IP（`checkip.amazonaws.com` を `curl -4` で取る）の `/32` にする | 認証なしで 401（許可され、Basic 認証の判定に進む） |
| (a) 書式 | `203.0.113.0/24, <自分の IP>`（空白あり、CIDR と単体の混在） | 401 |
| (a) 拒否 | `203.0.113.0/24`（文書用の範囲。自分の IP を含まない） | `/` と `/api/x` のどちらも 403 |
| (a) 不正 | `abc` | 503 |
| (a) 復元 | `0.0.0.0/0` | 401 |
| (b) | Basic 認証つきで `/api/pools`。ビューアーが誤った `x-api-key` を送っても同じ | 200（CloudFront がヘッダーを付ける。ビューアーが送った誤った値は CloudFront が上書きする）。直 URL はまだ 404（アプリの JSON） |
| (c) | 直 URL、キーなし。誤ったキー | どちらも 403（`{"message":"Forbidden"}`）。Lambda まで届かない |
| (c) | CloudFront 経由で、Basic 認証つき `/api/pools`。認証なし。画面（マトリクス） | 200、401、表示できる |
| merge 後 | `main` の CD | `terraform plan` は No changes、plan-guard は赤信号 0 件 |

- 許可リストの値を切り替えるたびに、応答が安定するまで待つ（最大 5 分。関数のインスタンスとキャッシュは、エッジとリージョンごとに別）。
- **拒否と不正値の確認の間は、依頼者を含む全員がサイトに入れない。** 実施の日時を事前に合わせる。実測の後は `0.0.0.0/0` に戻し、絞る値は依頼者が決めて登録する。
- 実測で、鍵が一致しない設定ミス（画面が壊れる形で現れる）が無いことを、(b)・(c) の `/api/pools` と画面で確かめる。

### 3.8 スコープ外・リスク

**スコープ外**

- IPv6 の許可リスト、管理画面から許可リストを編集する UI、拒否ログの記録と通知（監視は持たない方針）、レート制限、鍵の自動ローテーション。

**リスクと受容**

| リスク | 扱い |
|---|---|
| 誤った値を登録して、全員が入れなくなる | 復旧は `put-parameter`（SSM の API は IP 制限の対象外）。反映まで最大 5 分。README に書く |
| 鍵の不一致で API が 403 になり、CloudFront が `index.html` に書き換えて画面が壊れる | 二段階の反映（3.4）と、(b)・(c) の実測で防ぐ |
| API キーは認証の唯一の手段にしないよう、AWS が案内している | 多層防御の一層と位置づける。第一の防御は CloudFront の IP 制限と Basic 認証 |
| API キーが state と plan の成果物に入る | 既存の SSM の資格情報と同じ扱い。README「機微情報の扱い」に足す |
| 許可リストの変更が最大 5 分遅れる | 受容（資格情報と同じ） |
| 過去のコミットへ戻すと、制限が外れる | rollback-runbook に注記する。現行の `main` の `plan-guard.sh` を通す既存の手順が、R-11 で気づかせる |

## 4. 正本への反映

| 文書 | 覆す | 足す | 直す節 |
|---|---|---|---|
| `docs/design/requirements.md` | FR-6.1 の注記の「受容したリスク R-a」（解消する） | FR-6.2（IP 許可リスト）、FR-6.3（API Gateway への直接アクセスの拒否）、トレーサビリティの 2 行、冒頭の追記注記 | FR-6 の節（FR-6.1 の手段の注記） |
| `docs/design/iam-policy-design-note.md` | § 4 の「Basic 認証は API への到達を守らない」（R-a）を解消済みに訂正する | なし | 冒頭の追記注記、§ 3.8（SSM の読み取りが 2 パラメータになる）、§ 4 |
| `docs/design/cicd-pipeline.md` | なし | R-11、R-8 の対象の拡張 | 冒頭の追記注記、§ 赤信号 — 承認せず差し戻す、現行の一覧を指す `R-1〜R-10`（位置づけ、CI 側への影響、未決事項 4 など） |
| `docs/design/cd-config.md` | なし | なし | 冒頭の追記注記、現行の一覧を指す `R-1〜R-10`（位置づけ、D-6、パイプライン構成） |
| `docs/design/rollback-runbook.md` | なし | なし | 冒頭の段落と § ロールバックの基本形の `R-1〜R-10`。この変更より前へ戻すと制限が外れる旨の注記 |
| `docs/design/deployment-strategy.md` | なし | なし | 冒頭の追記注記、現行の一覧を指す `R-1〜R-10`（§ デプロイ前に満たされている前提の表 1 箇所、§ plan の差分をどう読むかの表 2 箇所）。実装時の grep で見つけた（初版の列挙から漏れていた） |
| `README.md` | 「IP 制限・SSO・WAF などの追加防御は行っていません」、直 URL の注記 | IP 許可リストの設定・復旧、鍵の入れ替え、機微情報の扱いへの追記 | 赤信号の範囲（`R-1〜R-10`）、Basic 認証の節、直 URL の注記、設定手順 |
| `.claude/rules/aws-infra.md` | なし | `api_key_required` の規則（1 項目） | § Lambda@Edge・CloudFront |
| `.github/workflows/cd.yml`・`ci.yml`、`.github/scripts/plan-guard.sh`・`plan-guard.test.sh` | なし | なし | コメントとステップ名の `R-1〜R-10` を `R-1〜R-11` に改める |
| `docs/design/README.md` | なし | なし | なし |
| `packages/api/TABLE-DESIGN.md` | なし | なし | なし |
| 画面設計（`mockups.md`・`interaction-spec.md`） | なし | なし | なし（画面の変更は無い） |
| `aidlc/` | 書き換えない | なし | なし |

- ID は変えない。R-a は ID を残し、解消の注記を付ける。追加（FR-6.2・FR-6.3・R-11）は末尾に置く。
- 来歴は二層にする。冒頭の追記注記（日付・Issue #76・変更の全体像）と、各箇所の「Issue #76 により 2026-09-29 追記・訂正」。
- 当時の範囲を述べる記述（`R-1〜R-8` など）は経緯として残し、現行の一覧を指す表記だけを直す。最後に `R-1〜R-10`・`R-a`・`IP 制限`・`直接公開` を grep で総当たりする（`aidlc/`・`docs/superpowers/` は対象外）。
