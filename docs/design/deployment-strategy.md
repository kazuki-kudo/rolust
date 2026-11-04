# Deployment Strategy — Rolust

> **追記注記**（Issue #240 により 2026-11-03 追記）: 配布物の同梱物に `CHANGELOG.md` を足した（§ 配布物と、更新・削除）。更新の手順書（`docs/guide/operations.md`）が、更新前に変更履歴を読むことを前提にするため。反映の戦略（in-place）と、更新・削除の手順は変わらない。
> **追記注記**（Issue #194 により 2026-10-24 追記）: 配布物の同梱物に `SECURITY.md` を足した（§ 配布物と、更新・削除）。README が相対リンクで指すため、同梱しないと tarball 内でリンクが切れる。反映の戦略（in-place）と、更新・削除の手順は変えていない。ID と節番号も変えない。
> **追記注記**（Issue #178 により 2026-10-18 訂正）: `README.md` の利用者向けの手順を `docs/guide/` に分けたため、README の節・手順を指していた参照を `docs/guide/` の文書に張り替えた（対応は `docs/superpowers/specs/2026-10-18-readme-split-design.md`）。NFR-4・SM-2 の「README と Terraform」という総称は、変えない（Issue #179 により 2026-10-19 訂正: 訂正前は「Issue #179 で扱うので変えていない」とした。README は入口で手順は `docs/guide/` にあるが、総称は今も通じるため）。ID と節番号は変えない。
> **追記注記**（Issue #93 により 2026-10-08 追記）: 表記の空白を外した（IAMユーザ・IAMロール・AWSアカウントID）。ID と内容は変えていない。
> **正本注記**（Issue #4 により 2026-09-27 追記）
>
> - **位置づけ**: 本書は Rolust の反映の戦略（in-place を採る理由・構成要素ごとの置き換え特性・環境・変更の種類ごとの扱い・反映の前に満たされている前提・plan の差分の読み方）の正本である。CD の構成は `cd-config.md`、ロールバックの手順は `rollback-runbook.md`、赤信号と黄信号の判定基準は `cicd-pipeline.md` にある。変更は `CLAUDE.md` § 開発フロー の規則に従い、実装と同じ PR で行う。
> - **複写元**: `aidlc/spaces/default/intents/260728-rolust-iam-trust/operation/deployment-pipeline/deployment-strategy.md`（2026-08-31 最終更新、2026-09-27 複写）。複写元は凍結した経緯として残る。
> - **照合の範囲**: `docs/superpowers/specs/2026-09-27-spa-asset-deletion-design.md` 3.3 の食い違い（S-1〜S-9）を、コード（`infra/cloudfront.tf`・`.github/workflows/cd.yml`・`packages/web/src/App.tsx`）、`cd-config.md`、凍結文書の実測の記録（`runbooks.md` RB-6、`smoke-test-results.md`）に照合して訂正した。それ以外の記述は照合していない（未照合）。
> - **訂正の全体像**: Stage・Scope・最終更新の行と、上流入力の経緯の段落を削除した。SPA の反映のたびに名前の変わったアセットが destroy されるという事実に改め、旧アセットは残さず、画面が再読込を案内する（`interaction-spec.md` GI-11）ことを恒久策とした。最終レビューの指摘により、apply の最中の数秒は新しく開いたタブでも壊れうること（GI-11 の対象外。受容する）を足した。CD は反映しない（`cd-config.md` D-7）ことに合わせ、CD による反映・承認・スモークテストを前提とした記述を、`docs/guide/` の手順による手動の反映（Issue #178 により 2026-10-18 訂正）に改めた。赤信号を R-1〜R-10 にし、テストの件数を書かない形にした。実 AWS の挙動のうち 4.3 で確認済みのものを反映した。未決事項 1 を解消とした。
> - **未決**: § 未決事項 2（CloudFront の更新中の混在区間の長さ）。
> - 本文がファイル名だけで名指す凍結文書（`ci-config.md`・`quality-gates.md`・`code-summary.md`・`smoke-test-results.md` など）とソースタグの所在は `docs/design/README.md` にある。

> **追記注記**（Issue #76 により 2026-09-29 追記）
>
> - **変更の全体像**: plan-guard に赤信号 R-11（API Gateway の直 URL を塞ぐ設定が外れていないか）を足したことに合わせ、現行の一覧を指す「R-1〜R-10」を R-1〜R-11 に改めた（§ デプロイ前に満たされている前提の表 1 箇所・§ plan の差分をどう読むかの表 2 箇所）。当時の範囲を述べる記述は経緯として残す。

> **追記注記**（Issue #85 により 2026-09-30 追記）
>
> - **変更の全体像**: plan-guard に赤信号 R-12（別アカウントへの `sts:AssumeRole` の到達範囲）を足したことに合わせ、現行の一覧を指す「R-1〜R-11」を R-1〜R-12 に改めた（§ デプロイ前に満たされている前提の表 1 箇所・§ plan の差分をどう読むかの表 2 箇所）。当時の範囲を述べる記述は経緯として残す。
> - **設計**: `docs/superpowers/specs/2026-09-30-cross-account-roles-design.md`

> **追記注記**（Issue #20 により 2026-10-05 追記）
>
> - **変更の全体像**: 認証方式（`auth_mode`。`basic` / `cognito`）を足した。`cognito` のとき、Cognito のユーザープール・ドメイン・クライアントと、接続情報の SSM（`/rolust/auth-cognito`）を Terraform が作る。方式の SSM（`/rolust/auth-mode`）は Terraform の管理下に置いた。方式を切り替える apply の間は、どのアクセスも 503 になりうる（許容済み）。
> - **設計**: `docs/superpowers/specs/2026-10-05-admin-auth-cognito-design.md`

> **追記注記**（Issue #92 により 2026-10-13 追記）
>
> - **変更の全体像**: 利用者への配布物（Release の tarball）と、更新・削除の戦略を足した（§ 配布物と、更新・削除）。反映の戦略（in-place）は変わらない。
> - **設計**: `docs/superpowers/specs/2026-10-13-user-deploy-release-design.md`

> **追記注記**（Issue #177 により 2026-10-18 追記）
>
> - **変更の全体像**: `ci.yml` のシークレット走査のジョブ（`secrets`）に、保護値の検査（`.github/scripts/protected-values-guard.sh`）とその回帰テストを足した。検出するのは、許可していない形の 12 桁の数字・`*.cloudfront.net`・IPv4・メールアドレスで、実値の一覧は持たない。ジョブの数と、ゲート G-1〜G-11 の番号は変えない（既存のシークレット走査のゲートに含める）。「担保済み」の表のシークレット走査の行に反映した。
> - **設計**: `docs/superpowers/specs/2026-10-18-protected-values-guard-design.md`

`cd-config.md` が CD の構成を、本書が**何をどう置き換えるか**を定める（Issue #4 により 2026-09-27 訂正: Stage・Scope・最終更新の行と、上流入力の経緯の段落を削除した）。

## 戦略: in-place（Terraform の収束）

blue/green・canary・rolling のいずれも採らない。**`terraform apply` が既存リソースを
その場で更新する**方式である。

### なぜ canary / blue-green を採らないか

| 戦略 | 採らない理由 |
|---|---|
| Canary | Lambda のエイリアスと重み付けルーティングが `infra/lambda.tf` に無い。導入するには Terraform の作り直しが必要で、それは infrastructure-design (3.4) の領分である。また API Gateway → Lambda の統合もエイリアス経由に変える必要がある |
| Blue/Green | CloudFront の複数オリジンと切り替え機構が無い。SPA は S3 の同一バケット・同一プレフィックスに上書きされる。ディストリビューションを 2 本持つ構成にすると、Lambda@Edge も 2 系統になり `terraform apply` が作るものが大きく増える（NFR-4 に影響） |
| Rolling | Lambda / CloudFront はマネージドで、置き換えの粒度を利用者が制御できない。「段階的に置き換える」という制御点が存在しない |

**単一環境・単一利用者集団の管理ツール**であり、requirements.md に段階的公開の要求が無い。
可用性の要求も NFR に定量値を持たない（NFR-1 は定量しきい値を持たない）。in-place の
短い不整合区間を許容できる性質の製品である。

## 構成要素ごとの置き換え特性

`terraform apply` は 1 コマンドだが、置き換わり方は要素ごとに異なる。**同時には切り替わらない。**

| 要素 | 置き換え方 | 所要 | 不整合が起きうる区間 |
|---|---|---|---|
| Lambda（crud / diff / apply） | `filename` + `source_code_hash` の更新で新バンドルに差し替え | 数秒 | 更新中の実行中リクエストは旧コード |
| DynamoDB テーブル | 定義変更が無ければ何も起きない | — | — |
| API Gateway | ステージの再デプロイ | 数秒 | — |
| S3 の SPA 資産 | 差分のあるファイルを上書きし、名前の変わったアセットを destroy する（Issue #4 により 2026-09-27 訂正） | 数秒 | **`index.html` と `assets/*` の更新順序**、反映の前から開いていたタブ |
| CloudFront | ディストリビューション設定の更新 | 数分〜十数分 | 設定変更時のみ |
| Lambda@Edge | 新バージョンを作りディストリビューションに関連付け、全エッジへ複製 | **数分〜十数分** | 複製完了まで旧版が動くエッジが混在 |

### SPA の更新順序が持つ不整合

`assets/*` はハッシュ付きで不変、`index.html` は可変（`Cache-Control: no-cache`）である。
名前にハッシュが付かない `favicon.ico` も `Cache-Control: no-cache` で置く。差し替えたときに 1 年キャッシュが残らないようにするため（Issue #77 により 2026-09-29 追記）。

**反映のたびに、直前のアセットは S3 から destroy される**（Issue #4 により 2026-09-27 訂正: 初版の「Terraform は差分のあるファイルを上書きするだけで旧アセットを削除しない」は誤りだった）。
`infra/cloudfront.tf` の `aws_s3_object.web` は `for_each = fileset(local.web_dist, "**")` であり、`npm run build` が `dist/` を作り直すため、
名前の変わったアセットは for_each のキーから外れる（`runbooks.md` RB-6 で `16 to destroy` を実測）。

影響を受けるのは、主に反映の前から開いていたタブである（Issue #4 により 2026-09-27 訂正）。新しく開いたタブと再読込したタブは新しい `index.html` を取り直す。
開いたままのタブがまだ読み込んでいない画面へ移ると、消えたチャンクを S3 から取れず（403 / 404）、そのとき読み込みに失敗する（Issue #4 により 2026-09-27 訂正。Issue #141 により 2026-10-07 訂正: 訂正前は、CloudFront のカスタムエラー応答（403 → `/index.html`）が HTML を返して失敗していた。カスタムエラー応答は外し、画面のパスの書き換えは Lambda@Edge が行う）。
旧チャンクは `max-age=31536000, immutable` のためエッジに残っていることもあり、そのときは壊れない（Issue #4 により 2026-09-27 追記）。
画面はこの失敗を受け止めて再読込を案内する（`interaction-spec.md` GI-11。Issue #4 により 2026-09-27 追記）。

**apply の最中の数秒は、新しく開いたタブでも壊れうる**（Issue #4 により 2026-09-27 追記）。`aws_s3_object.web` の各インスタンスには依存が無く、`index.html` の更新・新チャンクの作成・旧チャンクの destroy は並行して走る。
この区間に開いたタブは、新しい `index.html` に対して新チャンクがまだ無いか、旧 `index.html` に対して旧チャンクが既に消えている。欠けるのが入口のチャンクだと画面は真っ白になる（GI-11 の対象外。Issue #4 により 2026-09-27 追記）。
再読込すれば直る。区間は数秒で、単一利用者の管理ツールであるため受容する（Issue #4 により 2026-09-27 追記）。

**旧アセットを残す案は採らない**（Issue #4 により 2026-09-27 追記）。`assets/*` を Terraform の管理から外して `aws s3 sync` で上げると、
反映の手順が増えて NFR-4 から外れ、アセットの差分が plan に出なくなり、古いファイルを掃除する仕組みも要る。影響が開いたままのタブに限られ、再読込で直る以上、画面の案内で足りる。

反映は `docs/guide/operations.md` § SPA を更新したとき（Issue #178 により 2026-10-18 訂正） の手順だけで行い、**`index.html` の無効化は apply の後に行う**（Issue #4 により 2026-09-27 訂正: CD は反映しない。`cd-config.md` D-7）。

### Lambda@Edge の非対称性

Lambda@Edge の更新は他の要素と比べて桁違いに遅く、**ロールバックも同じだけ遅い**。
`rollback-runbook.md` § Lambda@Edge の制約 に詳細を置いた。

`packages/edge-auth` は Basic 認証そのものであるため、ここが壊れると
**認証が外れるか（FR-6.1 違反）、全員が締め出されるか**のどちらかになる。前者は
`docs/guide/operations.md` § SPA を更新したとき（Issue #178 により 2026-10-18 訂正） の最後の 401 の確認（`auth_mode = "cognito"` では画面が 302、`/api/` が 401。Issue #20 により 2026-10-05 追記）で検知する（Issue #4 により 2026-09-27 訂正: CD のスモークテストは Issue #51 で廃止した）。

## 配布物と、更新・削除（Issue #92 により 2026-10-13 追記）

利用者には、Release の tarball（`rolust-vX.Y.Z.tar.gz`。`infra/`・ビルド済みの成果物・`plan-guard.sh`・ターゲット側ロールのテンプレート・README 2 本・`LICENSE`・`SECURITY.md`・`docs/guide/` を、作業ツリーと同じ配置で含む。環境固有の値は含まない）で配る。戦略は in-place のまま変わらない。（Issue #194 により 2026-10-24 追記: 同梱物に `SECURITY.md` を足した。README が相対リンクで指すため、同梱しないと tarball 内でリンクが切れる。`check-release.sh` の必須ファイルにも足した。）（Issue #240 により 2026-11-03 追記: 同梱物に `CHANGELOG.md` を足した。更新の手順書が、更新前に変更履歴を読むことを前提にするため。`check-release.sh` の必須ファイルにも足し、本番の版はその版の節が空でないことを検査する。）

- **更新**: 新しい版を別のディレクトリに展開し、`terraform.tfvars` と `backend.hcl` を持ち越して、plan → plan-guard → apply → invalidation を行う。`backend.hcl` が同じなので state も同じものを使う。ターゲット側のテンプレートが変わった版では、各ターゲットでスタックを更新する。
- **削除**: ターゲット側のスタックを消し、退避するもの（DynamoDB のデータ、API Gateway のアカウント設定）を退避してから `terraform destroy` する。
  - **Lambda@Edge の削除は 1 回では終わらない**（Issue #92 の実測。Issue #178 により 2026-10-18 追記: README から移した）。関数（`<project_name>-edge-auth`）の削除は、CloudFront から外した後も各リージョンのレプリカが消えるまで、`it is a replicated function` で失敗する。約 13 分で 1 回失敗して終わり、約 30 分後に同じ `terraform destroy` を再実行すると、残りの関数とその実行ロールが消えた。AWS は数時間かかることがあるとしている。それ以外の資源は 1 回目で消える。
  - **ターゲット側の信頼ポリシーを直した直後は、数分のあいだ引き受けが `AccessDenied` のまま**になりうる（IAM の結果整合。Issue #85 の実測で、Manager の信頼ポリシーを元に戻してから最初に通るまで約 7 分。Issue #178 により 2026-10-18 追記: README から移した）。Rolust は引き受けの失敗を覚えないので、Lambda の再起動は要らない。
- 手順は `docs/guide/operations.md` にある（Issue #178 により 2026-10-18 訂正）（「新しいバージョンに更新する」「削除する」）。

## 環境と昇格

**単一環境**（質問 Q2 = A）。昇格の段階は存在しない。

| 環境 | 実体 | デプロイ契機 |
|---|---|---|
| `jump` アカウントの 1 セット | `infra/terraform.tfvars` の `project_name` / `region` で決まるリソース群 | `docs/guide/operations.md` § SPA を更新したとき（Issue #178 により 2026-10-18 訂正） の手順による手動の反映（Issue #4 により 2026-09-27 訂正: 初版は「`main` への push + 人の承認」） |

`org.md` § Deployment は「staging へは merge で自動、production は手動承認」を既定とするが、
段階が 1 つしか無いため**その 1 つを人の手で反映する**形で規定の趣旨を満たす。CD は反映しない（`cd-config.md` D-7）ため、
反映する人が plan と `plan-guard.sh` の結果を確かめてから手で apply することが承認の役割を担う（Issue #4 により 2026-09-27 訂正: 初版は CD の apply の前に手動承認を置いていた）。
自動の反映にしないのは、この製品が IAM の特権昇格面そのものであり、
`terraform apply` が IAMロールとポリシーを書き換えるためである。

## 変更の種類ごとの扱い

| 変更 | 経路 | 備考 |
|---|---|---|
| アプリケーションコードのみ（`packages/*`） | 通常の反映（`docs/guide/` の手順（Issue #178 により 2026-10-18 訂正））（Issue #4 により 2026-09-27 訂正） | Lambda バンドルと SPA が入れ替わる。SPA は名前の変わった旧アセットが destroy される（§ SPA の更新順序が持つ不整合。Issue #4 により 2026-09-27 追記） |
| Terraform のみ（`infra/*.tf`） | 通常の反映（`docs/guide/` の手順（Issue #178 により 2026-10-18 訂正））（Issue #4 により 2026-09-27 訂正） | plan の差分を apply の前に必ず読むこと（Issue #4 により 2026-09-27 訂正） |
| `managed_tag_key` / `managed_tag_value` の変更 | **通常の反映に載せない**（Issue #4 により 2026-09-27 訂正） | IAM ポリシーの `Condition` が変わり、旧タグの付いた登録済みロールが一斉に反映不能になる。加えて Lambda の環境変数（`ROLUST_MANAGED_TAG_KEY` / `ROLUST_MANAGED_TAG_VALUE`）も同時に変わるため、登録時検証の基準も切り替わる。影響範囲の確認が先。`docs/guide/managed-roles.md` § 管理対象は IAMロールのタグで絞り込まれる（Issue #178 により 2026-10-18 訂正） |
| **対象ロールへのタグ付け / タグ剥がし** | **反映の経路に存在しない**（Issue #4 により 2026-09-27 訂正） | Rolust も Terraform も `iam:TagRole` を持たない。管理対象の増減は運用者が `aws iam tag-role` で行い、`terraform plan` にも `plan-guard` にも現れない（Issue #4 により 2026-09-27 訂正: 承認画面は無い）。**接頭辞方式では変数変更として plan に映っていた性質が失われている。** 統制点は `iam:TagRole` の保持者に移った |
| Basic 認証の資格情報 | **反映の対象外**（Issue #4 により 2026-09-27 訂正） | SSM の値は `lifecycle { ignore_changes = [value] }` により Terraform 管理外。`aws ssm put-parameter` で直接投入する（`docs/guide/setup.md` の「Basic 認証の資格情報を投入する」（Issue #178 により 2026-10-18 訂正））。反映まで最大 5 分（`CACHE_TTL_MS`）。この `ignore_changes` が外れると赤信号 R-8 として `plan-guard.sh` が止める（CD の `guard` と、apply の前に手元で実行するもの。Issue #4 により 2026-09-27 訂正） |
| 認証方式（`/rolust/auth-mode`）と Cognito の接続情報（`/rolust/auth-cognito`） | **反映の対象**（Issue #20 により 2026-10-05 追記） | `auth-mode` は `var.auth_mode` を書く（`ignore_changes` なし）。`auth-cognito` は `auth_mode = "cognito"` のときだけ Terraform が作る。方式を切り替える apply では、apply の間と最大 5 分（`CACHE_TTL_MS`）の間、503 になりうる（空白期間。許容済み）。Cognito は反映の後に作られるので、Hosted UI が使えるまで数分かかる。`cognito` から `basic` に戻すと、ユーザープールとユーザは破棄される |
| `basic_auth_parameter_name` の変更 | **通常の反映に載せない**（Issue #4 により 2026-09-27 訂正） | Lambda@Edge は環境変数を持てないため `packages/edge-auth/src/index.ts` の `CREDENTIALS_PARAMETER_NAME` も同じ値に書き換えて再ビルドする必要がある（`docs/guide/limitations.md` § そのほか（Issue #178 により 2026-10-18 訂正））。コードと変数の同時変更であり、片方だけ反映すると認証が壊れる |

## デプロイ前に満たされている前提

`main` から手動で反映する時点で、`quality-gates.md` の G-1〜G-11 は `ci.yml` により担保されている
（`main` へのブランチ保護が設定されている場合）。反映の手順はこれを再実行しない（Issue #4 により 2026-09-27 訂正: 初版は「CD が走る時点で」）。

| 担保済み | 担保していない |
|---|---|
| lint / typecheck / ユニットテスト / build（Issue #4 により 2026-09-27 訂正: 件数は変わり続けるため書かない） | **実 AWS の挙動**のうち `iam:ListRoleTags` の `AccessDenied` の返り方（Issue #4 により 2026-09-27 訂正: `code-summary.md` § 2026-08-31 ラウンド 未解決事項 B / C のうち、`NoSuchEntity` とタグ無しの返り分け、`event.requestContext.accountId` の実値は 4.3 で確認した。`smoke-test-results.md`） |
| Terraform の書式と `validate`（`infra/` と `infra/bootstrap/`） | **`terraform plan` の妥当性**（赤信号 R-1〜R-12 は `plan-guard.sh` が機械で検査。それ以外は人が apply の前に読む。Issue #4 により 2026-09-27 訂正。Issue #76 により 2026-09-29 訂正: R-11 を足した。Issue #85 により 2026-09-30 訂正: R-12 を足した） |
| IaC スキャン（CRITICAL / HIGH） | **実 AWS での動作**（`docs/guide/operations.md` の手順の 401 の確認（Issue #178 により 2026-10-18 訂正）のみ（`cognito` では 302 / `/api/` の 401。Issue #20 により 2026-10-05 追記）。Issue #4 により 2026-09-27 訂正: CD のスモークテストは廃止した） |
| シークレット走査 / 依存監査（Issue #177 により 2026-10-18 追記: シークレット走査は、資格情報に加えて保護値（アカウント ID・CloudFront の DNS 名・IP・メール）の混入も見る） | **統合テスト**（実 IAM を書き換えるため CI に載せていない） |

## plan の差分をどう読むか

**未決事項 3（初版）はここで解消した。** 指針は
`cicd-pipeline.md` § 承認者のための plan 読み方 にある（Issue #4 により 2026-09-27 訂正: 正本に切り出された）。

| 段階 | 担い手 | 対象 |
|---|---|---|
| ~~`main` の継続検査~~ | ~~`cd.yml` の `guard` ジョブ~~ | **廃止**（`cd-config.md` D-8。Issue #181 により 2026-10-19 訂正: 公開リポジトリでは CD を持たない）。廃止前の記述: **赤信号 R-1〜R-12**。`main` の plan に該当があれば落ちる（Issue #4 により 2026-09-27 訂正: CD は承認も apply も持たない。`cd-config.md` D-7。Issue #76 により 2026-09-29 訂正: R-11 を足した。Issue #85 により 2026-09-30 訂正: R-12 を足した） |
| 手動の apply の**前** | 反映する人が手元で実行する `plan-guard.sh` | **赤信号 R-1〜R-12**。該当したら apply しない。判定基準は `cicd-pipeline.md` § 承認者のための plan 読み方（Issue #4 により 2026-09-27 訂正。Issue #76 により 2026-09-29 訂正: R-11 を足した。Issue #85 により 2026-09-30 訂正: R-12 を足した） |
| 手動の apply の**前**に読む | 反映する人 | **黄信号 Y-1〜Y-5**。差分があること自体は正常で、正しいかどうかが文脈依存（Issue #4 により 2026-09-27 訂正: 初版は「承認時」） |

赤信号のうち本書に直接かかわるのは次の 2 つである。

- **R-8**（`aws_ssm_parameter.basic_auth` の `value` に差分）は § 変更の種類ごとの扱い の
  「Basic 認証の資格情報は反映の対象外」（Issue #4 により 2026-09-27 訂正）が破れた状態そのものである。apply すると
  実運用の資格情報がプレースホルダで上書きされる。
- **R-5**（Lambda@Edge の関連付けが外れる）は § Lambda@Edge の非対称性 が述べた
  「認証が外れる」側の壊れ方である。apply 後の `docs/guide/operations.md` の 401 の確認（Issue #178 により 2026-10-18 訂正）（`cognito` では 302 / `/api/` の 401。Issue #20 により 2026-10-05 追記）でも検知できるが、
  `plan-guard.sh` は **apply の前**に止める（Issue #4 により 2026-09-27 訂正）。ロールバックに数分〜十数分かかる要素であるため、
  事前に止められることの価値が大きい。

## 未決事項

1. ~~**`cd-config.md` § P-3 / P-4 が未充足のため、この戦略は現時点で紙の上にある。**
   P-1 / P-2（state のリモート化とブートストラップ）は 3.4 で解消した。~~
   **解消**: P-3 は作成済み、P-4 は成立させない（`cd-config.md` D-7）。反映は 4.3 の初回 apply 以降、`docs/guide/` の手順で行われている（Issue #178 により 2026-10-18 訂正）（Issue #4 により 2026-09-27 訂正）。
2. **CloudFront の更新中に旧版と新版が混在する区間の長さを測っていない。** 数分〜十数分という
   見積もりは AWS の一般的な挙動に基づくもので、`jump` アカウントでの実測値ではない。
   deployment-execution (4.3) の初回 apply で実測できる。
3. ~~`terraform plan` の差分を人が読む前提だが、読み方の指針を置いていない。~~
   **解消。** § plan の差分をどう読むか を参照。指針は `cicd-pipeline.md` が定め、
   赤信号の機械検査は本ステージが `guard` ジョブとして実装した。
