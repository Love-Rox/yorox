# ブランド素材

外部サービス(Discord Bot、OAuth 同意画面など)に登録するための画像置き場。
アプリからは配信しない(配信する画像は `packages/app/public/images/`)。

配色とロゴはサイトと同じリソグラフ調:
藍 `#1b2240` / クリーム `#f4efde` / ピンク `#f0357f` / リソブルー `#35507e`

| ファイル | サイズ | 用途 |
| --- | --- | --- |
| `icon-512.png` | 512×512 | Discord Bot / アプリのアイコン、GitHub OAuth App |
| `icon-1024.png` | 1024×1024 | 高解像度が要るサービス向け |
| `icon-120.png` | 120×120 | Google OAuth 同意画面のロゴ |
| `bot-banner.png` | 680×240 | Discord Bot のバナー |
| `bot-banner.svg` | ベクター | バナーの元データ(文言・レイアウトの変更用) |
| `og-default.svg` | 1200×630 | サイト共通 OGP カードの元データ |

## 再生成

SVG から PNG を書き出すには `rsvg-convert`(librsvg)を使う:

```sh
rsvg-convert -w 680 -h 240 brand/bot-banner.svg -o brand/bot-banner.png
rsvg-convert -w 512 -h 512 packages/app/public/images/logo.svg -o brand/icon-512.png
```

サイト共通の OGP 画像(`packages/app/public/images/og-default.png`)は
`brand/og-default.svg` から同様に 1200×630 で書き出す。
イベント個別の OGP は `packages/og-renderer` が実行時に生成するため、ここには置かない。
