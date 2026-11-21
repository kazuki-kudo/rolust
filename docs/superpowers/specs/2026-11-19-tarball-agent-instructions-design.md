# tarball 利用者向けのエージェント指示書（Issue #262）

## 意図

Release の tarball でデプロイする利用者が、AI コーディングエージェントを使うなら、展開先のディレクトリに置かれた指示書を読ませて、**決めきれない値や分岐を利用者に質問しながら**手順書（`docs/guide/`）を進めさせたい。

リポジトリ直下の `CLAUDE.md` は開発者向け（TDD・Superpowers・保護値など）で、tarball には入らず、入れるべきでもない。利用者向けの指示書を別に用意し、tarball の直下に `AGENTS.md` と `CLAUDE.md` として同梱する。

依頼者の判断（2026-11-19）: 指示書は日本語 1 本。置き場所と `CLAUDE.md` の関係は、下の「採用した方針」のとおり。

## 目標・非目標・やってはいけないこと

**目標**

- tarball の直下に `AGENTS.md`（実体）と `CLAUDE.md`（`@AGENTS.md` の 1 行）が入る。
- 指示書に従うエージェントが、値を推測で埋めず、利用者に質問する。
- 破壊的操作・外部への書き込みの前に、利用者の承認を取る。
- 同梱を `build-release.sh`・`check-release.sh`・`release.test.sh` が担保する。

**非目標**

- 指示書の英語版。エージェントは利用者の言語で応答でき、英語の利用者には `docs/guide/en/` を読ませる。
- Codex・Copilot・Kiro での実測。Claude Code の 1 経路だけを実測する（ほかは調査結果の二次情報。Issue の表のとおり）。
- ツール専用の指示ファイル（`.github/copilot-instructions.md`・`.kiro/steering/`）。
- 手順書の改訂。指示書は手順書の内容を複製せず、指す。
- エージェントに `terraform apply` を自律実行させる仕組み。承認を取ってから実行させるだけ。

**やってはいけないこと**

- 指示書が手順書の写しになること（手順が変わると乖離する）。
- 開発者向けの `CLAUDE.md` が tarball に入ること。
- 利用者の資格情報・パスワードを、エージェントが会話で受け取る・生成する・ファイルに書くこと。

## 制約

- 保護値（アカウント ID・CloudFront の DNS 名・IP・会社ドメイン・作者メール）を指示書に書かない（検査は既存の `protected-values-guard.sh` が全追跡ファイルに対して走る）。
- `docs/guide/` の英語版は 3 本だけ。指示書は英語版を持たず、`guide-parity.sh` の対象外。
- 展開先の `.sh`・テンプレートは LF（`.gitattributes` で固定済み）。新しい 2 本も LF で出す。

## 調べたこと

- `build-release.sh` は `git ls-files … docs/guide` で追跡ファイルを作業ツリーと同じ配置で入れる。`docs/guide/` の下に指示書を置くと、tarball の `docs/guide/` にも入ってしまい、二重になる。
- `check-release.sh` は必須ファイルの存在、リポジトリとの同一性（`plan-guard.sh`・`target-roles.yaml`・`LICENSE`）、CR の混入を見る。同じ枠に載せられる。
- 質問の一覧の元は `setup.md` の手順 2〜5 と、`access-control.md`・`cross-account.md`・`users.md`。Issue の列挙にあった「ドメイン」は、`infra/variables.tf` に独自ドメインの変数が無いので、質問に入れない。

## 採用した方針

### 置き場所と生成

- 正本: `docs/tarball-agent-instructions.md`（1 ファイル）。`docs/guide` の外にあるので、tarball に二重に入らない。名前が `AGENTS.md` でないので、開発者のエージェントが自動では読まない。
- `build-release.sh` が、この正本を tarball の直下に `AGENTS.md` としてコピーし、`CLAUDE.md` を `@AGENTS.md`（LF の 1 行）で書き出す。正本が追跡されていなければ終了コード 1。tarball に `docs/tarball-agent-instructions.md` そのものは入れない。
- `CLAUDE.md` は取り込みの 1 行にする（内容が 1 か所で、食い違わない）。symlink は Windows の展開と tar で壊れやすいので使わない。**Claude Code が取り込みを解決するかは実測で確かめる。解決しなければ、同内容の 2 本に切り替える**（依頼者と決定済みの分岐）。

### 指示書の章立て（正本の内容）

1. **役割と前提**: ここは Release の tarball の展開先（開発リポジトリではない）。利用者のデプロイを手伝う。`npm` とソースは不要。
2. **最初にやること**: 目的（新規導入・更新・アンインストール）を聞く。新規導入は `docs/guide/setup.md`、更新とアンインストールは `docs/guide/operations.md` を読み、その順序に従う。利用者が英語なら `docs/guide/en/` の版を読む。分岐は `access-control.md`・`cross-account.md`・`users.md`・`managed-roles.md` を、該当するときに読む。
3. **質問すること（推測で埋めない）**: 値ごとに、使う手順書の節を添える。全体に関わるもの（目的・認証方式・ターゲットアカウントの有無）は最初に、そのほかは必要になる直前に聞く。
   - AWS のプロファイルとリージョン（`aws sts get-caller-identity` で解決先を示し、意図したアカウントかを利用者に確かめさせる）
   - state バケット: 既にある（バケット名・リージョン）か、無い（`infra/bootstrap/`）か
   - `pool_id`（既存のデプロイの更新なら、既存と同じ値）
   - `auth_mode`（`basic` か `cognito`）、`managed_tag_key` / `managed_tag_value`（既定のままか）
   - ターゲットアカウントの有無（有れば `cross-account.md` の手順）
   - ユーザプールに登録できるアカウント ID の許可リスト（`users.md`）
   - IP アドレス制限をするか（`access-control.md`）
4. **承認を取る操作**: `terraform apply`（`infra/bootstrap/` を含む）、SSM への書き込み、IAM・CloudFormation への書き込み、ファイルの削除。実行前に、コマンドと何が起きるかを示す。apply の前に plan を見せ、`plan-guard.sh` の赤信号が出たら止まり、警告（WARN）は箇所を示して利用者に判断を仰ぐ。`terraform destroy` と `state rm` は、利用者が明示的に求めたときだけ。
5. **資格情報と値の扱い**: Basic 認証のユーザ名・パスワードは利用者が決めて自分で投入する（エージェントは生成せず、会話で受け取らない。コマンドを示す）。`terraform.tfvars` に資格情報を書かない。アカウント ID・バケット名を応答の文面に書き写さず、コミットしない（展開先を公開リポジトリに置かない）。`tfplan`・`tfplan.json` は apply の後に消す。`terraform.tfvars`・`backend.hcl` の控えを展開先の外に取ることを勧める（`setup.md` 手順 3 の注記）。
6. **環境の落とし穴**: Windows（Git Bash）の `AWS_PROFILE` / `AWS_REGION`・`MSYS_NO_PATHCONV` などは、手順書の記述に従う（指示書には書き写さない）。
7. **ずれたとき**: 手順書とエラーの内容が食い違うときは、推測で回避せず、エラーを示して利用者に相談する。手順書が正。

### 検査

- `check-release.sh`: 必須ファイルに `AGENTS.md`・`CLAUDE.md` を足す。`AGENTS.md` がリポジトリの `docs/tarball-agent-instructions.md` と同一であること、`CLAUDE.md` の内容が `@AGENTS.md` の 1 行であること（開発者向けの `CLAUDE.md` が混ざれば落ちる）、2 本に CR が無いこと、tarball に `docs/tarball-agent-instructions.md` が無いことを検査する。
- `release.test.sh`: 模擬ツリーに正本を足し、正常系（2 本が入る・内容が正しい・正本が入らない）と、1 箇所ずつ壊す異常系（`AGENTS.md` の改変・`CLAUDE.md` の改変・欠落）を足す。
- 実測（受け入れ条件）: tarball をビルドして展開し、展開先で `claude -p`（読み取りだけを許可し、AWS には触れさせない）に「セットアップを始めて」と依頼し、**最初の応答が質問であること**と、`CLAUDE.md` 経由で指示書が効いていること（取り込みの解決）を確かめる。結果は PR に件数と種類だけで書く（保護値を書かない）。

## 採用しなかった方針

- **`docs/guide/agent/AGENTS.md` に置く**: `docs/guide` の一括取り込みで二重に入る。開発リポジトリで、その下で作業するエージェントが利用者向けの指示を拾う。
- **新しい最上位ディレクトリ（`release/` など）**: 1 ファイルのために構成の説明が増える。
- **`CLAUDE.md` を同内容の 2 本にする**: Copilot が同じ内容を 2 回読む。取り込みが効かなかったときの切り替え先として残す。
- **symlink**: Windows の展開と tar で壊れやすい。

## 正本への反映

- `docs/design/cd-config.md`: 追記注記（Issue #262 により 2026-11-19 追記）。tarball に `AGENTS.md`・`CLAUDE.md` を入れること、`check-release.sh` の検査の追加。同種の tarball の内容の列挙は、plan のタスクで grep して総当たりし、同じ来歴で直す。
- `docs/design/requirements.md`: 追記しない。NFR-4（README と Terraform 一式のみで完了できる）の判定を変えず、指示書は任意の補助のため。FR・画面・IAM の ID を覆す・足すことは無い。
- 新しい ID は足さない。

## そのほかの更新（同じ PR）

- `docs/development.md` のディレクトリの表に、正本の場所と、tarball の直下に生成されることを足す。
- `docs/guide/setup.md` の経路 A（展開の手順の後）と `docs/guide/en/setup.md` に、「AI エージェントを使うなら、展開先で起動すると指示書（`AGENTS.md`）を読む」旨を 1 段落足す。見出しは増やさず、`guide-parity.sh` の対象の階層の列は変わらない。
- `CHANGELOG.md` の `## 未リリース` に、利用者向けの変更として追記する。`### 更新時にやること` は無い。
- `CLAUDE.md`（リポジトリ直下）の構成と Release の記述に、正本と生成物を 1 行足す。

## 構築者に任せること

- 指示書の本文の言い回し、質問の順序の細部。
- `release.test.sh` のケースの名前と並び。
