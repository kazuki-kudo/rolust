# 設計メモ — Lambda 実行ロールの IAM ポリシー

> **追記注記**（Issue #194 により 2026-10-24 追記）: 3.2 に、`DenySelfEscalation` の二層目として、ロールの登録（`POST /roles`）でも Rolust 自身の 5 ロールを拒否することと、その一覧が Lambda の環境変数 `ROLUST_SELF_ROLE_ARNS`（`local.self_role_arns` と同じ `local`）で渡ることを追記した。IAM ポリシーそのもの（Action・Resource・タグ条件・Deny の対象）は変えていない。ID と節番号は変えない。
> **追記注記**（Issue #178 により 2026-10-18 訂正）: `README.md` の利用者向けの手順を `docs/guide/` に分けたため、README の節・手順を指していた参照を `docs/guide/` の文書に張り替えた（対応は `docs/superpowers/specs/2026-10-18-readme-split-design.md`）。NFR-4・SM-2 の「README と Terraform」という総称は、変えない（Issue #179 により 2026-10-19 訂正: 訂正前は「Issue #179 で扱うので変えていない」とした。README は入口で手順は `docs/guide/` にあるが、総称は今も通じるため）。ID と節番号は変えない。
> **追記注記**（Issue #92 により 2026-10-13 追記）
>
> - **変更の全体像**: 3.3 のターゲット側のロール（Reader・Manager）の配布を、CloudFormation テンプレート `cloudformation/target-roles.yaml` にした（訂正前は README の手順で手動で作るとし、配布方法は別途検討するとしていた）。テンプレートが定義の正本で、3.3 の JSON は設計の説明である。権限の内容（Action・Resource・タグ条件・`DenySelfEscalation`）は変えていない。一般の呼び名を「デプロイ先（アカウント）」に改めた（訂正前は、依頼者の環境名の「JUMP」）。
> - **設計**: `docs/superpowers/specs/2026-10-13-user-deploy-release-design.md`

> **追記注記**（Issue #93 により 2026-10-08 追記）: 表記の空白を外した（IAMユーザ・IAMロール・AWSアカウントID）。ID と内容は変えていない。
> **正本注記**（Issue #26 により 2026-09-24 追記）
>
> - **位置づけ**: 本書は Rolust の IAM ポリシー設計（Lambda 実行ロールと Lambda@Edge）の正本である。変更は `CLAUDE.md` § 開発フロー の規則に従い、実装と同じ PR で行う。
> - **複写元**: `aidlc/spaces/default/intents/260728-rolust-iam-trust/construction/code-generation/iam-policy-design-note.md`（2026-07-31 作成、2026-09-24 複写）。複写元は凍結した経緯として残る。作成時の本書は、code-generation (3.5) のパーク中に OQ-3 の後半（IAM 権限の確保方法）への提案として会話で導出したもので、承認ゲートを通っていなかった。
> - **照合の範囲**: `docs/superpowers/specs/2026-09-24-living-design-docs-design.md` 3.2 の 5 つの源泉から列挙した食い違いを、`infra/main.tf`・`infra/lambda.tf`・`infra/edge-auth.tf` と照合して訂正した。それ以外の記述は照合していない（未照合）。
> - **訂正の全体像**: 位置づけを正本に改めた。§ 1・§ 2 に CRUD の `iam:ListRoleTags` と、それが FR-5.7・C-4 を破ることを追記した。§ 3.2 のポリシー例をタグ方式と Deny 5 ロールに改め、2026-08-01 の追記（接頭辞方式・4 ロール）を経緯の注記に置き換えた。§ 3.3 は未実装、§ 3.4 は採用、§ 3.5 は不採用、§ 3.7 は解決済みと明記した。§ 3.6 に Lambda@Edge の例外を追記し、§ 3.8（Lambda@Edge の実行ロール）と § 3.9（CRUD の登録時のタグ読み取り）を新設した。§ 4 の帰結に受容リスク R-a を足した。§ 4 を解決済みに改め、帰結の対象をタグ付きロールに改めた。§ 5・§ 6 の状態を更新した。
> - **未決**: なし。別アカウント ID のロールがデプロイ先の同名ロールに解決される件（Issue #26 の最終レビューで判明）は、IAM を呼ばずに失敗させる形で解決した（3.3 の注記、requirements.md FR-2.2 の注記。Issue #27 により 2026-09-24 訂正。Issue #85 により 2026-09-30 訂正: 3.3 のクロスアカウント構成を実装し、別アカウントのロールも操作できる）。
> - ソースタグ（`[FR-x]`・`[Q<n>]`・`[derived]` など）の所在は `docs/design/README.md` にある。
>
> **訂正**（Issue #27 により 2026-09-24）: 3.3 の注記を、差分確認と反映がロールのアカウント ID をデプロイ先と照合し、一致しなければ IAM を呼ばない挙動に改めた。これに伴い上の「未決」を解決済みにした。IAM ポリシーそのものは変えていない。

> **追記**（Issue #24 により 2026-09-27）: 3.2 に、`DenySelfEscalation` の対象の漏れを plan-guard の赤信号 R-10 が検知することを追記した。

> **訂正**（Issue #9 により 2026-09-29）: Lambda@Edge の実行ロールが書き込めるロググループを、全リージョンの `/aws/lambda/*.rolust-edge-auth` から、Terraform が管理する 3 リージョン（us-west-1・eu-central-1・us-east-1）のものに絞った。3.6 の追記注記と 3.8 のログ行を訂正した。変わったのはログの `Resource` だけで、アクション（`CreateLogGroup` / `CreateLogStream` / `PutLogEvents`）は変えていない。

> **追記**（Issue #80 により 2026-09-30）: CRUD 系統の実行ロールに、タグ条件つきの `iam:GetRole` を足した（ロールの紐づけ時に、信頼ポリシーにいる IAM ユーザを Rolust の記録へ取り込むため）。1 節と 2 節の表を更新し、3.10 を足した。読める範囲は Diff 系統と同じ（管理対象タグの付いたロール）で、読み取り専用。`iam:UpdateAssumeRolePolicy` は持たない。plan-guard は R-1・R-3 の対象に新ポリシーを加え、R-9 を CRUD の 2 つのポリシーの Action の検査に広げた（`cicd-pipeline.md`）。設計は spec `docs/superpowers/specs/2026-09-30-role-unlink-and-trust-import-design.md`。

> **追記**（Issue #76 により 2026-09-29）: 3.8 に、Lambda@Edge の実行ロールが SSM から IP 許可リストも読むこと（`ssm:GetParameter` が 2 パラメータになること）を足した。§ 4 の「Basic 認証は API への到達を守らない」（受容リスク R-a）は、API Gateway の直 URL を API キーで塞いで解消した（`requirements.md` FR-6.3）。

> **訂正**（Issue #85 により 2026-09-30）: 3.3 のクロスアカウント構成を実装した。ターゲットアカウントに手動で作った Reader（読み取り用）と Manager（更新用）を、Rolust の実行ロールが AssumeRole する。当時の案から、ターゲット側のロールを 2 本に分け（CRUD・Diff が更新用のロールを引き受けられる形にすると、FR-3.2 の構造的な保証が外れるため）、ExternalId は使わないことにした。3.3 を実装した構成に書き換え、1 節・2 節の表と FR-5.7 の注記、3.10、5 節の OQ-3、6 節の NFR-3・NFR-4 の行を更新した。実行ロールの IAM ポリシーには、`sts:AssumeRole` を 3 つ足した（`crud_assume_target_reader`・`diff_assume_target_reader`・`apply_assume_target_manager`）。plan-guard に赤信号 R-12 を足した。設計は spec `docs/superpowers/specs/2026-09-30-cross-account-roles-design.md`。
>
> **追記**（Issue #20 により 2026-10-05）: 3.7・3.8 に、認証方式（`auth-mode`）と Cognito の接続情報（`auth-cognito`）も SSM に置くこと、Lambda@Edge の実行ロールの `ssm:GetParameter` が 4 パラメータになることを足した。Cognito を呼ぶ IAM 権限は要らない（トークンエンドポイントと JWKS は公開の HTTPS）。4 節に、`cognito` 方式でも防御の性質は同じであること、発行済みトークンの有効期限の制約を足した。設計は spec `docs/superpowers/specs/2026-10-05-admin-auth-cognito-design.md`。

> **追記**（Issue #120 により 2026-10-05）: § 3.x の末尾（415 行付近）の「実行者も記録しない」を、作成者・反映者を記録することに合わせて訂正した。

> **訂正**（Issue #135 により 2026-10-07）: ロールの紐づけを廃止し、登録した IAM ロールを無条件にユーザプールへ紐づけたので、CRUD 系統の `iam:GetRole`（タグ条件つき。読み取りのみ）の用途を、「ロールの紐づけ時」から「ロールの登録時」（`POST /roles`）に改めた。権限（Action・Resource・タグ条件）は変えない。FR-5.7 の例外も、紐づけ時から登録時に移った（登録は、すでに `iam:ListRoleTags` で例外であり、`GetRole` を足しても、AWS へ問い合わせる範囲は広がらない）。1 節と 2 節の表・FR-5.7 の判定への影響・3.10 を更新した。設計は spec `docs/superpowers/specs/2026-10-07-auto-link-roles-design.md`。
> **追記**（Issue #139 により 2026-10-07）: CRUD 系統の実行ロールに、許可アカウントの SSM パラメータ 1 件への `ssm:GetParameter` を足した（3.11）。ユーザプールに登録できる IAM ユーザのアカウント ID を許可リストに限るため（requirements.md FR-1.11）。IAM・STS の権限は変わらない。
> **追記**（Issue #170 により 2026-10-15）: Diff 系統に、登録済みの割り当てと実際の信頼ポリシーの乖離の確認（FR-4.9。`GET /api/drift`）を足した。読むのは `iam:GetRole` と、別アカウントの Reader の引き受けだけで、**権限（IAM ポリシー）は変えない**。API Gateway の経路（`infra/apigateway.tf` の `api_leaf_routes` の `drift`）を足しただけで、Diff の実行ロールのポリシーは増えない。2 節の表の Diff の担当に FR-4.9 を足した。設計は spec `docs/superpowers/specs/2026-10-15-trust-drift-check-design.md`。
> **追記**（Issue #172 により 2026-10-16）: Diff 系統に、乖離を直す 2 つの操作（FR-4.10・FR-4.11。`POST /api/drift/restore`・`POST /api/drift/adopt`）を足した。操作の時点で対象の 1 ロールの信頼ポリシーを読み直す（`iam:GetRole`、別アカウントのロールは Reader の引き受け）だけで、IAM は書かない（`restore` は下書きの申請を作るだけ、`adopt` は DynamoDB の記録を更新するだけ）。**権限（IAM ポリシー）は変えない**。DynamoDB の読み書きは全 Lambda 共通（3.4）なので、Diff の実行ロールに足すものは無い。`iam:UpdateAssumeRolePolicy` は引き続き Apply 系統だけが持つので、FR-3.2 の構造的な担保は変わらない。API Gateway の経路は `infra/apigateway.tf` の `drift_child`（`restore`・`adopt`）を足しただけ。2 節の表の Diff の担当に FR-4.10・FR-4.11 を足した。設計は spec `docs/superpowers/specs/2026-10-16-drift-repair-design.md`。

ソースタグは `requirements.md` の規約に従う（`[FR-x]` / `[Q<n>]` / `[derived]`）。`[derived]` は要件書にも回答にも直接の記述がなく本メモで導出した判断であり、`code-generation` 実行時に確認する対象。

---

## 1. 要件が確定させている範囲

必要な IAM アクションは、信頼ポリシーの読み書きに使う **2 つ**と、ロール登録時のタグ検証に使う `iam:ListRoleTags` の計 3 つである。絞り込みの決め手は FR-5.7 だが、`iam:ListRoleTags` は FR-5.7 を意図的に破る（下記）。（Issue #26 により 2026-09-24 訂正）

> FR-5.7: システムは、AWS への問い合わせを信頼ポリシーの読み取りと更新の時点に限定しなければならない（IAMユーザ／ロールの実在検証や一覧取得は行わない）

| アクション | 用途 | Source |
|---|---|---|
| `iam:GetRole` | `AssumeRolePolicyDocument` を読み取り、凍結入力との差分を算出する。CRUD 系統も、ロールの登録時に、信頼ポリシーにいる IAMユーザを取り込むために読む（3.10。Issue #80 により 2026-09-30 追記。Issue #135 により 2026-10-07 訂正。訂正前は紐づけ時）。Diff 系統は、利用者の指示による乖離の確認（FR-4.9。`GET /api/drift`）でも、登録済みの全ロールの信頼ポリシーを読む（Issue #170 により 2026-10-15 追記。権限は変えない）。乖離を直す操作（FR-4.10・FR-4.11。`POST /api/drift/restore`・`/adopt`）も、指示の時点で対象の 1 ロールの信頼ポリシーを読み直す（Issue #172 により 2026-10-16 追記。権限は変えない）。別アカウントのロールでは、ターゲット側の Reader（CRUD・Diff）・Manager（Apply）を引き受けて呼ぶ（3.3。Issue #85 により 2026-09-30 追記） | [FR-4.1][FR-5.1]、[FR-2.1]、[FR-4.9] |
| `iam:UpdateAssumeRolePolicy` | 信頼ポリシーを保全方式で更新する | [FR-5.3] |
| `iam:ListRoleTags` | ロール登録時に、対象ロールが管理対象タグ（`<managed_tag_key>` = `<managed_tag_value>`）を持つことを検証する。CRUD 系統だけが持つ（2 節・3.9）（Issue #26 により 2026-09-24 追記） | [FR-2.1]、3.4 の RQ-4 = A、code-generation の質問 11 = A |

### 付与してはならないアクション

| アクション | 根拠 |
|---|---|
| `iam:ListRoles` / `iam:ListUsers` / `iam:GetUser` | [FR-5.7][C-4]（手入力のみ・実在検証をしない） |
| `iam:SimulatePrincipalPolicy` | [FR-5.7]（読み取り・更新の 2 時点以外の問い合わせ） |
| `iam:PutRolePolicy` / `iam:AttachRolePolicy` | [derived] 信頼ポリシー（`AssumeRolePolicyDocument`）と権限ポリシーは別物であり、Rolust は前者のみを扱う |

`iam:GetRole` は `Role.AssumeRolePolicyDocument`（URL エンコードされた JSON）を返す。信頼ポリシーの取得に `iam:GetRolePolicy` は使わない（あれは**インライン権限ポリシー**用）。 [derived]

**FR-5.7 の判定への影響**: 判定列は「登録・マトリクス操作の各画面で IAM 参照 API が呼ばれていない / 呼ばれる」。上記の禁止アクションを実行ロールに含めないこと自体が、この判定を実装レベルで担保する第一の手段になる。ただし、ロールの登録（画面 2）だけは、信頼ポリシーを読むために `iam:GetRole` を呼ぶ（3.10。Issue #80 により 2026-09-30 追記。Issue #135 により 2026-10-07 訂正。訂正前は、ロールの紐づけ（画面 1）。紐づけは廃止した）。 また、画面 2 の「信頼ポリシーを確認」を押したときは、Diff 系統が登録済みの全ロールの信頼ポリシーを `iam:GetRole` で読む（乖離の確認。FR-4.9。Issue #170 により 2026-10-15 追記。画面の描画では呼ばれず、指示したときだけ。権限は変えない）。乖離を直す操作（画面 2 の詳細モーダル。FR-4.10・FR-4.11）を指示したときも、Diff 系統が対象の 1 ロールの信頼ポリシーを読み直す（Issue #172 により 2026-10-16 追記。信頼ポリシーは書き換えない。権限は変えない）。

**FR-5.7 を破る点**（Issue #26 により 2026-09-24 追記）: ロール登録（画面 2）は `iam:ListRoleTags` を呼び、ロールが存在しなければ（`NoSuchEntity`）400 で拒否する。これは FR-5.7・C-4 の「実在検証は行わない」を明確に破る。タグは AWS 上のロールにしか存在せず、登録時にタグの条件を照合するには呼ぶしかないため、3.4 の RQ-4 = A（登録時検証を残す）と code-generation の質問 11 = A で人間が選んだ（`packages/api/src/handlers/roles.ts`）。`iam:ListRoles` / `iam:ListUsers` / `iam:GetUser` は引き続きどの系統にも付与しない。

**FR-5.7 を破る点（登録時）**（Issue #79・#80 により 2026-09-30 追記。Issue #135 により 2026-10-07 訂正。訂正前は「紐づけ時」で、ロールの紐づけ（画面 1。`PUT /pool/roles`）が読んだ。紐づけは廃止した）: ロールの登録（画面 2。`POST /roles`。タグ検証の後）は、デプロイ先アカウントのロールについて `iam:GetRole` で信頼ポリシーを読み、ロールが存在しなければ（`NoSuchEntity`）400 で拒否する（何も書かない。登録は、取り込み → 紐づけ → IamRole の順に書き、IamRole を最後に確定する）。これも実在を確かめる副作用を持つ。読める範囲は Diff 系統と同じ（管理対象タグの付いたロール）で、`iam:UpdateAssumeRolePolicy` は持たない（3.10。requirements.md FR-5.7 の注記）。

**別アカウントのロール**（Issue #85 により 2026-09-30 追記）: 上の 3 つの IAM 呼び出しは、別アカウントのロールでは、ターゲット側のロールを引き受けた資格情報で行う（3.3）。`sts:AssumeRole` が加わるが、AWS へ問い合わせる時点は変わらない（登録時のタグ検証と信頼ポリシーの読み取り、差分確認、乖離の確認（Issue #170 により 2026-10-15 追記）、乖離を直す操作（Issue #172 により 2026-10-16 追記）、反映のいずれかの中で呼ぶ。Issue #135 により 2026-10-07 訂正。訂正前は「紐づけ時の読み取り」）ので、FR-5.7 の範囲は広がらない。

---

## 2. Lambda を 3 系統に分割する

`iam:UpdateAssumeRolePolicy` は特権昇格の経路になりうるため、全 Lambda に配らない。 [derived]

| Lambda | 担当する FR | 必要な権限 |
|---|---|---|
| **CRUD** — ユーザ／ロール登録（取り込みと紐づけを含む）、ロールの並び順、マトリクス操作、申請作成、申請履歴 | FR-1.1〜1.6, FR-2.1〜2.6, FR-3.1〜3.2, FR-4.4〜4.8, FR-7.1〜7.3, FR-7.5 | データストア + `iam:ListRoleTags`（読み取りのみ。ロール登録時のタグ検証。Issue #26 により 2026-09-24 訂正）+ `iam:GetRole`（読み取りのみ。タグ条件つき。ロールの登録時の信頼ポリシーの読み取り。Issue #80 により 2026-09-30 追記。Issue #135 により 2026-10-07 訂正。訂正前は紐づけ時）+ `sts:AssumeRole`（ターゲット側の Reader だけ。別アカウントのロール。3.3。Issue #85 により 2026-09-30 追記） |
| **Diff** — 差分算出・管理外 principal の検出・乖離の確認（Issue #170 により 2026-10-15 追記）・乖離を直す操作（`POST /api/drift/restore`・`POST /api/drift/adopt`。IAM は書かない。権限は変えない。Issue #172 により 2026-10-16 追記） | FR-4.1〜4.2, FR-4.9〜4.11, FR-7.4 | データストア + `iam:GetRole`（読み取りのみ）+ `sts:AssumeRole`（ターゲット側の Reader だけ。別アカウントのロール。3.3。Issue #85 により 2026-09-30 追記） |
| **Apply** — 信頼ポリシー反映・再反映 | FR-5.1〜5.6 | データストア + `iam:GetRole` + `iam:UpdateAssumeRolePolicy` + `sts:AssumeRole`（ターゲット側の Manager だけ。別アカウントのロール。3.3。Issue #85 により 2026-09-30 追記） |

この分割により、FR-3.2（チェック操作時に AWS へ一切書き込まない）は CRUD Lambda が書き込み権限を持たないことで構造的に保証される。 [derived]

**3 系統以外の IAMロール**（Issue #26 により 2026-09-24 追記）: Lambda@Edge の Basic 認証の実行ロール（`rolust-edge-auth-exec`、3.8）と、API Gateway がアクセスログを書くためのサービスロール（`rolust-apigw-logs`）がある。いずれも Rolust が作るロールとして `DenySelfEscalation` の対象に含める（3.2）。

---

## 3. ポリシー本体

以下の `123456789012` と `ap-northeast-1` はプレースホルダ。Terraform 変数に置き換える。 [C-3]

### 3.1 実行ロールの信頼ポリシー（3 系統共通）

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "Service": "lambda.amazonaws.com" },
    "Action": "sts:AssumeRole"
  }]
}
```

### 3.2 Apply Lambda — 単一アカウント構成

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadTrustPolicy",
      "Effect": "Allow",
      "Action": "iam:GetRole",
      "Resource": "arn:aws:iam::123456789012:role/*",
      "Condition": { "StringEquals": { "aws:ResourceTag/<managed_tag_key>": "<managed_tag_value>" } }
    },
    {
      "Sid": "UpdateTrustPolicy",
      "Effect": "Allow",
      "Action": "iam:UpdateAssumeRolePolicy",
      "Resource": "arn:aws:iam::123456789012:role/*",
      "Condition": { "StringEquals": { "aws:ResourceTag/<managed_tag_key>": "<managed_tag_value>" } }
    },
    {
      "Sid": "DenySelfEscalation",
      "Effect": "Deny",
      "Action": "iam:UpdateAssumeRolePolicy",
      "Resource": [
        "arn:aws:iam::123456789012:role/rolust-crud-exec",
        "arn:aws:iam::123456789012:role/rolust-diff-exec",
        "arn:aws:iam::123456789012:role/rolust-apply-exec",
        "arn:aws:iam::123456789012:role/rolust-edge-auth-exec",
        "arn:aws:iam::123456789012:role/rolust-apigw-logs"
      ]
    }
  ]
}
```

`DenySelfEscalation` は**必須**。これがないと、Rolust 自身の実行ロールの信頼ポリシーを Rolust 経由で書き換えられ、自己昇格の閉路ができる。 [derived]

> **Issue #26 により 2026-09-24 訂正**: 上の例を実装（`infra/main.tf` の `managed_tag_condition`・`self_role_arns`、`infra/lambda.tf` の `apply_iam_write`）に合わせた。経緯: `Resource` は本メモ作成時の `role/*` から、承認ゲートでロール名接頭辞方式（`role/<接頭辞>*`）へ、さらに 3.4 の再実行（RQ-3 = A、4.2 の質問 R-1 = B）でタグ方式（`role/*` ＋ `aws:ResourceTag/<managed_tag_key>` 条件）へ移った。`iam:TagRole` は誰にも付与しない（タグを付けるのは運用者であり、管理対象の増減は `terraform plan` に現れない。受容リスク R-e）。`DenySelfEscalation` の対象は、本メモ作成時の 3 系統の実行ロールに Lambda@Edge の実行ロールと、Issue #1 で API Gateway のサービスロール `rolust-apigw-logs` を加えた 5 ロールである。`RolustTrustPolicyManager`（3.3）は含まない（3.3 は実装していない）。タグはどのロールにも付きうるため、Rolust 自身のロールを守る明示の防御は `DenySelfEscalation` だけである。

> **Issue #194 により 2026-10-24 追記**: `DenySelfEscalation` は反映（`iam:UpdateAssumeRolePolicy`）を拒否するが、それだけだと違反は操作の連鎖の末尾で初めて現れる（登録・申請まで進んでから `AccessDenied`）。**ロールの登録（`POST /roles`）でも、同じ 5 ロールを 400 で拒否する**（requirements.md FR-2.1 の注記）。アプリ側の一覧は、Lambda の環境変数 `ROLUST_SELF_ROLE_ARNS`（`infra/lambda.tf` が `join(",", local.self_role_arns)` で渡す）で、Deny の `Resource` と**同じ `local`** を参照する。したがってポリシーと登録時検証が食い違うことはなく、R-10 が `local` の網羅を見張る構図も変わらない。照合はアカウント ID とロール名の対で行う（パーティションの表記差で照合が外れないため）。登録時検証は防御の二層目であり、`DenySelfEscalation` の代わりではない（Rolust の外から IAM を呼ばれる経路は、基盤層だけが止める）。

> **Issue #24 により 2026-09-27 追記**: Rolust が作るロールを増やして `self_role_arns` に加え忘れると、そのロールは Deny の外に出る。この漏れは plan-guard の赤信号 R-10（plan 内の全 `aws_iam_role` が `DenySelfEscalation` の `Resource` に含まれるか。`cicd-pipeline.md` § 赤信号 — 承認せず差し戻す）が plan の時点で検知する。

Diff Lambda は `ReadTrustPolicy` のみを持つ（タグ条件も同じ。`infra/lambda.tf` の `diff_iam_read`。Issue #26 により 2026-09-24 訂正）。

IAM は グローバルサービスのため ARN にリージョン部を持たない（`arn:aws:iam::<account>:role/<name>`）。 [derived]

### 3.3 クロスアカウント構成（FR-2.2 を実アカウント間で成立させる。実装済み）

> **Issue #85 により 2026-09-30 訂正**: Issue #26 の時点では、本節は実装していない設計だけだった（単一アカウント構成を採り、別アカウントのロールは、IAM を呼ばずに失敗させていた。Issue #27）。Issue #85 で実装した。当時の案から、次の 2 点を変えた。(1) ターゲット側のロールを、読み取り用の `RolustTrustPolicyReader` と更新用の `RolustTrustPolicyManager` の 2 本にした。CRUD・Diff が更新用のロールを引き受けられる形にすると、FR-3.2（CRUD は AWS へ書き込まない）の構造的な保証が外れるためである。セッションポリシーで絞る案は、呼び出し側が付け忘れると書き込めるので、保証にならない。(2) ExternalId は使わない（下記）。設計は spec `docs/superpowers/specs/2026-09-30-cross-account-roles-design.md`。

```
デプロイ先（Rolust）                    ターゲット（DEV1 など）
 crud-exec ─┐                            ┌ RolustTrustPolicyReader（CloudFormation）
 diff-exec ─┴─ sts:AssumeRole ─────────▶ │   iam:GetRole（タグ条件つき）＋ iam:ListRoleTags
 apply-exec ─── sts:AssumeRole ────────▶ └ RolustTrustPolicyManager（CloudFormation）
                                            iam:GetRole ＋ iam:UpdateAssumeRolePolicy（タグ条件つき）
                                            ＋ 自分と Reader の信頼ポリシー更新を Deny
```

別アカウントの IAM を呼ぶときの資格情報は、クライアントを選ぶ 1 か所（`packages/api/src/aws/iam-client.ts` の `resolveClient`）が決める。IAM の API は `RoleName` しか受け取らず、呼び出しに使った資格情報のアカウントに対して解決されるため、どの資格情報のクライアントで呼ぶかが、どのアカウントのロールに作用するかを決める。

- ロールの ARN のアカウントがデプロイ先と同じ: 実行ロール自身の資格情報（3.2 のとおり）。
- 別アカウント: ターゲット側の Reader（CRUD・Diff）か Manager（Apply）を引き受けた一時資格情報。セッション名は `rolust-crud`・`rolust-diff`・`rolust-apply`（CloudTrail で系統を特定できる）。一時資格情報は、アカウントと役割ごとに Lambda の実行環境の中でキャッシュされ、期限が近づくと更新される（`@aws-sdk/credential-providers` の `fromTemporaryCredentials`）。
- デプロイ先を判定できない（`requestContext.accountId` が無い）: どちらの資格情報を使うかを決められないので、IAM を呼ばずに止める（`DeployAccountUnknown`）。
- **引き受けに失敗しても、デプロイ先の資格情報で呼び直さない。** 呼び直すと、別アカウントのロール向けの操作が、デプロイ先の同名ロールに作用する（Issue #27）。失敗は `assume-role` の `IamOperationError` として返り、文言は、何が・なぜ・どう直すかを含む（GI-6）。

#### デプロイ先側（Terraform。`infra/lambda.tf`）

実行ロールごとに、`sts:AssumeRole` の Statement を持つポリシーを足す。Action は `sts:AssumeRole` 単体、Resource はロール名固定でアカウントだけ `*` とする。

```json
{
  "Sid": "AssumeTargetReader",
  "Effect": "Allow",
  "Action": "sts:AssumeRole",
  "Resource": "arn:aws:iam::*:role/RolustTrustPolicyReader"
}
```

- `crud_assume_target_reader`（CRUD）・`diff_assume_target_reader`（Diff）は Reader。`apply_assume_target_manager`（Apply）は Manager（`Sid` は `AssumeTargetManager`、Resource は `role/RolustTrustPolicyManager`）。
- ロール名は Terraform 変数 `target_reader_role_name`・`target_manager_role_name`（既定は上の名前）。IAM 名の書式に限り（ワイルドカードとパスを含めない）、2 つが同じ名前なら拒否する（同じだと、CRUD・Diff が更新用のロールを引き受けられる）。Lambda の環境変数 `ROLUST_TARGET_READER_ROLE_NAME`・`ROLUST_TARGET_MANAGER_ROLE_NAME` として渡る。
- アカウントは絞らない。開けるかどうかは、ターゲット側でロールを作り、信頼ポリシーで Rolust の実行ロールを名指しした管理者が決める。ターゲットを増やしても、Terraform の変更は要らない。
- 別アカウントの機能を無効にするフラグは設けない。ターゲット側にロールが無ければ引き受けられない。
- `self_role_arns`（`DenySelfEscalation`）は変えない。ターゲット側のロールは Rolust が作らない。
- plan-guard の赤信号 R-12 が、Action の広がり、ロール名のワイルドカード、Reader と Manager の取り違え（Resource と、ポリシーの `role` 属性の両方）、別のポリシーへの `sts` の Action の混入（大文字小文字と `NotAction` を含む）、実行ロールへの管理ポリシーのアタッチ・インラインポリシーの追加を、plan の時点で止める（`cicd-pipeline.md`。Issue #85 により 2026-09-30 追記。最終レビューを受けて 2026-10-02 に、`role` 属性・大文字小文字・`NotAction`・アタッチを足した）。

#### ターゲット側（CloudFormation テンプレート。`docs/guide/cross-account.md`（Issue #178 により 2026-10-18 訂正））

ターゲットアカウントに、次の 2 つのロールを作る。Terraform では作らない（依頼者の選択。Issue #85）。**定義の正本は `cloudformation/target-roles.yaml` で、ここの JSON は設計の説明である**（Issue #92 により 2026-10-13 訂正。訂正前は、README の手順で手動で作るとしていた）。`<DEPLOY>` は Rolust のデプロイ先のアカウント ID、`<TARGET>` はターゲットのアカウント ID、`<project>` は `project_name`。`rolust:managed`・`true` は `managed_tag_key`・`managed_tag_value` で、テンプレートのパラメータ（`ManagedTagKey`・`ManagedTagValue`）に Terraform の変数と同じ値を渡す（Terraform の出力 `target_roles_deploy_command` が埋める）。

**Reader の信頼ポリシー**（crud と diff の実行ロールだけを、ARN の完全一致で名指しする）

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": [
      "arn:aws:iam::<DEPLOY>:role/<project>-crud-exec",
      "arn:aws:iam::<DEPLOY>:role/<project>-diff-exec"
    ] },
    "Action": "sts:AssumeRole"
  }]
}
```

**Reader の権限ポリシー**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadTrustPolicy",
      "Effect": "Allow",
      "Action": "iam:GetRole",
      "Resource": "arn:aws:iam::<TARGET>:role/*",
      "Condition": { "StringEquals": { "aws:ResourceTag/rolust:managed": "true" } }
    },
    {
      "Sid": "ReadRoleTagsForRegistrationCheck",
      "Effect": "Allow",
      "Action": "iam:ListRoleTags",
      "Resource": "arn:aws:iam::<TARGET>:role/*"
    }
  ]
}
```

**Manager の信頼ポリシー**: Reader と同じ形で、`Principal.AWS` は `<project>-apply-exec` の 1 件だけ。

**Manager の権限ポリシー**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadTrustPolicy",
      "Effect": "Allow",
      "Action": "iam:GetRole",
      "Resource": "arn:aws:iam::<TARGET>:role/*",
      "Condition": { "StringEquals": { "aws:ResourceTag/rolust:managed": "true" } }
    },
    {
      "Sid": "UpdateTrustPolicy",
      "Effect": "Allow",
      "Action": "iam:UpdateAssumeRolePolicy",
      "Resource": "arn:aws:iam::<TARGET>:role/*",
      "Condition": { "StringEquals": { "aws:ResourceTag/rolust:managed": "true" } }
    },
    {
      "Sid": "DenySelfEscalation",
      "Effect": "Deny",
      "Action": "iam:UpdateAssumeRolePolicy",
      "Resource": [
        "arn:aws:iam::<TARGET>:role/RolustTrustPolicyReader",
        "arn:aws:iam::<TARGET>:role/RolustTrustPolicyManager"
      ]
    }
  ]
}
```

`ListRoleTags` にタグ条件を付けない理由は 3.9 と同じ（「タグが無い」と「読めない」を区別するため）。`DenySelfEscalation` は**必須**である。これが無いと、Reader か Manager に管理対象タグが付いたとき、Rolust 経由で自分の信頼ポリシーを書き換えられ、自己昇格の閉路ができる（3.2 と同じ理由）。

#### ExternalId を使わない理由

ExternalId が防ぐのは、第三者のサービスが複数の顧客のロールを代理で引き受ける構図（confused deputy）である。Rolust は運用者ごとに自分でデプロイするので、この構図は成立しない。信頼ポリシーが実行ロールの ARN を完全一致で名指しするので、ほかの主体は引き受けられない。付けると、秘密の保管（SSM）、ローテーション、ターゲットごとの手動配布のずれが増える。

#### 受容するリスクと運用上の注意

- Reader 経由の `iam:ListRoleTags`（タグ条件なし）を、Diff も引き受けられる。今の Diff は `iam:GetRole`（タグ条件つき）だけなので、ターゲット側のロールのタグを列挙できる範囲が増える。読み取り専用で、3.9 の受容リスク R-d と同じ性質なので受容する。避けるには Reader を 2 本に分ける必要があり、手動の負担が増える。
- 実行ロールを作り直す（replace）と、ターゲット側の信頼ポリシーの Principal（ロールの ARN。IAM は内部で一意の ID に置き換えて保持する）が無効になる。作り直したら、ターゲットのスタックを削除して作り直す（`target_roles_deploy_command` の再実行だけでは CloudFormation が「変更なし」と判断して直らない。Issue #92 により 2026-10-13 実測、訂正前は信頼ポリシーを更新し直すとしていた）。実行ロール名は `project_name` 由来で通常は変えない。plan-guard の黄信号には足していない。
- ターゲット側のスタックのパラメータと Terraform の変数（タグのキーと値、ロール名、プロジェクト名）は合わせる。出力 `target_roles_deploy_command` が Terraform の値で埋めるので、そのまま実行すれば合う（Issue #92 により 2026-10-13 訂正。訂正前は「ターゲット側の JSON と Terraform の変数は手で合わせる」）。ずれると、登録（信頼ポリシーの取り込みを含む。Issue #135 により 2026-10-07 訂正。訂正前は「登録・紐づけ」）・差分確認・反映が、`assume-role` の文言か `AccessDenied` で失敗する（黙って別のロールに作用することは無い）。
- 管理対象の増減は、ターゲット側でも terraform plan に現れない（受容リスク R-e と同じ。タグを付けるのは運用者）。
- ターゲット側のロールの配布は、CloudFormation テンプレート（`cloudformation/target-roles.yaml`）で行う。Terraform モジュールと StackSets は提供しない（Issue #92 により 2026-10-13 訂正。訂正前は、OSS 利用者向けの配布方法は別途検討するとしていた）。テンプレートの不変条件（Reader が書き込めない、Manager の `DenySelfEscalation`、書き込みのタグ条件）は `cloudformation/target-roles.test.sh` が CI で見張る（plan-guard の R-12 は、デプロイ先の Terraform だけを見る）。

### 3.4 データストア — DynamoDB（採用）

> **Issue #26 により 2026-09-24 訂正**: OQ-2 は DynamoDB 単一テーブルに確定した（code-generation の質問 1 = A、`packages/api/TABLE-DESIGN.md`）。下の Action 一覧は `infra/main.tf` の `dynamodb_policy` と一致する。
>
> **Issue #36 により 2026-09-27 訂正**: テーブルを状態テーブル（`rolust-state`）と申請テーブル（`rolust-change-requests`）の 2 本に分けた。Action は変えず、Resource を 2 本のテーブルと状態テーブルの index にした（申請テーブルは GSI を持たない）。Sid は `RolustTables`。

```json
{
  "Sid": "RolustTables",
  "Effect": "Allow",
  "Action": [
    "dynamodb:GetItem",
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:Query",
    "dynamodb:BatchGetItem"
  ],
  "Resource": [
    "arn:aws:dynamodb:ap-northeast-1:123456789012:table/rolust-state",
    "arn:aws:dynamodb:ap-northeast-1:123456789012:table/rolust-state/index/*",
    "arn:aws:dynamodb:ap-northeast-1:123456789012:table/rolust-change-requests"
  ]
}
```

- **`dynamodb:Scan` は付与しない。** NFR-1（ページング非実装）と NFR-2（件数に比例して単一レコードが肥大しない設計）を両立させると GSI + `Query` に落ちるはずであり、Scan が必要になった時点でデータモデル側の設計を疑う。 [NFR-1][NFR-2][derived]
- FR-4.6（1 IamRole につき未反映 ChangeRequest は 1 件まで）は `PutItem` + `ConditionExpression` で足りる。複数アイテムをまたぐ原子性が必要になった場合のみ `dynamodb:TransactWriteItems` を追加する。 [FR-4.6][derived]
- テーブルが カスタマー管理 KMS キーで暗号化される場合は `kms:Decrypt` / `kms:GenerateDataKey` を当該キー ARN 限定で追加。 [derived]

### 3.5 データストア — RDS/Aurora（不採用）

> **Issue #26 により 2026-09-24 訂正**: 不採用。OQ-2 で DynamoDB に確定した（3.4）。節番号の参照を保つために残す。

| 追加が必要なもの | 条件 |
|---|---|
| `rds-data:ExecuteStatement` / `rds-data:BatchExecuteStatement` | Data API 経由で接続する場合 |
| `secretsmanager:GetSecretValue`（当該シークレット ARN 限定） | 接続情報を Secrets Manager に置く場合。NFR-3（資格情報のハードコード禁止）を満たす手段 |
| `ec2:CreateNetworkInterface` / `ec2:DescribeNetworkInterfaces` / `ec2:DeleteNetworkInterface` | Lambda を VPC 内に配置する場合（`AWSLambdaVPCAccessExecutionRole` 相当） |

### 3.6 CloudWatch Logs（3 系統共通）

```json
{
  "Sid": "Logs",
  "Effect": "Allow",
  "Action": ["logs:CreateLogStream", "logs:PutLogEvents"],
  "Resource": "arn:aws:logs:ap-northeast-1:123456789012:log-group:/aws/lambda/rolust-*:*"
}
```

ロググループを Terraform で先に作成すれば `logs:CreateLogGroup` は不要。 [derived]

> **Issue #26 により 2026-09-24 追記**: これは主リージョンの 3 系統に限る。Lambda@Edge のログは処理したエッジのリージョンに出るため事前に作れず、`logs:CreateLogGroup` を持つ（3.8）。
>
> **Issue #9 により 2026-09-29 訂正**: 「事前に作れず」は、エッジのリージョンを選べないため全リージョン分を先に作れない、という意味に限る。Lambda@Edge のロールが書き込めるのは Terraform 管理下の 3 リージョンだけになった（3.8）。

### 3.7 アクセス制限の資格情報（解決: Basic 認証）

> **Issue #26 により 2026-09-24 訂正**: OQ-1 は Lambda@Edge の Basic 認証に確定し、資格情報は SSM Parameter Store（SecureString）に置く（code-generation の質問 2）。権限は Lambda@Edge の実行ロールが持ち、3 系統には追加しない（3.8）。

FR-6.1 の手段として Basic 認証を選び、資格情報を SSM Parameter Store / Secrets Manager に置く場合のみ、`ssm:GetParameter` または `secretsmanager:GetSecretValue`（+ 必要なら `kms:Decrypt`）を追加する。CloudFront 署名付き URL / Cookie を選んだ場合、検証は CloudFront 側で完結するため Lambda 実行ロールへの追加は不要。 [FR-6.1][Q12][derived]

（Issue #20 により 2026-10-05 追記: `auth_mode = "cognito"` のとき、資格情報は Cognito が持ち、Rolust は秘密を持たない。SSM に置くのは、認証方式（`/rolust/auth-mode`）と、公開情報だけの接続情報（`/rolust/auth-cognito`。String）である。 [FR-6.4]）

### 3.8 Lambda@Edge（edge-auth）の実行ロール

（Issue #26 により 2026-09-24 追記。`infra/edge-auth.tf` の実装を記す）

| 項目 | 内容 |
|---|---|
| ロール | `rolust-edge-auth-exec`（us-east-1 に作る） |
| 信頼ポリシー | `lambda.amazonaws.com` と `edgelambda.amazonaws.com` の両方。片方だけではレプリケーションできない |
| ログ | `logs:CreateLogGroup` / `logs:CreateLogStream` / `logs:PutLogEvents`。対象は、Terraform が管理する 3 リージョン（us-west-1・eu-central-1・us-east-1）の `/aws/lambda/us-east-1.rolust-edge-auth`（と `:*` 付きの形）に限る。エッジのリージョンは選べず全リージョン分を先に作れないため、`logs:CreateLogGroup` は残す（Issue #9 により 2026-09-29 訂正: 以前は全リージョンの `/aws/lambda/*.rolust-edge-auth` を許し、別のエッジが使われるたびに保持無期限・Terraform 管理外のロググループが自動作成されていた）。それ以外のリージョンのエッジが処理した分は書き込みを拒否され、ロググループは作られず、ログも残らない。リージョンを足すときの手順は `infra/monitoring.tf` にある |
| 資格情報 | `ssm:GetParameter`（Basic 認証の SSM パラメータ 1 件に限定）と `kms:Decrypt`（`Resource: "*"`、`kms:ViaService` = `ssm.us-east-1.amazonaws.com` の条件付き） |
| IP 許可リスト | `ssm:GetParameter`（IP 許可リストの SSM パラメータ 1 件に限定）。String なので KMS は要らない（Issue #76 により 2026-09-29 追記） |
| 認証方式・OIDC の接続情報 | `ssm:GetParameter`（`auth-mode` と `auth-cognito` の 2 件に限定。`auth-cognito` の ARN は名前とアカウントから組んだ文字列で、リソースへの参照ではない。Terraform の依存の循環を避けるため）。String なので KMS は要らない。`kms:Decrypt` は SecureString の `basic-auth` のためだけである（Issue #20 により 2026-10-05 追記） |

### 3.9 CRUD Lambda — 登録時のタグ読み取り

（Issue #26 により 2026-09-24 追記。`infra/lambda.tf` の `crud_iam_read_tags` の実装を記す）

```json
{
  "Sid": "ReadRoleTagsForRegistrationCheck",
  "Effect": "Allow",
  "Action": "iam:ListRoleTags",
  "Resource": "arn:aws:iam::123456789012:role/*"
}
```

- **タグ条件を付けない**（infrastructure-design (3.4) の再実行の RQ-6 = A）。タグ条件で絞ると、タグの無いロールで `AccessDenied` が返り、「タグが無い」と「読めない」を区別できなくなる。`packages/api/src/handlers/roles.ts` の 3 分岐（存在しない・タグが無い・値が違う）はこの区別を前提にしている。最小権限のつもりで 3.2 と同じタグ条件を付けると、登録時の判定が壊れる。
- **引き受けたもの（受容リスク R-d）**: CRUD がアカウント内の全ロールのタグを列挙できる。無関係な他システムのロールを含み偵察情報になりうるが、読み取り専用で AWS の状態を変える能力は持たない。

### 3.10 CRUD Lambda — 登録時の信頼ポリシーの読み取り（Issue #135 により 2026-10-07 訂正。訂正前は「紐づけ時の信頼ポリシーの読み取り」）

（Issue #80 により 2026-09-30 追記。`infra/lambda.tf` の `crud_iam_read_trust` の実装を記す）

```json
{
  "Sid": "ReadTrustPolicyForLinkImport",
  "Effect": "Allow",
  "Action": "iam:GetRole",
  "Resource": "arn:aws:iam::123456789012:role/*",
  "Condition": { "StringEquals": { "aws:ResourceTag/rolust:managed": "true" } }
}
```

- **用途**: ロールを登録するとき（`POST /roles`。Issue #135 により 2026-10-07 訂正。訂正前は、ロールをユーザプールへ紐づけるとき（`PUT /pool/roles`）。権限は変わらない）、信頼ポリシーにいるパスなしの IAM ユーザを Rolust の IamUser と反映済みの Assignment に取り込む（`packages/api/src/services/role-import.ts` を、`role-register-service.ts` が呼ぶ。requirements.md FR-2.1）。FR-5.7 の例外（同 FR-5.7 の注記）。
- **タグ条件を付ける**（3.2 の `ReadTrustPolicy` と同じ）。3.9 の `ListRoleTags` と違い、ここで欲しいのは管理対象のロールの信頼ポリシーだけであり、タグの無いロールで `AccessDenied` になっても判定は壊れない（登録時に、タグ付きであることは 3.9 の検証を通っている）。登録の直前にタグを確かめるので、通常は `AccessDenied` にならない。タグが外れた直後などで `AccessDenied` になったときは、API はコードと直し方を示して拒否し、何も書かない（登録済みのロールは影響を受けない）。
- **読める範囲は Diff 系統と同じ**で、新しい偵察面は増えない。CRUD は `iam:UpdateAssumeRolePolicy` を持たない（FR-3.2 の保証は保たれる）。コードは、読み取りだけの型（`IamTrustPolicyReader`）を CRUD に渡し、更新の関数を呼べる形にしない。
- **別アカウントのロール**（Issue #85 により 2026-09-30 追記）: ターゲット側の Reader を引き受けて読む（3.3）。CRUD の実行ロールが引き受けられるのは Reader だけで、更新用の Manager は引き受けられない（`sts:AssumeRole` の Resource を Reader の名前に固定している。plan-guard の R-12 が見る）。
- **機械的な担保**: plan-guard の R-1・R-3 がタグ条件と一覧系の Action を、R-9 が Action が `iam:GetRole` 単体であることを検査する（`cicd-pipeline.md`）。
- **実測**: 特権昇格面に触れるため、反映の前後に実測する。手順は旧リポジトリ（`rolust-legacy`）の plan にあった（持ち越していない。画面のロールの紐づけ操作が旧 #135 で廃止され、その手順は現行の画面では使えないため）。登録時の取り込み（`iam:GetRole`）の実測は `docs/runbooks/cross-account-roles.md` の 4.2・4.3 が担う。

### 3.11 CRUD Lambda — 許可アカウントの読み取り（Issue #139 により 2026-10-07 追記）

（`infra/lambda.tf` の `crud_ssm_allowed_accounts` の実装を記す）

```json
{
  "Sid": "ReadAllowedAccountIds",
  "Effect": "Allow",
  "Action": "ssm:GetParameter",
  "Resource": "arn:aws:ssm:ap-northeast-1:123456789012:parameter/rolust/allowed-account-ids"
}
```

- **用途**: IamUser を作る入口（`POST /pool/users`、ロール登録時の取り込み）で、アカウント ID が許可リストにあることを確かめる（requirements.md FR-1.11。`packages/api/src/aws/allowed-accounts.ts`）。
- **Resource は 1 件に固定する**。String のパラメータなので `kms:Decrypt` は要らない。Diff・Apply の実行ロールには付けない（ユーザを登録しないため）。
- **値は Terraform の管理外**（`ignore_changes`）。apply が運用者の足したアカウントを初期値で上書きしないことを、plan-guard の R-8 が見る。
- **self_role_arns・DenySelfEscalation は変わらない**（新しい IAMロールを作らず、既存の CRUD 実行ロールにインラインポリシーを足すだけ。Terraform が書く）。plan-guard の R-12(d)（`sts` の Action の混入）は、この Statement に当たらない。
- **実測**: 反映の前後に、本番で、許可外のアカウントの登録が 400 になること、許可リストに足すと登録できること、パラメータを読めないとき 502 で拒否されることを確かめる（モックでは確かめられない。手順は Issue #139 の PR の説明に残す）。

---

## 4. 解決済み — Resource 絞り込みと FR-2.1 の衝突

> **Issue #26 により 2026-09-24 訂正**: 3 案目（`role/*` ＋ 自己昇格の明示 Deny）を採り、のちにタグ条件で絞る形へ移った（3.2 の訂正注記）。タグ方式は FR-2.1 のパスなし ARN・実行時のロール登録と衝突しない。下の帰結は、対象をタグ付きロールに改めたうえで今も成り立つ。

**最小権限のセオリーどおり `Resource` をパスで絞りたいが、要件がそれを許していない。**

| 絞り込み案 | 衝突する要件 |
|---|---|
| パス規約（`role/rolust-managed/*` のみ許可） | FR-2.1 は IamRole の登録入力を「AWSアカウントID ＋ IAMロール名」のみと規定し、Data Model の補足は IamRole の ARN を `arn:aws:iam::<accountId>:role/<roleName>`（**パスなし**）と導出している。パス規約はこの導出と矛盾する |
| 対象ロール ARN を Terraform 変数で列挙 | FR-2.1 は実行時のロール登録を要求する。ロール追加のたびに `terraform apply` が必要になり、FR-7.2（画面からのロール登録）が実質機能しなくなる |
| **`role/*` 許可 + 自己昇格の明示 Deny**（3.2 の案） | 直接の矛盾なし。ただし下記の帰結を負う |

### 3 案目を採る場合の帰結（`code-generation` の承認ゲートで確認する）

> **Rolust の管理画面に到達できる者は、対象アカウント内で管理対象タグが付いた任意の IAMロール（`DenySelfEscalation` の 5 ロールを除く）の信頼ポリシーを書き換えられる。**（Issue #26 により 2026-09-24 訂正）

FR-6.1 のアクセス制限が「最小限」（OQ-1 で Basic 認証に確定。Issue #26 により 2026-09-24 訂正）である以上、管理画面の防御力がそのまま信頼ポリシー改変権限の防御力になる。`iam:UpdateAssumeRolePolicy` は、高権限ロールの信頼ポリシーを攻撃者 principal に向けて書き換えたうえで `sts:AssumeRole` する典型的な特権昇格経路であり、poc としてこれを許容するかは判断が要る。

**~~ただし Basic 認証は API への到達を守らない~~**（Issue #26 により 2026-09-24 追記。Issue #76 により 2026-09-29 訂正: 解消した）: API Gateway のリージョナルエンドポイントは、以前は `authorization = "NONE"` で、CloudFront を経由せずに到達すれば Basic 認証を経ずに反映の API を呼べた（受容リスク R-a）。Issue #76 で、CloudFront が付ける API キー（`x-api-key`）を API Gateway のメソッドが要求するようにし、直 URL は Lambda を呼ぶ前に 403 になる（`requirements.md` FR-6.3）。API キーは多層防御の一層であり、上の帰結の「管理画面に到達できる者」を絞る第一の防御は、CloudFront の IP 制限（FR-6.2）と Basic 認証（FR-6.1）である。

（Issue #20 により 2026-10-05 追記: `auth_mode = "cognito"` でも、この帰結は同じである。Basic 認証の位置に Cognito のサインインが入り、プールに居るユーザは全員が管理者で、権限の区別は無い（FR-6.4）。ユーザを削除・無効化しても、発行済みの ID トークンは有効期限（最大 1 日）まで使える。即時に締め出すなら `auth_mode` を切り替える。 ログアウト（Issue #160 により 2026-10-09 追記）は ID トークンを無効化しない。Cookie と Cognito のセッションを消すだけで、コピーされたトークンは `exp` まで使える。）

軽減策として検討したが本メモでは採用しなかったもの:

- **Permissions boundary**: 実行ロールに boundary を付けても `iam:UpdateAssumeRolePolicy` の対象ロール側は制限できない（boundary は自ロールの実効権限を絞るものであり、操作対象の集合を絞らない）。 [derived]
- **管理者エンティティによる操作者単位の制限**: Q9 / Q15 により管理者はデータモデルに含めないため、poc では成立しない（Issue #120 により 2026-10-05 訂正: 実行者は ChangeRequest の作成者・反映者として記録するようになったが、管理者エンティティと権限の区別は無いので、操作者単位の制限は引き続き成立しない。訂正前は「実行者も記録しない」とした）。A-6（将来の管理者エンティティ導入）と同時に再検討する。 [Q9][Q15][A-6]

---

## 5. 依存する未解決事項

| Open Question | 本メモへの影響 |
|---|---|
| **OQ-1**（アクセス制限の具体手段） | 3.7 の要否。および 4 節の帰結の深刻度 → **解決**: Basic 認証（3.7・3.8）（Issue #26 により 2026-09-24 訂正） |
| **OQ-2**（DynamoDB / RDS） | 3.4 と 3.5 のいずれを採るか。VPC 配置なら ENI 権限が追加される → **解決**: DynamoDB（3.4）（Issue #26 により 2026-09-24 訂正） |
| **OQ-3**（IAM 権限の確保方法） | 3.2（単一アカウント）と 3.3（クロスアカウント）のいずれを採るか。**本メモが提案しているのはこの項目** → **解決**: 単一アカウント構成（3.2）を採り、クロスアカウント構成（3.3）は Issue #85 で実装した（Issue #26 により 2026-09-24 訂正。Issue #85 により 2026-09-30 訂正。訂正前は「3.3 は未実装」） |

## 6. NFR との対応

| NFR | 本メモでの充足 |
|---|---|
| NFR-3（資格情報をハードコードせず環境変数または AWS 認証情報チェーンから取得） | Lambda 実行ロール経由の認証情報チェーンを使う限り自動的に満たされる。3.5 の Secrets Manager 参照も同じ方針。別アカウントのロールは、実行ロールが引き受けた一時資格情報（3.3）を使い、資格情報を引数にも環境変数にも持たない（Issue #85 により 2026-09-30 追記） |
| NFR-3 前段（管理外 principal を削除しない） | IAM 権限の設計では担保されない。FR-5.1 の保全方式ロジックの実装責任 |
| NFR-4（README と Terraform 一式でセットアップ完了） | 3.3 のクロスアカウント構成を使うときの、ターゲットアカウント側の Reader・Manager は、同梱の CloudFormation テンプレート（`cloudformation/target-roles.yaml`）で作る。Terraform サブモジュールにはしない（依頼者の選択）。第三者は Release の tarball から入れる（README「セットアップ」の経路 A。Issue #92 により 2026-10-13 訂正。訂正前は、README の「クロスアカウント構成」の手順で手動で作り、配布方法のパッケージ化は別途検討するとしていた）（Issue #26 により 2026-09-24 追記。Issue #85 により 2026-09-30 訂正。訂正前は、配布手順が README と Terraform サブモジュールに含まれる必要があるとし、3.3 は未実装のため該当しないとしていた）。 |

## 権限の分離と IAM（Issue #141 により 2026-10-07 追記）

管理者の権限（参照・作成・反映。FR-6.5）は、IAM ではなく、API の判定で行う。Lambda@Edge が ID トークンの `cognito:groups` を `x-rolust-actor` に載せ、API の共通層が、ルートの必要権限と照らして、AWS・DynamoDB を呼ぶ前に 403 にする（`packages/api/src/http.ts`）。

- **IAM ポリシーは変えない。** `DenySelfEscalation`・実行ロールの権限・クロスアカウントのロールの権限は、このためには動かさない。信頼ポリシーを書けるのは、これまでと同じく Apply 系統の実行ロールだけである。
- **Cognito のグループの作成は Terraform が、割り当ては運用者が CLI で行う。** Rolust の Lambda は Cognito の管理 API を呼ばない（権限を持たない）。グループの割り当てで、誰が反映できるかが決まるので、割り当て権限（`cognito-idp:AdminAddUserToGroup` など）は運用者だけが持つ。
- **API が拒否する前提**: `x-rolust-actor` は Lambda@Edge だけが付け、ビューアが送った値は除去する。API Gateway の直 URL は API キーで塞いである（FR-6.3）。したがって、API が読むグループは信頼できる。
- **fail closed**: 権限の設定（`ROLUST_AUTH_MODE`）が無い・不正なら API は 500 で止まり、全権限にしない。`cognito` でヘッダーが読めなければ権限なしとする。
