# 現行 README の内容を、利用者向けと開発者向けの文書に分ける 設計

Issue #178（親: #11 OSS 公開の準備、公開準備 3）。2026-10-18。

## 目的

`README.md`（824 行・約 97 KB）は、手順・制約・開発・設計の記録が一体で、Issue 番号と「追記」の来歴が各所に入っている。利用者向けの README（#179）を作る前に、中身を `docs/` の文書に分ける。

成功基準:

1. 利用者向けの詳細が `docs/guide/` に、開発者向けが `docs/development.md` と `CONTRIBUTING.md` にあり、`README.md` は短い案内役になっている。
2. `docs/guide/` に、Issue 番号・FR 番号・「Issue #N により YYYY-MM-DD 追記/訂正」が無い。除いた来歴は `docs/design/` の正本に既にあるか、無ければ正本へ移した。
3. **内容は変えない**。現在の仕様を平易に言い直すだけで、コマンド・パス・パラメータ名・数値・警告は移行前と一致する（変えるなら別 Issue）。
4. README の節名・手順番号を指していた参照（`docs/design/`・CI・infra・実行時メッセージ・`CLAUDE.md` など）が、すべて移行先を指す。
5. Release の tarball の利用者（経路 A）が、手順書を受け取れる。

## 決定済み

#11 の壁打ちと #178 の本文、および本セッションでの確認による。

- README は Rolust を使う人向け。詳しい使い方は別の文書にする。
- 利用者向けの文書は日本語を正とし、英語化は後続の Issue（「公開準備 4」の完了後に起票）。
- 過去の経緯（Issue 番号・FR 番号・「追記」の来歴）は、利用者向けの文書に載せない。「できること / できないこと」表の FR 番号と来歴は、正本の `docs/design/requirements.md` が持つ。
- #178 の終了時点の `README.md` は、短い案内役に絞る（#179 がその上に最終形を書く）。
- 「README の『クロスアカウント構成』」を指す実行時メッセージは、この PR で直す。

## 配置

```
README.md                  短い案内役（タイトル、概要、poc の注意、docs/guide への目次、ライセンス）
CONTRIBUTING.md            貢献の流れ
docs/development.md        開発者向け
docs/guide/
  README.md                目次（読む順）
  overview.md
  setup.md
  access-control.md
  cross-account.md
  managed-roles.md
  users.md
  operations.md
  limitations.md
docs/design/one-time-migrations.md   一度きりの移行手順（新規。正本の末尾に追加）
```

### 節の対応

行番号は 2026-10-18 時点の `README.md`。

| 現行 README の節 | 移行先 |
|---|---|
| できること / できないこと（11） | `overview.md`（FR 番号の列と来歴は落とす） |
| 構成（37）の図と「Lambda を 3 系統に分ける理由」 | `overview.md` |
| 構成（37）のディレクトリ表 | `docs/development.md`（`aidlc`・`docs/superpowers` の行は開発者向け） |
| 前提（61）、セットアップ 手順 1〜6（77） | `setup.md` |
| 手順 7 IP アドレス制限（249） | `access-control.md` |
| 認証方式の選択（277）、管理者の権限（293） | `access-control.md` |
| 表示言語（317） | `overview.md` |
| 新しいバージョンに更新する（332）、削除する（343）、SPA を更新したとき（357） | `operations.md` |
| ユーザプールとロールの紐づけの移行（389） | 削除（スクリプトは削除済みで、新規のデプロイには不要） |
| 状態テーブルと申請テーブルへの分割（395） | `docs/design/one-time-migrations.md` |
| クロスアカウント構成（461） | `cross-account.md` |
| 管理対象は IAMロールのタグで絞り込まれる（525）、プレースホルダ（580）、Terraform で作る場合（608） | `managed-roles.md` |
| ロールを新規登録すると、そのままユーザプールに紐づく（700）、乖離を直す（729）、IAMロールの削除（747） | `managed-roles.md`（ただし移行スクリプトの段落は下記） |
| Basic 認証は「最小限のアクセス制限」である（630）、「そのほか」の API Gateway のエンドポイント（761） | `access-control.md` |
| ユーザプールは 1 つだけ（653）、反映済み IAMユーザの削除不可（657）、ユーザプールは削除できない（668）、許可したアカウントの IAMユーザだけ（672） | `users.md` |
| Terraform の state に機微情報が入る（636）、「そのほか」の残り（757） | `limitations.md` |
| 開発（769）、テストの方針（782）、設計の記録（801） | `docs/development.md` |
| ライセンス（818） | `README.md` に残す（#179・#180 が扱う） |

構成は着手時に決める、という Issue の指示に従い、上の表を初期案とする。plan の作成時に、文書の長さと相互リンクを見て、分割を 1 段階だけ調整してよい（節の行き先を変えるときは、この表を直す）。

### 各文書の取り扱い

- 見出しは平易な名前にし、Issue 番号を含めない。節の「（Issue #N により …）」は除く。
- 「訂正前は …」で始まる経緯の文は、現在の仕様に不要なら除く。現在の仕様を述べる部分（例: 取り込み直しの手段）は残す。
- 実測値を含む記述（例: IAM の結果整合で約 7 分、Lambda@Edge の削除に約 13 分・約 30 分）は、Issue 番号だけを除いて「実測で」と言い換える。事実としての数値は残す。
- 「FR-6.1・FR-6.4 が働いていません」のように判定基準を述べる箇所は、FR 番号を除き、基準そのもの（認証が働いていない）を書く。
- 相互参照は、文書内の節への相対リンクにする。README の節名で参照していた文は、移行先の文書へのリンクに直す。
- 新規ファイルの改行は LF（`docs/design/` と同じ）。`README.md` は CRLF のままなので、Edit ツールで編集し、`git diff --numstat` で確かめる。

## README の中間状態

`README.md` に残すのは、タイトル、概要（現行の 3〜5 行目）、poc の注意、`docs/guide/` の目次、`docs/development.md`・`CONTRIBUTING.md` への案内、ライセンスの節（現行のまま）。詳細は残さない。

## 周辺の追従

### Release の tarball

`build-release.sh` は `README.md` だけを同梱する。`docs/guide/` も同梱し、`check-release.sh` の必須ファイルの検査と `release.test.sh` の合成リポジトリに加える。tarball を展開した利用者が、`docs/guide/setup.md` から手順を辿れること。`docs/guide/` 内のリンクは、tarball に含まれる文書だけを指す（`docs/design/` への案内が要るときは、リポジトリ上の位置としてパスで示し、リンクにはしない）。

### 実行時メッセージ

`packages/core/src/messages/{ja,en}.ts`、`packages/web/src/i18n/messages/{ja,en}/roles.ts` の「README の『クロスアカウント構成』」を、`docs/guide/cross-account.md` を指す文面に直す。意味は変えない。それを確かめるテスト（`roles.test.ts`・`apply-service.test.ts`・`diff-service.test.ts`・`role-import.test.ts`・`RolesScreen.test.tsx`）の期待文字列を先に直し、失敗を確かめてから実装する（TDD）。

### 参照の張り替え

README の節名・手順番号・「README の手順」を指す参照を、移行先に張り替える。対象は次のとおり（着手時に `git grep` で総当たりする。`aidlc/`・`docs/superpowers/` は凍結または履歴なので対象外）。

- `docs/design/`: `cd-config.md`・`cicd-pipeline.md`・`deployment-strategy.md`・`rollback-runbook.md`・`iam-policy-design-note.md`・`mockups.md`・`interaction-spec.md`・`requirements.md`（README の節・手順を指す参照だけ）
- `packages/api/TABLE-DESIGN.md`、`packages/api/src/migrations/*-cli.ts` のコメント
- `infra/*.tf`・`infra/terraform.tfvars.example`・`.gitignore`・`.trivyignore.yaml` のコメント
- `.github/workflows/*.yml`・`.github/scripts/*.sh` のコメント
- `.claude/rules/aws-infra.md`、`CLAUDE.md`

張り替えるのは、節・手順を特定する参照だけである。NFR-4・SM-2 の「第三者が README と Terraform 一式で」という総称は、#179 の範囲なので触れない。

`docs/design/` の訂正は、`CLAUDE.md` の「来歴の二層」に従う。各文書の冒頭に追記注記（日付・Issue #178・変更の全体像）を足し、各箇所に「Issue #178 により 2026-10-18 訂正」を付ける。

### CLAUDE.md

「利用者向けの説明・セットアップ・制約は `README.md` にある」を `docs/guide/` に直し、構成の節に `docs/guide/`・`docs/development.md`・`CONTRIBUTING.md` を足す。「README の手順による反映」は `docs/guide/operations.md` を指す。

## 一度きりの移行手順

- 「状態テーブルと申請テーブルへの分割」（Issue #36）と、`migrate:link-registered-roles`（Issue #135）の手順は、利用者向けから外し、`docs/design/one-time-migrations.md` に移す。移す際は、手順の文面を変えず、来歴（Issue 番号・日付）を残す。`rollback-runbook.md`・`TABLE-DESIGN.md` の参照は、この文書に張り替える。
- 「ユーザプールとロールの紐づけの移行」（Issue #19・#35）は、スクリプトが削除済みで新規のデプロイに不要なので削除する。経緯は `TABLE-DESIGN.md` と `aidlc/` に残っている。削除前に、`TABLE-DESIGN.md` の該当箇所が同じ事実（実施済み、スクリプト削除済み）を持つことを確かめ、足りなければ足す。
- `managed-roles.md` の「ロールの登録」の節では、「この変更より前に登録したロールは取り込み直されない」「紐づけを外していたロール」など、旧版のデプロイにだけ関わる段落を除く。現行の仕様（登録済みの再登録は 409、取り込み直す手段は「ロールを削除して登録し直す」または「記録を IAM に合わせる」）は残す。

## 統合テストの前提（docs/development.md）

Issue #178 のコメント（#176 の引き継ぎ）に従い、次を書く。

- 統合テストは実 IAM の信頼ポリシーを書き換え、終了時に復元する。`npm run test` からは走らない（`vitest.config.ts` が除外）。`ROLUST_INTEGRATION=1` が無ければ全件スキップする。
- **PR の貢献者は走らせなくてよい。** CI でも走らない。実 AWS に触れる変更（信頼ポリシーの反映、特権昇格面）は、メンテナーが実測する。
- 走らせるときの前提を事実として列挙する。2 アカウント（DEPLOY・TARGET1）のプロファイルと、対象ロールの `iam:GetRole`・`iam:UpdateAssumeRolePolicy` の権限。固定名のロール 3 本（名前と役割は `real-iam.integration.test.ts` のヘッダ表）。DEPLOY に実在する IAM ユーザ `test1@example.com`〜`test3@example.com`。
- 環境変数 `ROLUST_INTEGRATION_{DEPLOY,TARGET1}_{PROFILE,ACCOUNT}` は必須で、既定値が無い。書き込みの前に STS でプロファイルのアカウントを照合する。個人の値は gitignore した `.local/` に置く（雛形は `.local/rolust.env.example`）。
- プロファイル名は強制しない。標準の `AWS_PROFILE` と個人設定を使う。
- 第三者が前提を用意できる手順書までは整えない（別の Issue にする。必要になったときに起票する）。

`CONTRIBUTING.md` には、Issue から始めること、ブランチと PR の流れ、テスト方針への案内（`docs/development.md`）、保護値の規約と `git config core.hooksPath .githooks`、コミットメッセージの検査を書く。内容は `CLAUDE.md` の「開発フロー」「保護値」から、貢献者に要る部分だけを平易に写す（Superpowers の工程の詳細は書かない）。

## 来歴の処理

README から除く来歴は、`docs/design/` の正本が持っているかを、Issue 番号ごとに確かめる。

1. 現行 README に現れる「Issue #N」「OQ-N」「FR-x」の一覧を機械的に取り出す。
2. 各 Issue 番号について、`docs/design/`・`packages/api/TABLE-DESIGN.md` のどこに記述があるかを突き合わせ、表にする（plan のタスクの成果物とし、PR 本文には件数だけを書く）。
3. 記述が無い来歴（例: 「Issue #92 の実測」の数値の出所）は、該当する正本の文書に移す。移し先が無ければ、plan で候補を挙げて依頼者に判断を仰ぐ。

## 検証

文書の変更は TDD の例外とし、機械判定で確かめる。実行時メッセージの変更だけは TDD。

1. `docs/guide/`・`docs/development.md`・`CONTRIBUTING.md` に `Issue #`・`FR-`・`NFR-`・`OQ-`・「により」「追記」「訂正前」が残っていない（`git grep`）。
2. 現行 README のコードブロックとコードスパンの全件が、移行先（`docs/guide/`・`docs/development.md`・`docs/design/one-time-migrations.md`）のどれかに存在する（スクリプトで突き合わせる。内容が変わっていないことの代理指標。意図して落としたものは、一覧に理由を付ける）。
3. `docs/guide/` 内の相対リンクの宛先が実在する。
4. 古い参照が残っていない（`git grep` で「README の「」「README §」「README 手順」などを `aidlc/`・`docs/superpowers/` を除いて確かめる）。
5. Release: `./.github/scripts/release.test.sh` が通り、実際に `build-release.sh` で作った tarball に `docs/guide/` が入っている。
6. `npm run lint`・`typecheck`・`test`、`gitleaks git . --no-banner --redact --exit-code 1`、`./.github/scripts/protected-values-guard.sh`、`./.github/scripts/protected-values-guard.test.sh`、`./.github/scripts/plan-guard.test.sh`。`infra/` のコメントだけを変えるので `terraform fmt -check -recursive` と `terraform validate` も通す。
7. `README.md` の `git diff --numstat` と `git ls-files --eol README.md` で、CRLF が保たれていることを確かめる。

## 反映と実測

メッセージの変更を含むので、Lambda と SPA の本番反映が要る。plan の最終タスクに、`docs/guide/operations.md` の手順（plan → plan-guard → apply → CloudFront の invalidation → 401 の確認）による反映と、ロール登録モーダルの案内文の目視を含める。目視は、検証専用の Cognito ユーザを作って行い、終わったら削除する。`terraform apply` は自動判定に止められる場合があるので、依頼者に `!` での実行を頼む。

## 正本への反映

- **足す**: `docs/design/one-time-migrations.md`（一度きりの移行手順。末尾に追加）。`docs/design/README.md` の目次に、この文書と `docs/guide/` への案内を足す。
- **訂正**（README の節・手順を指す参照の張り替え）: `cd-config.md`（D-7、判定経路の表、手動経路の節）、`cicd-pipeline.md`、`deployment-strategy.md`、`rollback-runbook.md`、`iam-policy-design-note.md`、`mockups.md`・`interaction-spec.md`（画面の read-error の「クロスアカウント構成」への案内）、`requirements.md`（FR-1.11・FR-2.2・FR-5.1・FR-6.5 の節が README の節名を指す箇所）。`packages/api/TABLE-DESIGN.md` の README の手順への参照も張り替える。
- **覆さない・触れない**: `requirements.md` の NFR-4・SM-2・A-4・OQ-4 と、過去の変更を述べる追記注記（#179 と #180 の範囲）。ID の追加・削除・変更は無い。

## 範囲外

- 利用者向け README の最終形、英語版、構成図（#179）。
- ライセンスの決定と配置（#180）。
- 文書の英語化（#179 の完了後に起票）。
- 内容の変更。分割中に見つけた不具合や記述の誤りは、設計判断や要件変更を伴わなければその場で直して回帰テストを足し、伴うなら選択肢を添えて依頼者に判断を仰ぐ。
- 第三者向けの統合テストの手順書。
