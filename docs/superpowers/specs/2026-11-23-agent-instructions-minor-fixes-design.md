# エージェント指示書の同梱の軽微な改善 5 件（Issue #264）

Issue #262（PR #263）で tarball に同梱したエージェント指示書について、全体レビューで出て #262 の範囲では直さなかった 5 件を直す。どれも現状の動作を壊すものではない。規模は小さい（bounded）ので、チャットで設計を承認し（2026-11-23）、plan は作らずに実装する。

## 意図

- 1・2: Release を作る前の関門（`check-release.sh`）が、指示書の同梱について「通ってはいけないものを通す」穴を塞ぐ。
- 3〜5: 指示書の文面を、承認の規則・英語版の手順書・`auth_mode = cognito` の質問に合わせる。

## 目標・非目標

**目標**

- 1・2 は、直す前に落ちるテストを `release.test.sh` に先に足してから直す。
- 3〜5 は、指示書が指す参照先の実在を機械的に確かめ、`claude -p` で実測する。

**非目標**

- 指示書の構成の変更（表の形・節の順）。
- 手順書（`docs/guide/`）の改訂。
- `build-release.sh` の変更（`printf '@AGENTS.md\n'` で LF の 1 行を作っており、厳密な検査にしても今の Release は落ちない）。

## 設計

### 1. `CLAUDE.md` の形の検査（`check-release.sh`）

`[[ "$(cat ...)" == "@AGENTS.md" ]]` は、コマンド置換が末尾の改行を落とすので、末尾に改行の無いものも、後ろに空行が続くものも通る。設計は「LF の 1 行」。`printf '@AGENTS.md\n' | cmp -s - "$DIR/CLAUDE.md"` に替える。

テスト（`release.test.sh`）: 末尾に改行の無い `@AGENTS.md`、後ろに空行が続く `@AGENTS.md` が落ちるケースを先に足し、直す前に落ちる（検査が通してしまう）ことを確かめる。既存の正常系「CLAUDE.md が @AGENTS.md の 1 行である」も `cmp` に揃える。

### 2. 基準が無いとき、同一性の検査が黙って飛ぶ（`check-release.sh`）

`$ROOT` 側のファイルが無いと、`plan-guard.sh`・`target-roles.yaml`・`LICENSE`・`AGENTS.md` の同一性の検査が何も言わずに飛ぶ。tarball 側が無い場合は `REQUIRED` が拾うので、穴は `$ROOT` 側だけ。

tarball の展開の前に、`$ROOT` の次の 4 ファイルの存在を調べ、無ければ、無いものを示して終了コード 2（前提不足）で止める。判定できない状態（基準が古い木を指す）と、tarball が間違っている状態（終了コード 1）を分けるため。

- `.github/scripts/plan-guard.sh`
- `cloudformation/target-roles.yaml`
- `LICENSE`
- `docs/tarball-agent-instructions.md`

同一性の検査の `[[ -f "$ROOT/$f" ]]` の条件は、前提の検査で保証されるので外す（`-f "$DIR/$f"` は `REQUIRED` が先に落とすので残してもよい）。

テスト: `ROLUST_REPO_ROOT` を空のディレクトリに向けると終了コード 2 で落ちるケースを先に足す。

### 3. `tfplan` の削除と承認（`docs/tarball-agent-instructions.md`）

「資格情報と値の扱い」の `tfplan` の記述と、「承認を取る操作」の「ファイルの削除」が読み合わない。**判断（私の判断。2026-11-23 に承認）**: エージェントが `terraform plan` で自分で作った `tfplan` と `tfplan.json`（この 2 つの名前に限る）は、apply の後に承認なしで消す。それ以外のファイルの削除は、従来どおり承認を取る。「承認を取る操作」の「ファイルの削除」に、この例外を添える。

### 4. 質問の表の「使う手順書の節」の引き方

表の下に、節は手順の番号（手順 2・3・5）でも引けること、英語版（`docs/guide/en/`）は見出しが英語なので番号で引くこと、番号の無い節は日本語版と同じ位置（見出しの階層の列が一致する。`guide-parity.sh` が検査する）の見出しで引くことを添える。

### 5. Cognito の管理者の質問

表に 1 行足す: `auth_mode = "cognito"` のとき、管理者のユーザ名とメールアドレス、割り当てるグループ（`viewer` / `editor` / `applier`）。使う手順書の節は、`docs/guide/setup.md` の手順 5 と `docs/guide/access-control.md` の「管理者の権限」。パスワードは聞かない（既存の「資格情報と値の扱い」のとおり、一時パスワードはコマンドが乱数から作る）。

## 正本への反映

なし（`docs/design/` の ID を覆す・足すものではない）。指示書を直しても、`cd-config.md` の追記注記の内容（同梱の仕組み）は変わらない。

## CHANGELOG

3〜5 はエージェントの質問と承認の挙動が変わる（利用者に見える）ので、`## 未リリース` の `### 変更` に 1 項目足す。1・2 は Release を作る側の内部検査なので書かない。`### 更新時にやること` は無い。

## 確かめ方

- `./.github/scripts/release.test.sh`（1・2 は先に落ちることを確かめる）
- `./.github/scripts/ci-local.sh`（push の前）
- 指示書の参照先（手順書のファイル・見出し・手順番号）の実在を grep で確かめる
- `./.github/scripts/protected-values-guard.sh`
- 実測: tarball をリポジトリの外に展開し、`claude -p` で 5（Cognito の質問）と 3（tfplan の扱い）を確かめる
