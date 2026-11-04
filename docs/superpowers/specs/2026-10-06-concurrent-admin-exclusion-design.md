# 複数の管理者の同時操作に対する排他制御（Issue #121）

日付: 2026-10-06 / 関連: #20（複数の管理者の同時ログイン）

## 1. 目的と背景

#20 で複数の管理者が同時にログインできるようになった。同じ ChangeRequest を 2 人が同時に操作したとき、(a) 反映が二重に記録される、(b) 反映済みの申請が「破棄」と記録される、のを防ぐ。遅れた側には 409 を返し、記録を壊さない。

## 2. 現状の実測（コード読み）

Issue の「起こりうる競合」3 つを、実コードで確かめた結果。

| # | 競合 | 現状 | 判定 |
|---|---|---|---|
| 1 | Assignment のセルの同時更新 | `saveChecked`（`repository/assignment.ts`）は `checked` の絶対値を UpdateItem で書く。別のセルは干渉しない。同じセルは後勝ち | データは壊れない。後勝ちを仕様として明記する（範囲外） |
| 2 | 同じ ChangeRequest の同時反映、反映と破棄 | `applyOne` は `isApplicable` を読んだ後、`updateChangeRequestStatus`（条件は `attribute_exists(pk)` だけ）で書く。`discardChangeRequest` も同じ形 | **守られていない。本 spec の対象** |
| 3 | 同じロールの信頼ポリシーの read-modify-write | RoleLock（FR-4.6）で、1 ロールの未反映申請は 1 件。別々の申請どうしは競合しない。残るのは同じ申請の二重反映（#2 に含む）と、Rolust の外からの IAM 変更 | #2 で足りる。外部の変更は IAM に条件付き更新が無いので防げない（範囲外） |

#2 の害:

- 同時反映: マージは冪等なので IAM は壊れないが、後から書いた側が `appliedBy`・`appliedAt`・`result`（「既に申請どおりの状態でした」）を上書きし、監査記録が実態とずれる。
- 反映と破棄の交錯: 破棄が、反映の IAM 呼び出しの最中（`isApplicable` の読み取りの後）に確定すると、AWS は更新済みなのに記録は「破棄」になり、ロックも外れる（FR-5.5「反映した内容と監査記録は必ず一致する」が破れる）。

## 3. 範囲

範囲内: ChangeRequest の状態遷移（反映・失敗の記録・破棄）の排他。

範囲外（決定）:

- Assignment のセルの同時更新。同じセルは後勝ちとする。セル単位の即時保存・楽観的更新をしない（`CLAUDE.md` § 決定済みの仕様）との整合のため、version を持たせて拒否することはしない。
- Rolust の外からの IAM 変更。`GetRole` → `UpdateAssumeRolePolicy` の間の保護は、IAM に条件付き更新が無く、完全にはならないので作らない。
- 申請の作成（`createChangeRequests`）。RoleLock の条件付き Put（`attribute_not_exists(pk)`）が、すでに同時の作成を防いでいる。

## 4. 設計

方式は、申請アイテムに短い **claim（貸し出し）** を持たせることである。新しい状態は増やさない（下書き・反映済み・失敗・破棄のまま）。

### 4.1 属性

ChangeRequest のアイテムに、任意の 2 属性を足す。どちらも API の応答（`ChangeRequest` 型）には出さない。

| 属性 | 型 | 内容 |
|---|---|---|
| `applyingToken` | String | claim の持ち主を示す乱数（UUID）。反映 1 回ごとに作る |
| `applyingUntil` | String | claim の期限（ISO 8601 UTC。他の時刻属性と同じ形式で、辞書順で比べられる） |

claim の長さは **2 分**（定数 `APPLY_CLAIM_SECONDS = 120`）。apply Lambda の timeout（30 秒。`infra/lambda.tf`）より十分長いので、持ち主の実行中に期限が切れることはない。Lambda が途中で落ちても、期限で自動的に解ける。

### 4.2 リポジトリ（`repository/change-request.ts`）

- `claimChangeRequest(changeRequestId, now): Promise<{ claimed: true, token } | { claimed: false }>` — UpdateItem で `applyingToken`・`applyingUntil = now + 2 分` を SET する。
  条件: `attribute_exists(pk) AND #status IN (:draft, :failed) AND (attribute_not_exists(applyingUntil) OR applyingUntil < :now)`。`ConditionalCheckFailed` は `claimed: false`、他の失敗は `StorageError`。
- `updateChangeRequestStatus(changeRequest, guard)` — `guard` を必須にする（付け忘れをコンパイル時に防ぐ）。
  - `{ kind: "claim", token }`: 条件 `attribute_exists(pk) AND applyingToken = :token`。反映の成功・失敗の記録に使う。
  - `{ kind: "unclaimed", now }`: 条件 `attribute_exists(pk) AND #status IN (:draft, :failed) AND (attribute_not_exists(applyingUntil) OR applyingUntil < :now)`。破棄に使う。
  - どちらも、式に `REMOVE applyingToken, applyingUntil` を足し、claim を外す。条件に外れたら `ConflictError` を投げる（`StorageError` にしない。再試行しても同じ結果になる条件不一致なので）。
- `updateRoleLockStatus` は変えない。

条件に外れたときの冪等性（最終レビューによる追記）: AWS SDK は同じ UpdateItem を自動で再送するので、成功済みの書き込みの再試行が条件に外れうる。claim と状態の書き込みは、条件に外れたとき強い整合性で読み直し、claim は持ち主が自分の token なら成功、状態の書き込みは同じ状態・同じ `appliedAt` で claim が外れていれば成功として扱う。読み直しが要る箇所（反映の `claimRefusedReport`、破棄の読み直し）も強い整合性で読む。

### 4.3 反映（`services/apply-service.ts`）

`applyOne` の流れ:

1. `getChangeRequest` → 状態が反映できなければ、従来どおり `InvalidState` の報告。
2. `claimChangeRequest`。取れなければ、読み直して状態を確かめる。反映できない状態（別の管理者が先に反映・破棄した）なら `InvalidState`、反映できる状態なら（別の管理者が反映中）`Conflict` の報告（`ok: false`、`status` は読み直した値、`errorCode: "Conflict"`、`message: "別の管理者がこの申請を反映中です。しばらくしてから申請履歴で状態を確かめてください。"`）。どちらも ChangeRequest の記録は書かない。
3. `commitApply`（IAM の読み取り → マージ → 更新）。成功・失敗の記録は、取った token を guard にして書く。
4. コミット点より後（ロール解放・baseline 追随）は変えない。例外を投げない（B-1）。

token の guard に外れた場合（期限切れ後に別の反映が claim した。timeout の定めにより実際には起きない）は、`commitApply` の catch に落ち、失敗の記録も同じ条件で拒否される。`console.error` に残し、報告は「失敗」とする。

### 4.4 破棄（`services/change-request-service.ts`）

`discardChangeRequest` は、`updateChangeRequestStatus(discarded, { kind: "unclaimed", now })` で書く。条件に外れたら読み直す。破棄できない状態（先に破棄・反映された）なら、従来の `ValidationError`（「状態「…」の申請は破棄できません」）。破棄できる状態なら、`ConflictError`（「この申請は別の管理者が反映中です。しばらくしてから、もう一度操作してください。」）。

`now` は handler から渡す（`applyChangeRequests` と同じ引数の形）。

### 4.5 利用者への見せ方

- 破棄（申請履歴）: 既存の `catch` が「破棄できませんでした: <メッセージ>」を出し、必ず `reload()` する。メッセージが上の文言になる。コードは変えない（テストで確かめる）。
- 反映（差分確認）: `Conflict` の報告は、既存の失敗の報告と同じカードに文言を出す。`status` が反映済み・破棄のとき（`InvalidState`）は従来どおり。
- どちらも、画面の自動再取得は既存の挙動（破棄は `reload`、反映は報告の表示）に任せ、新しい操作は足さない。

### 4.6 権限・インフラ

DynamoDB の権限は変えない（`UpdateItem` は付与済み。`TransactWriteItems` は使わない）。環境変数・Terraform の変更は無い。既存のアイテムは属性を持たないので、条件 `attribute_not_exists(applyingUntil)` に合い、移行は要らない。前の版へ戻しても、旧コードは新属性を読まず、claim が残っていても無害（旧版は claim を見ない）。

## 5. エラーと失敗の整理

| 場面 | 結果 |
|---|---|
| 同時 2 反映 | 先に claim した側が反映。後の側は `Conflict`（記録は書かない） |
| 反映中の破棄 | 破棄は `ConflictError`（409）。申請は変わらない |
| 破棄の後の反映 | 従来どおり `InvalidState`（claim の条件の `status` でも拒否される） |
| 反映した側が落ちた | claim が 2 分で切れる。それまで反映・破棄は 409。切れた後は、状態は下書き（または失敗）のままで、再反映できる。IAM は反映済みでも、再反映のマージは冪等で「既に申請どおり」になる |
| 反映が失敗 | 失敗の記録と同じ式で claim を外す。FR-5.6 の再反映は、すぐできる |

## 6. テスト

アプリコード（`packages/api`）は TDD。

ユニット（モック）:

- `claimChangeRequest`: 条件式、成功時の token、`ConditionalCheckFailed` → `claimed: false`、他の失敗 → `StorageError`。
- `updateChangeRequestStatus`: guard ごとの条件式と `REMOVE`、条件不一致 → `ConflictError`。
- `applyOne`: claim が取れない 2 通り（`InvalidState` と `Conflict`）で IAM を呼ばない・記録を書かない。成功と失敗の記録が token の guard で書かれる。
- `discardChangeRequest`: 条件不一致で、状態により `ValidationError` と `ConflictError` に分かれる。
- `HistoryScreen`: 破棄が 409 のとき、メッセージを出して再取得する。

**実測（モックでは原理的に検証できない）**: 実 DynamoDB に、このテスト専用のキー（`CR#concurrency-test-<乱数>`）で下書きの申請を 1 件作り、同じプロセスから次を同時に実行して結果を確かめ、終わったらそのアイテムを削除する。既存の資源は書き換えない。IAM は呼ばない。

1. `claimChangeRequest` の同時 2 回 → 1 回だけ `claimed: true`
2. claim 中の `{ kind: "unclaimed" }` での書き込み → `ConflictError`
3. token が違う guard での書き込み → `ConflictError`
4. 期限切れ（過去の `now` で claim したアイテム）への claim → 成功
5. 成功の記録の後、`applyingToken`・`applyingUntil` が消えている

統合テストとして `ROLUST_INTEGRATION=1` の下に置く（`npm run test:integration`）。手順書は plan に含める。

## 7. 既存の決定との整合

- セル単位の即時 API 呼び出し・楽観的更新をしない・件数無制限: 変えない（範囲外にしたので触れない）。
- B-1（コミット点より後は例外を投げない）: 変えない。claim の取得はコミット点より前、claim を外すのはコミット点の書き込みと同じ式。
- FR-4.6（RoleLock）: 変えない。

## 8. 正本への反映

覆す・足す ID と節（実装と同じ PR で更新する。plan のタスクに含める）:

| 文書 | 変更 |
|---|---|
| `requirements.md` | **FR-5.8 を末尾に追加**（同じ ChangeRequest の同時の反映・破棄を排他し、遅れた側を 409 / 報告の `Conflict` で拒否する。記録は先に確定した操作のものだけ）。FR-4.8 に、反映中の申請は破棄できないことを追記。冒頭の追記注記と、トレーサビリティ表（FR-5.1 – FR-5.7 の行）を FR-5.8 まで広げる。範囲外（Assignment のセルの後勝ち、外部の IAM 変更）を FR-5.8 の注記に明記 |
| `packages/api/TABLE-DESIGN.md` | 冒頭の追記注記。ChangeRequest の `applyingToken`・`applyingUntil` と、アクセスパターン 28（反映の claim）。節「ChangeRequest の同時操作（Issue #121）」を末尾に追加（claim の期限・条件式・guard の 2 種・移行不要・戻したときの扱い） |
| `interaction-spec.md` | 反映（失敗のカードに `Conflict` の文言）と破棄（409 の通知。確認モーダルは閉じて再取得）の行を追記。冒頭の追記注記 |
| `mockups.md` | 申請履歴の破棄・差分確認の反映のエラー状態に、同時操作の文言を追記 |
| `iam-policy-design-note.md` | **なし**（DynamoDB の権限は変えない。確認済み） |
| `CLAUDE.md` § 決定済みの仕様 | 「Assignment の同じセルの同時更新は後勝ち」を追記（本 spec 3 節の決定） |

`aidlc/` は触らない。凍結文書の訂正は無い。

## 9. 反映（デプロイ）

Lambda（apply・crud）と SPA の変更を伴う。Terraform の変更は無い。plan の最終タスクに、README の手順による反映（`cd.yml` は反映しない。`cd-config.md` D-7）と、本番での実測（上の 6 節の手順を、本番テーブルに専用キーで作って消す）を含める。
