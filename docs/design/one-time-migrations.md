# 一度きりの移行手順

> **正本注記**（Issue #178 により 2026-10-18 追記）
>
> - **位置づけ**: 過去のデプロイを更新するときにだけ要る、一度きりの移行手順を置く。新しく作ったデプロイでは不要。利用者向けの手順書（`docs/guide/`）からは外した。
> - **複写元**: 旧リポジトリの `README.md`（コミット `2ce40d5` 時点。旧リポジトリのコミットで、この木では引けない）の「状態テーブルと申請テーブルへの分割（Issue #36、一度だけ）」と、「ロールを新規登録すると、そのままユーザプールに紐づく」の移行スクリプトの段落。手順の文面は変えず、他の文書への参照だけを張り替えた。
> - **含めないもの**: 「ユーザプールとロールの紐づけの移行・ロールの持ち主の移行（Issue #19・#35。実施済み）」は、スクリプト（`migrate:pool-role-links`・`migrate:role-link-owners`）を Issue #108 で削除済みのため載せない。経緯は `packages/api/TABLE-DESIGN.md` と `aidlc/` にある。
> - **切り戻し**: 分割の切り戻しは `rollback-runbook.md`「状態テーブルと申請テーブルへの分割の切り戻し」。

## 状態テーブルと申請テーブルへの分割（Issue #36、一度だけ）

（Issue #36 により 2026-09-27 追記）Issue #36 より前からあるデプロイを更新したときだけ必要です。新しく作ったデプロイでは要りません。Issue #36 から、DynamoDB は状態テーブル（`rolust-state`）と申請テーブル（`rolust-change-requests`）の 2 本です。反映すると、Terraform は旧テーブル `rolust` を消さずに管理から外します。状態（ユーザプール・IAM ユーザ・割り当て・紐づけ・IAM ロール）を新しいテーブルに写してから、旧テーブルを消します。**申請履歴と未反映の申請は移しません**（捨てます）。

**反映から手順 4 のコピーが終わるまで、画面は空に見えます。その間は画面を操作しないでください。**

リポジトリのルートで、次を順に実行します。

```bash
export AWS_PROFILE=<デプロイ先のプロファイル> AWS_REGION=<デプロイ先のリージョン>
export ROLUST_LEGACY_TABLE_NAME=rolust  # 旧 Terraform 変数 table_name の値（既定は rolust）。table_name を上書きしていたら合わせて変えてください（Issue #36 により 2026-09-27 追記）

# 1. 退避
aws dynamodb create-backup --table-name "$ROLUST_LEGACY_TABLE_NAME" --backup-name rolust-before-split

# 2. 旧テーブルの件数を種別ごとに控える（総数が 8 種別の合計と一致することも確かめる）
count() {
  for t in UserPool IamUser Assignment PoolRoleLink IamRole RoleLinkOwner ChangeRequest RoleLock; do
    printf '%s\t' "$t"
    aws dynamodb scan --table-name "$1" --select COUNT \
      --filter-expression 'itemType = :t' --expression-attribute-values "{\":t\":{\"S\":\"$t\"}}" \
      --query Count --output text
  done
  printf 'total\t'; aws dynamodb scan --table-name "$1" --select COUNT --query Count --output text
}
count "$ROLUST_LEGACY_TABLE_NAME"
```

3. `docs/guide/setup.md` の「apply する」の手順で反映します（plan → plan-guard → apply）。plan で `aws_dynamodb_table.rolust` が「will no longer be managed by Terraform」（forget）になり、destroy になっていないことを確かめてください。**この apply を別の端末で行った場合、手順 5・6 の前に、上の `export`／`count()` の行をその端末で改めて実行してください**（`count()` と環境変数はその端末の中にしかありません。Issue #36 により 2026-09-27 追記）。

```bash
# 4. 状態を写す
export ROLUST_STATE_TABLE_NAME="$(terraform -chdir=infra output -raw state_table_name)"
npm run migrate:split-tables --workspace @rolust/api             # dry-run（何も書き込まない）
npm run migrate:split-tables --workspace @rolust/api -- --apply  # 書き込む
npm run migrate:split-tables --workspace @rolust/api             # 「書く対象はありません」になることを確かめる

# 5. 突き合わせ: 状態の 6 種別が手順 2 と一致し、ChangeRequest・RoleLock が 0、total が 6 種別の合計であること
count "$ROLUST_STATE_TABLE_NAME"
```

6. 画面 1〜5 を開き、ユーザプール・マトリクス・IAM ロールが以前と同じに見えることを確かめます。続けて、申請テーブルの経路（モックでは検証できません）を確かめます（Issue #36 により 2026-09-27 追記）。

   1. 画面 3（IAMロール割り当て）で、任意の 1 セルのチェックボックスを切り替え、「申請を作成」します。
   2. 画面 4（差分確認・反映）で、作成した下書きの差分を開いて確認します（反映はしません）。
   3. 画面 5（申請履歴）から、その申請を破棄します。
   4. 画面 3 に戻り、手順 1 で切り替えたセルのチェックボックスを元の状態に戻します（反映していないので画面上の操作だけで戻ります）。

   ```bash
   # 6'. 申請テーブルを確かめる: ChangeRequest が 1 件残り（破棄した申請も蓄積する。CLAUDE.md）、RoleLock が 0 であること
   count "$(terraform -chdir=infra output -raw change_request_table_name)"
   ```

```bash
# 7. 旧テーブルを消す（手順 1 の退避は残ります）
aws dynamodb delete-table --table-name "$ROLUST_LEGACY_TABLE_NAME"
```

コピーは既存のアイテムを上書きしません。途中で失敗したら（終了コード 1。npm のバージョンによっては `npm run` の終了コードが 0 になるため、成否は出力で確かめてください）、原因を直して再実行すると続きから写します。環境変数が無いか同じ名前なら終了コード 2 です。件数が合わないときは旧テーブルを消さず、切り戻す（`docs/design/rollback-runbook.md`「状態テーブルと申請テーブルへの分割の切り戻し」）か、原因を調べてください。

## 登録済みで紐づいていないロールの紐づけ（Issue #135、一度だけ）

**既存のロールは取り込み直されません。** Issue #135 より前に登録したロールの割り当ては、マトリクスで作った記録のままです。信頼ポリシーと記録を合わせ直すには、未反映のチェックを反映するか破棄し、ロールを削除して、登録し直します（削除のときに、未反映のチェックは削除されます）。割り当てを消さずに、乖離したユーザだけを信頼ポリシーの現状に合わせるなら、「記録を IAM に合わせる」も使えます（`docs/guide/managed-roles.md` の「信頼ポリシーの乖離を直す」。Issue #172 により 2026-10-16 追記）。Issue #135 より前に、ロールの紐づけを外していた登録済みのロールは、一覧の末尾に出て、マトリクスの列には出ず、割り当ての保存は 409 になります。削除して登録し直すと、列になります。紐づけを外していたロールをまとめて紐づけるには、反映の直後に一度だけ、次の移行スクリプトを使います（Issue #135 により 2026-10-07 追記。登録と同じ書き込みで、信頼ポリシーの取り込みと末尾への紐づけを行います。何度実行しても同じ結果になり、すでに紐づいたロールには触れません。信頼ポリシーを読めないロールは、何も書かずに列挙し、終了コード 1 になります）。

```bash
export ROLUST_STATE_TABLE_NAME="$(terraform -chdir=infra output -raw state_table_name)"
export ROLUST_CHANGE_REQUEST_TABLE_NAME="$(terraform -chdir=infra output -raw change_request_table_name)"
export ROLUST_MANAGED_TAG_KEY=<managed_tag_key> ROLUST_MANAGED_TAG_VALUE=<managed_tag_value>   # infra/terraform.tfvars の値
export ROLUST_POOL_ID=<pool_id> ROLUST_DEPLOY_ACCOUNT_ID=<Rolust をデプロイしたアカウント ID>
export MSYS_NO_PATHCONV=1                                                   # Git Bash で、/ で始まる値がパスに変換されるのを防ぐ
export ROLUST_ALLOWED_ACCOUNT_IDS_PARAMETER="$(terraform -chdir=infra output -raw allowed_account_ids_parameter_name)"   # 未登録の IAMユーザを取り込むとき（許可リストに無いアカウントのユーザは取り込まれません。Issue #139）
npm run migrate:link-registered-roles --workspace @rolust/api             # dry-run（何も書き込まない）
npm run migrate:link-registered-roles --workspace @rolust/api -- --apply  # 書き込む
npm run migrate:link-registered-roles --workspace @rolust/api             # 「書く対象はありません」になることを確かめる
```
