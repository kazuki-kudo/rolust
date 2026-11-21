# 変更履歴

版ごとに、利用者に影響する変更を書きます。取り込んだ PR の一覧は、GitHub の Releases のノート（自動生成）にあります。

- **「更新時にやること」の節は、通常の更新手順（[docs/guide/operations.md](docs/guide/operations.md)）に加えて必要な作業がある版にだけあります。** この節が無い版は、通常の手順だけで更新できます。
- 更新するときは、いま使っている版の次の版から、更新先の版までの節を読んでください。
- **v0.1.0〜v0.1.5 は、公開前の非公開のリポジトリで出した版です。GitHub の Release としては公開していません。** 公開した最初の版は v0.2.0 です。下の v0.1.x の節は、非公開の間の記録として残しています。節にある旧 Issue・PR の番号は、旧リポジトリのものです。

## 未リリース

### 変更

- Basic 認証の資格情報（SSM の SecureString。既定の名前は `/rolust/basic-auth`）を、Terraform の管理から外した（Issue #266）。`terraform plan` / `refresh` は SecureString を復号して state に平文で書き、plan ファイルにも入れる。`ignore_changes` はこれを止めない。管理から外したので、資格情報は state にも plan にも入らない（入るのは API Gateway の API キーの値だけ。`docs/guide/limitations.md`）。
  - 新しく入れるときは、`terraform apply` の後に、出力 `set_basic_auth_command` のコマンドで資格情報を作る（作成と更新は同じコマンド）。作るまで、管理画面は `503` で閉じたまま。`auth_mode = "cognito"` では作らなくてよい。
  - `infra/edge-auth.tf` の `removed` ブロックが、旧版で作った環境の state からこのパラメータを外す（パラメータは消えず、資格情報はそのまま使える）。このブロックは消さない。
  - アンインストール（`terraform destroy`）は、このパラメータを消さない。手順書（`docs/guide/operations.md`）に、削除のコマンドを足した。
  - plan-guard の R-8 は、`basic_auth` を見なくなった（IP 許可リスト・許可アカウントは従来どおり）。

### 更新時にやること

- 旧版で入れた環境（`auth_mode = "basic"` のとき、資格情報を投入済みのもの）を更新するとき、`terraform plan` に `aws_ssm_parameter.basic_auth` が「no longer managed」（plan の JSON では `forget`）として出る。**state から外すだけで、パラメータは削除されない。** 確かめること:
  - plan の末尾の destroy が **0 件**であること（`Plan: 0 to add, 0 to change, 0 to destroy`）。`1 to destroy` が出たら、apply せずに止める。
  - `aws_iam_role_policy.edge_auth_ssm` に差分が出ないこと（Resource の文字列が、旧版の参照と同じ値になる）。
- apply の後、資格情報は作り直さなくてよい（パラメータは残っている）。`terraform state list` に `basic_auth` が無く、管理画面が `401`（資格情報なし）であることを確かめる。
- 版を飛ばして更新しても、`removed` ブロックが残っているので、パラメータは消えない。`infra/edge-auth.tf` の `removed` ブロックを自分で消さない。

## v0.2.1 - 2026-11-21

### 変更

- `terraform output` が表示する SSM パラメータの投入コマンド（`set_basic_auth_command`・`set_ip_allowlist_command`・`set_allowed_account_ids_command`）の先頭に、`export MSYS_NO_PATHCONV=1` の行を足した（Issue #259）。Git Bash（Windows）で表示されたコマンドをそのまま実行すると、`/` で始まるパラメータ名が Windows のパスに変換され、`Parameter name must be a fully qualified name` で失敗していた。macOS / Linux では無害。出力文字列だけの変更で、apply しても資源の差分は出ない。手順書（`setup.md` の日英、`access-control.md` の日英、`users.md`）の注記も、実際のエラーに合わせた。
- 手順書（`docs/guide/operations.md`）のアンインストールの、state 用バケット（`infra/bootstrap/` で作ったもの）を削除する手順を直した（Issue #257）。手順 4 の後に展開先のルートへ戻る `cd ..` が無く、手順 5 の `terraform -chdir=infra/bootstrap …` が `infra/infra/bootstrap` を探して失敗していた。バケット名は `infra/backend.hcl` から読む。`infra/bootstrap/terraform.tfstate` が無い環境（新しい版へ更新したときに持ち越さなかったなど）の削除の道（古い展開先から実行する／`aws s3api delete-bucket`）を足した。更新手順の、`infra/bootstrap/` の state の持ち越しも、見落としにくい書き方に改めた。
- Release の tarball の直下に、AI コーディングエージェント向けの指示書（`AGENTS.md` と `CLAUDE.md`）を同梱した（Issue #262）。展開先で、`AGENTS.md` を読むエージェント（Claude Code は `CLAUDE.md` 経由）を起動すると、決めきれない値を推測せず質問しながら、手順書（`docs/guide/`）に沿ってセットアップを進める。`terraform apply` など AWS に書き込む操作は、実行の前に承認を求める。指示書は日本語で、エージェントは利用者の言語で応答する（`docs/guide/setup.md` の経路 A）。

## v0.2.0 - 2026-11-04

### 変更

- リポジトリを公開した。公開に伴い、版を v0.2.0 に改めた。アプリ・Terraform・API の挙動の変更はない。
- 公開したリポジトリでは、CI が `main` への push でも走る（これまでは PR と手動実行だけ）。
- Issue のテンプレート（不具合の報告、質問）を足した。通常の報告への応じ方を `CONTRIBUTING.md` に書いた。

## v0.1.5 - 2026-11-03

### 変更

- ソースから入れる経路（経路 B）で要る Node.js の下限を、20.19 から 24 に上げた（`package.json` の `engines`、`docs/guide/setup.md`）。Lambda と Lambda@Edge の実行環境、CI、Release はすでに Node 24 で、それにそろえた。Release の tarball から入れる経路 A は Node が要らず、影響しない。

### 更新時にやること

- ソースから入れている場合は、手元の Node.js を 24 以上にしてから `npm ci` と `npm run build` を実行する。

## v0.1.4 - 2026-11-03

### 変更

- クロスアカウントの手順書（`docs/guide/cross-account.md`）の英語版を、`docs/guide/en/` に追加した。Release の tarball にも入る。
- 導入の手順書（`docs/guide/setup.md`）と認証の手順書（`docs/guide/access-control.md`）の英語版を、`docs/guide/en/` に追加した。Release の tarball にも入る。日本語版が正本で、ほかの手順書は日本語のみのまま。
- 手順書（`docs/guide/operations.md`）の「新しいバージョンに更新する」を、これだけで最後まで実行できる手順に書き直した（`AWS_PROFILE` の設定や `cd infra` が抜けて失敗する問題を直した）。`terraform.tfvars` と `backend.hcl` を無くしたときの作り直し方（「設定ファイルを紛失したとき」）を足した。`setup.md` の手順 3 に、この 2 つの控えを展開先の外に取る注意を足した。
- 手順書の複数行のコマンドを、コピーして貼ったときに最後のコマンドも実行されるようにした（コードブロックの末尾に空行を足した）。
- Release の tarball に、この変更履歴（`CHANGELOG.md`）を同梱した。Release の本文は、この変更履歴の該当の節を先頭に、自動生成のノートを続けた形になる。

## v0.1.3 - 2026-11-03

### 変更

- Lambda と Lambda@Edge の実行環境を Node.js 24（`nodejs24.x`）に上げた。
- `auth_mode = "cognito"` のとき、Cognito にユーザを足すコマンド（`create_cognito_user_command`）が、一時パスワードをコマンドの中で乱数から作る形になった。
- 画面 2「IAMロール管理」の「登録を解除」が折り返されないようにした。
- 「信頼ポリシーを確認」の説明を、常時表示から「i」アイコンの吹き出しに変えた。
- 左上の ROLUST の表記を、右隣の画面名と見分けがつくように目立たせた。
- 手順書（`docs/guide/`）を直した。Cognito のユーザ作成とグループ割り当ての手順を実際の経路に合わせ、`terraform.tfvars` の雛形に、既定値と必須の変数の説明を足した。

## v0.1.2 - 2026-11-02

### 変更

- セキュリティ点検（`docs/security-review.md`）で見つかった問題を直した。Rolust 自身の実行ロールは、ロールとして登録する時点で拒否される。
- 反映先の IAM ユーザが実在しないとき、そのことが伝わる文言になった。作成した直後のユーザは、約 10 秒は拒否されることがある。
- CSV での一括登録の入力欄に、登録済みの属性名がヘッダ行として初期入力される。
- 「信頼ポリシーを確認」の説明をキャプションで足した。
- 手順書（`docs/guide/`）を直した。「削除する」をアンインストールの手順にし、`AWS_PROFILE` などの前提を追記した。

## v0.1.1 - 2026-10-19

### 変更

- 管理画面を日本語と英語で表示できるようになった。
- 登録済みの割り当てと、IAM の信頼ポリシーの乖離を確認し、画面から直せるようになった（API Gateway に `/drift`・`/restore`・`/adopt` を足した）。
- 第三者のライセンスの一覧（`THIRD-PARTY-NOTICES.txt`）を、Release の tarball と SPA に同梱した。
- Apache-2.0 の `LICENSE` を置いた。
- 利用者向けの README（英語・日本語）と手順書（`docs/guide/`）を整えた。
- 公開リポジトリでは、`terraform plan` を実行する CD（`cd.yml`）を廃止した。`plan` と `plan-guard` は手元で走らせる。

## v0.1.0 - 2026-10-13

最初の Release。IAM ロールの信頼ポリシーを、申請と差分確認を経て保全方式で反映する。

### 変更

- 割り当てマトリクス、IAM ロール管理、ユーザプール、申請履歴などの画面。
- 管理者の認証は Basic 認証と Cognito から選べる。Cognito では、権限を参照・作成・反映の 3 段階のグループで分ける。
- 別アカウントの IAM ロールを、ターゲット側に作る Reader・Manager のロール（`cloudformation/target-roles.yaml`）を引き受けて操作できる。
- Release の tarball として配布し、`docs/guide/setup.md` の経路 A で導入できる。
