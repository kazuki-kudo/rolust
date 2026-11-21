# Basic 認証の SecureString を Terraform の管理から外す 実装計画（Issue #266）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `aws_ssm_parameter.basic_auth` を Terraform の管理から外し、state・plan に Basic 認証の復号値を入れない。既存環境は、パラメータを消さず管理画面を閉じずに移行できる。

**Architecture:** リソースを削除し、`removed { destroy = false }` を恒久的に残す。Lambda@Edge の IAM は ARN を文字列で組む（参照にしない）。`packages/edge-auth` は既に取得失敗を 503 にするので、`ParameterNotFound` を回帰テストで固定するだけで足りる。plan-guard の R-8 から `basic_auth` を外す。

**Tech Stack:** Terraform（`>= 1.10.0`）、TypeScript（Vitest・`aws-sdk-client-mock`）、bash + jq（plan-guard）、Markdown。

**Spec:** `docs/superpowers/specs/2026-11-21-basic-auth-outside-terraform-design.md`

## Global Constraints

- 本文（コミット・文書・PR）は日本語。識別子・パス・コマンド・FR の ID は原文のまま。FR・GI などの正本の ID は変えない。
- 保護値（アカウント ID・CloudFront DNS 名・IP・メール）を、どこにも書かない。投稿前に `./.github/scripts/protected-values-guard.sh text <file>` を通す。
- 正本の訂正・追記には「Issue #266 により 2026-11-21 追記（または訂正）」の来歴を付ける。同種の古い記述は grep で総当たりする。
- `removed` ブロックは**残し続ける**。`--overwrite` は投入コマンドに残す。R-8 に新しい規則は足さない。
- 文書は、日英 3 本（`setup.md`・`access-control.md`・`cross-account.md`）のうち変えたものを、日本語版と英語版で同じ PR で更新する。`./.github/scripts/guide-parity.sh` が通ること。
- コミットメッセージの末尾に `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`。ブランチは `feat/266-basic-auth-outside-terraform`（作成済み）。
- 各コミットの前に、変更した層の検査を走らせる（Task ごとに記す）。

## Review Focus

1. パラメータが無い状態（`ParameterNotFound`）の後に作成されたら、5 分待たずに通る（失敗をキャッシュしない）。→ Task 1
2. `auth_mode = "cognito"` では、`basic-auth` を読まない（パラメータが無くても通る）。→ Task 1
3. 手動投入した値が `:` を含まない、または空のとき 503（既存の挙動。実在するテストを壊さない）。→ Task 1
4. `basic_auth_parameter_name` を既定値から変えた環境でも、IAM の Resource の ARN がその名前から組まれる。→ Task 3
5. 版を飛ばして更新した環境でも、`basic_auth` が destroy されない（`removed` を残す）。→ Task 3・Task 4（CHANGELOG の文面）

---

### Task 1: `ParameterNotFound` で fail closed のテスト

**Files:**
- Modify: `packages/edge-auth/src/index.test.ts`（`describe("Lambda@Edge の Basic 認証（FR-6.1）"` の中、141 行付近の「SSM から取得できない場合」の直後。cognito の節は 457 行付近の既存の describe）

**Interfaces:**
- Consumes: 既存の `ssmMock`、`CREDENTIALS_PARAMETER_NAME`、`handler`、`event(header?)`、`asResponse`、`mockCredentials(value)`、`VALID_HEADER`（同ファイル内。実物を読んで使う）。
- Produces: なし（実装は変えない）。

- [ ] **Step 1: テストを書く。** 次の 3 本。
  - `"エッジケース: 資格情報のパラメータが無い（ParameterNotFound）なら通さず 503（fail closed。Issue #266）"`: `ssmMock.on(GetParameterCommand, { Name: CREDENTIALS_PARAMETER_NAME }).rejects(Object.assign(new Error("not found"), { name: "ParameterNotFound" }))`。`console.error` を `vi.spyOn` で抑える。正しい `VALID_HEADER` で `status` が `"503"`。
  - `"パラメータが作られたら、待たずに通る（失敗をキャッシュしない。Issue #266）"`: 1 回目は上と同じで 503。同じテストの中で、続けて `mockCredentials` で有効な値に差し替え、2 回目に `VALID_HEADER` で `toMatchObject({ uri: "/", method: "GET" })`。キャッシュのリセットの仕方は、同ファイルの既存のテスト（297〜309 行付近の許可リストの再取得）に倣う。
  - cognito の既存の describe に `"cognito では basic-auth を読まない（パラメータが無くても動く。Issue #266）"`: `auth-mode` を `cognito` にして、`basic-auth` を `ParameterNotFound` にしても、未認証のリクエストが 503 でなく 302 になり、`ssmMock.commandCalls(GetParameterCommand, { Name: CREDENTIALS_PARAMETER_NAME })` が 0 件。既存の cognito のテストの準備（auth-cognito のモック）を流用する。
- [ ] **Step 2: 実行する。** `cd packages/edge-auth && npx vitest run src/index.test.ts`。**3 本とも PASS** する（取得失敗を 503 にする実装が既にあるため、回帰テストになる）。
- [ ] **Step 3: テストが実際に落ちうることを確かめる（変異）。** `packages/edge-auth/src/providers/basic.ts` の `return serviceUnavailable();` を一時的に `return request;` に変え、1 本目が FAIL することを確かめて、**元に戻す**（`git diff packages/edge-auth/src/providers` が空）。
- [ ] **Step 4: 検査して commit。** `npm run lint`・`npm run typecheck`・`npx vitest run`（`packages/edge-auth`）が緑。`git add packages/edge-auth/src/index.test.ts` して、メッセージ「test: 資格情報のパラメータが無いときの 503 を固定する（Issue #266）」でコミットする。

---

### Task 2: plan-guard から `basic_auth` を外す

**Files:**
- Modify: `.github/scripts/plan-guard.sh:548` 付近（R-8）、`.github/scripts/plan-guard.test.sh`（68 行の `SSM`、328〜330 行の R-8、413 行付近のコメント）、`.github/scripts/testdata/plan-clean.json:182` 付近
- Test: `./.github/scripts/plan-guard.test.sh`

**Interfaces:**
- Produces: `plan-guard.sh` の R-8 は `aws_ssm_parameter.ip_allowlist` と `aws_ssm_parameter.allowed_account_ids` だけを見る。`$impact` の else 枝（資格情報の文面）は消す。

- [ ] **Step 1: 先にテストを変える（赤にする）。**
  - `plan-clean.json` の `aws_ssm_parameter.basic_auth`（`no-op`）のエントリを、`actions: ["forget"]` で `before` だけを持つ形（`after` は `null`、`after_unknown` は `{}`）に差し替える。移行の plan の実形（実測済み: `terraform show -json` が `["forget"]` を出す）。
  - `plan-guard.test.sh` の `SSM` の定義と、`"R-8 value に差分が出る"` の 1 本を削除する。見出し `echo "== R-8 ..."` は「R-8 SSM の許可リスト・許可アカウントが Terraform に上書きされる」に直す。
  - 追加: `assert "basic_auth を管理から外す plan（forget）は緑（Issue #266）" 0 "赤信号 0 件" '.'`（fixture が既に `forget` を持つので、変異なしの 1 本目と同じ入力だが、意図を名前で残す）。もう 1 本: `basic_auth` に `["update"]` と値の差分を作っても、R-8 が出ない（`removed` を外した状態への警告は足さない、という決定を固定）。`jq` の変異は `forget` のエントリの `.change.actions = ["update"] | .change.before.value = "x" | .change.after.value = "y"`。
  - 413 行付近の「ignore_changes の無い SSM パラメータで guard が落ちない」の説明に `basic_auth` の名指しがあれば、`ip_allowlist` に直す。
- [ ] **Step 2: 実行して赤を確かめる。** `./.github/scripts/plan-guard.test.sh`。`basic_auth` の `update` を R-8 が拾っているので、追加した 2 本目が FAIL する。
- [ ] **Step 3: `plan-guard.sh` を直す。** R-8 の `select(...)` から `is_addr("aws_ssm_parameter.basic_auth") or` を除き、`$impact` の else 枝（「実運用の資格情報がプレースホルダで上書きされる」）を `allowed_account_ids` の枝に統合する（`if ip_allowlist … else <allowed_account_ids の文面>`）。R-8 のコメント行も「許可リスト・許可アカウント」に直す。
- [ ] **Step 4: 実行して緑を確かめる。** `./.github/scripts/plan-guard.test.sh`（jq が要る）が全 PASS。
- [ ] **Step 5: commit。** メッセージ「fix: plan-guard の R-8 から basic_auth を外す（Issue #266）」。

---

### Task 3: Terraform の変更

**Files:**
- Modify: `infra/edge-auth.tf`、`infra/outputs.tf`、`infra/bootstrap/main.tf:41` 付近のコメント、`infra/variables.tf:40`（description に「Terraform の管理外。`put-parameter` で作る」を追記。名前を変える注意はそのまま）

**Interfaces:**
- Consumes: `var.basic_auth_parameter_name`、`local.partition`、`local.account_id`（`auth_cognito` の Resource が既に使っている）。
- Produces: 出力 `basic_auth_parameter_name`（`var.basic_auth_parameter_name`）、`set_basic_auth_command`（変数から組む）。

- [ ] **Step 1: `infra/edge-auth.tf` を直す。**
  - `aws_ssm_parameter.basic_auth` のリソースと、その直前のコメントを削除する。代わりに同じ位置へ、`removed { from = aws_ssm_parameter.basic_auth  lifecycle { destroy = false } }` と、残す理由のコメントを置く: Basic 認証の資格情報は Terraform の管理外で、利用者が `aws ssm put-parameter` で作る（state・plan に復号値を入れないため。Issue #266）。ブロックは**消さない**（旧版の state が残る環境で、パラメータが destroy されて管理画面が閉じるのを防ぐ）。
  - `edge_auth_ssm` の `ReadCredentials` の Resource を `"arn:${local.partition}:ssm:us-east-1:${local.account_id}:parameter${var.basic_auth_parameter_name}"` にする。`ReadAuthCognito` のコメントに倣い、理由（Terraform が管理しないので参照できない。参照が無くなっても ARN は同じ文字列）を 1〜2 行で書く。
- [ ] **Step 2: `infra/outputs.tf` を直す。** `basic_auth_parameter_name` の value を `var.basic_auth_parameter_name` に。description は「Basic 認証の資格情報を作る SSM パラメータ名（us-east-1。Terraform の管理外）」。`set_basic_auth_command` は `--name '${var.basic_auth_parameter_name}'` にし、description を「apply の後に実行する、資格情報を作るコマンド（`auth_mode = "basic"` のとき。更新も同じコマンドで、`--overwrite` は作成と更新の両方に効く）」に直す。`export MSYS_NO_PATHCONV=1` の行は残す。
- [ ] **Step 3: コメントを直す。** `infra/bootstrap/main.tf` の SSE-KMS のコメント（「`terraform plan` / `refresh` は `aws_ssm_parameter.basic_auth`… を refresh する際に復号値を state に書き込む」）を、「Basic 認証の資格情報は Terraform の管理外で、state に入らない（Issue #266）。API Gateway の API キーの値は入る」に訂正する。
- [ ] **Step 4: 検査する。**
  - `(cd infra && terraform fmt -check -recursive && terraform init -backend=false && terraform validate)` が成功。
  - `grep -rn "aws_ssm_parameter.basic_auth" infra` は `removed` ブロックの `from` だけを返す。
  - `trivy config infra --ignorefile .trivyignore.yaml --severity CRITICAL,HIGH --exit-code 1`（Trivy 0.73.0。無ければ `ci-local.sh` の仕組みで取得する）が 0 で終わる。
  - 実 AWS の plan は、最終タスクで依頼者が行う（CD は無い）。
- [ ] **Step 5: commit。** メッセージ「feat: Basic 認証の SecureString を Terraform の管理から外す（Issue #266）」。

---

### Task 4: 手順書・設計文書・CHANGELOG

**Files:**
- Modify（利用者向け）: `docs/guide/setup.md`、`docs/guide/en/setup.md`（日英を同時）、`docs/guide/limitations.md`、`docs/guide/access-control.md` と `docs/guide/en/access-control.md`（「Basic に戻す」の項目。`basic-auth` の値は Terraform の管理外なので、そのまま残る旨に直す）、`CHANGELOG.md`
- Modify（設計の正本）: Spec の「正本への反映」の一覧のとおり。`docs/design/requirements.md`（FR-6.1 の手段の節）、`iam-policy-design-note.md`（3.7、3.8 の表に `basic-auth` の記述があれば）、`cicd-pipeline.md`（290・451・533 行付近）、`cd-config.md`（101 行付近）、`deployment-strategy.md`（139・166 行付近）、`rollback-runbook.md`（93・191 行付近）、`docs/runbooks/cross-account-roles.md`（139 行付近。`basic-auth` を読む手順があるなら、値の取り方はそのままで足りるか確かめる）

**Interfaces:**
- Consumes: Task 3 の出力 `set_basic_auth_command`（`--overwrite` を持つ）。

- [ ] **Step 1: `setup.md`・`en/setup.md` の「認証の準備」を直す。** 見出しを「資格情報を作る」にし、「SSM パラメータの値は Terraform の管理外」の段落を「パラメータは Terraform が作らない。**作るまで管理画面は閉じたまま**（`packages/edge-auth` が `ParameterNotFound` を 503 にする。fail closed）」に書き換える。`set_basic_auth_command` の説明、コマンド（`--overwrite` は残す）、Git Bash の注意、5 分のキャッシュはそのまま。「作成と更新は同じコマンド」を 1 文足す。手順 6 の「動作を確認する」の記述（資格情報を入れる前は 503）が、文面として合っていることも確かめる。
- [ ] **Step 2: `limitations.md` を直す。** 「Terraform の state に機微情報が入る」の節を、①Basic 認証の資格情報（SSM の SecureString）は Terraform が管理しないので state にも plan にも入らない、②入るのは `aws_api_gateway_api_key` の値だけ、という構成に書き換える。「plan の artifact にも復号値が入りえます」の行を、API キーに限る形に直し、「`terraform plan` が refresh のたびに復号して state に書く」という不正確な記述（`ignore_changes` では止まらない）を、削除した理由とともに正しく言い換える。「`cognito` でもプレースホルダのまま作られます」の 1 文は、「`cognito` では `basic-auth` は作らなくてよい」に直す。冒頭に追記の注記（日付・Issue）を足し、各箇所に「Issue #266 により 2026-11-21 訂正」の来歴を付ける。
- [ ] **Step 3: 設計の正本を、同じ来歴で直す。** 各ファイルを読み、`basic_auth` を refresh する・復号値が state と plan に入る・プレースホルダ・`ignore_changes` で守る、という記述を、新しい構成（Terraform の管理外・`removed`・plan ロールは復号値を読まない）に訂正または追記する。plan ロールの `ssm:GetParameter` の記述は、ほかのパラメータの refresh に要るので残す。R-8 の表の行は、対象を `ip_allowlist`・`allowed_account_ids` にする。`requirements.md` の FR-6.1 の手段の節と `iam-policy-design-note.md` の 3.7 には、「資格情報は Terraform の管理外で、state に入らない」を 1 文追記する（FR の ID・本文は変えない）。最後に `grep -rn "basic_auth" docs | grep -v superpowers` の残りが、意図した記述（過去の来歴の注記・変数名）だけであることを確かめる。
- [ ] **Step 4: `CHANGELOG.md` の `## 未リリース` に追記する。** 変更の説明（Basic 認証の資格情報を Terraform が管理しない。state に入らない。新規は apply の後に `set_basic_auth_command` で作る。`auth_mode = "cognito"` では作らなくてよい）と、`### 更新時にやること`: ①`terraform plan` で `aws_ssm_parameter.basic_auth` が `forget`（state から外すだけ）で、destroy が 0 件であることを確かめてから apply する。パラメータは消えず、資格情報はそのまま使える。②`removed` ブロックは消さない（版を飛ばした環境でパラメータが消えるため）。③plan に `1 to destroy` が出たら、apply せず止める。
- [ ] **Step 5: 検査する。** `./.github/scripts/guide-parity.sh`（日英の見出しの階層の一致）と `./.github/scripts/guide-parity.test.sh`、`./.github/scripts/protected-values-guard.sh`（変更したファイルを含む全体。gitleaks 8.30.1）が通る。変更した文書の `git diff --numstat` が、意図した箇所の行数だけであること（CRLF の事故がないこと）。
- [ ] **Step 6: commit。** 利用者向け（手順書・CHANGELOG）と設計の正本を、2 つのコミットに分ける。メッセージ「docs: Basic 認証の資格情報を作る手順に改め、state の記述を訂正する（Issue #266）」と「docs: 設計の正本の Basic 認証の記述を Terraform の管理外に合わせる（Issue #266）」。

---

### Task 5: 全体の検査と PR、反映と実測の引き取り

**Files:**
- Modify: なし（検査と PR）。PR 本文に、下の「依頼者の実測の手順」を載せる（保護値を書かない）。

- [ ] **Step 1: ローカル CI。** `./.github/scripts/ci-local.sh` を 1 回だけ走らせる（二重起動しない）。SKIP が出たジョブは、`ci.yml` の固定版を取得して個別に走らせる。`infra/` を変えたので trivy、`gitleaks git . --no-banner --redact --exit-code 1`、`./.github/scripts/protected-values-guard.sh`、`npx -y npm@11 audit --audit-level=high` も（依存は変えていないが、CI の落とし穴を避けるため）。
- [ ] **Step 2: ユニットとビルド。** `npm run lint && npm run typecheck && npm run test && npm run build`。`packages/edge-auth/dist` が変わるのは、ソースを変えていないので無い。
- [ ] **Step 3: PR。** push と PR の作成は、依頼者に確認してから行う（push は聞く）。本文は `./.github/scripts/protected-values-guard.sh text <file>` に通してから投稿する。本文に、変更の要約・検証した層・下の実測の手順・`Closes #266` を書く。
- [ ] **Step 4: 依頼者の実測の手順（PR 本文・引き渡しに書く）。** 件数や種類だけを書き、実値を書かない。
  1. **既存環境の plan**: `docs/guide/operations.md` の「新しいバージョンに更新する」の手順で `terraform plan -out=tfplan` を作る。期待: `aws_ssm_parameter.basic_auth` が「no longer managed（forget）」、**destroy は 0 件**、`aws_iam_role_policy.edge_auth_ssm` に差分なし（Resource の文字列が同じため）。plan-guard が赤信号 0 件。
  2. **apply 後**: `terraform state list` に `basic_auth` が無い。`aws ssm get-parameter --with-decryption` で、パラメータが残り値が変わっていない。管理画面が閉じていない（`curl` が 401）。
  3. **新規デプロイ（実測用の別環境）**: apply 直後の `state list` に `basic_auth` が無く、`curl` が 503。`set_basic_auth_command` で作ると、5 分以内に 401（資格情報なし）／管理画面（あり）に変わる。手順書（`docs/guide/setup.md`）を、経路として上から実行して確かめる。
  4. `auth_mode = "cognito"` の新規環境で、`basic-auth` を作らずに、サインインできる。
