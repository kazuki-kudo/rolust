# クロスアカウントの IAM ロールの信頼ポリシーの操作 — 設計

- 日付: 2026-09-30
- Issue: #85
- ブランチ: `feat/85-cross-account-roles`
- 状態: spec レビュー待ち

## 1. 背景と目的

Rolust は、デプロイしたアカウント（JUMP）にあるロールの信頼ポリシーだけを読み書きできる（単一アカウント構成。#26・#27）。別アカウントのロールは、登録・紐づけ・申請の作成までは通るが、差分確認と反映は IAM を呼ばずに `CrossAccountRoleNotSupported` で失敗する。一方で FR-2.2 は「別アカウントのロールを登録・運用し、FR-5.1 の反映まで到達できる」ことを **Must** としており、いまは満たしていない。

失敗の原因は、`iam:GetRole`・`iam:UpdateAssumeRolePolicy`・`iam:ListRoleTags` がロール名だけで呼ばれ、呼び出し元アカウントのロールとして解決されることにある。別アカウントのまま呼ぶと、デプロイ先の同名ロールを読み書きしてしまう（#27）。そのため Rolust は、アカウントが違うと IAM を呼ばずに止めている。

この spec は、別アカウントのロールを、ターゲットアカウントのロールを AssumeRole して操作する構成で成立させる。設計書 `iam-policy-design-note.md` 3.3 が未実装の構成として残していたものにあたる（#27 の選択肢 C）。

### 発端

2026-09-30、依頼者がユーザプール画面で DEV1 アカウントのロール `dev1_role_sw_rolust_c` を紐づけたところ、「信頼ポリシーを読めず、取り込んでいません」の警告が出た（#80 の D-10 どおりの挙動）。差分確認・反映へ進んでも失敗する。依頼者は、クロスアカウントのロールを操作できるようにしたい。

### 依頼者の制約

- クロスアカウントに必要なリソース変更のうち、**ターゲット側は Terraform を使わず手動**で行う（依頼者。2026-09-30）。
- OSS として他の人が利用する場合の、権限の付与方法は、別途検討する（依頼者。2026-09-30）。本 spec の対象外（6 節）。

### 成功基準

1. DEV1 の `dev1_role_sw_rolust_c` を、登録、紐づけ（信頼ポリシーからの取り込みを含む）、チェック、申請、差分確認、反映まで通せる。実測: DEV1 の CloudTrail の `UpdateAssumeRolePolicy` の呼び出し元が、Manager ロールのセッション（`rolust-apply`）である。
2. AssumeRole に失敗しても、デプロイ先の資格情報で IAM を呼ばない。実測: ターゲット側の準備を一時的に外した状態で、JUMP に置いた同名で管理対象タグの付いたロールの信頼ポリシーが変わらず、JUMP の CloudTrail に `UpdateAssumeRolePolicy` が無い。
3. CRUD・Diff の実行ロールは、更新用の Manager を引き受けられない。Manager は、自分と Reader の信頼ポリシーを更新できない（実測）。
4. ターゲット側が未準備のアカウントのロールは、登録も紐づけもできず、原因と直し方が示される。
5. デプロイ先と同じアカウントのロールの挙動は変わらない（既存のテストが通る）。
6. 別アカウントへの到達範囲が広がる変更（Action の追加、ロール名へのワイルドカード、Reader と Manager の取り違え）は、plan-guard が plan の時点で止める。

## 2. 決定事項

| ID | 事項 | 決定 | 出所 |
|---|---|---|---|
| D-1 | 構成 | ターゲットアカウントに、読み取り用の `RolustTrustPolicyReader` と更新用の `RolustTrustPolicyManager` を置き、JUMP の実行ロールが AssumeRole する。CRUD と Diff は Reader、Apply は Manager だけを引き受ける | 依頼者の選択（2026-09-30。アプローチ A）。採らなかった案: 3.3 のとおり更新用 1 本（CRUD が更新権限のロールを引き受けられる形になり、FR-3.2 の構造的な保証が崩れる。セッションポリシーで絞る案は、呼び出し側が付け忘れると書き込めるので保証にならない）、JUMP 側に許可アカウントの一覧を持つ案（ターゲットを増やすたびに `terraform apply` が要り、運用が 2 か所になる） |
| D-2 | 手動の範囲 | ターゲット側のロールは手動（README の JSON と `aws iam` の手順）。JUMP の実行ロールへの `sts:AssumeRole` の許可は Terraform（`infra/lambda.tf`） | 依頼者の選択（2026-09-30）。実行ロールの権限は plan-guard が plan で見張る面であり、手動にすると機械検査の外に出るため、JUMP 側は Terraform を推奨し、承認された |
| D-3 | ExternalId | 使わない。信頼ポリシーが実行ロールの ARN を完全一致で名指しする。3.3 の記述を訂正する | 導出: ExternalId が防ぐのは、第三者のサービスが複数の顧客のロールを代理で引き受ける構図（confused deputy）である。Rolust は運用者ごとに自分でデプロイするので成立しない。付けると、秘密の保管（SSM）、ローテーション、手動配布のずれが増える。依頼者が承認（2026-09-30） |
| D-4 | ロール名と変数 | 既定は `RolustTrustPolicyReader`・`RolustTrustPolicyManager`（3.3 の名前を踏襲）。Terraform 変数 `target_reader_role_name`・`target_manager_role_name` で変えられ、IAM 名の書式に限り、ワイルドカードを含む値は `validation` で拒否する。Lambda には環境変数 `ROLUST_TARGET_READER_ROLE_NAME`・`ROLUST_TARGET_MANAGER_ROLE_NAME` で渡す | 導出: JUMP 側の `Resource` はロール名を固定してアカウントだけワイルドカードにするので（D-5）、名前は変数で受け、IAM ポリシーとアプリで同じ値を使う（`managed_tag_key` と同じ方式） |
| D-5 | 許可するアカウント | JUMP 側の `Resource` は `arn:aws:iam::*:role/<固定名>`。アカウントは絞らない。開けるかどうかはターゲット側の信頼ポリシーが決める | 依頼者が承認（2026-09-30）。導出: ターゲット側でロールを作り、実行ロールを名指しした管理者だけが、そのアカウントへの到達を許せる。別アカウントの第三者が同名のロールを作っても、Rolust が影響を及ぼすのは、管理者がそのアカウントのロールを登録したときの、その第三者のロールだけである |
| D-6 | 有効化フラグ | 設けない | 導出: ターゲット側にロールが無ければ引き受けられないので、ターゲット側が実質の関門になる。フラグは動作のモードを増やす。依頼者が承認（2026-09-30） |
| D-7 | クライアントの解決 | ロールの ARN のアカウントがデプロイ先と同じなら、実行ロール自身の資格情報を使う（従来どおり）。別アカウントなら、AssumeRole した一時資格情報の IAM クライアントを使う（読み取りは Reader、更新は Manager）。デプロイ先を判定できない（`deployAccountId` が `null`）ときは、従来どおり `DeployAccountUnknown` で止める。**AssumeRole に失敗しても、デプロイ先の資格情報で呼び直さない**（クライアントの選択が資格情報を決めるので、フォールバックの分岐を持たない） | 導出: #27 の再発防止。同一か別かを判定できなければ、どちらの資格情報で呼ぶかを決められない |
| D-8 | 一時資格情報 | SDK の `fromTemporaryCredentials` を使い、アカウントと役割（Reader・Manager）ごとに Lambda の実行環境内でキャッシュし、期限前に更新する。セッション名は `rolust-crud`・`rolust-diff`・`rolust-apply`。新しい依存 `@aws-sdk/credential-providers` を足す | 導出: 自前で期限管理を書くより、SDK の実績のある実装を使う。セッション名で、CloudTrail の呼び出し元を系統まで特定できる。依存を変えるので `npm audit` を実行する |
| D-9 | 経路ごとの動き | 別アカウントのロールについて、登録は Reader の `ListRoleTags` で同アカウントと同じ 3 分岐、紐づけは Reader の `GetRole` で取り込み、差分確認は Reader の `GetRole`、反映は Manager の `GetRole` → マージ → `UpdateAssumeRolePolicy`（3.4 の表） | 導出: 同アカウントの経路と同じ検証と手順にそろえる（FR-2.2「同一アカウントの場合も同じ手順で扱う」）。#26 の「誤りはそれが作られた場所で報せる」に従い、登録時にも検証する |
| D-10 | エラー | AssumeRole の失敗を、新しい種別 `assume-role` で区別する。文言は GI-6 に従い、何が・なぜ・どう直すかを含む。引き受けた後の `AccessDenied`・`NoSuchEntity` は従来の分類のままにし、文言にアカウント ID を入れる。`CrossAccountRoleNotSupported` は廃止し、`DeployAccountUnknown` は残す | 導出: 原因と直し方が違う失敗（ターゲット側の未準備と、タグ・権限の不足）を区別しないと、運用者は間違った場所を直す（`roles.ts` の 3 分岐の考え方） |
| D-11 | 未準備のターゲット | ターゲット側の Reader を引き受けられない別アカウントのロールは、登録も紐づけも 502 で拒否する。引き受けた後の失敗は、同アカウントと同じ扱いにする（登録: 存在しない・タグが無い・値が違うは 400、権限不足は 502。紐づけ: 存在しないは 400、タグ条件による `AccessDenied` は 502） | 導出: D-9 のとおり、誤りを作られた場所で報せる。従来の「登録は通り、差分確認で初めて失敗」は、README が認めていた欠点だった。依頼者が承認（2026-09-30） |
| D-12 | 前の spec の D-10 | 覆す。別アカウントのロールも信頼ポリシーを読んで取り込む。`ImportedRole.skipped` と、画面の警告（画面 1・3 の `Flashbar`）を廃止する | 導出: 別アカウントを読めるようになると、D-10 の「読まずに紐づける」が成り立つ場面が無い。出す場面が無い警告と `skipped` はデッドコードになる。依頼者が承認（2026-09-30） |
| D-13 | plan-guard | 赤信号 R-12 を足す。番号を足すので、現行の一覧を指す「R-1〜R-11」の表記を grep で総当たりして直す（5 節） | 導出: 検査する性質（`sts:AssumeRole` の到達範囲）が、R-1・R-3・R-9 の性質（タグ条件と Action の範囲）と別である。前の spec の D-13 が番号を足さなかったのは、性質が同じだったため。R-10（#24）・R-11（#76）と同じ扱い |
| D-14 | 既存データ | 移行しない。登録済み・紐づけ済みの別アカウントのロールは、ARN のまま使える。ターゲット側を用意するまで、差分確認・反映は D-10 の文言で失敗する | 導出: データの構造は変わらない |
| D-15 | 進め方 | spec 1 本・plan 1 本・ブランチ 1 本・PR 1 本 | 導出: 経路は 1 つの仕組み（クライアントの解決）を共有する |

## 3. 設計

### 3.1 全体構成

```
JUMP（Rolust）                          ターゲット（DEV1 など）
 crud-exec ─┐                            ┌ RolustTrustPolicyReader（手動）
 diff-exec ─┴─ sts:AssumeRole ─────────▶ │   iam:GetRole（タグ条件つき）＋ iam:ListRoleTags
 apply-exec ─── sts:AssumeRole ────────▶ └ RolustTrustPolicyManager（手動）
                                            iam:GetRole ＋ iam:UpdateAssumeRolePolicy（タグ条件つき）
                                            ＋ 自分と Reader の信頼ポリシー更新を Deny
```

Diff は Apply と別の系統なので、Apply の書き込み権限は Diff・CRUD に及ばない。CRUD が AWS へ書けないという FR-3.2 の保証は、CRUD の実行ロールが Manager を引き受ける権限を持たないこと（JUMP 側の IAM ポリシー）と、Manager の信頼ポリシーが apply-exec だけを名指しすること（ターゲット側）の 2 段で保たれる。

### 3.2 ターゲット側のロール（手動）

以下の `<JUMP>` は Rolust のデプロイ先のアカウント ID、`<TARGET>` はターゲットのアカウント ID、`<project>` は `project_name`（既定は `rolust`）、`rolust:managed`・`true` は `managed_tag_key`・`managed_tag_value`（既定値）。ターゲット側の JSON は手で作るので、これらの値は Terraform の変数と手で合わせる。

**Reader の信頼ポリシー**

```json
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": { "AWS": [
      "arn:aws:iam::<JUMP>:role/<project>-crud-exec",
      "arn:aws:iam::<JUMP>:role/<project>-diff-exec"
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

`ListRoleTags` にタグ条件を付けない理由は、`iam-policy-design-note.md` 3.9 と同じ（「タグが無い」と「読めない」を区別するため）。

**Manager の信頼ポリシー**: Reader と同じ形で、`Principal.AWS` は `<project>-apply-exec` だけ。

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

`DenySelfEscalation` は**必須**である。これが無いと、Reader か Manager に管理対象タグが付いたとき、Rolust 経由で自分の信頼ポリシーを書き換えられ、自己昇格の閉路ができる（`iam-policy-design-note.md` 3.2 と同じ理由）。

### 3.3 JUMP 側（Terraform）

- 実行ロールごとに、`aws_iam_role_policy` を足す。CRUD と Diff は `sts:AssumeRole` を `arn:${partition}:iam::*:role/${var.target_reader_role_name}` に、Apply は `arn:${partition}:iam::*:role/${var.target_manager_role_name}` に許可する。Action は `sts:AssumeRole` 単体。
- 変数 `target_reader_role_name`・`target_manager_role_name` は、IAM 名の書式（`^[A-Za-z0-9+=,.@_-]{1,64}$`）に限る `validation` を持つ。この書式はワイルドカードを含めない。
- 環境変数 `ROLUST_TARGET_READER_ROLE_NAME`・`ROLUST_TARGET_MANAGER_ROLE_NAME` を、3 系統の Lambda に渡す（`packages/api/src/config.ts` が読む）。
- `self_role_arns` は変えない。ターゲット側のロールは Rolust が作らないので、R-10 の対象外である。

### 3.4 アプリ

**クライアントの解決（D-7・D-8）**: 信頼ポリシーの読み取り、更新、タグの読み取りは、ロールの ARN からアカウントを取り出し、そのアカウントに応じたクライアントを使う。

- デプロイ先と同じアカウント: 従来のクライアント（実行ロール自身の資格情報）。
- 別アカウント: `fromTemporaryCredentials`（`RoleArn = arn:aws:iam::<アカウント>:role/<Reader または Manager>`、`RoleSessionName = rolust-<系統>`）の資格情報を持つ `IAMClient`。読み取りと、タグの読み取りは Reader、更新は Manager。アカウントと役割ごとにキャッシュする。
- `deployAccountId` が `null`: `DeployAccountUnknown`（従来どおり）。

サービス層の `assertRoleInDeployAccount` の呼び出し（`diff-service`・`apply-service`・`role-import`）と、`roles.ts` の別アカウントの検証の省略は、この解決に置き換える。`deployAccountId` は、解決の入力として、引き続き渡す。

**経路ごとの動き（D-9・D-11）**

| 経路 | 別アカウントのロール |
|---|---|
| ロール登録（`POST /roles`） | Reader で `ListRoleTags`。存在しない・タグが無い・値が違うは 400、権限不足は 502。AssumeRole の失敗は 502（`TagLookupUnavailable` と同じ扱いで、原因の文言を分ける） |
| ロールの紐づけ（`PUT /pools/:poolId/roles`） | Reader で `GetRole` し、信頼ポリシーの IAM ユーザを取り込む。1 件でも読めなければ、何も書かずに拒否する（前の spec の D-9）。存在しないは 400、タグ条件による `AccessDenied` と AssumeRole の失敗は 502（`TrustPolicyUnavailable`。原因の文言を分ける） |
| 差分確認 | Reader で `GetRole`。失敗はカード単位の read-error（1 件の失敗が他を止めない。FR-7.4） |
| 反映 | Manager で `GetRole` → マージ → `UpdateAssumeRolePolicy`。失敗は、申請を「失敗」で記録し、ロックを持ち続ける（FR-5.5・FR-4.6） |

**エラー（D-10）**: `IamFailureKind` に `assume-role` を足す。AssumeRole の失敗の文言は、次の 3 点を含む。

> アカウント X のロール `RolustTrustPolicyReader` を引き受けられませんでした（AccessDenied）。ターゲットアカウントにこのロールが無いか、信頼ポリシーが `rolust-crud-exec` を許可していません。README の「クロスアカウント構成」の手順で作成してください。

**変更するファイル**

- api: `aws/iam-client.ts`、`config.ts`、`services/diff-service.ts`、`services/apply-service.ts`、`services/role-import.ts`、`services/pool-roles-service.ts`、`handlers/roles.ts`
- core: `api-contract.ts`（`ImportedRole.skipped` を削除）
- web: `screens/LinkRolesModal.tsx`、`MatrixScreen.tsx`、`PoolsScreen.tsx`（別アカウントの警告の廃止）
- infra: `lambda.tf`（実行ロールごとのポリシーと環境変数）、`variables.tf`、`outputs.tf`（必要なら）
- `.github/scripts/plan-guard.sh`・`plan-guard.test.sh`

### 3.5 plan-guard の赤信号 R-12（D-13）

次のいずれかに当てはまる plan を、承認せず差し戻す。判定の詳細は plan で決め、`plan-guard.test.sh` に合格と不合格のケースを足す。

- `sts:AssumeRole` を持つ Lambda 実行ロールのポリシーで、Action が `sts:AssumeRole` 単体でない。
- `Resource` のロール名の部分にワイルドカードがある（アカウントの部分の `*` は許す）。
- CRUD と Diff のポリシーが Reader 以外を、Apply のポリシーが Manager 以外を指す。
- 上記のポリシー以外の Lambda 実行ロールのポリシーに、`sts:*` の Action が現れる。

R-12 は、到達範囲が広がる変更を止めるための検査であり、ターゲット側（手動）のロールの中身は検査しない。ターゲット側は、手順書の実測（4 節）と、JSON の突き合わせ（`jq -S`）で確かめる。

### 3.6 画面

- 画面 1・3 の、別アカウントのロールを取り込まなかった警告（`Flashbar`）を廃止する（D-12）。保存の成功通知は、取り込みの件数の表示を、同アカウント・別アカウントの区別なく出す。
- 差分確認画面は、API の message とコードをそのまま出すので、構造を変えない（GI-6）。read-error の説明から、`CrossAccountRoleNotSupported` の記述を除く。

### 3.7 受容するリスクと運用上の注意

- **Reader 経由の `ListRoleTags`（タグ条件なし）を、Diff も引き受けられる。** 今の Diff は `GetRole`（タグ条件つき）だけなので、ターゲット側のロールのタグを列挙できる範囲が増える。読み取り専用で、3.9 の受容リスク R-d と同じ性質なので受容する。避けるには Reader を 2 本に分ける必要があり、手動の負担が増える。
- **実行ロールを作り直す（replace）と、ターゲット側の信頼が切れる。** 信頼ポリシーの Principal はロールの ARN で書くが、IAM は内部で一意の ID に置き換えて保持する。実行ロールを削除・再作成すると、ターゲット側の信頼ポリシーは、名前が同じでも一致せず、AssumeRole が `AccessDenied` になる。実行ロール名は `project_name` 由来で通常は変えない。README に、作り直したらターゲット側の信頼ポリシーを更新し直すことを書く。plan-guard の黄信号には足さない。
- **ターゲット側の JSON と Terraform の変数は、手で合わせる。** タグのキーと値、ロール名がずれると、登録・紐づけ・差分確認・反映が、D-10 の文言か `AccessDenied` で失敗する（黙って別のロールに作用することは無い）。
- **管理対象の増減は、ターゲット側でも Terraform の plan に現れない**（既存の受容リスク R-e と同じ。タグを付けるのは運用者）。

## 4. 検証

アプリコードは TDD で書く。Terraform・CI 設定・文書は、CLAUDE.md § テスト方針のとおり、変更した層ごとに機械判定で検証する。

**ユニット（TDD）**

- クライアントの解決: 同アカウントは従来のクライアント、別アカウントは Reader（読み取り）か Manager（更新）、`null` は `DeployAccountUnknown`。
- **AssumeRole の失敗で、デプロイ先の資格情報のクライアントの `send` が呼ばれないこと**（監視して固定）。
- 登録・紐づけ・差分確認・反映の各経路、エラーの分類と文言（`assume-role`、引き受けた後の `AccessDenied`・`NoSuchEntity`）。
- 同アカウントの経路が変わらないこと（既存のテスト）。
- `plan-guard.test.sh` に R-12 のケース。

**Terraform・CI**: `terraform fmt -check -recursive`、`terraform init -backend=false`、`terraform validate`、`plan-guard.test.sh`。`terraform plan` で、CI ロール `rolust-ci-plan` に追加の権限が要らないこと（同じ `aws_iam_role_policy` の型のため、要らない見込み）を確かめる。

**push の前**: `gitleaks git . --no-banner --redact --exit-code 1`（8.30.1）、`trivy config infra --ignorefile .trivyignore.yaml --severity CRITICAL,HIGH --exit-code 1`（0.73.0。`infra/` を変えるので）、`npm audit --audit-level=high`（依存を足すので）。

**実 AWS の実測**（モックでは確かめられない。依頼者が引き取れる手順書を、plan の成果物として残す）

1. **DEV1 の準備（手動。承認後）**: Reader と Manager を作成し、`dev1_role_sw_rolust_c` に管理対象タグを付ける。既存の資源を書き換えるので、事前に信頼ポリシーとタグを退避し、検証後に復元し、復元後に読み直して一致を確かめる（CLAUDE.md）。Reader と Manager は、依頼者の目的（DEV1 のロールの操作）の成果物なので、検証後も残す。
2. **JUMP の反映**: README の手順で `terraform apply` する（`cd.yml` は反映しない。`docs/design/cd-config.md` D-7）。承認は、実施の直前にいただく。
3. **本番での通し操作**: 検証用のプールを新規に作り（本番は依頼者も触る）、登録、紐づけ（取り込み件数）、チェック、申請、差分確認、反映を通す。CloudTrail で、DEV1 の `UpdateAssumeRolePolicy` の呼び出し元が Manager のセッション（`rolust-apply`）であること、STS の `AssumeRole` が両アカウントに現れることを確かめる。IAM のイベントは us-east-1、STS は Lambda が呼んだリージョンで引く（`.claude/rules/shell-and-aws-cli.md`）。
4. **#27 の再発防止の実測**: 検証用に、JUMP に同名で管理対象タグの付いたロールを作る（承認後。終わったら削除する）。登録と申請の作成を済ませたあと、DEV1 の Manager の信頼ポリシーを退避して外し、反映が**失敗する**ことを確かめる。JUMP の同名ロールが変わらないこと、JUMP の CloudTrail に `UpdateAssumeRolePolicy` が無いことを確かめる。その後、Manager の信頼ポリシーを復元し、一致を確かめる。
5. **特権昇格面**: Manager が自分と Reader の信頼ポリシーを更新できないこと（明示 Deny）、CRUD と Diff の実行ロールが Manager を引き受けられないことを、IAM のシミュレーションで確かめる。ターゲット側の信頼ポリシーと権限ポリシーの実物を、README の JSON と `jq -S` で突き合わせる。

## 5. 正本への反映

覆す・足す ID と節は次のとおり。着手時に、同種の古い記述を grep で総当たりし、同じ来歴で直す。訂正は、文書の冒頭の追記注記（日付・Issue・変更の全体像）と、各箇所の来歴（「Issue #85 により 2026-09-30 訂正」）の二層にする。凍結された `aidlc/` と、過去の spec・plan（記録）は書き換えない。

| 文書 | 覆す・足す ID と節 |
|---|---|
| `docs/design/requirements.md` | FR-2.1 の登録時検証の注記（別アカウントも検証する）、FR-2.2 と単一アカウント構成の注記（改める。正本注記の「未決」の記述も）、FR-1.7（別アカウントも読んで取り込む。前の spec の D-10 を覆す）、FR-5.7 の例外（別アカウントの読み）、FR-3.2（CRUD は Reader だけ。書き込み権限を持たない）、NFR-3（一時資格情報）、NFR-4（ターゲット側は手動という例外）、C-4 の例外の記述。`単一アカウント`（4 か所）、`CrossAccountRoleNotSupported`（1）、`assertRoleInDeployAccount`（1）を総当たりする |
| `docs/design/iam-policy-design-note.md` | 3.3 を実装した構成（Reader と Manager の 2 ロール、ExternalId なし、JUMP 側は Terraform）に書き換える。2 節の表、3.2 の注記、3.9・3.10、1 節の FR-5.7 を破る点、5・6 節の OQ-3 と NFR-4 の行。`単一アカウント`（3）、`RolustTrustPolicyManager`（3）、`ExternalId`（3）、`3.3` の参照（7）を総当たりする |
| `docs/design/interaction-spec.md` | FR-7.1（別アカウントの警告と GI-5 の例外の廃止）、FR-7.4 の初期表示と read-error（`CrossAccountRoleNotSupported` を除き、`assume-role` を足す）、GI-6 |
| `docs/design/mockups.md` | 画面 1・3（警告の廃止）、画面 4 の error 状態 |
| `docs/design/cicd-pipeline.md` | 赤信号に R-12 を足す。位置づけ、§ 赤信号、§ 読み方の実務、§ CI 側への影響、未決事項の、現行の一覧を指す「R-1〜R-11」（6 か所） |
| R-1〜R-11 の表記 | `.github/scripts/plan-guard.sh`（1）、`.github/workflows/cd.yml`（4）・`ci.yml`（1）、`docs/design/cd-config.md`（6）・`deployment-strategy.md`（4）・`rollback-runbook.md`（3）、`README.md`（1）。当時の範囲を述べる記述は、経緯として残す |
| `README.md` | 制約の表（25 行）、「単一アカウント構成」の節を「クロスアカウント構成」に改める（ターゲット側の手動手順、JSON、確認コマンド、実行ロールを作り直したときの注意、Terraform の変数）。`単一アカウント`（3）、`CrossAccountRoleNotSupported`（2）を総当たりする。CRLF なので、Edit ツールで直し、`git diff --numstat` で意図した箇所だけの差分であることを確かめる |
| `.claude/rules/aws-infra.md` | 管理対象ロールの範囲に、ターゲット側の手動ロールと、R-12 を足す |
| コードのコメント | `iam-client.ts`、`roles.ts`、`http.ts`、`real-iam.integration.test.ts`（「Rolust 本体は単一アカウント構成」）ほか、`assertRoleInDeployAccount`・`単一アカウント` を述べる箇所 |
| `packages/api/TABLE-DESIGN.md` | なし（データの構造は変えない） |

## 6. 対象外

- **OSS 利用者向けの、権限の付与方法**（CloudFormation テンプレート、Terraform モジュール、StackSets などのパッケージ化）。ターゲット側の JSON を、README の手順の「配る単位」として置くので、後でパッケージ化できる。別 Issue で検討する。
- ターゲット側のロールを、Rolust が作る・更新する機能（`iam:CreateRole` などは付与しない）。
- ターゲット側のロールの中身を、CI で検査すること（JUMP の Terraform の外にあるため）。
- 許可するアカウントの一覧を、Terraform の変数で持つこと（D-1 で不採用）。

## 7. 未決事項

なし。plan で決めるのは実装の詳細（クライアントの生成とキャッシュの構造、R-12 の `jq` の判定式、環境変数の読み込み）だけで、要件・権限・画面の判断は残っていない。
