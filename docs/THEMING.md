# UI テーマカスタマイズ

Yorox の UI は CSS カスタムプロパティ(デザイントークン)だけで全面的に着せ替えられる。

## 仕組み

1. **トークン定義**: `packages/app/src/styles/tokens.css` の `:root` に `--yorox-*` として
   色・フォント・タイプスケール・動き・形を定義している。
2. **Tailwind への橋渡し**: `src/styles.css` の `@theme inline` がトークンを Tailwind v4 の
   ユーティリティ(`bg-paper`, `text-ink`, `border-accent` など)へマップする。
   `inline` なので**実行時に `--yorox-*` を上書きすればユーティリティの色もすべて追従する**。
3. **コンポーネント規律**: アプリの CSS / クラスは必ず `var(--yorox-*)` かマップ済み
   ユーティリティを参照する。生の色値・フォント名のハードコードは禁止。

## インスタンスのカスタマイズ方法

`tokens.css` の後に読み込まれる CSS で `:root` を再定義するだけでよい:

```css
/* 例: 落ち着いた青系インスタンスにする */
:root {
  --yorox-paper: oklch(97% 0.01 250);
  --yorox-ink: oklch(22% 0.03 250);
  --yorox-accent: oklch(55% 0.18 250);
  --yorox-accent-2: oklch(45% 0.12 200);
  --yorox-font-display: 'Shippori Mincho B1', serif;
  --yorox-offset-shadow: none; /* 版ズレシャドウを切る */
}
```

将来的にはインスタンス設定画面からカスタム CSS を注入できるようにする(未実装)。

## デフォルトテーマ「Riso」

レトロポップ(リソグラフ印刷)がモチーフ:

| 要素 | 値 |
| --- | --- |
| 紙 | クリーム `oklch(96.5% 0.02 95)` |
| インク | 藍(青黒)`oklch(24% 0.04 265)` |
| アクセント | 蛍光ピンク `oklch(62% 0.24 5)` + リソブルー `oklch(44% 0.14 255)` の2色刷り |
| 見出し | Dela Gothic One(レトロ看板文字) |
| 本文 | Zen Kaku Gothic New |
| メタ情報 | Space Mono(日付・コロフォンのみ) |
| 署名的ディテール | ボタンの「版ズレ」ハードオフセットシャドウ、マストヘッド下の2色二重罫線 |

デザイン上の規律(hallmark 準拠): 純黒・純白は使わない / アクセントは画面の
数%以下 / フォーカスリングは即時表示 / モーションは hover/focus の状態遷移のみ /
クリック可能要素は 44px 以上のヒットターゲット。
