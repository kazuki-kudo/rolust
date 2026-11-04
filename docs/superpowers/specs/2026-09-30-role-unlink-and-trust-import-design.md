# ロールの紐づけの解除と、信頼ポリシーからの IAM ユーザの取り込み — 設計

- 日付: 2026-09-30
- Issue: #79、#80
- ブランチ: `feat/79-80-role-unlink-and-trust-import`
- 状態: spec レビュー待ち

## 1. 背景と目的

Rolust は、ユーザプールに IAM ロールを紐づけ（FR-1.7）、そのロールの信頼ポリシーへの反映を、マトリクスの Assignment と申請を経て行う。Assignment は「Rolust が管理するロールの状態の記録」で、`checked`（あるべき状態）と `reflected`（最後に反映された状態）を持つ。

今は、この記録と実態（AWS 上の信頼ポリシー）が、両端でずれうる。

- **解除（Issue #79）**: 当該プールにそのロールの割り当て（`checked` か `reflected`）が残っていると、紐づけを外せない。依頼者は、IAM ユーザが登録されていても外せるようにし、外しても信頼ポリシーはそのままにして、ロールを Rolust の管理外の扱いにしたい。
- **紐づけ（Issue #80）**: 既存のロールを紐づけても、信頼ポリシーにすでにいる IAM ユーザは Rolust の記録に無い。マトリクスでは未チェックに見え、`reflected` も無いので、そのユーザを外す申請を作れない。依頼者は、紐づけのときに、信頼ポリシーにいる未登録の IAM ユーザをプールに登録したい。

2 つは同じ仕組みの表裏である。解除は、当該ロールの Rolust 上の記録を消す。紐づけは、実際の信頼ポリシーから記録を作り直す。この対が保たれると、外して紐づけ直すことが、記録を実態へ再同期する手段になる。そのため、1 つの spec で設計する。

### 成功基準

1. 当該プールにそのロールの割り当てが残っていても、当該プールから作った未反映の申請が無ければ、紐づけを外せる。外した後、当該プールのそのロールの Assignment は 0 件になる。AWS 上の信頼ポリシーは変わらない（実測: 外す操作の前後の `iam get-role` が一致し、CloudTrail に `UpdateAssumeRolePolicy` が無い）。
2. 当該プールから作った未反映（下書き・失敗）の申請があるロールは、従来どおり 409 で外せず、何も変えない。
3. 既存のロールを紐づけると、信頼ポリシーの `Effect: Allow` にある、パスなしの IAM ユーザ（`arn:aws:iam::<12桁>:user/<名前>`）が、当該プールの IamUser になり、`checked = reflected = true` の Assignment を持つ。マトリクスに、チェック済みで出る。申請の自動プリセレクトには入らない。
4. 取り込み対象でない principal（パス付きのユーザ・ロール・サービス・root・ワイルドカード・`Deny`）は取り込まれず、差分確認で、従来どおり管理外として警告される。
5. 紐づけるロールの信頼ポリシーを 1 件でも読めなければ、何も書かずに拒否する。デプロイ先と別アカウントのロールは、取り込みなしで紐づけだけ行い、その旨を通知する。
6. 外して紐づけ直すと、マトリクスは実態と一致した状態に戻る。
7. CRUD 系統の実行ロールが `iam:GetRole` で読めるのは、管理対象タグの付いたロールだけであり、`iam:UpdateAssumeRolePolicy` は持たない（実測）。範囲が広がる変更は plan-guard が止める。

## 2. 決定事項

| ID | 事項 | 決定 | 出所 |
|---|---|---|---|
| D-1 | 「管理外」の意味（#79 の未決 1） | ロールを Rolust の操作対象から外すだけ（Issue の (a)）。信頼ポリシーに残る principal を新たに警告の対象にしない。FR-4.2 の定義は変えない | 導出: 外したロールはマトリクスの列に出ず（FR-3.1）、申請も作れない（`change-request-service.ts` の `not-linked`）。FR-4.2 の警告は申請から開く差分確認にしか出ない。IamUser は登録のまま残るので、(b) の警告の対象になる principal が存在しない |
| D-2 | 解除時の Assignment（#79 の未決 2） | 当該プールのそのロールの Assignment を、`checked`・`reflected` を問わずすべて削除する | 導出: 管理外になったロールの記録は、実態とずれていくだけである。再び紐づけるときは D-7 が実態から作り直すので、古い記録が残ると二重になる。未反映の変更（`checked ≠ reflected`）も消えるので、画面で件数を示して確認する（D-5） |
| D-3 | 未反映の申請（#79 の未決 3） | 当該プールから作った未反映（下書き・失敗）の申請があるロールは、従来どおり解除を拒否する | 導出: FR-4.6 は既存の ChangeRequest の自動破棄を禁じる。`apply-service.ts` は紐づけを確認しないため、残したまま解除すると、管理外のロールへ反映できてしまう。FR-1.8 の「紐づけが無ければ未反映の申請も無い」という導出も保てる。依頼の「IAM ユーザが登録されていても」の範囲外なので覆さない |
| D-4 | FR-1.5・FR-1.8（#79 の未決 5） | 文言を変えない | 導出: 解除で Assignment が消えるので、そのロールだけが理由で削除を拒否されていた IamUser は削除できるようになる。FR-1.5 は、紐づいたままのロールの反映済みの割り当てについては拒否のままである。プールの削除は「解除 → IamUser の削除 → 削除」で辿れる。FR-1.8 の導出（3.1）は D-3 により成り立つ |
| D-5 | 画面（#79 の未決 6） | 外せない行の無効化は、未反映の申請があるロールだけにする。割り当てが残るロールの解除を含む保存では、確認表示（GI-4）を挟む | 導出: 破壊的な操作は確認を挟む（GI-4）。確認は、消える割り当ての件数（うち未反映の変更）と、信頼ポリシーが変わらないことを示す |
| D-6 | 取り込む対象（#80 の未決 2） | `Effect: Allow` の Statement にある、`arn:aws:iam::<12桁>:user/<IAM_NAME_PATTERN>`（partition は `aws`、パスなし）。`Action` と `Condition` は見ない。別アカウントのユーザも取り込む。ほかは取り込まず、管理外のまま警告する | 導出: マージの「既に存在する」（`allowedAwsPrincipalSet`、`merge.ts` の規則 4）と同じ定義にそろえる。IAM ユーザの登録は `buildUserArn` の書式に限る（A-2: パス付きは対象外）。別アカウントのユーザは FR-1.4 で登録できる |
| D-7 | 取り込んだユーザの記録（#80 の未決 3・6・8） | 当該プールに未登録なら IamUser を作る（登録済みなら作らない。ほかのプールにいても作れる。IamUser の一意性はプール内）。Assignment は `checked = reflected = true` で作る。属性（#61）は未設定 | 導出: 3.2 のとおり、Issue の懸念（登録しただけだと次の反映で外れる）は実装では起きない（`buildFrozenInput` と `mergeTrustPolicy` の規則 1）。本当の理由は、`reflected` が無いとマトリクスからそのユーザを外す申請を作れず、未チェックに見えることである |
| D-8 | 確認の有無（#80 の未決 4） | 紐づけの前に確認を挟まない。保存の成功通知に、取り込んだ件数（うち新規登録の件数）を出す | 導出: AWS を書き換えず、信頼済みのユーザの記録を作るだけである。D-2 の解除で取り消せる |
| D-9 | 失敗時（#80 の未決 5） | 読み取りをすべて先に行い、1 件でも失敗すれば何も書かずに拒否する（FR-1.7 の慣行）。書き込みは「持ち主 → IamUser → Assignment → 紐づけ」の順で、紐づけを最後にする。途中で失敗したら 502（再試行可）とし、再保存で続きから直る | 導出: 紐づけが最後なら、ロールがマトリクスに出るのは、IamUser と Assignment が揃ってからになる。IamUser は条件付き Put、Assignment は同じ値の Put なので、再実行で結果が変わらない。件数の上限は設けない: 信頼ポリシーの大きさに IAM の上限があり（既定 2,048 文字、引き上げても 4,096）、1 ロールの取り込みは高々数十件である |
| D-10 | 別アカウントのロール | 読まずに、取り込みなしで紐づけだけ行う。結果に理由を載せ、画面で警告する | 導出: FR-2.2 の注記により、IAM の読み取りはロール名だけで呼ばれ、デプロイ先アカウントに解決される（`assertRoleInDeployAccount`）。読めないロールの紐づけを拒否すると、今は紐づけられるロールが紐づけられなくなる。ただし `DeployAccountUnknown`（デプロイ先を判定できない）は、判定不能なまま読む危険があるので拒否する |
| D-11 | 読む経路（#80 の未決 1） | CRUD 系統の実行ロールに `iam:GetRole` を足す。保存リクエストの中で、サーバが読む | 依頼者の選択（2026-09-30）。採らなかった案: 保存を Diff 系統へ移す（API Gateway の経路の追加と、読み取り専用の系統への書き込みが生じる）、画面が Diff で事前に読み対象を保存へ添える（サーバが検証できず、記録が実態とずれうる） |
| D-12 | 権限の範囲 | `iam:GetRole` 単体で、`Resource = role/*` に管理対象タグの条件を付ける（Diff の `diff_iam_read` と同じ）。`iam:ListRoleTags`（条件なし）の既存ポリシーは変えない | 導出: 読める範囲は Diff と同じで、新しい偵察面を増やさない。FR-3.2 の保証（CRUD は AWS へ書けない）は、`iam:UpdateAssumeRolePolicy` を持たないことで保たれる |
| D-13 | plan-guard | 赤信号は増やさず、R-1〜R-11 のままにする。R-1・R-3 の対象に新ポリシーを加え、R-9 を「CRUD の各ポリシーが、設計の Action 単体か」に広げる | 導出: 新しい番号を足すと、文書・CI・スクリプトの約 15 か所の件数表記を直す必要がある。検査の性質（タグ条件と Action の範囲）は R-1・R-3・R-9 と同じである |
| D-14 | 既存の紐づけ | 取り込まない。再同期は「外して紐づけ直す」で行う（D-2・D-7 の対）。README に書く | 導出: 既存の紐づけの Assignment は、依頼者がマトリクスで作った記録であり、実態との差は Rolust が判断できない。自動で書き換えない |
| D-15 | 進め方 | spec 1 本・plan 1 本・ブランチ 1 本・PR 1 本で、#79 と #80 を閉じる | 導出: どちらも `savePoolRoles` と `LinkRolesModal` を変える。PR を分けると同じ箇所で衝突する |

## 3. 設計

### 3.1 FR-1.8 の導出が保たれること（D-3・D-4）

FR-1.8 は「IamUser と紐づけがどちらも無ければ、当該プールから作った未反映の申請も無い」と導く。理由は、申請は紐づけたロールにしか作れないことと、紐づけの解除は当該プールから作った未反映の申請があると拒否されること（FR-1.7）である。D-3 は後者を保つので、この導出はそのまま成り立つ。

### 3.2 Issue #80 の懸念が起きないことと、取り込みの理由（D-7）

Issue #80 の未決 3 は、「Assignment を持たないと、次の反映で、登録済み・未チェックのユーザとして信頼ポリシーから外れるおそれがある」と懸念した。実装では起きない。

- `buildFrozenInput`（`packages/core/src/matrix.ts`）は、`checked ≠ reflected` の交点だけを凍結する。Assignment が無い交点は入らない。
- `mergeTrustPolicy`（`merge.ts` の規則 1）は、凍結入力に名前が挙がっていない principal に触れない。

取り込む理由は別にある。Assignment が無いと、マトリクスでは未チェックに見える。`reflected` も無いので、そのユーザを外す申請（`removeUserArns`）を作れない。つまり、Rolust の目的（信頼ポリシーの principal を、申請と差分確認を経て増減する）が、そのユーザについて果たせない。`checked = reflected = true` で記録すると、マトリクスの見え方と、外す申請の作成が、実態と一致する。

### 3.3 `packages/core`

**`importableUserArns(document)`**（`trust-import.ts`。AWS SDK に依存しない純粋関数）

- `allowedAwsPrincipalSet(document)` の結果から、`^arn:aws:iam::\d{12}:user/[A-Za-z0-9+=,.@_-]{1,64}$` に完全一致するものだけを、重複なし・昇順で返す。
- `Action`・`Condition` は見ない。`sts:AssumeRole` 以外の Action だけの Statement や、`Condition` 付きの Statement の principal も含む。これは、マージの規則 4（既に存在する principal は追加しない）と、FR-4.2 の警告の判定と同じ定義で、3 つが食い違わないようにするためである。条件付きの許可を取り込んだ後に、そのユーザのチェックを外して反映すると、条件付きの Statement からも削除される（規則 2）。README の「制約と既知の帰結」に書く。
- 含めないもの: パス付きのユーザ、`aws` 以外の partition、`AIDA…` の一意 ID（削除された IAM ユーザ）、root・ロール・サービス・ワイルドカード、`Deny` の principal、プレースホルダ Statement。

**割り当ての集計と外せない理由の切り出し**（`packages/api/src/services/unlink-blockers.ts` と `@rolust/core` の API 契約）

- `summarizeAssignments(assignments, roleArns)`: ロールごとに `{ total, pending }` を返す。`total` は `checked || reflected` の交点の数、`pending` は `checked !== reflected` の交点の数。
- `computeUnlinkBlockers`（API の外せない理由）は、`unreflected-request` だけを返す。判定は、これまでと違い、割り当てがあるロールでも行う（今は割り当てのあるロールでは `assigned` が優先されて、未反映の申請の判定を行わない）。
- 移行スクリプト（`role-link-owners.ts`。#35）は、「割り当てが残る」の判定（`assigned` と `unreflected-request` の両方）に依存する。挙動を変えないため、今の関数を `computeActiveReasons`（型 `ActiveReason`）に改名して移行が使い続ける。移行の既存のテストは、型と関数の名前の追随以外、変えない。

### 3.4 API

**`GET /pools/:poolId/roles`**（`getPoolRoles`）

- `PoolRoleOption.unlinkBlocker` は `unreflected-request` だけになる（型 `UnlinkBlocker` を、この 1 つの形に狭める）。
- `PoolRoleOption.assignments: { total: number; pending: number } | null` を足す。紐づけ済みのロールだけ非 null。画面が、確認表示と状態の列に使う。

**`PUT /pools/:poolId/roles`**（`savePoolRoles`）。手順は、今の 1〜5 に足し引きする。

1. **入力の検証（400）**: 変えない。
2. **差分**: 変えない。加えて、`listAssignments(poolId)` と `listUsers(poolId)` を 1 回ずつ読む。
3. **検証（409）**: 外す側は、未反映の申請だけを拒否する（割り当ては拒否しない）。足す側の「ほかのプールが持ち主」は変えない。1 件でも引っかかれば何も書かない。
4. **【新】読み取り**: 足す各ロールについて、次を行う。並列で読み、1 件でも失敗すれば、何も書かずに拒否する。
   - `assertRoleInDeployAccount` が `CrossAccountRoleNotSupported` なら、読まず、`skipped: "cross-account"` とする。`DeployAccountUnknown` は、`TrustPolicyUnavailable`（502）で拒否する。
   - `getTrustPolicy` を呼び、`importableUserArns` を求める。
   - 読み取りの失敗は次のとおり（GI-6: 原因の近傍に、AWS のコードをそのまま出す）。

     | `IamOperationError.kind` | 応答 | 文面の要点 |
     |---|---|---|
     | `not-found` | 400（`ValidationError`、`roleArns`） | ロールが AWS に存在しない。登録を確かめる |
     | `access-denied` | 502（`TrustPolicyUnavailable`、再試行不可） | `<errorCode>`。管理対象タグが外れている可能性と、CRUD の実行ロールの `iam:GetRole`（`infra/lambda.tf` の `crud_iam_read_trust`）が未反映の可能性 |
     | `throttling` | 502（同、再試行可） | 少し待って再度保存する |
     | それ以外 | 502（同、再試行不可） | `<errorCode>` と AWS のメッセージ |

5. **書き込み**（`TransactWriteItems` は使わない。`TABLE-DESIGN.md` の考え方と同じ）
   1. 持ち主の取得（変えない）。
   2. 足すロールを 1 つずつ、次の順に書く。
      0. そのロールの古い交点を消す（最終レビュー Important 1 により 2026-09-30 追記）: 手順 2 で読んだ当該プールの Assignment のうち、そのロールのもので、取り込む ARN に無いユーザのもの（取り込みなしのロールは全件）を、条件なしで削除する。足すロールは紐づけが無いので、その交点は孤児である（以前の解除が途中で失敗して残ったものなど）。消さないと、外して紐づけ直しても古い記録が実態と食い違ったまま残り、成功基準 6・D-2 が破れる。取り込む ARN の交点は、次の 2 で同じ値に書き直す。
      1. 取り込む各 ARN について、当該プールに未登録なら IamUser を条件付き Put（`attribute_not_exists(pk)`。すでにあれば何もしない）で作る。
      2. 取り込む各 ARN について、Assignment を `checked = reflected = true` で Put する（条件なし）。
      3. 紐づけを Put する（最後）。
   3. 外すロール: 紐づけを削除する → そのロールの Assignment を、条件なしで全削除する → 持ち主を返す。紐づけを先に消すので、マトリクスの保存（`isRoleLinked` で検証する）は、以後そのロールの交点を作れない。
   4. 孤児の片付け: 持ち主の片付けは変えない。加えて、手順 2 で読んだ当該プールの Assignment のうち、保存後に紐づけの無いロールのものを、条件なしで削除する。手順 5.3 で消したものは除く。途中で失敗した取り込みの残りを片付ける。
6. **応答**: `SavePoolRolesResponse` に、次を足す。
   - `imported: ImportedRole[]`。`ImportedRole` は `{ roleArn, userCount, registeredCount, skipped: "cross-account" | null }`。
   - `deletedAssignments: number`（外したロールの Assignment のうち、`checked` または `reflected` だったものの削除件数。残骸は数えない）。

**HTTP の失敗**: `TrustPolicyUnavailable` は、`TagLookupUnavailableError`（`handlers/roles.ts`）と同じ形の `ApiError` とする。`IamOperationError` は `ApiError` ではなく、そのままでは `toErrorResponse` が 500 の汎用文言に丸めて、AWS のコードが画面に届かないため、サービスで変換する。

**リポジトリ**: `pool.ts` に `addUserIfAbsent`（条件付き Put）、`assignment.ts` に `putReflectedAssignment` を足す。既存の `addUsers`（無条件 Put）と `deleteAssignment`（条件なし削除）は変えない。

### 3.5 失敗と競合・回復

| 失敗した箇所 | 残る状態 | 見え方と回復 |
|---|---|---|
| 読み取り（手順 4） | なし | 何も書かない。文面のとおり直して、もう一度保存する |
| 取り込みの途中（手順 5.2.1・5.2.2） | 取り込んだ IamUser と Assignment（紐づけは無い）、持ち主 | 502（再試行可）。ロールは紐づいていない。もう一度保存すると、続きから直る（IamUser は重複せず、Assignment は同じ値になる）。そのロールを含めずに別の保存をすると、孤児の片付け（手順 5.4）が、紐づけの無いロールの Assignment を消す（IamUser は残る） |
| 紐づけの Put（手順 5.2.3） | 取り込み済みの IamUser と Assignment | 同上 |
| 解除の途中（手順 5.3） | 紐づけの削除の後に交点と持ち主の一部が残る | 502（再試行可）。残る交点は、紐づけの無いロールのものなので、マトリクスに出ない。次の保存の孤児の片付けが消す |

孤児の Assignment が残っている間は、`checked` か `reflected` の交点を持つ IamUser の削除が、FR-1.5 により拒否されることがある。回復は、当該ロールを紐づけ直して外す、または、別のロールの保存を 1 回行うこと（孤児の片付け）である。

判定と書き込みの間に、同時操作が割り込む競合は、これまでと同じく受け入れる（#48 の依頼者の判断）。

### 3.6 IAM と infra

- **`infra/lambda.tf`**: `aws_iam_role_policy.crud_iam_read_trust` を新設する。`Sid: ReadTrustPolicyForLinkImport`、`Action: iam:GetRole`、`Resource: local.managed_role_arn_all`、`Condition: local.managed_tag_condition`。`crud_iam_read_tags` は変えない。
- **型で権限を分ける**: `IamTrustPolicyReader`（`getTrustPolicy` だけ）を、`iam-client.ts` に切り出す。`IamTrustPolicyClient` はそれを継承して `updateTrustPolicy` を足す。CRUD には `createIamTrustPolicyReader()` の戻り値だけを渡し、持たない権限の呼び出しを型の上でも作れなくする（`IamRoleTagClient` と同じ考え方）。
- **plan-guard**（`.github/scripts/plan-guard.sh`、`plan-guard.test.sh`）:
  - R-1・R-3: 対象に `aws_iam_role_policy.crud_iam_read_trust` を加える（タグ条件、値のワイルドカード禁止、一覧系の Action 禁止）。
  - R-9: 対象を `crud_iam_read_tags`（`iam:ListRoleTags` 単体）と `crud_iam_read_trust`（`iam:GetRole` 単体）の 2 つにし、それぞれの Action が設計の 1 つだけであることを検査する。CRUD に `iam:UpdateAssumeRolePolicy` などが紛れ込むのを止める。
  - 回帰ケースを `plan-guard.test.sh` に足す（タグ条件の欠落、Action の拡張、未確定値の警告）。
- **コメントの追随**: `lambda.tf` の冒頭の表、`apigateway.tf` の冒頭（「CRUD（IAM 権限なし）」は `ListRoleTags` の追加後も残っていた古い記述）、`crud.ts` の冒頭。
- 環境変数・Lambda・API Gateway の経路は変えない。DynamoDB の権限も変えない（PutItem・DeleteItem・Query は付与済み）。

### 3.7 テーブル設計（`TABLE-DESIGN.md`）

アイテムとキーは変えない。アクセスパターンを足す。

| # | 用途 | 操作 | 要件 |
|---|---|---|---|
| 19 | 紐づけ時の取り込み | Query（#2）で当該プールの IamUser を読む → 未登録なら PutItem `attribute_not_exists(pk)`（IamUser）→ PutItem（Assignment。`checked = reflected = true`）→ #13 の紐づけの PutItem | FR-1.7 |
| 20 | 解除時の交点の全削除 | Query（#3）→ 外すロールの交点を DeleteItem（条件なし） | FR-1.7 |

「ロールの持ち主」の失敗表の「紐づけの追加の途中」の行に、取り込んだ IamUser と交点が残ることを足す。

### 3.8 画面（`packages/web`）

**ロールの紐づけモーダル**（`LinkRolesModal.tsx`）

- **状態の列**: 紐づけ済みで割り当てが残るロールは、行を無効にせず「割り当て N 件（外すと削除されます）」を出す。無効のまま出すのは、`unreflected-request` の行の「外せません — 未反映の申請があります」と、`linkedElsewhere` の行だけである。
- **見出しの説明**: 「割り当てが残っているロールも外せます。外しても信頼ポリシーは変わらず、Rolust の管理外になります。」を足す。
- **確認表示**: 保存の押下時に、選択から外すロールのうち `assignments.total > 0` のものがあれば、フッターを確認表示に切り替える。フォーム本体はアンマウントしない（GI-4、`frontend.md`）。切り替え後は、フォーカスを確認表示の最初のボタンへ移す。
  - 文面: 「N 個のロールの紐づけを外します。信頼ポリシーは変わらず、これらのロールは Rolust の管理外になります。」に続けて、ロールごとに「割り当て A 件（うち未反映の変更 B 件）が削除されます」。
  - ボタン: 「キャンセル」（確認表示を閉じてフォームへ戻る）と「外して保存」。保存中は「保存中」（GI-7）。
  - 割り当てが残らないロールだけを外す場合は、確認なしで従来どおり保存する。
- **成功通知**（画面 1・画面 3 で共用の `linkRolesSavedText`）: 「紐づけ 追加 N 件 / 解除 M 件」に続けて、取り込みがあれば「信頼ポリシーから IAM ユーザ K 件を取り込みました（新規登録 J 件）」、解除で削除した割り当てがあれば「割り当て A 件を削除しました」を出す。`skipped: "cross-account"` のロールは、`Flashbar` の警告（type: warning）に「<ロール名> はアカウント X のロールのため、信頼ポリシーを読めず、取り込んでいません」を出す。名前の列挙はしない。取り込んだ人は、マトリクスとカードの一覧に出る。
- **保存の失敗**: モーダルは閉じず、`error.message`（AWS のコード入り）を出す。502 は、今のとおり読み直す（何も書いていなくても無害）。

**マトリクス**（画面 3）: 取り込んだユーザは `checked = reflected = true` なので、変更件数に数えず、申請の自動プリセレクトにも入らない。マトリクスの実装は変えない。

### 3.9 テスト

**TDD の対象**（`packages/`。失敗するテストを先に書き、失敗を確かめてから実装する）

- `core`: `importableUserArns` を、許可・`Deny`・パス付き・`aws-cn`・`AIDA…`・root・ワイルドカード・裸のアカウント ID・文字列と配列・重複・`Condition` 付きの Allow・プレースホルダで検証する。
- `api`: `summarizeAssignments`、`computeUnlinkBlockers`（`unreflected-request` のみ、割り当てのあるロールでも判定）、`computeActiveReasons`（移行の挙動が不変）。`savePoolRoles`（`ddb-mock`）を、次で検証する。
  - 解除で交点を全削除し、未反映の申請のあるロールだけ拒否する。
  - 取り込み: 新規、すでに登録済み、ほかのプールにいる、別アカウントのユーザ。
  - 読み取り失敗の種別ごとの応答と、何も書かないこと。別アカウントのロールは取り込みなし。`DeployAccountUnknown` は拒否。
  - 途中失敗の後の再保存の冪等と、孤児の片付け。
- `web`: 状態の列、確認表示（フォーカス、キャンセル、閉じ経路の破棄確認）、成功通知と警告。
- **モックの寛容さへの対策**: 統合テスト（`real-iam.integration.test.ts`）に、実 IAM が返す信頼ポリシーを、実物のまま `importableUserArns` に通すシナリオを 1 つ足す。既存の退避・復元・一致確認の枠組みを使い、新しいロールは作らない。
- **Terraform・CI・文書**（TDD の例外）: `terraform fmt -check`・`validate`、`plan-guard.test.sh`、`trivy`（`infra/` を変えるため）、`gitleaks`。文書は grep の機械判定（旧文言の残存ゼロ、追記・訂正ごとに来歴があること、R-1〜R-11 の表記が不変であること）。依存は変えないので `npm audit` は要らない。

### 3.10 plan の構成と、反映・実測（plan の最後のタスク）

1. `core`（`importableUserArns`）と、判定の切り出し。
2. `api`: 解除（#79）と型の分離。
3. `api`: 取り込み（#80）。
4. `web`。
5. `infra` と plan-guard。
6. 統合テストと、依頼者が実測を引き取れる手順書（`docs/superpowers/plans/2026-09-30-role-unlink-and-trust-import-handoff.md`）。CRUD ロールの権限の実測（タグ付きは読め、タグ無しは `AccessDenied`。`UpdateAssumeRolePolicy` は持たない）を書く。
7. 正本の更新と、旧文言の grep 総当たり。
8. push 前検査（`lint`・`typecheck`・`test`・`build`、`gitleaks`、`trivy`、`plan-guard.test.sh`、`terraform validate`）。
9. **最終**: README の手順による `terraform apply`（jump-admin / ap-northeast-1）と実測。apply の前に、`iam:GetRole` のタグ条件を Access Analyzer で実測する（`aws-infra.md`）。実測は、捨てのプールで既存のフィクスチャロールを紐づけ、取り込み・解除・再紐づけを画面で通す。CloudTrail（us-east-1、`AttributeKey=EventName`）で、CRUD ロールの `GetRole` があり、`UpdateAssumeRolePolicy` が無いことを確かめ、最後に捨てのプールを片付ける。`terraform apply` の直後に IAM の反映が遅れると、保存が `AccessDenied` で拒否される（何も書かない）ので、数分後に再実行する。

### 3.11 範囲の外

- 既存の紐づけの取り込み（D-14）。
- 未反映の申請を、解除と同時に破棄すること（D-3）。
- `apply-service.ts` に紐づけの確認を足すこと。D-3 で不要にした。
- 取り込みの前の確認モーダル、取り込み対象の選択（D-8）。
- パス付きの IAM ユーザの登録（A-2）。
- IamUser の属性（#61）。取り込んだユーザは属性が空である。

## 4. 正本への反映

各文書の冒頭に追記の注記（日付・Issue・変更の全体像）を置き、該当箇所に来歴（「Issue #79・#80 により 2026-09-30 追記」など）を付ける。実装と同じ PR で行い、plan のタスク 7 に含める。

**覆す**

- `docs/design/requirements.md`
  - **FR-1.7**: 「解除は、当該 UserPool にそのロールの Assignment（チェックありまたは反映済み）が残る場合、…拒否」のうち、Assignment が残る場合の拒否を覆す。解除は、未反映の ChangeRequest が当該 UserPool から作られたものである場合だけ拒否し、それ以外は、当該ロールの Assignment をすべて削除して解除する。AWS 上の信頼ポリシーには触れない（D-1〜D-3）。
  - **FR-5.7**: 「AWS への問い合わせを信頼ポリシーの読み取りと更新の時点に限定」する規則の例外に、ロールの紐づけ時の信頼ポリシーの読み取り（`iam:GetRole`、CRUD 系統）を足す（D-11）。読み取りの時点が増える。一覧取得・実在検証は、引き続き行わない。FR-5.7 の注記（「FR-5.7 の例外」）に来歴付きで足す。
  - **C-4** と Out of Scope の「IAM API による一覧取得・実在検証」の行の例外注記: 紐づけ時の読み取りが、ロールの実在を確かめる副作用を持つこと（`NoSuchEntity` は拒否）を足す。
  - **Out of Scope の「既存の信頼ポリシーを Rolust に取り込む初期同期」の行**（最終レビュー Important 3 により 2026-09-30 追記）: 紐づけ時に、そのロールの信頼ポリシーにいるパスなしの IAM ユーザだけを取り込むことが、例外であることを注記する。一括の初期同期と、既存の紐づけの自動取り込み（D-14）は引き続き範囲外。
- `docs/design/interaction-spec.md`: FR-7.1 の「ロールの紐づけモーダルのロールの表」の、「外せないロール（当該プールにチェックありまたは反映済みの Assignment が残る、または…）はチェックを無効にし」を、未反映の申請があるロールだけに改める。
- `README.md`: 移行の節（`ロールの持ち主の移行`）の「『割り当てが残る』は、紐づけを外せない理由と同じです」は、外せない理由が未反映の申請だけになるため、成り立たなくなる。「Issue #79 により 2026-09-30 訂正: 当時の定義のまま（移行スクリプトは変えていない）」と注記する。プールの削除の手順（「先に IAM ユーザを削除し…、『ロールの紐づけ』で紐づけを外してください」）の順序を、「紐づけを外し、IAM ユーザを削除する」に改める。

**足す**

- `docs/design/requirements.md`
  - FR-1.7 に、紐づけ時の取り込み（D-6・D-7・D-9・D-10）を足す。取り込みの対象、IamUser の登録と Assignment の初期状態、失敗時、別アカウントのロール。
  - FR-4.2 の定義の後に、注記を足す。定義（全 IamUser の ARN 集合）は変えない。取り込み後は、取り込んだユーザが管理外として警告されなくなる（定義の帰結）。パス付きのユーザなどは、警告のままである（D-1・D-6）。
  - FR-7.1・FR-7.3 の説明に、確認表示と成功通知を足す。トレーサビリティの FR-1.1 – FR-1.8 の出所に、Issue #79・#80 を足す。
  - 冒頭の追記注記（日付・Issue・全体像）。
- `docs/design/interaction-spec.md`: FR-7.1 にロールの紐づけモーダルの確認表示の行（GI-4）、FR-7.3 に成功通知の変更、冒頭の追記注記。
- `docs/design/mockups.md`: 画面 1 の「ロールの紐づけ」モーダルの状態の列と確認表示、画面 3 のツールバーの成功通知。
- `docs/design/design-system-mapping.md`: 「ロールの紐づけモーダル」の行に、`isItemDisabled` の条件（未反映の申請と `linkedElsewhere`）と、確認フッターを足す。
- `docs/design/iam-policy-design-note.md`: 冒頭の注記、1 節の「FR-5.7 の判定への影響」と「FR-5.7 を破る点」（紐づけ時の `GetRole` の例外。最終レビュー Important 3 により 2026-09-30 追記）、1 節と 2 節の表（CRUD に `iam:GetRole`）、3.9 の隣に節（CRUD Lambda — 紐づけ時の信頼ポリシーの読み取り。タグ条件つき、Diff と同じ範囲）、受容リスク。
- `docs/design/cicd-pipeline.md`: R-1・R-3・R-9 の定義の更新と冒頭の追記注記。番号は増やさない（R-1〜R-11 の表記は変えない。`cd-config.md` も同じ）。
- `packages/api/TABLE-DESIGN.md`: アクセスパターン 19・20、「ロールの持ち主」の失敗表の行、冒頭の追記注記。
- `README.md`: 構成図（CRUD の IAM 権限）、「Lambda を 3 系統に分ける理由」（CRUD が持つ IAM 権限）、受容リスク（CRUD が読める範囲）、「制約と既知の帰結」に節（解除しても信頼ポリシーは変わらず、ロールは管理外になること、外して紐づけ直すと再同期されること、取り込みの対象と、`Condition` 付きの許可も取り込むこと、既存の紐づけは取り込まれないこと）、「できること」の対応要件。

**該当なし**

- FR-1.5・FR-1.8 の文言: 変えない（D-4）。
- `docs/design/cd-config.md`: R-1〜R-11 の表記は不変（D-13）。
- `aidlc/`: 書き換えない。

## 5. 引き受ける帰結

- **既存の紐づけは取り込まれない**（D-14）。再同期は「外して紐づけ直す」で行う。外すとき、未反映のチェックは消える（確認表示で件数を示す）。
- **`Condition` 付きの許可も取り込む**（D-6）。条件付きで許可されているユーザは、取り込むと「チェック済み・反映済み」に見える。そのチェックを外して反映すると、条件付きの Statement からも削除される（マージの規則 2）。
- **取り込みに失敗して紐づけが残らなかったとき**、取り込み済みの IamUser が残る。害は無く、再保存か別の保存で片付く（3.5）。
- **管理対象タグが外れたロールは、新たに紐づけられない**（`AccessDenied`）。既存の紐づけは影響を受けない。
- **IAM の反映の遅れ**: `terraform apply` の直後は、CRUD の `iam:GetRole` の反映が遅れて、保存が拒否されることがある。何も書かれないので、待って再実行すればよい。
- **CRUD 系統が、管理対象ロールの信頼ポリシーを読める**（D-12）。Diff 系統と同じ範囲で、新しい偵察面は増えない。書き込み権限は持たない。
