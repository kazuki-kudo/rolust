---
paths:
  - "packages/web/**"
---

# 管理画面（packages/web）の規則

React + AWS Cloudscape Design System の SPA。画面仕様は `docs/design/` の `mockups.md`・`interaction-spec.md`・`design-system-mapping.md` にある。

- Cloudscape の TopNavigation は `utilities` ではなく children スロットで構成する。`utilities` は設定オブジェクトのため `data-testid` を載せられず、現在ページの状態も持てない。
- 変更件数などの導出値は prop で受け取らず、既存レコードから算出する。Assignment が checked と reflected を 1 レコードで持つ以上、baseline を別配列にすると情報源が二重化する。
- ページ唯一の primary アクション（GI-9）を含むツールバーはページ階層に置き、コンポーネント内に入れ子にしない。コンポーネントには skip link 用の target id だけを渡す。
- 非同期処理中にインタラクティブ要素を別要素へ差し替えない（Checkbox を Spinner にしない）。差し替えるとフォーカスが破棄され、interaction-spec の Focus-management 要件を破る。要素は DOM に残したまま状態を表示する。
- 入力を捨てて閉じる操作は、Escape・背景クリック・× ボタン・キャンセルのすべてが該当する。破棄確認は一部の経路だけでなく、全ての閉じ経路に付ける。一部だけ確認すると、利用者から見て挙動が恣意的になる。
- モーダルを確認表示へ切り替えるとき、フォーム本体をアンマウントしない（フォーカスを持つ入力欄が消えるため）。切り替えるのはフッターだけとし、起点のボタンが消える経路では明示的にフォーカスを移す。
- UI 規約（GI-*）の数値目標は、自前で定義した部分への規約と解する。Cloudscape 由来の違反は規約の緩和ではなく、適用範囲の確定として扱う（例: GI-8 の 300ms 超は Cloudscape 由来の 3 件が残るが、reduced-motion 環境で全て停止することをもって充足とした）。
