# Rolust への貢献

Rolust への貢献を歓迎します。始める前に、この文書を読んでください。

## 流れ

1. **Issue から始める。** 不具合の報告、機能の提案、文書の訂正は、まず GitHub の Issue にします。実装は Issue を単位に進め、ブランチ名・コミットメッセージ・PR に Issue の番号を含めます。**脆弱性だけは Issue に書きません**——[SECURITY.md](SECURITY.md) の経路（GitHub の private vulnerability reporting）で報告してください。Issue には、不具合の報告と質問のテンプレートがあります。通常の不具合報告と質問には、気づいたときに返事をします。期限はお約束できません（[SECURITY.md](SECURITY.md) の応答期限は、脆弱性だけの約束です。Issue #252 により 2026-11-04 追記）。
2. **ブランチを切る。** `main` から短命なブランチを切ります。`main` へ直接コミットしません。
3. **テストを先に書く。** アプリケーションコード（`packages/`）は TDD で書きます。失敗するテストを先に書き、失敗を確かめてから実装します。Terraform・CI 設定・文書は、変更した層ごとに機械的な判定（`terraform validate`、grep など）で確かめます。方針は [docs/development.md](docs/development.md) にあります。
4. **PR を出す前に検査を走らせる。** `./.github/scripts/ci-local.sh` が、CI の 7 ジョブと同じ検査を同じ版・同じ引数でまとめて走らせます（手元の Node と一致しない版は `SKIP` として出ます）。ジョブ単位・個別のコマンドは [docs/development.md](docs/development.md) にあります。
5. **PR を出す。** 変更の意図と、確かめた方法を書きます。

## 設計の正本を更新する

要件・画面設計・IAM ポリシーの設計は `docs/design/` が正本です。変更が設計に触れるときは、実装と同じ PR で正本を更新します。案内は `docs/design/README.md` にあります。

## 変更履歴（CHANGELOG.md）を更新する

利用者に影響する変更（機能・画面・API の挙動、Terraform の変数や出力、更新のときの作業）を入れる PR は、実装と同じ PR で `CHANGELOG.md` の `## 未リリース` に追記します。テスト・CI・開発者向けの文書だけの変更は書きません（取り込んだ PR の一覧は、Release のノートが自動生成します）。

- `### 変更` に、利用者から見た変化を書きます。
- `### 更新時にやること` は、**通常の更新手順（[docs/guide/operations.md](docs/guide/operations.md)）に加えて必要な作業があるときだけ**、`### 変更` の後に足します。例: 必須の変数が増えた、持ち越す値が変わった、ターゲット側のロール（`cloudformation/target-roles.yaml`）が変わった。作業が無い版には書きません（この節が無い版は、通常の手順だけで更新できると読まれます）。
- 日本語のみです（英訳は持ちません）。

## Release を出す（メンテナー）

1. `CHANGELOG.md` の `## 未リリース` の見出しを `## vX.Y.Z - YYYY-MM-DD` に改める PR を出して merge します。上には、次の版のための空の `## 未リリース` を残します。
2. `main` の最新で検査を走らせます（[docs/development.md](docs/development.md) の「CI が走る時と、Release の前」）。
3. `main` の最新に `vX.Y.Z` のタグを打って push します。`release.yml` が tarball を作って検査し、`CHANGELOG.md` のその版の節を本文の先頭に置いて Release を作ります。節が無い、または空の版は、検査で落ちて Release が作られません（`-` を含む prerelease は除く）。

## README を更新する

README は英語（`README.md`）と日本語（`README.ja.md`）の 2 本です。**日本語を正本**とし、英語は日本語から訳します。

- README を変える PR は、2 本を同じ PR で更新します。片方だけを直しません。
- 見出しの構造・順序と、リンクを 1 対 1 に揃えます。図（Mermaid）も同じ構造で、ラベルだけを言語に合わせます。
- README は短い案内に保ちます。詳細は `docs/guide/` に書き、README には入れません。
- `docs/guide/` は日本語が正本です。英語版を持つのは `setup.md`・`access-control.md`・`cross-account.md` の 3 本だけで、`docs/guide/en/` に置きます。ほかの手順書は日本語のみです（英訳は持ちません）。

## 手順書の英語版を更新する

`docs/guide/setup.md`・`docs/guide/access-control.md`・`docs/guide/cross-account.md` のどれかを変える PR は、日本語を先に直し、同じ PR で `docs/guide/en/` の同名のファイルを更新します。見出しの階層の列（`#` の数を出現順に並べたもの）が日本語版と一致していることを、`./.github/scripts/guide-parity.sh` で確かめます（CI の `release-artifacts` ジョブも検査します。コードブロックの中の `#` 行は見出しに数えません）。英訳していないページへのリンクは日本語版に向け、リンクの後に「 (Japanese)」を添えます。

## 実値を書かない

AWS のアカウント ID、CloudFront の DNS 名、自宅や会社の IP アドレス、会社のドメイン、個人のメールアドレスは、コード・文書・コミットメッセージ・Issue・PR・コメントのどれにも書きません。例には次の形を使います。

| 対象 | 書く形 |
|---|---|
| AWS アカウント ID | `<ACCOUNT_ID>`、`111122223333`、`123456789012` |
| CloudFront の DNS 名 | `dXXXXXXXXXXXXX.cloudfront.net` |
| IP アドレス | `203.0.113.x`（RFC 5737 の範囲） |
| メールアドレス | `user@example.com`（`example.com`・`example.org`・`example.net`） |

検査は `.github/scripts/protected-values-guard.sh` が行います（gitleaks 8.30.1 が必要です）。clone したら、コミットメッセージの検査のために、一度だけ次を実行してください。

```bash
git config core.hooksPath .githooks
```

Issue や PR に本文を投稿する前にも、`./.github/scripts/protected-values-guard.sh text <ファイル>` で検査できます。

## 開発の手引き

ディレクトリ構成、コマンド、テストの方針、統合テストの前提は [docs/development.md](docs/development.md) にあります。
