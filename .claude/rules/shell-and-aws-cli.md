# Windows（Git Bash）と AWS CLI の注意

- Git Bash の `sed -i` は CRLF ファイルの改行を LF に変換し、`git diff` が全行差分になる。CRLF（または混在）の文書は Edit ツールで編集し、変更後に `git diff --numstat` と改行コードの統計で、差分が意図した箇所だけであることを確かめる。（Issue #235 により 2026-11-03 追記、Issue #182 により 2026-11-04 訂正）`.gitattributes` で全体を LF に固定したため、改行だけの差分は出ない。旧リポジトリの `aidlc/` だけが `-text` で CRLF・混在を持っていたが、`aidlc/` はこの木に無い。
- Git Bash 上の `jq` は行末を CRLF で出力する。`jq -r` の出力をパスとして `test -f` などに渡す前に `tr -d '\r'` で除去する（除去しないと、末尾の `\r` のせいで全件が不在と判定される）。
- AWS CLI の失敗は資格情報の不在とは限らない。`[default]` プロファイルが無いだけで region が空になり、`Invalid endpoint: https://sts..amazonaws.com` を返す。資格情報の有無は `aws sts get-caller-identity --profile <p> --region <r>` で実測してから判断し、失効が確定したら、事前に決めてある分岐を再質問せずに発動する。
- IAM の CloudTrail イベント（`UpdateAssumeRolePolicy`・`TagRole` など）はグローバルサービスのため us-east-1 にしか記録されない。`aws cloudtrail lookup-events` には必ず `--region us-east-1` を付ける（ap-northeast-1 で引くと 0 件になり、「記録が無い」ように見える）。
- 「IAM を呼んでいない」を CloudTrail で確かめるときは `AttributeKey=EventName`（`GetRole`・`UpdateAssumeRolePolicy` など）で引き、`CloudTrailEvent` の `requestParameters.roleName` と `userIdentity` で絞る。`AttributeKey=ResourceName` で引くと、Resources 欄を持たない `GetRole` は 1 件も返らず、呼び出しがあっても「無い」と判定してしまう。記録は数分遅れて現れるため、同じ時間帯の自分の呼び出し（`aws iam get-role` など）が現れてから、対象の呼び出しが無いことを判断する。
- Git Bash は `/` で始まる引数を Windows パスに変換する。`aws cloudfront create-invalidation --paths '/index.html'` は InvalidArgument、`aws ssm get-parameter --name /rolust/basic-auth` は ParameterNotFound になる。こうした引数を渡すコマンドには `MSYS_NO_PATHCONV=1` を付ける。
- Git Bash から curl に日本語を引数で渡すと CP932 に変換され、API に保存される値が化ける。JSON の本文は UTF-8 のファイルに書き、`--data-binary @<file>` で渡す。
- 日本語の値を含む AWS CLI の JSON 出力（`aws dynamodb query` など）は、Windows では `jq` が読めないことがある（`Invalid escape`）。`--projection-expression` で要る属性だけに絞るか、`--query … --output text` で取り出す。
- npm 9.6.2 の `npm run <script> --workspace <pkg>` は、スクリプトが失敗しても（エラーは表示するが）exit 0 を返す。workspace のスクリプトの成否は終了コードではなく出力で判断するか、`node` で直接実行して終了コードを見る。
- npm 9.6.2 の `npm audit --audit-level=high` は、high の勧告があっても exit 0 を返す（勧告は表示する）。CI は npm 11 で走るので exit 1 になり、手元が緑のまま CI が赤くなる。push の前の確認は `npx -y npm@11 audit --audit-level=high` で行い、終了コードを見る（Issue #194 で実測。同じ lockfile で 9.6.2 が 0、11 が 1 を返した）。
- npm 9.6.2 の `npm install` は、依存の版を上げた直後に `Cannot read properties of null (reading 'edgesOut')` で落ちることがある（`npm audit fix` も同じ）。lockfile の更新は `npx -y npm@11 install` で行う。npm 11 は install script を既定で走らせないので、`esbuild` のような postinstall を要する依存を新しく入れたときは `npm install-scripts approve <pkg>` か、既存の `node_modules` を残したまま実行する（Issue #194）。
- Windows で `chmod +x` したスクリプトは、git の index に実行権限が残らない（100644 でコミットされ、Linux の CI で `./x.sh` が Permission denied になる）。新しいスクリプトを足したら `git update-index --chmod=+x <file>` を実行し、`git ls-files -s <file>` が `100755` であることを確かめる。Git Bash では `chmod -x` も効かない（実行権限を `#!` や拡張子から合成する）ので、実行権限を外す検査は Windows では走らせられない（Issue #92）。
- GNU tar は `C:/...` のような Windows 形式のパスを `host:path`（リモート）と解釈して失敗する（`Cannot connect to C: resolve failed`）。スクリプトで tar にユーザ指定のパスを渡すときは `--force-local` を付ける（Issue #92）。
- Windows の Python は標準出力が cp932 で、日本語を含む JSON を `ensure_ascii=False` で出すと `jq` が読めなくなる。他のコマンドに渡す JSON は ASCII（`ensure_ascii` の既定）で出す（Issue #92）。
- `terraform plan` は `--profile` ではなく環境変数 `AWS_PROFILE`（と `AWS_REGION`）で資格情報を選ぶ。`aws` コマンドでは通っても、`terraform` が `No valid credential sources found` で落ちる場合は、`export AWS_PROFILE=<自分のプロファイル> AWS_REGION=<リージョン>` を付ける（個人の値は `.local/rolust.env` に置く。Issue #176）。
- Windows の AWS CLI v2 は、`--template-file` / `file://` で読むファイルを OS の文字コード（CP932）で復号する。日本語（UTF-8）を含むテンプレートは `'cp932' codec can't decode byte …` で失敗する（`PYTHONUTF8=1` は効かない）。環境変数 `AWS_CLI_FILE_ENCODING=UTF-8` を付ける（Issue #92）。
- `MSYS_NO_PATHCONV=1` の下では、`file://$DIR/x.json`（AWS CLI）も、Windows ネイティブの `jq` に渡すパスも、`/c/Users/…` を開けず `No such file or directory` になる。作業ディレクトリは `C:/Users/…` の形式（`cygpath -m` で得る）にする（Issue #92 のリハーサル）。
- `aws cloudformation deploy --no-execute-changeset` は、同名の IAM ロールが既にあると `NAME_CONFLICT_VALIDATION` で変更セットの作成自体が失敗する。既存ロールを置き換える前の事前確認は、スタック名とロール名を別名に替えた確認用のスタックで行い、確かめたら消す（Issue #92）。
