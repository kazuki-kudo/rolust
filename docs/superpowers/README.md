# docs/superpowers

設計書（`specs/`）と実装計画（`plans/`）を置く。作業の流れは `CLAUDE.md` の「開発フロー」に従う。

- spec: `specs/YYYY-MM-DD-<topic>-design.md`。設計の正本は `docs/design/` で、spec は個々の作業の設計と、その根拠である。
- plan: `plans/YYYY-MM-DD-<feature>.md`。実行したら、実測の手順は `docs/runbooks/` に、設計の決定は `docs/design/` に反映する。

## 旧リポジトリの記録

この木は、旧リポジトリ（`rolust-legacy`、非公開）の main から、履歴を持ち越さずに作った（Issue #182）。

- **spec は持ち越した。** 旧リポジトリの plan は持ち越していない。spec にある plan への参照（「雛形は旧 #26 の plan」など）は、旧リポジトリの plan を指す記録である。plan にだけあった実測の手順書と用語対応表は、`docs/runbooks/` と `docs/development.md` に起こした。
- **`aidlc/`（AI-DLC 時代の記録）も持ち越していない。** spec と `docs/design/` にある `aidlc/` のパスと、コミットの SHA は、旧リポジトリの中のものである。
- **Issue・PR の番号:** #251 以下は旧リポジトリ（`rolust-legacy`）のものである。この木の新しい番号は #252 から始まる（Issue #182 により、移行時にダミーの Issue を作って削除し、番号を予約した）。新しい Issue・PR・コミットで旧番号を引くときは「旧 #N」と書く。旧リポジトリの Issue は `gh issue view N --repo kazuki-kudo/rolust-legacy` で引く。

（Issue #182 により 2026-11-04 追記）
