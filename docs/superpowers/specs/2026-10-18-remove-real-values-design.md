# 実値をコード・文書から除き、個人設定を分離する（Issue #176）

日付: 2026-10-18 / 関連: #11（OSS 公開の準備）・#177（混入防止。本 Issue の後）・#178（README の内容の文書分割）・#182（新リポジトリへの移行）

> **追記（Issue #176 により 2026-10-18。plan の作成時の訂正）**: アカウント ID を含むファイルは 6 ではなく **7** である。`packages/api/src/integration/change-request-claim.integration.test.ts` の 63 行目（存在しないロールの ARN）にも実 ID が 1 件ある。Issue の一覧にも、本文の §1・§3.2 にも無かった。本文は書き換えず、ここで訂正する。
>
> - §1「現状」: アカウント ID を含むファイルに、上のファイルを加える（7 ファイル）。
> - §3.2 の最後の項目「`change-request-claim.integration.test.ts` は…変えない」は誤り。このファイルの ARN の実 ID も、§3.3 の架空 ID（`plan-clean.json` のもう一方の ID と同じ `444455556666`）に置換する。環境変数やプロファイルの扱いは、記載どおり変えない。
> - 見つけた方法: 実在 ID の集合を統合テストの既定値と `plan-clean.json` から作り、その集合を持ち越す木全体で探した（ID は出力に出さず、ファイル名だけを見た）。
>
> **追記（Issue #176 により 2026-10-18。最終レビューによる、上の訂正の訂正）**: 上の訂正は誤りだった。`change-request-claim.integration.test.ts` の 63 行目と、`plan-clean.json` の 1 件の値は、実在の ID ではなく、全桁が同じ数字のダミーだった（実在の ID は 2 種類）。アカウント ID を含むファイルは、Issue と §1 のとおり **6** である。§3.2 の最後の項目（`change-request-claim.integration.test.ts` は変えない）が正しく、このファイルは変えない。`plan-clean.json` のダミーも元の値に戻した。誤りの原因は、実在 ID の集合を「統合テストの既定値と `plan-clean.json` に現れる 12 桁の全部」から作り、値の形（ダミーかどうか）を確かめなかったことである。

## 1. 目的と背景

#11 の方針により、Rolust は新規の公開リポジトリへ移る。移す木から「守る対象」を除き、あわせて、フォークした開発者に特定のプロファイル名・アカウントを強制しない。

**守る対象**（コード・履歴・Issue・PR・コメント・コミットメッセージのどこにも出さない）: AWS アカウント ID、CloudFront の DNS 名、自宅の IP アドレス、会社ドメイン、作者メール。**実値はこの spec にも書かない。**

### 現状（持ち越す木 = `aidlc/` と `docs/superpowers/plans/` を除く木。2026-10-18 に実測）

- アカウント ID を含むファイル 6: `.github/scripts/plan-guard.test.sh`、`.github/scripts/testdata/plan-clean.json`（実 plan の写しで、バケット名・Lambda ARN にも入る）、`docs/design/cicd-pipeline.md`、統合テスト 2 本（`?? "<ID>"` の既定値）、`packages/api/src/migrations/link-registered-roles.test.ts`
- 会社ドメインを含むファイル 4: 統合テスト 2 本（テスト用 IAM ユーザ名）、`packages/core/src/arn.test.ts`、`packages/core/src/trust-import.test.ts`
- 自宅 IP・CloudFront の DNS 名: 持ち越す木には無い
- プロファイル名（`jump-admin`・`dev1-admin`）の強制: 統合テストの既定値、`.claude/rules/`（`shell-and-aws-cli.md`・`aws-infra.md`）、`docs/design/cicd-pipeline.md`。`README.md` には無い

### 受け入れの観点

- 持ち越す木に、守る 5 種のうち本 Issue の対象（アカウント ID・会社ドメイン）が残らない（機械判定）。
- `npm run test`・`./.github/scripts/plan-guard.test.sh` が緑のまま。
- 統合テストは、必須の環境変数が無ければ理由を示して失敗し、**期待と違うアカウントには書き込まない**。
- `.local/` の雛形があり、`.claude/settings.local.json` の `env` で `AWS_PROFILE` を渡せるかが実測で決まっている。

## 2. 決定

| ID | 論点 | 決定 | 根拠 |
|---|---|---|---|
| D-1 | 書き込み前の安全装置 | **期待アカウント ID を環境変数で明示させ、STS `GetCallerIdentity` と照合する**。不一致なら何も書かずに失敗する | 依頼者の決定（2026-10-18。選択肢: ID を明示して照合・プロファイル名だけ渡して許可タグで確かめる）。根拠: 既存の変数名を活かせて変更が小さい。ID を人が一度入力するので、プロファイルの書き間違いも拾える。タグ方式は既存ロール 3 本への作業と `iam:ListRoleTags` の権限が要る |
| D-2 | 環境変数名 | `JUMP`→`DEPLOY`、`DEV1`→`TARGET1`。`ROLUST_INTEGRATION_{DEPLOY,TARGET1}_{PROFILE,ACCOUNT}` | 依頼者の指定（2026-10-18。`TARGET1_ACCOUNT` の例）。README の用語（デプロイ先・ターゲット）に合わせ、依頼者固有の名前（JUMP・DEV1）を除く |
| D-3 | 既定値 | プロファイル・アカウントともに**既定値を持たない**。`ROLUST_INTEGRATION=1` で未設定なら失敗 | Issue の目的。既定値が実値の置き場になっていた |
| D-4 | テスト用 IAM ユーザ | `test1@example.com`〜`test3@example.com` に改め、**デプロイ先に事前に作る前提**とする（テストは作らない） | 依頼者の決定（2026-10-18。選択肢: 事前に作る・テストが作成削除する）。根拠: 変更が小さく、作成直後のユーザを信頼ポリシーに書いて拒否される結果整合の不安定が出ない。依頼者は 15 ユーザを作るが、残りはマトリクス画面のスクロール確認用で、統合テストは 3 ユーザだけを使う |
| D-5 | 検証用ロールの名前 | `jump_role_sw_rolust_a` などは**固定のまま**にする | ロールは改名できず、固定なら前提を「この名前で用意する」と書ける。オーナー専用か第三者も用意できるかの明記は #178 の文書（本 spec は前提の列挙まで） |
| D-6 | 個人設定の置き場 | `.local/` を gitignore し、`.local/*.example`（値が空）だけコミットする | 導出: `*.tfvars.example` と同じ流儀（`.gitignore` の `!*.tfvars.example`）。`.env` は `aws` も `terraform` も自動では読まないので使わない |
| D-7 | 過去の spec のプロファイル名 | **触らない** | プロファイル名は守る対象ではなく、spec は過去の記録。一般化の対象は、いま読まれる `.claude/rules/` と `docs/design/` |

## 3. 設計

### 3.1 統合テストの共通処理 `packages/api/src/integration/support.ts`

2 ファイルに重複している `withProfile` と、新設する検査をここへ寄せる（`*.integration.test.ts` ではないので、Vitest の既定の設定が拾い、ユニットテストの対象になる）。

- `requireIntegrationEnv(names, env)`: 未設定の変数を**すべて**列挙して例外にする。メッセージに `.local/rolust.env.example` への案内を含める。
- `assertCallerAccount(profile, expectedAccount)`: `withProfile(profile)` の下で STS `GetCallerIdentity` を呼び、`Account` が期待と一致しなければ、プロファイル名と期待 ID を示して例外にする。STS が失敗したときも例外（握りつぶさない。ログイン失効はここで分かる）。
- `withProfile`: 既存の挙動のまま移す（`AWS_PROFILE` を差し替えて `resetIamClient()`）。

`@aws-sdk/client-sts` を `packages/api` の devDependency に足す（他の AWS SDK と同じ系列。`npm audit --audit-level=high` で確認）。

### 3.2 統合テスト 3 本

- `real-iam.integration.test.ts`: `DEPLOY_*` と `TARGET1_*` の 4 変数を必須とする。`beforeAll` の**先頭**（退避より前）で、両プロファイルのアカウントを照合する。
- `drift-repair.integration.test.ts`: `DEPLOY_*` の 2 変数を必須とする。`beforeAll` の先頭（検証用ロールの作成より前）で照合する。
- 両ファイルとも、`RUN` が偽のときは変数の検査も STS も呼ばない。定数（`ROLE_A` など）の計算が落ちないよう、スキップ時はダミーの架空 ID（`111122223333`）を使う。
- ヘッダの「前提」に、必要なロール・ユーザ・権限を列挙する。ユーザ名は `test1@example.com`〜`test3@example.com`。
- `change-request-claim.integration.test.ts` は、実値も既定のプロファイルも持たない（`AWS_PROFILE` を使う）ので変えない。

### 3.3 実値の置換

| 対象 | 置換 |
|---|---|
| `link-registered-roles.test.ts`、`plan-guard.test.sh`、`plan-clean.json` | 実 ID を架空 ID に。2 つ必要な箇所は `111122223333` と `444455556666`。**実 ID ごとに 1 対 1 の対応**にして、plan-guard が比較する同一性（同じ ID・異なる ID）を保つ。置換は、実値を出力に出さないスクリプトで行う |
| `cicd-pipeline.md` のポリシー例 | `<ACCOUNT_ID>`・`<TERRAFORM_STATE_BUCKET>` などのプレースホルダ |
| `arn.test.ts`、`trust-import.test.ts` の会社ドメイン | `example.com` |

### 3.4 個人設定

- `.gitignore`: `/.local/*` と `!/.local/*.example` を足す。
- `.local/rolust.env.example`: 値が空の `AWS_PROFILE`・`AWS_REGION`・統合テストの 6 変数（`DEPLOY`・`TARGET1` の PROFILE・ACCOUNT のほか、`MANAGED_TAG_KEY`・`MANAGED_TAG_VALUE`）。使う人は `source .local/rolust.env`。
- Claude Code: `.claude/settings.local.json` の `env` に `AWS_PROFILE` を書き、Bash ツールの環境に渡るかを**実測**する（plan の 1 タスク）。渡るなら案内を書き、渡らなければ `source` に一本化する。

### 3.5 プロファイル名の一般化

`.claude/rules/shell-and-aws-cli.md` と `.claude/rules/aws-infra.md` の `jump-admin`・`dev1-admin` を、「自分のプロファイル（`AWS_PROFILE`）」に改める。`docs/design/cicd-pipeline.md` の `jump-admin`（3 か所）も同様。

## 4. 正本への反映

| 正本 | 変更 |
|---|---|
| `docs/design/cicd-pipeline.md` | ポリシー例の実 ID・バケット名をプレースホルダに、`jump-admin` を `AWS_PROFILE` に置換する。ID（P-1 など）は変えない。冒頭に追記注記（Issue #176 により 2026-10-18）を足し、各箇所に来歴を付ける |
| `CLAUDE.md` | テスト方針に一行足す: 統合テストの環境変数は必須で、書き込み前に STS で期待アカウントを照合する。個人設定は `.local/` |
| `docs/design/` の FR・画面・IAM の記述 | なし |
| `packages/api/TABLE-DESIGN.md` | なし |

## 5. エラーと境界

- 変数が一部だけ未設定: 未設定の名前を全部示して失敗する（1 件ずつ直させない）。
- プロファイルの SSO が失効: STS の失敗として、プロファイル名を示して失敗する。書き込みには進まない。
- DEPLOY と TARGET1 に同じ ID を渡した: 各々は STS と一致するが、前提（2 アカウント）に反する。`requireIntegrationEnv` の後に、2 つの ID が異なることも検査する。
- スキップ時（`ROLUST_INTEGRATION` が 1 でない）: 変数も STS も見ない。通常の `npm run test` は変わらない。

## 6. 範囲外

- 混入を防ぐ検査と規約（#177）。
- 利用者向け README・利用者向けの前提文書（#178・#179）。統合テストの前提は、ヘッダの列挙までにとどめる。
- 過去の spec の `jump-admin`（D-7）。
- **持ち越さない plan への参照**: 持ち越す木の `README.md`・`CLAUDE.md`・`docs/design/` の 4 文書・`packages/core/src/messages/en.ts`・統合テスト 2 本のヘッダが、持ち越さない `docs/superpowers/plans/` を参照している。#182 の移行で参照切れになる。#176 では直さず、#182 に書き残す（人間の判断が要る: 手順書を spec や文書へ起こすか、参照を外すか）。

## 7. テスト方針

- `support.ts` はアプリコードなので TDD。失敗するテストを先に書く。STS は `aws-sdk-client-mock` で差し替え、次を確かめる: 未設定の変数をすべて列挙する・一致で通る・不一致で例外・STS の失敗で例外・`withProfile` が `AWS_PROFILE` を戻す・DEPLOY と TARGET1 が同じ ID なら例外。
- 置換: `plan-guard.test.sh`・`npm run test` が緑であること。守る対象が残らないことは、実値を出力に出さない grep（旧 ID の一覧を作らず、架空 ID の許可リスト以外の 12 桁・会社ドメインを探す）で確かめる。
- モックは外部サービスが拒否する状態を再現できない。統合テストの契約変更は実測で確かめる: 依頼者がユーザ 3 本を作った後、実 AWS で統合テストが緑になること（退避・復元・一致確認は既存のまま）。誤アカウントの照合は、わざと違う ID を渡して、書き込み前に落ちることを確かめる（CloudTrail に `UpdateAssumeRolePolicy` が無いこと）。
- push 前: `gitleaks git . --no-banner --redact --exit-code 1`、`npm audit --audit-level=high`（依存を変えるため）。`infra/`・`cloudformation/` は変えない。
- 依頼者が実測を引き取れる手順書（ユーザの作成、`.local/rolust.env` の作り方、統合テストの実行、誤アカウントの確認）を plan に含める。
