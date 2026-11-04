# 信頼ポリシーの乖離を、画面から直せるようにする（Issue #172）

日付: 2026-10-16 / 関連: #170（乖離の確認。spec `2026-10-15-trust-drift-check-design.md`）・#135（登録＝取り込み）・#120（実行者の記録）・#121（排他）・#141（権限）・#94（i18n）

> **追記（2026-10-16。最終レビュー）**: 実装は、以下の本文（§3.4・§4・§7 の「確認モーダル」「Modal + Alert」）と次の点で異なる。本文は書き換えず、ここで訂正する。
>
> - 「記録を IAM に合わせる」の確認は、2 枚目の `Modal` にしない。同じ詳細モーダルの中で、本文の先頭に警告の `Alert` を差し込み、フッタを「キャンセル」と「記録を合わせる」に切り替える（GI-10。正本は `interaction-spec.md` FR-7.2）。
> - 2 つの操作（「IAM を記録に合わせる（申請を作成）」「記録を IAM に合わせる」）のボタンは、フッタではなくモーダルの本文に置く。
> - 申請の種別（`restore`・`adopt`）は、一覧の状態チップの下に小さい文字で出す（バッジではない）。
> - 「再確認が必要」は、adopt が全件成功した直後だけ出す（一部の交点が失敗したときは列を変えない）。
> - 成功の通知の件数は、サーバの応答（実際に書いた集合）から出す（§5「確認から実行までの間に IAM が変わった」）。

## 1. 目的と背景

#170 で、画面 2（IAMロール管理）の「信頼ポリシーを確認」から、Rolust の記録（`Assignment.reflected`）と実際の信頼ポリシーの乖離（足りない・余分）を見られるようになった。ただし**見つけた乖離を直す経路が無い**（#170 §6 で範囲外にした）。

直せない理由（コードで確認済み）:

- 申請の凍結入力は `checked` と `reflected` の食い違いから作る（`buildFrozenInput`）。外から信頼ポリシーが変わっても `checked = reflected` のままなので入力が空になり、`createChangeRequests` が `no-changes` で除外する（`change-request-service.ts:81-85`。FR-4.4）。
- 記録を IAM に合わせる経路も、ロールの登録解除→再登録しか無い（割り当てごと消える）。

乖離の詳細モーダルから、ロール 1 本ごとに次の 2 つの操作で直せるようにする。どちらを正とするかは、操作する人が選ぶ。

- **A. IAM を記録に合わせる**（`restore`）: 乖離を入力にした下書きの申請を作り、既存の差分確認・反映で信頼ポリシーを戻す。
- **B. 記録を IAM に合わせる**（`adopt`）: 乖離したユーザの `checked`・`reflected` を IAM の現状に更新する。AWS へは書かない。

### 受け入れの観点（Issue #172 の完了条件）

- どちらを正とするか（両方）が決定され、根拠とともにここに記録されている（§2）。
- #170 で見つけた乖離を画面から直せる。直した後に「信頼ポリシーを確認」を押すと「一致」になる。
- 直す操作が管理外の principal に触れない。
- 実 IAM に対する動作は実測で確かめる（§7）。アプリコードは TDD。

## 2. 決定

| ID | 論点 | 決定 | 根拠 |
|---|---|---|---|
| D-1 | どちらを正とするか | **A と B の両方**を用意し、ロールごとに操作する人が選ぶ（Issue の C 案） | 依頼者の決定（2026-10-16。選択肢: A のみ・A と B・B のみ）。根拠: 「IAM が改ざんされた」（A）と「外からの変更が正当だった」（B）は、どちらも現場で起きる。B の代替は登録解除→再登録だけで、割り当てごと消える |
| D-2 | B の監査 | **ChangeRequest に種別（`kind`）を足して残す**。B は AWS を書かずに「反映済み」で作る | 依頼者の決定（2026-10-16。選択肢: ChangeRequest に種別を足す・ログのみ・専用アイテム）。根拠: 実行者を残す場所は ChangeRequest だけ（#120）。履歴（画面 5）に並び、テーブル・キー・保持の規則を増やさない。「反映済み」が IAM の更新を意味しなくなるので、種別を表示と文言で区別する（§3.4） |
| D-3 | 操作の単位 | **ロール 1 本ごと**。ユーザごと・全ロール一括は置かない | 導出: FR-4.4 は申請をロール単位で作る。FR-4.6 のロックもロール単位。詳細モーダルがロール単位 |
| D-4 | 操作の場所 | #170 の**乖離の詳細モーダル**に 2 つのボタンを足す。新しい画面・ナビは増やさない | 導出: 乖離の内容（足りない・余分）を読んだ場で選ぶのが自然。確認結果は使い捨て（#170 D-1）なので、乖離のあるロールだけに出る |
| D-5 | 乖離の再計算 | 操作の時点で、**サーバが IAM を読み直して乖離を再計算する**。画面が持つ確認結果は使わない。乖離が消えていれば何もせず、その旨を返す（状態を変えない） | 導出: 確認は読み取りの瞬間の写しにすぎない（Issue）。クライアントが渡した入力を信用すると、不正な principal を申請に入れられる。算出は `computeTrustDrift`（#170 D-5〜D-8）をそのまま使う |
| D-6 | 対象 | 管理下のユーザの乖離だけ。管理外の principal・プレースホルダには触れない | 導出: #170 D-7・D-8。FR-5.1 の保全方式 |
| D-7 | 権限 | A・B とも**作成・更新に `edit`**。A の反映は従来どおり `apply`（画面 4）。A・B とも `view` では押せない（GI-13: 無効にして理由を出す） | 導出: A の申請作成は FR-4.4（`edit`）と同じ。B は AWS を書かず記録だけを更新する操作（Issue の整理）。IAM を更新するのは `apply` だけ（FR-6.5） |
| D-8 | API の置き場所 | A・B とも **Diff 系統**（`POST /api/drift/restore`・`POST /api/drift/adopt`） | 導出: 乖離の算出は Diff の担当（#170 D-4）。IAM を読む系統を増やさない。DynamoDB の読み書き権限は全 Lambda 共通（`infra/main.tf` 3.4）なので、IAM ポリシーは変わらない。CRUD に置くと IAM の読み取りが「登録時だけ」の範囲を超える。コストは Terraform の経路追加と反映 |
| D-9 | A の申請 | 種別 `restore` の下書き ChangeRequest。入力は 足りない → `addUserArns`、余分 → `removeUserArns`。FR-4.6 のロックを `acquireRoleLock` で取る。未反映の申請（下書き・失敗）があるロールは作らず、既存の除外と同じ理由（`draft`・`failed`）と既存の `changeRequestId` を返す | 導出: 反映側（`mergeTrustPolicy`・`syncBaseline`）は変えずに動く。`markReflected` は足りない側が `reflected=true` のまま、余分側が `reflected=false` のままで冪等。FR-4.3: 反映は画面 4 で差分を確認して明示的に指示する |
| D-10 | A の作成後 | 画面 4（`/requests?ids=<id>`）へ遷移する。除外のときは遷移せず、詳細モーダルに理由と既存の申請 ID を出す | 導出: 通常の「申請を作成」と同じ流れ（FR-7.3 → FR-7.4） |
| D-11 | B の更新 | 乖離したユーザの交点だけを書く。余分（IAM にいて記録にいない）は `checked = reflected = true`、足りない（記録にいて IAM にいない）は `checked = reflected = false`。ほかの交点は触らない。**そのユーザの未反映の編集（`checked` ≠ `reflected`）は上書きされる** | 導出: Issue の「登録時の取り込み（FR-2.1）の再実行に近い」。`checked` だけ残すと、取り込んだつもりの交点が「未反映の変更」として残り、直したことにならない。上書きは確認モーダルで対象のユーザとともに明示する（GI-4）。同じセルの同時更新は後勝ち（CLAUDE.md の決定済みの仕様・#121） |
| D-12 | B と未反映の申請 | **未反映の申請（下書き・失敗）があるロールでは B を拒否する**。理由と既存の申請 ID を返す。申請を破棄してから実行する | 導出: FR-4.6。下書きの `restore` が残ったまま B で記録を変えると、あとで反映したとき `syncBaseline` が `reflected` を食い違わせる。通常の下書きでも、凍結入力と記録を食い違わせない |
| D-13 | B の書き込み順 | **監査の ChangeRequest を先に書き、そのあと交点を書く**。交点の途中で失敗したら、失敗した交点を列挙して返し、再実行（乖離の再計算）でやり直せる | 導出: 先に交点を書いて監査が失敗すると、記録が変わったのに痕跡が無い（Issue の懸念）。逆なら「痕跡はあるが一部未更新」で、再実行が冪等に残りを直す。交点は絶対値の書き込みで、再実行しても同じ結果 |
| D-14 | B の ChangeRequest | `kind: "adopt"`、`status: "applied"`、`addUserArns` = 余分（記録に取り込んだ）、`removeUserArns` = 足りない（記録から外した）、`createdAt = appliedAt`、`createdBy = appliedBy` = 実行者、`result` = 成功（文言「記録を IAM の現状に合わせました（AWS は書き換えていません）」）。**ロックは取らない**（未反映の状態を持たないため） | 導出: #120 の実行者の記録の形に合わせる。`applied` の申請は FR-4.6 の「未反映」に数えない |
| D-15 | `kind` の保存 | ChangeRequest に任意の属性 `kind`（`"restore"`・`"adopt"`）を足す。**無い（既存・通常の申請）は通常として読む**。型は `kind?: ChangeRequestKind`（`undefined` = 通常） | 導出: #120 の `createdBy` と同じ移行の仕方。移行不要。テーブル・キー・GSI は変えない |
| D-16 | 結果の後の確認結果 | 操作が成功したら、詳細モーダルを閉じ、画面 2 の確認結果の当該ロールの行を「再確認が必要」にする（B は即座に再確認の導線）。確認結果の自動更新はしない（#170 D-14: 結果は使い捨て） | 導出: 結果は「その時刻の IAM」の写しで、Rolust の操作では変わらない。A はまだ反映前、B は記録だけが変わって乖離の算出結果が変わる。古い結果が「いま乖離」と読まれるのを避ける |

## 3. 設計

### 3.1 ドメイン（`packages/core`）

- `types.ts`: `ChangeRequestKind = "restore" | "adopt"` を足し、`ChangeRequest` に `kind?: ChangeRequestKind` を足す（D-15）。
- `drift.ts`（#170 で新設）に、乖離から操作の入力を作る純粋関数を足す:
  - `restoreInputOf(drift: TrustDrift): FrozenInput` — 足りない → `addUserArns`、余分 → `removeUserArns`。昇順。
  - `adoptChangesOf(drift: TrustDrift): { checkedTrue: string[]; checkedFalse: string[] }` — 余分 → 真、足りない → 偽。
  - 乖離が無い（`missing`・`extra` が空）かの判定 `hasDrift(drift)` を足す（`status` の導出と共通にする）。
- `api-contract.ts`: 操作の応答の型を足す（§3.2）。

### 3.2 API（`packages/api`）

共通: `POST /drift/restore`・`POST /drift/adopt`（`requires: "edit"`）を `handlers/apply.ts` の `diffRoutes` に足す。本文は `{ roleArn }`。ロールが未登録なら 404 に相当する検証エラー（既存の `getRole` の扱いに合わせる）。

`services/drift-repair-service.ts`（新設）:

- 共通の前処理 `loadDrift(roleArn, deployAccountId)`: `getRole`・`listAllUsers`・`listAssignments(poolId)`・`iam.getTrustPolicy(roleArn)`（Diff の `createIamTrustPolicyReader`。別アカウントは Reader を引き受ける）から `computeTrustDrift` を得る（D-5）。IAM を読めなければ `readError` と同じ形で失敗を返し、何も書かない。
- `restoreDrift(roleArn, now, actor, deployAccountId)`:
  1. `loadDrift`。乖離が無ければ `{ outcome: "no-drift" }`。
  2. `restoreInputOf` で入力を作り、`acquireRoleLock(roleArn, id, "draft", now)`。取れなければ `{ outcome: "excluded", reason: "draft" | "failed", changeRequestId }`（`createChangeRequests` と同じ判定）。
  3. 下書きの ChangeRequest（`kind: "restore"`、`createdBy: actor`）を `putChangeRequest`。失敗したら `compensateRoleLock`（既存と同じ）。
  4. `{ outcome: "created", changeRequest }`。
- `adoptDrift(roleArn, now, actor, deployAccountId)`:
  1. `getRoleLock(roleArn)` があれば `{ outcome: "excluded", reason, changeRequestId }`（D-12）。IAM を読む前に判定する。
  2. `loadDrift`。乖離が無ければ `{ outcome: "no-drift" }`。
  3. `kind: "adopt"` の ChangeRequest（`applied`。D-14）を `putChangeRequest`（D-13: 先）。
  4. `adoptChangesOf` の各ユーザについて、交点を書く（`setAssignmentState` を `assignment.ts` に足す。`checked`・`reflected` を絶対値で書く条件なしの Update。行が無ければ作る）。ユーザごとに独立して書き、失敗は集める。
  5. `{ outcome: "adopted", changeRequest, failures: [{ userArn, message }] }`。`failures` が空でなければ画面に列挙する。
- どちらも、**IAM の書き込みは呼ばない**（`IamTrustPolicyReader` だけを渡す）。FR-3.2 の担保は変わらない。
- 応答: `RepairResponse = { outcome: "created" | "adopted" | "no-drift" | "excluded"; changeRequest: ChangeRequest | null; exclusion: { reason: "draft" | "failed"; changeRequestId: string | null } | null; failures: { userArn: string; message: string; localized?: LocalizedMessage }[] }`。

`repository/change-request.ts`: `putChangeRequest`・読み出し（`toChangeRequest`）に `kind` を通す（D-15。無ければ `undefined`）。`ChangeRequestItem` に `kind?`。

`services/apply-service.ts`・`diff-service.ts` は**変えない**（D-9）。`restore` の申請も通常の申請と同じ扱いで差分・反映される。

### 3.3 インフラ（`infra/`）

- `infra/apigateway.tf`: `drift` の子として `restore`・`adopt` の 2 経路を足す（`api_leaf_routes` に親を持たせるか、子リソースとして別の `for_each` を足すかは plan で決める。いずれも `http_method = "ANY"`・`api_key_required = true`・Diff への統合。ファイル冒頭の経路表のコメントを更新する）。`/api/drift` は子を持たないリーフで、子の経路は greedy proxy に落ちずに 403 になるので、足さないと届かない。
- IAM ポリシーは変えない（D-8）。CloudFront の `/api/*` ビヘイビアも変えない。
- plan-guard R-11 は `aws_api_gateway_method` の作成・更新を全件見る。新しい 2 経路でも `api_key_required = false` で落ちることを `plan-guard.test.sh` に足す。

### 3.4 画面（`packages/web`）

- **詳細モーダル**（`DriftDetailModal.tsx`）: 乖離のあるロールで、フッタに 2 つのボタンを足す。
  - 「IAM を記録に合わせる（申請を作成）」: `edit` が無ければ無効、理由を出す（GI-13）。押すと `POST /drift/restore` を呼ぶ。成功（`created`）は画面 4 へ遷移。`no-drift` は「乖離がなくなっていました」を出して再確認を促す。`excluded` は理由（未反映の申請あり）と申請 ID（履歴への導線）を出す。
  - 「記録を IAM に合わせる」: `edit` が無ければ無効、理由を出す。押すと確認モーダルを開く。本文に、取り込む・外すユーザの ARN 全文と「AWS の信頼ポリシーは書き換えません」「そのユーザの未反映の編集は上書きされます」を出す（D-11・GI-4）。確認の実行ボタンは primary にしない（破壊的操作の規則）。実行で `POST /drift/adopt`。`adopted` は閉じて「n 件を記録に合わせました」、`failures` があれば列挙して再実行を促す。`excluded` は「未反映の申請があるため実行できません。申請を破棄してから実行してください」と申請 ID を出す。
  - 説明の文言: 2 つのボタンの意味を、モーダル内に 1 文ずつ（どちらを正とするか）添える。
- 実行中は 2 つのボタンとも無効（loading）。API の失敗（ネットワーク・403 など）はモーダル内にエラーを出す（GI-6。コードを併記）。
- **確認結果の扱い**（D-16）: 操作が成功したら、当該ロールの行を「再確認が必要」にする（「信頼ポリシー」列に、一致・乖離の代わりに「再確認が必要」を出す）。サマリは残す。
- **申請履歴（画面 5）・差分確認（画面 4）**: `kind` が `restore`・`adopt` の申請に、種別のバッジを出す（`restore`: 「乖離の修復（IAM を記録に合わせる）」、`adopt`: 「記録の取り込み（AWS は書き換えていません）」）。`adopt` の状態は「反映済み」のまま、結果の文言で区別する。画面 4 では `restore` の申請に「IAM を記録に合わせるための申請です」と添える。
- `api-client.ts` に `restoreDrift(roleArn)`・`adoptDrift(roleArn)`。文言は日本語・英語の両方（#94。`packages/core/src/messages/` に ID、SPA の固定文言）。

### 3.5 変えないもの

- 反映（`apply-service`）・差分確認（`diff-service`）のロジック、`mergeTrustPolicy`。
- 通常の「申請を作成」（`createChangeRequests`・`buildFrozenInput`）。`no-changes` の除外は変えない（A は別の経路で作る）。
- DynamoDB のテーブル・キー・GSI。実行ロールの IAM ポリシー。CloudFront、Lambda@Edge。
- FR-3.2（CRUD は AWS へ書き込まない）。A・B とも Diff 系統で、IAM の書き込みは `apply` 系統だけ。

## 4. 正本への反映

実装と同じ PR で行う（plan のタスクに含める）。覆すものは無く、足す・追記するだけ。

- `docs/design/requirements.md`:
  - **FR-4.10 を末尾に追加**: 乖離のあるロールについて、利用者の指示で、反映済みの割り当てを信頼ポリシーへ反映する下書きの申請（`restore`）を作れる。入力は操作の時点の乖離から作り、管理外には触れず、反映は FR-4.3 のとおり差分確認と明示の指示を経る（`edit` で作成、`apply` で反映）。
  - **FR-4.11 を末尾に追加**: 乖離のあるロールについて、利用者の指示で、乖離したユーザの `checked`・`reflected` を信頼ポリシーの現状に更新できる（`adopt`）。AWS へ書かない。未反映の申請があるロールでは拒否する。実行者と対象を ChangeRequest（種別 `adopt`）に残す。`edit`。
  - **FR-4.9** に注記: 確認自体は読み取り専用のまま。直す操作は FR-4.10・FR-4.11。
  - **FR-4.4・FR-4.5**: `restore`・`adopt` の申請は、入力を `checked`/`reflected` の食い違いではなく乖離から作る例外であることを注記する。FR-4.6 の「未反映」は `restore` の下書きにも適用される。
  - **FR-3.2**: `adopt` は Assignment を更新するが AWS へ書かない旨を注記する。
  - **FR-5.7**: `restore`・`adopt` の指示時に、乖離の再計算のため信頼ポリシーを読む旨を足す（#170 の確認と同じ読み取り）。
  - **FR-6.5**: `restore`・`adopt` は `edit` を足す。
  - **FR-7.2**: 乖離の詳細モーダルの 2 操作と、確認結果の「再確認が必要」。**FR-7.4・FR-7.5**: 種別の表示。
  - 冒頭の追記注記（Issue #172 により 2026-10-16）と、トレーサビリティの FR-4.x の行への FR-4.10・FR-4.11。
- `docs/design/mockups.md`: 画面 2 の詳細モーダルに 2 つの操作・確認モーダル・結果を、画面 4・画面 5 に種別のバッジを追記する（状態表にも）。
- `docs/design/interaction-spec.md`: FR-7.2 の節に、2 操作のフォーカス、確認モーダル（GI-4）、無効の理由（GI-13）、エラーの出し方（GI-6）、実行中の無効化を足す。FR-7.4・FR-7.5 の表に種別を足す。
- `docs/design/design-system-mapping.md`: 詳細モーダルのフッタ（Button）、確認モーダル（Modal + Alert）、種別のバッジ（StatusIndicator / Badge）を足す。
- `docs/design/iam-policy-design-note.md`: 2 節の表の Diff の担当に FR-4.10・FR-4.11 を足し、経路表に `POST /api/drift/restore`・`/adopt` を足す。権限（IAM ポリシー）は変えないことを注記する。
- `packages/api/TABLE-DESIGN.md`: ChangeRequest の `kind` 属性（任意。無ければ通常）と、アクセスパターン #30（restore）・#31（adopt）を末尾に足す。テーブル・キー・GSI は変えない。
- `docs/design/cicd-pipeline.md`: R-11 の記述に新しい 2 経路が対象であることを足す。
- `README.md`: 利用者向けの説明に、乖離の 2 つの直し方と違い（IAM を戻す / 記録を取り込む）を足す。既存の「許可リストに無いアカウント」の節（登録解除→再登録の案内）に、B の案内を足すかを、plan の最初のタスクで grep して確かめる。

## 5. エラーと境界

- 乖離が消えていた: 何も書かず `no-drift`。画面は再確認を促す。
- IAM を読めない（権限・別アカウントの Reader 引き受け失敗・`deployAccountId` が `null`）: 何も書かず、`readError` と同じ文言（`IamOperationError` の `localized`）で失敗を返す。
- ロール未登録: 検証エラー。
- A で未反映の申請あり: 作らず `excluded`（D-9）。ロックは `acquireRoleLock` の条件付き Put で原子的に取る（FR-4.6）。
- B で未反映の申請あり: 書かず `excluded`（D-12）。ロックの読み取りと書き込みの間に別の管理者が A で申請を作ると、すき間が空く。許容する（B は記録だけで、`restore` の下書きは `syncBaseline` で `reflected` をそろえるだけ。再実行で直る）。
- B の途中失敗: 監査は残り、失敗した交点を列挙する。再実行で乖離を再計算し、残りを直す（D-13）。
- 確認から実行までの間に IAM が変わった（B）: 確認の状態が列挙する対象は確認時の画面の結果（キャッシュ）である。サーバは実行（クリック）の時点で IAM を読み直して乖離を再計算し、再計算した集合を書く。監査の ChangeRequest には実際に書いた集合を残し、成功の通知の件数もその応答（追加＋削除）から出す。確認で見せた一覧と書く集合は、この間に変わりうる。許容する（Issue #172 の最終レビュー 2026-10-16）。
- A の反映で、作成から反映までの間に IAM が変わった: 反映は保全方式のマージで対象を再計算する（FR-5.1）。差分は画面 4 で、反映時点の信頼ポリシーに対して見られる。

## 6. 範囲外

- ユーザごとの選択、全ロール一括の修復。
- 結果の保存・履歴・通知・定期実行（監視系は持たせない方針。2026-09-28）。B の監査は ChangeRequest だけ。
- 管理外の principal の乖離としての扱い・取り込み（#170 D-7）。
- マトリクス（画面 3）への乖離の表示。

## 7. テスト方針

アプリコード（`packages/`）は TDD（失敗するテストを先に書く）。

- `packages/core`: `restoreInputOf`・`adoptChangesOf`・`hasDrift`（足りないのみ・余分のみ・両方・乖離なし・昇順・管理外を含まない）。`ChangeRequest.kind` の型。
- `packages/api`:
  - `drift-repair-service.test.ts`: A（下書きが作られ入力が乖離と一致、`kind: "restore"`、ロールを取る、未反映の申請で除外、乖離なし、IAM の読み取り失敗で何も書かない、`putChangeRequest` の失敗でロックを補償）。B（余分は真・足りないは偽、ほかの交点は触らない、`checked` の食い違いが上書きされる、`kind: "adopt"` の applied が監査として先に書かれる、未反映の申請で拒否、乖離なし、交点の一部失敗で列挙、IAM を書く関数を呼ばない）。
  - ハンドラの経路テスト（`POST /drift/restore`・`/adopt` は `edit` で通り、`view` は 403。`route-permissions.test.ts`）。
  - `change-request` リポジトリの `kind` の往復（無い既存アイテムは `undefined`）。
  - `apply-service` が `restore` の申請を通常と同じに反映し、`syncBaseline` が冪等であること（回帰）。
- `packages/web`: 詳細モーダルの 2 ボタン（`edit` で有効、`view` で無効と理由）、A の成功で画面 4 へ、`no-drift`・`excluded` の表示、B の確認モーダル（対象 ARN と上書きの注意）、`adopted`・`failures` の表示、成功後に行が「再確認が必要」、API 失敗のエラー、日本語・英語の両方、履歴・差分の種別バッジ。
- Terraform・CI 設定・文書は TDD の例外。`terraform fmt -check`・`terraform validate`・plan-guard（`plan-guard.test.sh` に R-11 の 2 経路を足す）、文書は grep で機械的に確かめる。
- **実測**（モックでは検証できない: 信頼ポリシーの更新そのもの）。検証用の IAM ロール（承認を得て新規作成。管理対象タグを付ける）を使い、既存の管理対象ロールは書き換えない:
  1. 外から信頼ポリシーを書き換えて、足りない・余分・管理外を作る。
  2. A: `restore` の申請を作り、画面 4 で反映して、信頼ポリシーが記録に戻り、管理外が残り、「信頼ポリシーを確認」が「一致」になる。
  3. B: 再び乖離を作り、`adopt` で記録が IAM に合い、「一致」になる。AWS（`UpdateAssumeRolePolicy`）を呼んでいないことを CloudTrail で確かめる（`AttributeKey=EventName`・`--region us-east-1`）。履歴に `adopt` の申請が実行者つきで並ぶ。
  4. 未反映の申請があるロールで B が拒否される。
  5. 別アカウント（dev2/dev3）のロールでも A・B が通る。
  終わったら DynamoDB の登録と IAM ロールを消す。
- 反映（plan の最終タスク）: Terraform は `terraform apply`（経路の追加。README の手順。`cd.yml` は反映しない。`docs/design/cd-config.md` D-7）、Lambda と SPA を反映して実測する。`DenySelfEscalation` の対象や実行ロールの IAM ポリシーは変えないので、特権昇格面への手順書は要らない。
- push の前に、CLAUDE.md の CI 同等の検査（gitleaks・`infra/` を変えるので trivy・依存を変えるなら npm audit）を実行する。
