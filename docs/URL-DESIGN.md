# ID / URL 設計

連合(ActivityPub)前提の URL 設計。MVP 時点からこの設計を守る(docs/DECISIONS.md「MVPスコープ」)。

## 原則

1. **AP オブジェクト URI は不変**。改名・移管で変わらない opaque な ULID を使う。
2. **人間向け URL は可変**(slug / handle ベース)。AP URI とは分離し、リダイレクトや
   content negotiation で相互に行き来できるようにする。
3. ID は全エンティティ ULID(26文字 Crockford Base32、辞書順 = 時系列順)。再割当しない。

## 正規 AP URI(canonical、不変)

| エンティティ | URI |
| --- | --- |
| ユーザー | `https://{host}/users/{ulid}` |
| グループ | `https://{host}/groups/{ulid}` |
| イベント | `https://{host}/events/{ulid}` |
| inbox | 上記 + `/inbox`、共有 inbox は `/inbox` |
| 参加者コレクション | `https://{host}/events/{ulid}/attendees` |
| 資料コレクション | `https://{host}/events/{ulid}/materials` |

- Misskey 方式(opaque ID)を採用。Mastodon 方式(`/users/{username}`)は改名で URI が
  壊れるため不採用。
- 正規 URI への HTML リクエスト(Accept が AP でない)は人間向け URL へ 302。
- AP 露出は当初グループ/イベントのみ。ユーザーの URI は**予約のみ**して露出は止める
  (deref すると当面 404、ID 体系は将来のユーザーアクター公開まで保持)。

## 人間向け URL(可変)

| ページ | URL |
| --- | --- |
| ユーザープロフィール | `/@{handle}` |
| グループ | `/g/{handle}` |
| イベント | `/g/{handle}/events/{ulid}` |

- handle はユーザー/グループで**単一の名前空間**(GitHub 方式)。
- handle 変更は許可するが、AP URI は変わらない。旧 handle の追跡はしない(404)。

## WebFinger

- `acct:{handle}@{host}` → 該当ローカルアクターの正規 AP URI(`links[rel=self]`)。
- 個人グループとユーザーが同じ handle を巡って衝突する問題は未解決
  (docs/OPEN-QUESTIONS.md 参照)。当面、webfinger は actors テーブルの
  handle 一致(ローカルのみ)をそのまま返す。

## ディスカバリ用エンドポイント(URL のみ予約)

- `/.well-known/webfinger` — 実装済み
- `/.well-known/nodeinfo` → `/nodeinfo/2.1` — 最小実装
- `/inbox`(共有)、各アクターの `/inbox` — 501 を返す(連合実装まで)
