# Rolust 利用者ガイド

Rolust をデプロイして使う人向けの手順書です。まず [概要](overview.md) で何ができるかを確かめ、[セットアップ](setup.md) に進んでください。

`setup.md`・`access-control.md`・`cross-account.md` は英語版があります（`en/`。日本語が正本です）。ほかは日本語のみです。

| 文書 | 内容 |
|---|---|
| [overview.md](overview.md) | できること・できないこと、構成、表示言語 |
| [setup.md](setup.md)（[English](en/setup.md)） | 前提と、入手から動作確認までの手順 |
| [access-control.md](access-control.md)（[English](en/access-control.md)） | 認証方式（Basic / Cognito）、管理者の権限、IP アドレス制限、API Gateway の直 URL |
| [cross-account.md](cross-account.md)（[English](en/cross-account.md)） | 別アカウントのロールを管理するための準備 |
| [managed-roles.md](managed-roles.md) | 管理対象のロール（タグ、プレースホルダ、登録、乖離を直す操作、削除） |
| [users.md](users.md) | ユーザプールの制約と、登録できるアカウントの許可リスト |
| [operations.md](operations.md) | 新しい版への更新、SPA の反映、アンインストール |
| [limitations.md](limitations.md) | Terraform の state の機微情報、そのほかの制約 |

## 制約と既知の帰結

> **開発状況**: poc（proof of concept）です。実運用の前に、この節の文書を必ず読んでください。

実運用の判断に必要な事項です。**すべて意図的な設計判断であり、バグではありません。**

- [access-control.md](access-control.md) — Basic 認証は最小限のアクセス制限であること、API Gateway のエンドポイントを配布しないこと
- [cross-account.md](cross-account.md) — 別アカウントのロールを操作するときの注意
- [managed-roles.md](managed-roles.md) — 管理対象がタグで決まること、タグを付けられる人の権限が統制点になること、信頼ポリシーを空にできないこと
- [users.md](users.md) — ユーザプールは 1 つ、信頼ポリシーに反映済みのユーザは削除できないこと
- [limitations.md](limitations.md) — Terraform の state に機微情報が入ること、そのほか

開発に加わる人は、リポジトリの `docs/development.md` と `CONTRIBUTING.md` を読んでください。
