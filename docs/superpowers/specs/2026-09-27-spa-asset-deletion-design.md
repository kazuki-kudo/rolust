# SPA の旧アセットが消えることを受け入れ、画面を読み込めないときに再読込を案内する — 設計

- 日付: 2026-09-27
- Issue: #4
- ブランチ: `feat/4-spa-asset-deletion`
- 状態: 設計承認済み（brainstorming の設計 1・2）、spec レビュー待ち

## 1. 背景と目的

### 起きていること

`infra/cloudfront.tf` の `aws_s3_object.web` は `for_each = fileset(local.web_dist, "**")` で SPA のファイルを管理している。`npm run build` が `dist/` を作り直すため、ビルドで名前が変わった直前のアセットは for_each のキーから外れ、`terraform apply` のたびに destroy される（`runbooks.md` RB-6 で `16 to destroy` を実測。2026-09-19）。

凍結文書 `deployment-strategy.md` § SPA の更新順序が持つ不整合 は「Terraform は旧アセットを削除しない」を前提にしており、誤っている。同じ前提に立った記述が `cicd-pipeline.md` Y-4 と README § SPA を更新したとき のコメント「差分のあるファイルだけが S3 に上がる」に残っている（後者は Issue #4 のコメントで併せて直すよう依頼されている）。`rollback-runbook.md` は Issue #5 で事実と暫定の手当て（タブの再読込の周知）に改め、恒久策を #4 の未決にしている。

### 壊れ方（2026-09-27 にコードで確認）

- `packages/web/src/App.tsx` は 5 画面を `React.lazy` で分割して読み込む。ErrorBoundary は無い。
- 反映の前から開いていたタブで、まだ読み込んでいない画面へ移ると、消えたチャンクの代わりに CloudFront のカスタムエラー応答（403 → `/index.html`、200）が返る。`import()` は失敗し、React のツリー全体が外れて**画面が真っ白になる**。
- `index.html` は `Cache-Control: no-cache` のため、新しく開いた・再読込したタブは壊れない。影響は反映の前から開いていたタブに限られる。

### 依頼の内容

Issue #4 のやること 2 件: `deployment-strategy.md` の前提を訂正する。旧アセットを一定期間残す運用、またはそれを受容する判断を手順に書く。Issue のコメントにより、`deployment-strategy.md` は `docs/design/README.md` の手順で切り出してから直す。

### 成功基準

1. 画面のチャンクを読み込めなかったとき、真っ白にならず、画面の本体の位置に案内と「再読込」ボタンが出る。ナビゲーションは残る。
2. `docs/design/deployment-strategy.md` が正本として存在し、正本注記と、3.3 の訂正 S-1〜S-9 のそれぞれに来歴がある。
3. 「旧アセットは残る」「旧アセットを削除しない（消さない）」を現行として書いた記述が、`aidlc/`・`docs/superpowers/` の外に残っていない。
4. フルパスで `deployment-strategy.md` を指す参照が `docs/design/` を指す。
5. `aidlc/` に差分が無い。

## 2. 決定事項

| 論点 | 決定 | 理由 |
|---|---|---|
| 恒久策の方向 | **消えることを受け入れ、画面の側で立て直す**（依頼者の決定、案 A） | Terraform を変えずに NFR-4（README と `terraform apply` でセットアップが完了する）を保てる。旧アセットを残す案（`assets/*` を Terraform の管理から外し `aws s3 sync` で上げる）は手順が増え、アセットの差分が plan に出なくなり、古いファイルの掃除も要る |
| 読み込めなかったときの振る舞い | **案内と「再読込」ボタンを出し、利用者に再読込してもらう。自動では再読込しない**（依頼者の決定、案 1） | 何が起きたかが見え、勝手に画面が切り替わらない。本物の障害（ビルドの欠落など）で再読込を繰り返す状態に陥らない。自動再読込は 1 回に限る仕組みと、失敗時の案内の両方が要る |
| 失敗の見分け方 | **`import()` の失敗だけを専用のエラー `ScreenLoadError` に包み直して判定する。** ブラウザのエラー文言では判定しない | 文言はブラウザごとに違う（`Failed to fetch dynamically imported module` など）。どこで失敗したかで見分ければ、MIME 不一致（`index.html` が返る）も通信の途絶も同じ形で捕まえられる |
| 受け止めるエラーの範囲 | **`ScreenLoadError` だけ。** ほかのエラーは投げ直し、今の挙動を変えない | 画面の描画中のバグを「新しい版が反映された」という案内で覆い隠さない |
| 規約の置き場所 | **`interaction-spec.md` に GI-11 として末尾に足す。** `mockups.md` の各画面の状態は変えない | 5 画面に共通し、画面の外側（`App.tsx`）が担う振る舞いである |
| 切り出しで見つかった古い記述 | **`docs/design/README.md` の手順 3 の総当たりとして、SPA の節以外（CD の反映・承認、赤信号の範囲など）も同じ来歴で直す**（設計 2 で承認済み） | 手順が切り出し時の総当たりを定めている。直さずに正本にすると、古い記述が現行の顔をして残る |
| テスト件数「193 件」 | **件数を書かない形に改める** | 件数は変わり続け、書くたびに古くなる。文書の主張（ユニットテストは CI が担保する）には件数が要らない |

## 3. 設計

### 3.1 画面側（`packages/web`）

**`packages/web/src/lazy-screen.ts`（新規）**

- `ScreenLoadError`（`Error` の派生）: 画面のチャンクを読み込めなかったことを表す。元のエラーを `cause` に持ち、`message` は元のエラーの `message` を引き継ぐ。
- `lazyScreen(load)`: `lazy(() => load().catch((error) => { throw new ScreenLoadError(error); }))` を返す。`load` の型は `() => Promise<{ default: ComponentType<P> }>`。
- `App.tsx` の 5 画面の `lazy(...)` を `lazyScreen(...)` に置き換える。

**`packages/web/src/components/ScreenErrorBoundary.tsx`（新規）**

- クラスコンポーネント（React の ErrorBoundary はクラスでしか書けない）。`getDerivedStateFromError` でエラーを状態に持ち、`ScreenLoadError` でなければ `render` で投げ直す。
- `ScreenLoadError` のときは次を表示する（`data-testid="screen-load-error"`）。
  - Cloudscape の `Alert`（`type="error"`、`statusIconAriaLabel="エラー"`）
  - 見出し: 「画面を読み込めませんでした」
  - 本文: 「新しい版が反映されたか、通信が途切れた可能性があります。ページを再読込してください。」
  - 小さい文字で元のエラーの文言（GI-6）
  - `action` にボタン「再読込」（`data-testid="screen-load-error-reload"`）。押すと `window.location.reload()` を呼ぶ
- `App.tsx` で `AppShell` の内側、`Suspense` の外側に置き、`key={route.path}` を付ける。画面を移ると状態が消え、読み込み済みの別の画面にはそのまま移れる。失敗した画面に戻ると、`React.lazy` が失敗を覚えているため同じ案内が出る（直すには再読込が要るので正しい）。
- ナビゲーションとスキップリンクは `AppShell` にあるため、案内の表示中も残る。

**テスト（TDD。Vitest + Testing Library、jsdom）**

1. `lazyScreen` は、`load` が拒否されると `ScreenLoadError` で拒否し、`cause` に元のエラーを持つ。
2. `ScreenErrorBoundary` の中で `lazyScreen` の画面の読み込みが失敗すると、案内（見出し・本文・元のエラーの文言）と「再読込」ボタンが出る。
3. 「再読込」を押すと `window.location.reload` が呼ばれる（`vi.spyOn` などで差し替える）。
4. `ScreenLoadError` 以外のエラーは受け止めず、外側へ伝わる。
5. `App` で画面の読み込みが失敗しても、ナビゲーションが残り、別の経路へ移るとその画面が表示される。

### 3.2 文書の切り出し（`deployment-strategy.md`）

| 正本 | 複写元（`aidlc/spaces/default/intents/260728-rolust-iam-trust/` 配下） | 改行コード |
|---|---|---|
| `docs/design/deployment-strategy.md` | `operation/deployment-pipeline/deployment-strategy.md` | CRLF（維持する。Edit ツールで直す） |

- 複写だけのコミットを先に作る。
- 冒頭の `# Deployment Strategy — Rolust` の直後に正本注記を置く。書式は `rollback-runbook.md` に倣う（位置づけ・複写元・照合の範囲・訂正の全体像・未決・ファイル名だけで名指す凍結文書の所在）。
- 節の見出しは変えない（`rollback-runbook.md`・`cicd-pipeline.md` が節名で参照している）。

### 3.3 照合（既知の食い違いの総当たり）

訂正には「Issue #4 により 2026-09-27 訂正」（足すものは「追記」）の来歴を、訂正後の文言と同じ行に付ける。

| # | 箇所 | 訂正 | 源泉 |
|---|---|---|---|
| S-1 | 冒頭 | Stage・Scope の行、最終更新、上流入力の経緯の段落を削除する | 残骸 |
| S-2 | § 構成要素ごとの置き換え特性 の表「S3 の SPA 資産」 | 置き換え方を「差分のあるファイルを上書きし、名前の変わったアセットを destroy する」にする | RB-6・コード |
| S-3 | § SPA の更新順序が持つ不整合 | 「旧アセットは残る」前提を「反映のたびに直前のアセットが destroy される」に改める。影響は反映の前から開いていたタブに限られ、画面が案内（GI-11）を出して再読込を促すことを書く。「旧アセットは消さない」を削る。「README と同じ手順を CD に組み込んでいる」を「反映は README の手順だけで行い、`index.html` の無効化は apply の後に行う」に改める | RB-6・F-1.4・D-7・本 Issue |
| S-4 | § Lambda@Edge の非対称性 | 「`cd-config.md` § スモークテストの判定 の 401 チェックで検知する」を、README の手順の 401 の確認に改める（スモークは Issue #51 で廃止） | #51・README |
| S-5 | § 環境と昇格 | デプロイ契機「`main` への push + 人の承認」を「README の手順による手動の反映」に改める。手動承認の段落は、CD が反映しない（D-7）ため、人が plan と plan-guard を確かめて手で apply することが承認の役割を担う、に改める。IAM の特権昇格面であるという理由は残す | D-7 |
| S-6 | § 変更の種類ごとの扱い | 経路の「通常の CD」を「通常の反映（README の手順）」に、「CD に載せない」「CD の対象外」「CD の経路に存在しない」を反映の手順に即した言い方に改める。R-8 を止める主体を「`plan-guard.sh`（CD の `guard` と手元の実行）」にする | D-7・`cd-config.md` D-6 |
| S-7 | § デプロイ前に満たされている前提 | 「CD が走る時点で」を「`main` から手動で反映する時点で」に改める。テスト件数「193 件」を件数を書かない形にする。赤信号を R-1〜R-10 にする。「スモークの 401 チェックのみ」を README の手順の 401 の確認に改める。`code-summary.md` の未解決事項 B / C は、後の記録（4.3・統合テスト）で確かめられているかを照合し、確定できなければ未決に挙げる | #24・#51・記録 |
| S-8 | § plan の差分をどう読むか | 指針の在処を `docs/design/cicd-pipeline.md` に、判定基準の在処を `quality-gates.md` から `cicd-pipeline.md` に改める。表の「承認の前 / 承認時」を、「`main` の継続検査（CD の `guard`）と、手動の apply の前（手元の `plan-guard.sh`）/ apply の前に人が読む黄信号 Y-1〜Y-5」に改める。R-1〜R-9 を R-1〜R-10 にする | D-6・D-7・#24 |
| S-9 | § 未決事項 1 | P-3 は作成済み、P-4 は成立させない（D-7）ため、「紙の上にある」を解消にする。反映は README の手順で実行されている | `cd-config.md` |

照合したが変えないもの: § 未決事項 2（CloudFront の更新中の混在区間の長さ）。4.3 の記録に実測値が無い。

**未決（直さない）**: § 未決事項 2。S-7 で確定できなかった事項があればここに足す。

### 3.4 同じ前提に立った記述と参照

| ファイル | 変更 |
|---|---|
| `docs/design/rollback-runbook.md` | 正本注記の未決 (1) と § SPA だけを戻す場合 の「恒久策は Issue #4 で決める」を、画面が案内（GI-11）を出すに改める。「開いているタブの再読込を周知する」は、周知しなくても画面が案内する形に改める |
| `docs/design/cicd-pipeline.md` | Y-4 を「SPA の反映では毎回、名前の変わったアセットが destroy される（正常）。開いたままのタブは画面の案内（GI-11）で再読込を促す。数が SPA のビルドの差分と釣り合わないときに読む」に改める。§ 本書の立場 の表の `aidlc/…/deployment-strategy.md` を正本のパスに改める |
| `docs/design/interaction-spec.md` | GI-11 を末尾に足す: 「画面のコードを読み込めなかったときは、画面の本体の位置に原因（新しい版の反映、または通信の途絶）と『再読込』ボタンを出す。ナビゲーションは残す。自動では再読込しない」 |
| `README.md` § SPA を更新したとき | コメント「差分のあるファイルだけが S3 に上がる」を「名前の変わった旧アセットは削除される」に改める。反映の前から開いていたタブで画面の移動に失敗すると案内が出るので、再読込すればよい、と 1 文足す |
| `.github/workflows/cd.yml` | 冒頭のコメントの `aidlc/…/deployment-strategy.md` を `docs/design/deployment-strategy.md` に改める。動作は変わらない |
| `docs/design/README.md` | 冒頭の経緯に切り出しを 1 文足す。文書の表に `deployment-strategy.md` を足す。凍結文書の所在の表から `deployment-strategy.md` の行を外し、正本の本文が新たに名指す凍結文書があれば足す |

ファイル名だけの参照（`cd-config.md` の `deployment-strategy.md` など）は README の規約で解決するので書き換えない。

### 3.5 検証

- 画面: 3.1 のテストが通ること。`npm run lint`・`npm run typecheck`・`npm run test`・`npm run build` が通ること。
- 文書（機械判定。雛形は `docs/superpowers/plans/2026-09-27-rollback-runbook.md` の検証スクリプト）:
  1. `git diff --stat main -- aidlc/` が空であること。
  2. 複写元の `##`・`###` 見出しがすべて正本にあること。
  3. S-1〜S-9 の各項目について、訂正後の文言と来歴（`Issue #4 により 2026-09-27`）があること。S-1 は削除した文言が無いことで判定する。
  4. `aidlc/`・`docs/superpowers/` の外に、「旧アセットを削除しない」「旧アセットは消さない」「差分のあるファイルだけが S3 に上がる」「恒久策は Issue #4 で決める」が無いこと。
  5. 張り替えたパス参照の先が実在し、`aidlc/…/deployment-strategy.md` をフルパスで指す参照が `aidlc/`・`docs/superpowers/` の外に残っていないこと。
  6. CRLF の文書について、`git diff --numstat` と改行コードの統計で、差分が意図した箇所だけで、改行が混在していないこと。
- push の前に gitleaks 8.30.1 を実行する。PR の CI（`ci.yml`）が緑であることを確かめる。
- 実環境（plan の最終タスク）: README の手順で反映する（plan-guard で赤信号が無いこと、401 の確認）。反映の前のビルドにあったチャンクのパスを取得すると 200 の `text/html`（`index.html`）が返ることを確かめる（壊れ方の前提の実測）。ブラウザでの確認は依頼者に引き取ってもらう手順書を残す（ローカルの `vite preview` で、画面を開いたまま未読込の画面のチャンクを `dist/` から消して移動し、案内が出ることを見る。実環境では次の反映で、反映前から開いていたタブで同じことを見る）。

## 4. 正本への反映

- 覆すもの: `deployment-strategy.md` § SPA の更新順序が持つ不整合（旧アセットは残る前提と「旧アセットは消さない」）、同 § 環境と昇格・§ 変更の種類ごとの扱い・§ デプロイ前に満たされている前提・§ plan の差分をどう読むか の CD の反映を前提とした記述、同 § 未決事項 1（S-1〜S-9）。`rollback-runbook.md` 正本注記の未決 (1) と § SPA だけを戻す場合 の恒久策の記述。`cicd-pipeline.md` Y-4。
- 足すもの: `docs/design/deployment-strategy.md`（新しい正本）、`interaction-spec.md` GI-11。`docs/design/README.md` の文書の表と凍結文書の所在の表を更新する。`cicd-pipeline.md` § 本書の立場 のパスを改める。
