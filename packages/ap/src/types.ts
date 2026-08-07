/**
 * ActivityStreams 2.0 の型定義(Yorox で使うサブセット)。
 *
 * 網羅性より実用を優先し、Yorox のユースケース
 * (イベント/グループのアクター、参加フロー、モデレーション、移行)
 * に必要な語彙のみを定義する。
 */

/** JSON-LD の @context に入りうる値 */
export type JsonLdContext = string | Record<string, unknown> | (string | Record<string, unknown>)[];

/** URI 参照。埋め込みオブジェクトか URI 文字列 */
export type ObjectOrUri<T extends ApObject = ApObject> = T | string;

/** AS2 の基本オブジェクト */
export interface ApObject {
  '@context'?: JsonLdContext;
  id?: string;
  type: string | string[];
  name?: string;
  summary?: string;
  content?: string;
  mediaType?: string;
  url?: string | ApLink | (string | ApLink)[];
  published?: string;
  updated?: string;
  attributedTo?: ObjectOrUri | ObjectOrUri[];
  to?: string | string[];
  cc?: string | string[];
  [key: string]: unknown;
}

export interface ApLink {
  type: 'Link';
  href: string;
  mediaType?: string;
  name?: string;
}

/** アクター(Person / Group / Service など) */
export interface ApActor extends ApObject {
  type: 'Person' | 'Group' | 'Organization' | 'Service' | 'Application';
  preferredUsername?: string;
  inbox: string;
  outbox: string;
  followers?: string;
  following?: string;
  endpoints?: { sharedInbox?: string };
  publicKey?: ApPublicKey;
  /** アカウント移行(Move)・エイリアス統合に使う */
  alsoKnownAs?: string[];
  movedTo?: string;
}

export interface ApPublicKey {
  id: string;
  owner: string;
  publicKeyPem: string;
}

/** イベント(AS2 コア語彙の Event) */
export interface ApEvent extends ApObject {
  type: 'Event';
  startTime?: string;
  endTime?: string;
  location?: ApObject | string;
}

/** 資料(スライド・動画等)は Document として流通させる */
export interface ApDocument extends ApObject {
  type: 'Document';
}

/** 削除通知後の残骸 */
export interface ApTombstone extends ApObject {
  type: 'Tombstone';
  formerType?: string;
  deleted?: string;
}

/** Yorox が送受信するアクティビティの型名 */
export type ActivityType =
  | 'Create'
  | 'Update'
  | 'Delete'
  | 'Join'
  | 'Leave'
  | 'Accept'
  | 'TentativeAccept'
  | 'Reject'
  | 'Undo'
  | 'Follow'
  | 'Add'
  | 'Remove'
  | 'Move'
  | 'Flag'
  | 'Announce';

export interface ApActivity extends ApObject {
  type: ActivityType;
  actor: ObjectOrUri<ApActor> | string;
  object?: ObjectOrUri | ObjectOrUri[];
  target?: ObjectOrUri;
  origin?: ObjectOrUri;
  result?: ObjectOrUri;
}

/** コレクション(参加者一覧・資料一覧など) */
export interface ApCollection extends ApObject {
  type: 'Collection' | 'OrderedCollection';
  totalItems?: number;
  items?: ObjectOrUri[];
  orderedItems?: ObjectOrUri[];
  first?: ObjectOrUri<ApCollectionPage>;
  last?: ObjectOrUri<ApCollectionPage>;
}

export interface ApCollectionPage extends ApObject {
  type: 'CollectionPage' | 'OrderedCollectionPage';
  partOf?: string;
  next?: string;
  prev?: string;
  items?: ObjectOrUri[];
  orderedItems?: ObjectOrUri[];
}
