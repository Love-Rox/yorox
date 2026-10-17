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

| 要素 | ライト | ダーク |
| --- | --- | --- |
| 紙 | クリーム `oklch(96.5% 0.02 95)` | 藍 `oklch(19% 0.03 265)`(紙とインクを反転) |
| インク | 藍(青黒)`oklch(24% 0.04 265)` | クリーム `oklch(93% 0.018 95)` |
| アクセント | 蛍光ピンク `oklch(62% 0.24 5)` + リソブルー | 明度を上げた同色相(ピンク 70%・ブルー 72%) |
| 見出し | M PLUS Rounded 1c 700(漢字の視認性優先) | 同左 |
| ワードマーク | Dela Gothic One(欧文「Yorox」のみ) | 同左 |
| 本文 | Zen Kaku Gothic New | 同左 |
| メタ情報 | Space Mono(日付・コロフォンのみ) | 同左 |
| 面 | `--yorox-surface`(紙より一段明るい。カード・入力欄・パネル) | 紙より一段明るい藍 |
| 状態色 | `--yorox-danger`(赤)/ `--yorox-success`(緑)/ `--yorox-warning`(黄土) | 明度を上げた同色相 |
| 署名的ディテール | **主ボタン(`.btn`)だけ**の「版ズレ」ハードオフセットシャドウ、ヘッダー下の2色二重罫線 | 同左 |

ダークモードは `prefers-color-scheme: dark` でトークンを再定義するだけ
(色相は変えず明度・彩度のみ移動)。カスタムテーマでも同じ手法で両対応できる。

## 部品クラス(`src/styles.css` の `@layer components`)

見た目の階層は「意味のあるクラス」で表し、ページ側で枠線の太さや色を直接組まない。

| クラス | 用途 |
| --- | --- |
| `.btn` / `.btn-quiet` / `.btn-danger` | 主操作(1画面に原則ひとつ)/ 二次操作 / 戻せない操作 |
| `.input` `.field-label` `.field-hint` | 入力欄とラベル・補足 |
| `.section-title` / `.panel` `.panel-title` | ページ内の大見出し / 関連する操作のまとまり |
| `.notice` + `-error` `-success` `-warning` `-neutral` | 状態を伝える帯(文字はインク色、意味は左帯と地色) |
| `.badge` `.badge-accent` `.badge-danger` | 小さな状態ラベル |
| `.disclosure` / `.disclosure-flat` | 枠付きの折りたたみ / 面の中の折りたたみ |
| `.tabs` | ページ内アンカーのタブ |

ピンク(accent)はブランドと主ボタンの署名に限定し、エラー・削除には使わない(`danger` を使う)。

デザイン上の規律(hallmark 準拠): 純黒・純白は使わない / アクセントは画面の
数%以下 / フォーカスリングは即時表示 / モーションは hover/focus の状態遷移のみ /
クリック可能要素は 44px 以上のヒットターゲット。
