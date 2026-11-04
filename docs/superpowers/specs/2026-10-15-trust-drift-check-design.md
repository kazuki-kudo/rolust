# 登録済みの割り当てと実際の信頼ポリシーの差分を、指示時に確認して表示する（Issue #170）

日付: 2026-10-15 / 関連: #85（クロスアカウント・Reader）・#135（登録＝紐づけ・取り込み）・#141（権限）・#94（i18n）・#16（プレースホルダ）・#121（FR-5.8）

## 1. 目的と背景

Rolust は、IAM ロールの割り当て（Assignment）を正として、申請と差分確認を経て信頼ポリシーへ反映する。ただし Rolust の外から信頼ポリシーが変更されうる（FR-5.8 の範囲注記のとおり、防げない）。その結果、Rolust の記録と実際の信頼ポリシーが乖離しても、申請を作って差分を見るまで気づけない。

利用者が**指示したときだけ**、登録済みの全ロールについて、Rolust の記録と実際の信頼ポリシーを比べ、乖離があれば画面 2（IAMロール管理）に表示する。乖離が無ければ、その旨を表示する。

読み取り専用で、AWS へ書き込まない・ChangeRequest を作らない・何も保存しない。乖離を直す操作は範囲外（§6）。

### 受け入れの観点（Issue #170 の完了条件）

- 利用者が指示したときだけ比較が走り、画面の描画では走らない（画面のテストで、描画だけでは API を呼ばないことを確かめる）。
- 乖離のあるロールと、その差分（足りない・余分な principal）が表示される。
- 永続化の可否が決定され、根拠とともにここに記録されている（D-1）。
- アプリコードは TDD。実 IAM に対する動作は実測で確かめる（§7）。

## 2. 決定

| ID | 論点 | 決定 | 根拠 |
|---|---|---|---|
| D-1 | 永続化 | **しない（使い捨て）**。結果は API の応答として返し、画面内の状態にだけ保持する。再読み込みで消える。テーブル・GSI・保持期間は増やさない | 依頼者の決定（2026-10-15。選択肢: A 使い捨て・B 最新 1 件を保存・C 履歴を保存）。根拠: 結果は IAM の「いま」の写しで、古くなるほど価値が下がる。履歴を使う場面が Issue に無い。保存すると古い結果が「いま乖離」と読まれる恐れがあり、履歴は監視に近づく（監視系は持たせない方針。2026-09-28）。B・C が要るなら別 Issue で足せる |
| D-2 | 対象単位 | **登録済みの全ロールを 1 回の指示で**確認する。選択・個別の確認は置かない | 依頼者の決定（2026-10-15。選択肢: A 全ロール・B 選択したロールだけ・C 両方）。根拠: 要望は「差分があるか」を知ること。マトリクスの選択は「申請に含める」意味と重なる。操作が増えるのは YAGNI に反する |
| D-3 | 表示場所 | **画面 2（IAMロール管理）**。見出し行に「信頼ポリシーを確認」ボタン、一覧に「信頼ポリシー」列、乖離の行から詳細モーダル。新しい画面・ナビは増やさない | 依頼者の決定（2026-10-15。画面案を提示して承認。選択肢: A 画面 2・B 画面 3 のマトリクス上・C 専用画面）。根拠: 乖離はロール（IAM 側の状態）の性質で、ユーザ×ロールの編集とは関心が別。画面 2 はロール単位で、「未反映の申請」列という状態の可視化の前例がある。画面 3 の列ヘッダはすでに過密で、ARN の詳細を置く場所が無い |
| D-4 | API の置き場所 | **Diff 系統に専用の経路 `GET /api/drift` を足す**（`infra/apigateway.tf` の `api_leaf_routes` に `drift` を 1 行足し、ハンドラは `diffRoutes` に置く） | 依頼者の決定（2026-10-15。選択肢: A Diff に新経路・B CRUD に置く・C `/api/diff` をクエリで分岐）。根拠: `iam-policy-design-note.md` が「差分算出・管理外 principal の検出」を Diff の担当にしている。Diff はすでに読み取りだけの `iam:GetRole` と Reader の `sts:AssumeRole` を持つので、IAM ポリシーは増えない。CRUD が AWS を読む範囲（登録時だけ）も広がらない。コストは Terraform の反映と実測 |
| D-5 | 比較の基準 | **`Assignment.reflected`**（最後に反映した状態）。`checked` は使わない | 導出: `reflected` は「最後に IAM へ反映された状態」で、Rolust だけが IAM を書くなら、それと実際の信頼ポリシーの食い違いは外からの変更を意味する。`checked` と `reflected` の食い違いは未反映の編集（通常の運用）で、乖離ではない。`checked` と比べると、編集のたびに乖離として出てしまう |
| D-6 | 乖離の定義と算出 | 「反映済みの割り当てを、いまの信頼ポリシーへ反映したら何が変わるか」を、**申請の差分と同じマージ（`mergeTrustPolicy`）から導く**。足りない = マージが「追加する」principal（`reflected=true` なのに信頼ポリシーで許可されていない管理下のユーザ）。余分 = マージが「削除する」principal（`reflected=false` なのに信頼ポリシーで許可されている管理下のユーザ）。入力は、固定プールの全 IamUser から、当該ロールで `reflected=true` のユーザを足りない側の候補とし、残りを余分側の候補とする（`addUserArns` = 反映済みのユーザ、`removeUserArns` = それ以外の全ユーザ） | 導出: `diff.ts` の冒頭の原則「差分は反映が決めることと食い違わないよう、マージの結果から導く」。Allow・Deny、条件つき Statement、ARN の正規化、プレースホルダの扱いの定義が、マージ・登録時の取り込み・FR-4.2 の警告と食い違わない。別の比較関数を作ると、その定義が 2 つになる |
| D-7 | 管理外の principal | **乖離に数えない**。参考として、詳細モーダルに別枠で出す（`findUnmanagedPrincipals`。基準集合は FR-4.2 のとおり全 IamUser の ARN 集合） | 導出: FR-4.2 は、管理外（未登録のユーザ・サービス・外部アカウントなど）を Rolust が意図して保全するものとし、警告は表示のみで反映を妨げない。管理外が増えたことは、登録前から居たものと区別できないので、乖離にはできない。Issue の「管理下と管理外の扱い（FR-4.2 の定義）に沿って判定する」にあたる |
| D-8 | プレースホルダ | 信頼ポリシーの `RolustPlaceholder` Statement の有無は、乖離に数えない。マージの `placeholderInjected`・`placeholderRemoved` は使わない | 導出: プレースホルダは Rolust 自身が管理する注入物で、principal ではない（#16。管理外にも数えない）。外から消されても、管理下のユーザの食い違いではない |
| D-9 | 読み取りの失敗 | ロールごとに独立して読み、1 ロールの失敗が他を止めない。失敗したロールは「読み取り失敗」の行にし、AWS のエラーコードをそのまま出す（GI-6）。サマリは乖離の件数と読み取り失敗の件数を別に数える | 導出: 差分確認（画面 4）と同じ規約（`diff-service.ts`。interaction-spec FR-7.4）。`IamOperationError` の `localized` をそのまま使う |
| D-10 | 権限 | `view`（参照）で実行できる | 導出: 読み取りだけで、FR-6.5 の「参照（FR-7.x の表示と差分確認）は `view`」にあたる。差分確認（`GET /diff`）も `view` |
| D-11 | 応答の時刻 | 応答に、サーバが確認を始めた時刻（`checkedAt`。ISO 8601）を入れる。画面はサマリに、利用者のタイムゾーンで表示する | 根拠: 使い捨てでも、結果が「いつの IAM」かを示さないと、時間が経った結果が現状と読まれる。時刻は応答の一部で、保存しない（D-1） |
| D-12 | 反映との競合 | 反映の実行中に確認すると、IAM を更新した後・`reflected` を書く前の短い間だけ、一時的な乖離が出うる。排他しない | 導出: 反映の実行中の確認は稀で、再確認で消える。FR-5.8 の排他は ChangeRequest の状態遷移だけに限る（CLAUDE.md の決定済みの仕様） |
| D-13 | 並び順の編集中 | 並び順の編集モード（FR-2.6）の間は、「信頼ポリシーを確認」を無効にする | 導出: GI-9（編集モードの間は、ほかの操作を無効にして「保存」を唯一の primary にする）と、画面 2 の既存の規則に合わせる |
| D-14 | 結果の画面内の寿命 | 結果は画面 2 の状態として持つ。ロールの登録・削除・並び順の保存・説明などの編集をしても、結果は自動では消さない。画面を離れる・再読み込みで消える。再確認で置き換える。サマリの「閉じる」で消す | 導出: 結果は「その時刻の IAM」の写しで、Rolust の編集では変わらない（Rolust の編集は信頼ポリシーを書かない）。ただし削除したロールの行は一覧から消えるので、結果は一覧の行に ARN で結びつけ、一覧にない ARN の結果は出さない |

## 3. 設計

### 3.1 ドメイン（`packages/core`）

`packages/core/src/drift.ts`（新設）に純粋関数を置く。AWS SDK に依存しない。

```ts
export interface TrustDrift {
  roleArn: string;
  /** Rolust は引き受けられる状態と記録している（reflected）が、信頼ポリシーで許可されていない管理下のユーザ。昇順。 */
  missing: string[];
  /** Rolust は引き受けられないと記録している（reflected でない）が、信頼ポリシーで許可されている管理下のユーザ。昇順。 */
  extra: string[];
  /** FR-4.2 の管理外 principal（乖離に数えない。D-7）。 */
  unmanaged: UnmanagedPrincipal[];
}

export function computeTrustDrift(
  current: TrustPolicyDocument,
  roleArn: string,
  allUserArns: string[],      // 固定プールの全 IamUser の ARN
  reflectedUserArns: string[], // 当該ロールで reflected = true のユーザの ARN
): TrustDrift;
```

- 実装は `computeTrustPolicyDiff(current, { roleArn, addUserArns: reflected, removeUserArns: allUserArns − reflected })` の `added`・`removed` を `missing`・`extra` に読み替える（D-6）。プレースホルダの項目は使わない（D-8）。
- `unmanaged` は `findUnmanagedPrincipals(current, allUserArns)`（D-7）。
- `reflectedUserArns` が `allUserArns` に無い ARN を含んでも、`allUserArns` を `Set` にして差し引くだけで、結果に混ざらないようにする（登録を消したユーザの孤児 Assignment への備え）。

`packages/core/src/api-contract.ts` に応答の型を足す。

```ts
export type TrustDriftStatus = "match" | "drift" | "readError";

/** `GET /api/drift` の 1 ロール（画面 2）。 */
export interface TrustDriftView {
  roleArn: string;
  status: TrustDriftStatus;
  /** `readError` のときは空。 */
  missing: string[];
  extra: string[];
  unmanaged: UnmanagedPrincipal[];
  /** `readError` のときだけ非 null。形は `DiffView.readError` と同じ。 */
  readError: { errorCode: string; message: string; localized?: LocalizedMessage } | null;
}

export interface DriftResponse {
  /** サーバが確認を始めた時刻（ISO 8601）。 */
  checkedAt: string;
  /** 登録済みのロールの列順（FR-2.6）。 */
  roles: TrustDriftView[];
}
```

`status` は `readError` が非 null なら `readError`、`missing` か `extra` が空でなければ `drift`、それ以外は `match`。

### 3.2 API（`packages/api`）

- `GET /drift`（`requires: "view"`）を `handlers/apply.ts` の `diffRoutes` に足す。`lambda/diff.ts` は `diffRoutes` を渡しているので、ハンドラの配線は変わらない。
- `services/drift-service.ts`（新設）の `computeDriftViews(deployAccountId, deps)`:
  1. `listRoles()`（列順）、`listAllUsers()`、`listAssignments(poolId)` を並列に読む（既存の Query。TABLE-DESIGN #5・#2・#3）。
  2. ロールごとに、`reflected=true` のユーザの ARN を集め、`iam.getTrustPolicy(roleArn)` を呼ぶ。ロールごとに並列で、`Promise.allSettled` のように 1 件の失敗を他へ伝えない。
  3. 読めたら `computeTrustDrift`、読めなければ `readError`（`diff-service.ts` と同じ `IamOperationError`・`localizedOfError` の扱い。失敗は `console.error` に残す）。
  4. 応答は `{ checkedAt, roles }`。ロールが 0 件なら `roles: []`。
- 読み取りは `createIamTrustPolicyReader(deployAccountId)`（Diff の既存。別アカウントは Reader を引き受ける）。更新の関数を持たない型（`IamTrustPolicyReader`）だけを渡す。
- DynamoDB・IAM の書き込みは一切しない。`Assignment` も `ChangeRequest` も更新しない。

### 3.3 インフラ（`infra/`）

- `infra/apigateway.tf` の `api_leaf_routes` に `drift = { path_part = "drift", target = "diff" }` を足し、ファイル冒頭の経路表のコメントを更新する。メソッドは既存の `leaf` と同じ（`api_key_required = true`。FR-6.3・plan-guard R-11）。
- IAM ポリシーは変えない（Diff の `diff_iam_read`・`diff_assume_target_reader` で足りる）。CloudFront の `/api/*` ビヘイビアも変えない。
- plan-guard R-11 が `leaf` の全エントリを見ているかを確かめ、`drift` が `api_key_required = false` に戻ったときに落ちることを `plan-guard.test.sh` に足す。

### 3.4 画面 2（`packages/web`）

画面案（2026-10-15 に承認）のとおり。

- 見出し行に「信頼ポリシーを確認」ボタン（`view` で有効。並び順の編集中は無効。D-13）。押すと `GET /drift` を 1 回呼ぶ。描画では呼ばない。確認中はボタンが loading、一覧の「信頼ポリシー」列は各行「確認中…」。
- 一覧に「信頼ポリシー」列を足す（「未反映の申請」の次）。確認前は「—」。確認後は「✓ 一致」「! 乖離 n 件（足りない + 余分の件数）［詳細］」「✗ 読み取り失敗［詳細］」。色だけに頼らず、記号と文字を併記する。
- 結果のサマリを表の上に出す（確認後）。乖離があれば警告、無ければ「すべてのロール（n 件）で一致しています（時刻）」、読み取り失敗があればその件数も出す。「再読み込みすると消えます」を添え、「閉じる」で消せる。
- 「詳細」は読み取り専用のモーダル。乖離は「Rolust は引き受けられる状態と記録しているが、IAM 上に無い」（足りない）と「Rolust の記録に無い（未反映）のに、IAM 上にある」（余分）を ARN で列挙する。管理外の principal は参考として別枠に出す（乖離に数えない旨を添える）。読み取り失敗はエラーコードと文言を出す。フッタは「閉じる」だけ。
- API 自体が失敗したとき（ネットワーク・403 など）は、サマリの位置にエラーを出す（GI-6。コードは併記）。
- `api-client.ts` に `getDrift()` を足す。文言は日本語・英語の両方（#94。`packages/core/src/messages/` に ID を足し、API が返す `localized` と、SPA の固定文言の両方）。

### 3.5 変えないもの

- 申請・差分確認（画面 4）・反映・履歴、マトリクス（画面 3）。
- DynamoDB のテーブルとキー（読むだけ）。Assignment の `checked`・`reflected` の意味。
- 実行ロールの IAM ポリシー、CloudFront、Lambda@Edge。
- FR-3.2（CRUD は AWS へ書き込まない）。この確認は Diff 系統で読むだけで、CRUD の経路は増えない。

## 4. 正本への反映

実装と同じ PR で行う（plan のタスクに含める）。覆すものは無く、足す・追記するだけ。

- `docs/design/requirements.md`:
  - **FR-4.9 を末尾に追加**（FR-4 の末尾。「追加は末尾」）: 利用者の指示で、登録済みの全ロールについて、Rolust の記録（`reflected`）と信頼ポリシーの食い違い（足りない・余分な管理下の principal）を表示する。管理外は乖離に数えず参考にとどめる。読み取りだけ・保存しない・`view` で実行できる（D-1〜D-12）。
  - **FR-5.7 の例外**の注記に、確認（`GET /drift`。Diff 系統の読み取り）を足す。AWS へ問い合わせる時点の列挙に「乖離の確認の指示時」を足す。読むのは信頼ポリシーだけで、IAM の一覧取得や実在検証ではない。
  - **C-4** の例外に「乖離の確認」を足す。範囲外の表の「IAM API による一覧取得・実在検証」の例外にも足す。
  - **FR-7.2**（IAMロール管理）に、「信頼ポリシーを確認」と結果の表示（D-3・D-13・D-14）を追記する。
  - **FR-6.5 の対象**に「乖離の確認は `view`」を足す。
  - 冒頭の追記注記（Issue #170 により 2026-10-15）と、トレーサビリティの FR-4.x の行への FR-4.9。
- `docs/design/mockups.md`: 画面 2 に、ボタン・列・サマリ・詳細モーダルと、確認前・確認中・一致・乖離・読み取り失敗の見え方を追記する（5 状態の表にも）。
- `docs/design/interaction-spec.md`: FR-7.2 の節に、確認のボタン・結果・詳細モーダルのフォーカス、読み上げ（サマリは `aria-live`）、エラーの出し方（GI-6）、編集モード中の無効化（GI-9）を足す。
- `docs/design/design-system-mapping.md`: 画面 2 の部品（Button の loading、Table の列、Alert、Modal）を足す。
- `docs/design/iam-policy-design-note.md`: 2 節の表の Diff 系統の担当に FR-4.9 を足し、`GET /api/drift` を経路表に足す。権限は変えないことを注記する。
- `packages/api/TABLE-DESIGN.md`: アクセスパターン #29（乖離の確認。#5・#2・#3 の読み取りの組み合わせ。書き込みなし）を末尾に足す。テーブル・キーは変えない。
- `docs/design/cicd-pipeline.md`: R-11 の記述に、`leaf` の全エントリが対象であることを確かめ、`drift` を含むことを足す（plan-guard の対象が変わらないなら注記のみ）。
- `README.md`: 利用者向けの説明に、画面 2 の「信頼ポリシーを確認」と、保存しないこと・読み取りだけであることを足す。実際の記述の有無は、plan の最初のタスクで grep して確かめる。

## 5. エラーと境界

- ロールが 0 件: ボタンは有効のまま。押すと `roles: []` で、サマリは「確認するロールがありません」。
- 全ロールの読み取りが失敗: サマリは「n 件すべてで読み取りに失敗しました」。各行にエラーコード。
- 別アカウントのロールで Reader を引き受けられない: そのロールだけ `readError`（`assume-role` の文言。`iam-client.ts` の既存の文言をそのまま使う）。
- デプロイ先のアカウントを判定できない（`deployAccountId` が `null`）: 既存の読み取りクライアントが IAM を呼ばずに止め、全ロールが `readError` になる。
- 権限が `view` に足りない: 既存の 403（AWS・DynamoDB を呼ぶ前）。
- 巨大な信頼ポリシーや多数のロール: 並列に読み、API Gateway のタイムアウト内に収まる規模（手入力のロール・ユーザの規模）を前提にする。超える規模は、別 Issue で扱う（ページングや非同期の確認）。

## 6. 範囲外

- 乖離を直す操作（再反映・取り込み・記録の更新）。`checked = reflected` のロールで外から信頼ポリシーが変わっても、差分が空なので申請を作れない。直す経路は別 Issue で、選択肢（反映済みの記録に合わせて IAM を戻す・IAM に合わせて記録を取り込む）を並べて決める。
- 結果の保存・履歴・通知・定期実行（D-1。監視系は持たせない方針）。
- マトリクス（画面 3）への乖離の表示。
- 管理外の principal の乖離としての検出（D-7）。

## 7. テスト方針

アプリコード（`packages/`）は TDD（失敗するテストを先に書く）。

- `packages/core/src/drift.test.ts`: 一致（空の乖離）、足りない、余分、両方、管理外（サービス・外部アカウント・未登録ユーザ）を乖離に数えない、プレースホルダを乖離に数えない、`allUserArns` に無い反映済みの ARN の扱い、Deny だけの principal（足りない）、条件つき Statement の principal（一致）、昇順。
- `packages/api`: `drift-service.test.ts`（1 ロールの失敗が他を止めない、列順、ロール 0 件、`reflected` と `checked` の食い違いが乖離にならないこと、別アカウントの読み取りの失敗、書き込み系を呼ばないこと）、`handlers` の経路テスト（`GET /drift` が `view` で通り、権限不足は 403。`route-permissions.test.ts` に載る）。
- `packages/web`: 描画だけでは API を呼ばない、押すと 1 回呼ぶ、確認中の状態（ボタンの loading・行の「確認中…」）、一致・乖離・読み取り失敗の行とサマリ、詳細モーダル（足りない・余分・管理外の別枠）、API 失敗のエラー、並び順の編集中は無効、権限（`view` で押せる）、日本語・英語の両方（`PoolScreen.en.test.tsx` などの前例）。
- Terraform・CI 設定は TDD の例外（configuration files）。`terraform fmt -check`・`terraform validate`・plan-guard（`plan-guard.test.sh` に `drift` の R-11 を足す）で機械的に確かめる。
- **実測**（モックでは検証できない: 外部 API の呼び出しそのもの）: 検証用の IAM ロール（承認を得て新規作成。管理対象タグを付ける）を使い、(a) 一致、(b) 外から信頼ポリシーを書き換えた後の乖離（足りない・余分・管理外）、(c) Rolust に登録していないロールの読み取り失敗、(d) 別アカウント（dev2/dev3）のロールを確かめる。**CloudTrail で、確認が `GetRole` だけを呼び、`UpdateAssumeRolePolicy` を呼んでいないこと**を確かめる（`AttributeKey=EventName`・`--region us-east-1`）。終わったら、DynamoDB の登録と IAM ロールを消す。既存の管理対象ロールの信頼ポリシーは書き換えない。
- 反映（plan の最終タスク）: Terraform は `terraform apply`（API Gateway の経路。反映は README の手順で、`cd.yml` は反映しない。`docs/design/cd-config.md` の D-7）、Lambda と SPA は反映して実測する。
- push の前に、CLAUDE.md の CI 同等の検査（gitleaks・`infra/` を変えるので trivy・依存を変えるなら npm audit）を実行する。
