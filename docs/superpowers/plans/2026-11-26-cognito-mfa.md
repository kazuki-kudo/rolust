# Cognito の MFA（TOTP）を選べるようにする Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `auth_mode = "cognito"` のユーザープールに、認証アプリ（TOTP）の MFA を、変数 `cognito_mfa`（`OFF` / `OPTIONAL` / `ON`、既定 `OFF`）で選べるようにする。

**Architecture:** `infra/cognito.tf` の `mfa_configuration` を変数にし、`OFF` 以外のときだけ `software_token_mfa_configuration` を有効にする。機能プランは Lite のまま。`edge-auth`・Lambda・SPA は変えない。実 AWS の挙動（Hosted UI での登録・復旧・in-place 更新）は、使い捨てのユーザープールで実測し、結果を手順書に書く。

**Tech Stack:** Terraform（AWS provider `~> 6.0`、ロック版 6.57.1）、Cognito（Lite・classic Hosted UI）、Markdown の手順書（日英）。

**Spec:** Issue #271 と、2026-11-26 にチャットで承認された短い設計（下の「設計」節に転記。bounded な変更なので spec ファイルは作らない。`CLAUDE.md` の開発フロー）。

## 設計（承認済みの転記）

- 変数 `cognito_mfa`（string、既定 `"OFF"`、検証で `OFF`・`OPTIONAL`・`ON` 以外を弾く）。`auth_mode = "cognito"` のときだけ効く。
- `mfa_configuration = var.cognito_mfa`。`OFF` 以外のときだけ `software_token_mfa_configuration { enabled = true }`（dynamic ブロック。`OFF` で TOTP の設定を書くと provider か API が拒否しうるための判断）。
- 既定が `OFF` なので、既存の環境の plan に差分は出ない。CHANGELOG の「更新時にやること」は書かない。
- 非目標: Essentials・メール OTP・SMS・脅威保護・プラン選択の変数。Rolust 側での MFA の強制や検証（Cognito に任せる）。
- 実測は使い捨てのユーザープールで行い、本番のプールでは `ON` にしない（実管理者を締め出さないため）。

## Global Constraints

- 本文（文書・コミット・PR）は日本語。コード識別子・パス・コマンド・要件 ID は原文のまま。
- Issue 番号 #271 を、コミット・PR・文書の来歴（「Issue #271 により 2026-11-26 追記」）に含める。
- 保護値（アカウント ID・CloudFront の DNS 名・IP・会社ドメイン・作者メール）を、どのファイル・出力・PR 本文にも書かない。メールは `user@example.com` の形（`example.com`）にする。
- 正本の ID（FR-6.4 など）は変えない。追記は来歴付きで、同じ PR で行う。
- `docs/guide/access-control.md` と `docs/guide/en/access-control.md` は同じ PR で更新し、見出しの階層の列を揃える（`guide-parity.sh`）。
- Terraform・文書は TDD の例外。変更した層ごとに、機械判定（`terraform fmt -check`・`validate`・グラフ・grep・`guide-parity.sh`）で検証する。
- 既存の実資源を書き換える検証はしない。実測は新規作成のユーザープールだけで行い、終わったら破棄して、消えたことを確かめる。
- `infra/backend_override.tf` はコミットしない（`.gitignore` に無い）。使ったら必ず消す。

## Review Focus

- `cognito_mfa` に `"on"`（小文字）や `"TOTP"` を渡す → plan が変数の検証のメッセージで止まる（Task 1）。
- `auth_mode = "basic"` に `cognito_mfa = "ON"` を渡す → Cognito の資源が無く、エラーにならない（Task 1）。
- 既定の `OFF` → 既存のプールの plan が「No changes」（`software_token_mfa_configuration` のブロックが増えない）（Task 2）。
- 既に居るユーザー（MFA 未登録）を `ON` にした後 → 次のサインインで、Hosted UI が認証アプリの登録を求める（Task 2）。
- 認証アプリを失くしたユーザー → 運用者の手順で、`ON` のまま再登録まで戻れる（戻れないなら止めて依頼者に判断を仰ぐ）（Task 2）。
- MFA を通った後の ID トークンに、`edge-auth` が読む `sub`・`cognito:username`・`cognito:groups` が入っている（Task 2）。

---

## ファイル構成

| ファイル | 責務 |
|---|---|
| `infra/variables.tf` | 変数 `cognito_mfa` の定義と検証 |
| `infra/cognito.tf` | プールの `mfa_configuration` と TOTP の有効化。冒頭コメント |
| `infra/terraform.tfvars.example`・`docs/guide/setup.md`（日英） | 変数を列挙している箇所に `cognito_mfa` を足す（Task 1 の grep で特定する） |
| `docs/design/requirements.md` | FR-6.4 の追記・冒頭の追記注記・トレーサビリティの行 |
| `docs/security-review.md` | F-7 の更新 |
| `docs/guide/access-control.md`・`docs/guide/en/access-control.md` | MFA の有効化・登録・復旧の手順。「MFA は無効」の記述の訂正 |
| `CHANGELOG.md` | 未リリースの追記 |

---

### Task 1: 変数と Terraform の変更

**Files:**
- Modify: `infra/variables.tf`（`auth_mode` の変数の直後に足す）
- Modify: `infra/cognito.tf:4-5`（冒頭コメント）、`:30`（`mfa_configuration`）
- Modify: `infra/terraform.tfvars.example`・`docs/guide/setup.md`・`docs/guide/en/setup.md`（`auth_mode` を列挙している箇所。Step 1 で特定）

**Interfaces:**
- Produces: `var.cognito_mfa`（string。値は `"OFF"` / `"OPTIONAL"` / `"ON"`）。Task 2 の実測と Task 3 の文書が、この名前と値を使う。

- [ ] **Step 1: `auth_mode` を列挙している箇所を洗い出す**

Run: `grep -rn "auth_mode" infra/terraform.tfvars.example docs/guide/setup.md docs/guide/en/setup.md docs/guide/users.md README.ja.md README.md`
Expected: 変数の一覧・例に `auth_mode` が出る箇所が分かる。`cognito_mfa` を足す箇所（`auth_mode` と並べて変数を説明している箇所）だけを控える。散文の言及は足さない。

- [ ] **Step 2: 変数 `cognito_mfa` を定義する（`infra/variables.tf`）**

`type = string`、`default = "OFF"`。検証の条件は `contains(["OFF", "OPTIONAL", "ON"], var.cognito_mfa)`、メッセージは `cognito_mfa は "OFF"・"OPTIONAL"・"ON" のどれかにしてください。`。説明（heredoc、`auth_mode` の説明と同じ書式）に入れること:
- `auth_mode = "cognito"` のときだけ効く（`basic` では無視される）。
- 認証アプリ（TOTP）の MFA。`OFF`（既定。MFA なし）／`OPTIONAL`（登録したユーザーだけが MFA を使う。強制はしない。段階導入のため）／`ON`（全員が必須。未登録のユーザーは次のサインインで登録を求められる）。
- 機能プランは Lite のまま。メール OTP・SMS は扱わない。
- 手順は `docs/guide/access-control.md`。

- [ ] **Step 3: `infra/cognito.tf` を変える**

`mfa_configuration = var.cognito_mfa` にする。`OFF` 以外のときだけ有効になる `dynamic "software_token_mfa_configuration"`（`for_each = var.cognito_mfa == "OFF" ? [] : [1]`、`content { enabled = true }`）を、`mfa_configuration` の直後に足す。冒頭のコメント（4〜5 行目）の、機能プランは Lite という説明に「MFA は `cognito_mfa`（既定 `OFF`）で TOTP を選べる」を足す。

- [ ] **Step 4: Step 1 で控えた箇所に `cognito_mfa` を足す**

`terraform.tfvars.example` はコメントアウトした 1 行（既定 `"OFF"`）、`setup.md` の日英は変数の説明の 1 行（日英で同じ内容）。

- [ ] **Step 5: 機械判定で検証する**

Run（`infra/` で。`backend_override.tf` は CI の依存循環の検査と同じ手順）:

```bash
cd infra
terraform fmt -check -recursive
terraform init -backend=false -input=false >/dev/null && terraform validate
printf 'terraform {\n  backend "local" {}\n}\n' > backend_override.tf
terraform init -input=false -reconfigure >/dev/null
for mode in basic cognito; do for mfa in OFF OPTIONAL ON; do
  echo "--- auth_mode=$mode cognito_mfa=$mfa ---"
  TF_VAR_auth_mode=$mode TF_VAR_cognito_mfa=$mfa terraform graph >/dev/null && echo ok
done; done
TF_VAR_pool_id=verify TF_VAR_cognito_mfa=on terraform plan -input=false -lock=false -no-color 2>&1 | grep -c 'cognito_mfa は'
rm -f backend_override.tf .terraform/terraform.tfstate
```

Expected: `fmt` と `validate` は成功する。6 通りの組み合わせがすべて `ok`（`basic` と `ON` の組み合わせも含む）。最後の `grep -c` が `1`（小文字 `on` が検証のメッセージで拒否される）。

- [ ] **Step 6: Commit**

```bash
git add infra/variables.tf infra/cognito.tf infra/terraform.tfvars.example docs/guide/setup.md docs/guide/en/setup.md
git commit -m "feat: Cognito の MFA（TOTP）を cognito_mfa 変数で選べるようにする（Issue #271）"
```

（`Co-Authored-By` の行は、依頼されている形式でコミットメッセージの末尾に付ける。）

---

### Task 2: 使い捨てのユーザープールでの実測

**Files:**
- Create（コミットしない）: スクラッチ領域の `mfa-verify/main.tf`・補助スクリプト
- Modify: `docs/superpowers/plans/2026-11-26-cognito-mfa.md`（末尾の「実測の記録」を埋める）

**Interfaces:**
- Consumes: Task 1 の `infra/cognito.tf` の記述（プール・ドメイン・クライアント・グループ）。
- Produces: 「実測の記録」。Task 3 が手順書に書く、登録・復旧の手順と注意の根拠になる。

実測は本番の環境に触れない。`infra/` の全体（CloudFront・Lambda@Edge）は使わず、Cognito の 4 つの資源だけをスクラッチ領域の別ルートで作る。

- [ ] **Step 1: 資格情報を確かめる**

`source .local/rolust.env` の後、`aws sts get-caller-identity --profile "$AWS_PROFILE" --region "$AWS_REGION"` を実行する。失効していたら、依頼者に `! aws sso login --profile <プロファイル>` を頼み、待つ間は Step 2 を進める。アカウント ID は出力に貼らない。

- [ ] **Step 2: 検証用のルートを作る**

スクラッチ領域に `mfa-verify/main.tf` を作る。`main` の `infra/cognito.tf`（`git show main:infra/cognito.tf`）から、`aws_cognito_user_pool.admin`・`aws_cognito_user_pool_domain.admin`・`aws_cognito_user_pool_client.admin`・`aws_cognito_user_group.permission` を複写し、次を替える。
- `count` と `[0]` の添え字を外す。
- `callback_urls` を `["https://example.com/callback"]`、`logout_urls` を `["https://example.com/"]` にする。
- `domain` を `rolust-mfa-verify-<乱数 8 桁>`（`cognito` を含めない）にする。
- クライアントに `explicit_auth_flows = ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_REFRESH_TOKEN_AUTH"]` を足す（TOTP の紐づけを API で補助するため。**本番の構成には入れない**）。
- ここでは `mfa_configuration = "OFF"` のままで、`software_token_mfa_configuration` は書かない（`main` と同じ記述にする）。

Run: `terraform init && terraform apply -auto-approve`（スクラッチ領域の `mfa-verify/` で、local の state）
Expected: プール 1・ドメイン 1・クライアント 1・グループ 3 が作られる。

- [ ] **Step 3: 既定の `OFF` で差分が出ないことを確かめる（Review Focus 3）**

`main.tf` のプールの `mfa_configuration = "OFF"` の行を `infra/cognito.tf` の Task 1 の記述（`var.cognito_mfa` と dynamic ブロック）に差し替え、`variable "cognito_mfa"`（既定 `"OFF"`）を足す。

Run: `terraform plan`
Expected: `No changes.`（「Your infrastructure matches the configuration」）。差分が出たら止めて、理由を調べる。

- [ ] **Step 4: 検証ユーザーを作る**

`admin-create-user`（`--message-action SUPPRESS`、メールは `user@example.com`、`email_verified=true`）で `verify1` を作り、`admin-set-user-password --permanent` でパスワードを設定する。`viewer` グループに入れる。パスワードは乱数で作り、画面や記録に出さない。

- [ ] **Step 5: `ON` に切り替える（in-place 更新と、既存ユーザーへの影響）**

Run: `terraform plan -var cognito_mfa=ON`
Expected: プールは `update in-place`（`1 to change`）で、`0 to destroy`（Review Focus: プールとユーザーが作り直しにならない）。`replace` や `destroy` が出たら止めて、依頼者に報告する（設計の前提が崩れる）。

Run: `terraform apply -var cognito_mfa=ON -auto-approve`、続けて `aws cognito-idp list-users` で `verify1` が残っていること。
Expected: `verify1` が残っている。

- [ ] **Step 6: Hosted UI での登録とサインインを確かめる（Review Focus 4・6）**

補助スクリプト（スクラッチ領域。Python は `-I` で実行）に、次を用意する。
- RFC 6238 の TOTP（SHA-1・30 秒・6 桁）を計算する関数。
- PKCE の `code_verifier` と、S256 の `code_challenge`。

ヘッドレスの Playwright（無ければスクラッチ領域で `npx -y playwright install chromium`）で、`https://<ドメイン>.auth.<リージョン>.amazoncognito.com/oauth2/authorize?response_type=code&client_id=<クライアント>&redirect_uri=https://example.com/callback&scope=openid&code_challenge=…&code_challenge_method=S256` を開き、`verify1` でサインインする。

Expected（1）: パスワードの後に、Hosted UI が認証アプリの登録の画面を出す（画面のスクリーンショットと見出しの文言を記録する）。
- 出ない、または登録の画面でエラーになる → ここで止めて、依頼者に選択肢を添えて報告する（classic では MFA を `ON` にできない可能性。設計の前提が崩れる）。
- 秘密鍵が画面の文字として取れる → その値から TOTP を計算して入力する。取れない → ユーザーのサインインの代わりに、`InitiateAuth`（`USER_PASSWORD_AUTH`）→ `MFA_SETUP` → `AssociateSoftwareToken` → `VerifySoftwareToken`（`UserCode` は計算した TOTP）→ `RespondToAuthChallenge` で登録し、登録の画面が出たことは Expected（1）の記録に残す。

Expected（2）: 登録の後、新しいセッションで Hosted UI にサインインすると、TOTP の入力の画面が出て、計算したコードで `https://example.com/callback?code=…` に戻る。`/oauth2/token`（PKCE）で ID トークンに交換し、`sub`・`cognito:username`・`cognito:groups`（`viewer` を含む）が入っていることを確かめる（トークンの中身は記録に貼らない。claim の名前の有無だけ）。

- [ ] **Step 7: 認証アプリを失くしたユーザーの復旧を確かめる（Review Focus 5）**

`verify1` の TOTP を、運用者が外す: `aws cognito-idp admin-set-user-mfa-preference --software-token-mfa-settings Enabled=false,PreferredMfa=false`。続けて Hosted UI（または `InitiateAuth`）でサインインする。

Expected: 次のどれかを記録する。(a) 再び登録を求められる → 復旧は「運用者が無効化 → 本人が再登録」。(b) 外れた状態でトークンが出る（MFA の強制が外れる） → 注意として記録する。(c) サインインできない → `admin-delete-user` と作り直し（`verify2`）で復旧できることを確かめ、手順として記録する。

(a)〜(c) のどれでも、最終的に「運用者がどの手順で、`ON` のまま本人を戻せるか」が 1 つ以上確かめられていること。確かめられない場合は止めて、依頼者に報告する。

- [ ] **Step 8: `OPTIONAL` を確かめる**

`terraform apply -var cognito_mfa=OPTIONAL -auto-approve`（これも `update in-place`）。MFA を登録していない新しいユーザー `verify3` が、登録を求められずにサインインできること（`InitiateAuth` が直接トークンを返す）を確かめる。

- [ ] **Step 9: 破棄して、消えたことを確かめる**

破棄の前に、検証用のプールの ID を `terraform state show aws_cognito_user_pool.admin`（または `terraform output` に足した値）から控える（画面や記録には貼らない）。名前（`rolust-admins`）は本物の環境のプールと同じになりうるので、名前では探さない。

Run: `terraform destroy -var cognito_mfa=OFF -auto-approve`、続けて `aws cognito-idp describe-user-pool --user-pool-id <控えた ID>`
Expected: `ResourceNotFoundException` で終わる（検証用のプールが残っていない）。スクラッチ領域の補助ファイル・`mfa-verify/` も消す。

- [ ] **Step 10: 「実測の記録」を埋める**

この plan の末尾の「実測の記録」の各行を、結果（✓／✗と、1 行の観測）で埋める。値・ID・トークンは書かない。Step 7 の復旧の手順（コマンドの形まで）をここに書く。

- [ ] **Step 11: Commit**

```bash
git add docs/superpowers/plans/2026-11-26-cognito-mfa.md
git commit -m "docs: Cognito の MFA の実測の記録を足す（Issue #271）"
```

---

### Task 3: 正本と手順書の更新

**Files:**
- Modify: `docs/design/requirements.md`（71 行目の直後、FR-6.4 の行（347 行目）、トレーサビリティの行（499 行目））
- Modify: `docs/security-review.md:49`（F-7）
- Modify: `docs/guide/access-control.md`・`docs/guide/en/access-control.md`（「認証方式の選択」の末尾に項目 12、「Basic 認証は…」節の MFA の箇条書き）

**Interfaces:**
- Consumes: Task 1 の変数名と値、Task 2 の「実測の記録」。

- [ ] **Step 1: `requirements.md` に追記する（二層）**

- 71 行目（Issue #20 の追記注記）の直後に、冒頭の追記注記を 1 段落足す: 「**追記**（Issue #271 により 2026-11-26）: FR-6.4 の `cognito` で、MFA（認証アプリの TOTP）を `cognito_mfa` で選べるようにした。FR の ID・他の本文は変えない。」
- FR-6.4 の行の、記述の末尾（`Issue #160 により 2026-10-09 追記` の括弧の後、`| Must |` の前）に: 「`cognito` では、MFA（認証アプリの TOTP）を導入時に `cognito_mfa`（`OFF`（既定）／`OPTIONAL`／`ON`）で選べる（Issue #271 により 2026-11-26 追記。機能プランは Lite のまま）」。
- 499 行目のトレーサビリティの行に、`Issue #271`（FR-6.4 の追記）を、既存の追記の書き方に合わせて足す。

- [ ] **Step 2: `security-review.md` の F-7 を更新する**

内容を「Cognito の MFA が既定で無効（`cognito_mfa = "OFF"`）」、判断を「既定は変えない（既存の環境の挙動を黙って変えないため）。要る人は `cognito_mfa` を `ON` にできる（`docs/guide/access-control.md`。Issue #271 により 2026-11-26 更新。更新前は『Terraform で有効にできる』）」にする。「許容して残したもの」の表に置いたままにする（再提案しない扱いは変わらない）。

- [ ] **Step 3: `access-control.md`（日本語）を更新する**

「認証方式の選択」の項目 11 の後に、項目 12「**MFA（多要素認証）**」を足す。見出しは足さない。書くこと:
- `terraform.tfvars` に `cognito_mfa = "ON"` を書いて apply する（`auth_mode = "cognito"` のときだけ効く。値の意味は `OFF`・`OPTIONAL`・`ON` の 3 つ）。方式は認証アプリ（TOTP）だけ。SMS・メール OTP は扱わない（メール OTP は Essentials 以上）。
- 切り替えは in-place の更新で、プールとユーザーは消えない（Task 2 の実測）。
- `ON` にした後、既存のユーザーは**次のサインインで**登録を求められる（Task 2 の実測の文言に合わせる）。発行済みの ID トークンは期限（最大 1 日）まで有効で、その間は MFA を求められない。即時に切るなら `auth_mode` の切り替え（項目 5）。
- ユーザーが認証アプリを失くしたときの復旧手順（Task 2 の Step 7 の記録のコマンドの形）。
- `OPTIONAL` は強制ではない。登録したユーザーだけが MFA を使う（段階導入のための値）。

「Basic 認証は…」節の、`- **多要素認証は無効**です（…）` の箇条書きを、`- **多要素認証は既定で無効**です（\`cognito_mfa = "OFF"\`）。有効にする手順は、上の「認証方式の選択」の 12 です。`に直す。ユーザープランが Lite で脅威保護が使えないという次の箇条書きは、変えない。

- [ ] **Step 4: `access-control.md`（英語）を同じ内容で更新する**

項目 12 と、`**multi-factor authentication is disabled by default** (\`cognito_mfa = "OFF"\`). See item 12 of "Choosing an authentication method" above for how to enable it.` を同じ位置に入れる。

- [ ] **Step 5: 機械判定で検証する**

Run:

```bash
./.github/scripts/guide-parity.sh
grep -rn 'mfa_configuration = "OFF"' docs/ ; grep -rn "cognito_mfa" docs/ infra/ | wc -l
./.github/scripts/protected-values-guard.sh
```

Expected: `guide-parity.sh` が 0 で終わる。`mfa_configuration = "OFF"` の旧い記述が、`docs/guide/` と `docs/security-review.md` に残っていない（来歴の引用として残る箇所は、その旨が書かれたものだけ）。`cognito_mfa` が infra・手順書・設計・security-review に出る。保護値の検査が 0 で終わる。

- [ ] **Step 6: Commit**

```bash
git add docs/design/requirements.md docs/security-review.md docs/guide/access-control.md docs/guide/en/access-control.md
git commit -m "docs: Cognito の MFA の手順と、FR-6.4・F-7 を更新する（Issue #271）"
```

---

### Task 4: CHANGELOG と push 前の検査

**Files:**
- Modify: `CHANGELOG.md`（`## 未リリース` の下）

- [ ] **Step 1: CHANGELOG に追記する**

`## 未リリース` の下に `### 変更` を作り、次の内容の 1 項目を足す（`### 更新時にやること` は書かない。既定が `OFF` で差分が出ないため）: Cognito の MFA（認証アプリの TOTP）を、変数 `cognito_mfa`（`OFF`（既定）／`OPTIONAL`／`ON`）で選べるようにした（Issue #271）。既存の環境の plan に差分は出ない。`ON` にすると、管理者は次のサインインで認証アプリの登録を求められる。手順と、認証アプリを失くしたときの復旧は `docs/guide/access-control.md`。機能プランは Lite のまま（メール OTP の MFA は Essentials 以上で、対象外）。

- [ ] **Step 2: ローカル CI を全部走らせる**

Run: `./.github/scripts/ci-local.sh`
Expected: 7 ジョブが PASS（`SKIP` は理由を確かめ、`terraform`・`docs` 系の SKIP を残さない）。赤があれば直して再実行する。

- [ ] **Step 3: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: 変更履歴に cognito_mfa を足す（Issue #271）"
```

- [ ] **Step 4: push と PR は、依頼者に確認してから行う**

確認が取れたら `git push -u origin feat/271-cognito-mfa` の後、PR 本文を `./.github/scripts/protected-values-guard.sh text <file>` にかけて 0 であることを確かめてから `gh pr create`（本文に `Issue #271`、検証の結果は件数と種類だけ。本文の末尾に、依頼されている形式の生成の行を付ける）。

---

## 実測の記録

Task 2 の Step 10 で埋める（✓／✗と 1 行の観測。値・ID・トークンは書かない）。

| # | 確かめること | 結果 |
|---|---|---|
| 1 | 既定の `OFF` で既存のプールに差分が出ない（Step 3） | |
| 2 | `OFF` → `ON` が in-place 更新で、プールとユーザーが残る（Step 5） | |
| 3 | `ON` にした後、既存のユーザーが Hosted UI で登録を求められる（Step 6・1） | |
| 4 | 登録後、Hosted UI で TOTP を入力してサインインできる（Step 6・2） | |
| 5 | MFA を通った ID トークンに `sub`・`cognito:username`・`cognito:groups` がある（Step 6・2） | |
| 6 | 認証アプリを失くしたユーザーを運用者が復旧できる。手順（Step 7） | |
| 7 | `OPTIONAL` で、未登録のユーザーが登録を求められずにサインインできる（Step 8） | |
| 8 | 検証用のプールを破棄し、消えたことを確かめた（Step 9） | |
