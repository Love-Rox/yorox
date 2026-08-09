/**
 * Yorox のデータスキーマ(D1 / SQLite + Drizzle)。
 *
 * 設計の根拠は docs/DECISIONS.md を参照。
 * - 統一アクターモデル: ローカル/リモートを同一テーブルで扱う
 * - イベントの所有者は常にグループ(個人主催 = 個人グループ)
 * - 枠(スロット)は5要素の枠ポリシーを持つ
 * - ID は ULID。AP オブジェクト URI の不変部分になるため再割当しない
 */
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// ---------------------------------------------------------------------------
// アクター(統一モデル)
// ---------------------------------------------------------------------------

export const actors = sqliteTable(
  'actors',
  {
    id: text('id').primaryKey(), // ULID
    /** user = 人間(Person)。group = グループ(Group) */
    kind: text('kind', { enum: ['user', 'group'] }).notNull(),
    /**
     * local          = このインスタンスのアカウント
     * remote_unclaimed = リモートユーザーの自動生成エイリアス(未claim)
     * remote_claimed   = claim 済みリモートアカウント
     */
    state: text('state', {
      enum: ['local', 'remote_unclaimed', 'remote_claimed'],
    }).notNull(),
    /** ローカルアクターのハンドル。ユーザーとグループで単一の名前空間 */
    handle: text('handle'),
    /** リモートアクターのドメイン。ローカルは null */
    domain: text('domain'),
    /** AP アクター URI(ローカルは https://{host}/users/{id} 等)。露出前でも予約する */
    uri: text('uri').notNull(),
    inboxUrl: text('inbox_url'),
    sharedInboxUrl: text('shared_inbox_url'),
    displayName: text('display_name').notNull(),
    summary: text('summary'),
    avatarUrl: text('avatar_url'),
    /** プロフィールのリンク(SNS・サイト等の URL 配列) */
    profileLinks: text('profile_links', { mode: 'json' }).$type<string[]>(),
    /** リモートアクターのカスタム絵文字(shortcode → 画像 URL)。表示名の :code: 置換用 */
    emojis: text('emojis', { mode: 'json' }).$type<Record<string, string>>(),
    /** AP 用 RSA 鍵ペア(PEM)。アクター文書の初回参照時に遅延生成 */
    publicKeyPem: text('public_key_pem'),
    privateKeyPem: text('private_key_pem'),
    /** アカウント統合(Move)で吸収された側が向き先を持つ */
    movedToActorId: text('moved_to_actor_id'),
    /** claim 済みリモートエイリアスが紐付くローカルユーザーの actorId */
    claimedByActorId: text('claimed_by_actor_id'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('actors_uri_unique').on(t.uri),
    // ユーザーと個人グループは同じ handle を共有できる(docs/OPEN-QUESTIONS.md #2)。
    // DB 制約は kind 込みの一意までとし、personal ペア以外の cross-kind 重複はアプリ層で禁止する
    uniqueIndex('actors_handle_domain_kind_unique').on(t.handle, t.domain, t.kind),
    index('actors_kind_idx').on(t.kind),
  ],
);

/**
 * AP フォロー関係。followerActorId(リモート/ローカル問わず actors 行)が
 * followedActorId(当面はローカルグループ)をフォローする。
 * 受理即 accepted(承認制は将来拡張)。Undo(Follow) で行削除。
 */
export const follows = sqliteTable(
  'follows',
  {
    id: text('id').primaryKey(), // ULID
    followerActorId: text('follower_actor_id')
      .notNull()
      .references(() => actors.id),
    followedActorId: text('followed_actor_id')
      .notNull()
      .references(() => actors.id),
    /** 受信した Follow アクティビティの id(Undo 照合・Accept の object 用) */
    activityUri: text('activity_uri'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('follows_pair_unique').on(t.followerActorId, t.followedActorId),
    index('follows_followed_idx').on(t.followedActorId),
  ],
);

/**
 * AP アクティビティの配信キュー(server-to-server)。
 * mail_queue と同じ思想: fan-out 時に行を作り、cron がバックオフ付きで配信する。
 */
export const apDeliveries = sqliteTable(
  'ap_deliveries',
  {
    id: text('id').primaryKey(), // ULID
    /** 署名に使うローカルアクター(通常は主催グループ) */
    signerActorId: text('signer_actor_id')
      .notNull()
      .references(() => actors.id),
    inboxUrl: text('inbox_url').notNull(),
    /** アクティビティ id。(activityUri, inboxUrl) で冪等化(即時配信と cron の二重積み防止) */
    activityUri: text('activity_uri'),
    activityJson: text('activity_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: integer('next_attempt_at', { mode: 'timestamp_ms' }).notNull(),
    lastError: text('last_error'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('ap_deliveries_pending_idx').on(t.sentAt, t.nextAttemptAt),
    uniqueIndex('ap_deliveries_activity_inbox_unique').on(t.activityUri, t.inboxUrl),
  ],
);

/**
 * claim 用ワンタイムコード。設定画面で発行し、リモートアカウントから
 * コードをメンション投稿する(署名検証で本人性を担保)ことで紐付ける。
 */
export const claimCodes = sqliteTable(
  'claim_codes',
  {
    id: text('id').primaryKey(), // ULID
    userActorId: text('user_actor_id')
      .notNull()
      .references(() => actors.id),
    /** コードの SHA-256(hex)。平文は保存しない */
    codeHash: text('code_hash').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  },
  (t) => [uniqueIndex('claim_codes_hash_unique').on(t.codeHash)],
);

/** ローカルユーザーの認証・連絡先情報(actors と 1:1) */
export const users = sqliteTable('users', {
  actorId: text('actor_id')
    .primaryKey()
    .references(() => actors.id),
  email: text('email').notNull().unique(),
  emailVerifiedAt: integer('email_verified_at', { mode: 'timestamp_ms' }),
  /** 参加状況などのお知らせをメールで受け取るか(ログイン用メールは対象外) */
  emailNotifications: integer('email_notifications', { mode: 'boolean' })
    .notNull()
    .default(true),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

// ---------------------------------------------------------------------------
// 認証(docs/OPEN-QUESTIONS.md #5〜#7)
// ---------------------------------------------------------------------------

/**
 * ログインセッション。httpOnly cookie にトークンを持たせ、SHA-256 ハッシュを保存する。
 * D1 行の削除 = 即時失効。
 */
export const authSessions = sqliteTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    /** セッショントークンの SHA-256(hex)。平文は保存しない */
    tokenHash: text('token_hash').notNull(),
    userActorId: text('user_actor_id')
      .notNull()
      .references(() => users.actorId),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('auth_sessions_token_hash_unique').on(t.tokenHash),
    index('auth_sessions_user_idx').on(t.userActorId),
  ],
);

/**
 * マジックリンクのワンタイムトークン。
 * 既存ユーザーのログインと新規サインアップの両方で使う(メール検証を兼ねる)。
 */
export const loginTokens = sqliteTable(
  'login_tokens',
  {
    id: text('id').primaryKey(),
    /** トークンの SHA-256(hex) */
    tokenHash: text('token_hash').notNull(),
    email: text('email').notNull(),
    /** OAuth 経由サインアップのとき、登録完了時に自動リンクするプロバイダ情報 */
    oauthPayload: text('oauth_payload', { mode: 'json' }).$type<{
      provider: string;
      providerUserId: string;
      label: string;
    }>(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
  },
  (t) => [uniqueIndex('login_tokens_token_hash_unique').on(t.tokenHash)],
);

/** OAuth 連携アカウント(ログイン手段。1ユーザーが複数プロバイダを持てる) */
export const oauthAccounts = sqliteTable(
  'oauth_accounts',
  {
    id: text('id').primaryKey(), // ULID
    provider: text('provider', { enum: ['github', 'google'] }).notNull(),
    /** プロバイダ側の不変ユーザー ID(GitHub id / Google sub) */
    providerUserId: text('provider_user_id').notNull(),
    userActorId: text('user_actor_id')
      .notNull()
      .references(() => users.actorId),
    /** 表示用ラベル(GitHub ログイン名、Google メールアドレスなど) */
    label: text('label'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('oauth_accounts_provider_user_unique').on(t.provider, t.providerUserId),
    index('oauth_accounts_user_idx').on(t.userActorId),
  ],
);

// ---------------------------------------------------------------------------
// グループ
// ---------------------------------------------------------------------------

export const groups = sqliteTable('groups', {
  actorId: text('actor_id')
    .primaryKey()
    .references(() => actors.id),
  /** 個人グループ(GitHub のユーザー名前空間方式)かどうか */
  isPersonal: integer('is_personal', { mode: 'boolean' }).notNull().default(false),
  descriptionMd: text('description_md'),
  /**
   * Bluesky クロスポスト用の認証情報(任意)。
   * App Password は失効可能な専用パスワードを登録してもらう
   * (docs/DECISIONS.md: AT Protocol はネイティブ連合せずクロスポストで橋渡し)
   */
  bskyIdentifier: text('bsky_identifier'),
  bskyAppPassword: text('bsky_app_password'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * カスタムロール。permissions は権限フラグ文字列の JSON 配列。
 * 例: ["event.create", "event.edit", "attendance.manage", "lottery.run",
 *      "member.manage", "group.settings"]
 * プリセット(オーナー/共同主催/メンバー)はグループ作成時に投入する。
 */
export const groupRoles = sqliteTable(
  'group_roles',
  {
    id: text('id').primaryKey(),
    groupActorId: text('group_actor_id')
      .notNull()
      .references(() => groups.actorId),
    name: text('name').notNull(),
    permissions: text('permissions', { mode: 'json' }).$type<string[]>().notNull(),
    isPreset: integer('is_preset', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('group_roles_group_idx').on(t.groupActorId)],
);

export const groupMembers = sqliteTable(
  'group_members',
  {
    groupActorId: text('group_actor_id')
      .notNull()
      .references(() => groups.actorId),
    memberActorId: text('member_actor_id')
      .notNull()
      .references(() => actors.id),
    roleId: text('role_id')
      .notNull()
      .references(() => groupRoles.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupActorId, t.memberActorId] }),
    index('group_members_member_idx').on(t.memberActorId),
  ],
);

// ---------------------------------------------------------------------------
// イベント
// ---------------------------------------------------------------------------

export const events = sqliteTable(
  'events',
  {
    id: text('id').primaryKey(), // ULID = AP オブジェクト URI の不変部分
    groupActorId: text('group_actor_id')
      .notNull()
      .references(() => groups.actorId),
    title: text('title').notNull(),
    descriptionMd: text('description_md'),
    /** 参加確定者(と主催)だけに表示する案内(接続URL・会場の入館方法など) */
    participantInfoMd: text('participant_info_md'),
    /** サムネイル画像 URL(外部リンク。OGP og:image にも使う) */
    thumbnailUrl: text('thumbnail_url'),
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }).notNull(),
    endsAt: integer('ends_at', { mode: 'timestamp_ms' }),
    /** IANA タイムゾーン名(例: Asia/Tokyo)。表示用 */
    timezone: text('timezone').notNull().default('Asia/Tokyo'),
    venueName: text('venue_name'),
    venueAddress: text('venue_address'),
    /** 住所から保存時にジオコーディングした座標(地図表示用。失敗時は null) */
    venueLat: real('venue_lat'),
    venueLng: real('venue_lng'),
    onlineUrl: text('online_url'),
    /** セッション欄の表示ラベル(「セッション」/「タイムテーブル」) */
    sessionsLabel: text('sessions_label', { enum: ['sessions', 'timetable'] })
      .notNull()
      .default('sessions'),
    /** draft は下書き。public のみ一覧・連合に流通する */
    visibility: text('visibility', { enum: ['draft', 'public'] })
      .notNull()
      .default('draft'),
    /** 参加者一覧の公開(デフォルト公開 = Connpass 流) */
    participantListPublic: integer('participant_list_public', { mode: 'boolean' })
      .notNull()
      .default(true),
    /**
     * Fediverse からの参加申込を受け付ける方法(イベント単位で選択)。
     * reply = 告知 Note へのリプライ / join = Join アクティビティ(Mobilizon 等)。
     * 実際に申込可能かは枠側の allowRemote も必要。
     */
    remoteJoinMethods: text('remote_join_methods', { mode: 'json' })
      .$type<('reply' | 'join')[]>()
      .notNull()
      .default(['reply', 'join']),
    /** セルフチェックイン用トークン(QR に載せる)。null = 無効 */
    checkinToken: text('checkin_token'),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }),
    /** 予約公開時刻。draft のままこの時刻を過ぎると cron が自動公開する */
    publishAt: integer('publish_at', { mode: 'timestamp_ms' }),
    createdByActorId: text('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('events_group_idx').on(t.groupActorId),
    index('events_starts_at_idx').on(t.startsAt),
  ],
);

/** 発表/セッション(任意機能の一級エンティティ) */
export const eventSessions = sqliteTable(
  'event_sessions',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    title: text('title').notNull(),
    descriptionMd: text('description_md'),
    /** 登壇者。ローカル/リモート問わずアクター参照(任意) */
    speakerActorId: text('speaker_actor_id').references(() => actors.id),
    /** アクターに紐付かない登壇者名(外部ゲスト等) */
    speakerName: text('speaker_name'),
    /** 登壇者のリンク(SNS・サイト等)。ホスト名からサービスアイコンを判定して表示 */
    speakerUrl: text('speaker_url'),
    startsAt: integer('starts_at', { mode: 'timestamp_ms' }),
    endsAt: integer('ends_at', { mode: 'timestamp_ms' }),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('event_sessions_event_idx').on(t.eventId)],
);

/** 資料。紐付け先はイベント直下かセッションのどちらか(MVP は外部リンクのみ) */
export const materials = sqliteTable(
  'materials',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    sessionId: text('session_id').references(() => eventSessions.id),
    title: text('title').notNull(),
    url: text('url').notNull(),
    createdByActorId: text('created_by_actor_id')
      .notNull()
      .references(() => actors.id),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('materials_event_idx').on(t.eventId)],
);

// ---------------------------------------------------------------------------
// 参加枠(スロット)と枠ポリシー5要素
// ---------------------------------------------------------------------------

/** 参加条件の宣言的ルール(AND で評価) */
export interface SlotConditions {
  /** claim 済み(またはローカル)アカウントのみ */
  requireClaimed?: boolean;
  /** アカウント作成からの最低日数 */
  minAccountAgeDays?: number;
  /** 過去の参加実績の最低回数 */
  minAttendedCount?: number;
}

export const slots = sqliteTable(
  'slots',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id),
    name: text('name').notNull(),
    capacity: integer('capacity').notNull(),
    /** 1. 方式 */
    method: text('method', { enum: ['fcfs', 'lottery'] }).notNull(),
    /** 2. 補欠モデル: connpass = 落選は自動的に補欠 / separate = 補欠数を主催が設定 */
    waitlistModel: text('waitlist_model', { enum: ['connpass', 'separate'] })
      .notNull()
      .default('connpass'),
    /** separate のときの補欠定員(connpass のときは null = 無制限) */
    waitlistCapacity: integer('waitlist_capacity'),
    /** 3. 繰上ポリシー */
    promotionPolicy: text('promotion_policy', {
      enum: ['auto', 'auto_deadline', 'consent'],
    })
      .notNull()
      .default('auto'),
    /** auto_deadline のとき: 開催 X 時間前で繰上停止 */
    promotionDeadlineHours: integer('promotion_deadline_hours'),
    /** 4. 抽選ロジック(method = lottery のときのみ) */
    lotteryLogic: text('lottery_logic', { enum: ['random', 'manual', 'weighted'] }),
    /** 抽選実行予定時刻 */
    lotteryAt: integer('lottery_at', { mode: 'timestamp_ms' }),
    /** 5. 参加条件(AND 組合せ)。null = 無条件 */
    conditions: text('conditions', { mode: 'json' }).$type<SlotConditions>(),
    /** Fediverse からのリモート参加を受け入れるか(主催者が枠ごとに明示) */
    allowRemote: integer('allow_remote', { mode: 'boolean' }).notNull().default(false),
    /** 登壇枠(LT 枠など)。参加確定者はイベントページの登壇者欄にも表示される */
    isSpeakerSlot: integer('is_speaker_slot', { mode: 'boolean' }).notNull().default(false),
    /** 参加費(通貨最小単位。JPY なら円)。null = 無料 */
    price: integer('price'),
    currency: text('currency').notNull().default('JPY'),
    /** 支払方法: onsite = 現地払い / external = 外部決済リンク。null = 無料枠 */
    paymentMethod: text('payment_method', { enum: ['onsite', 'external'] }),
    /** external のときの決済 URL(Stripe Payment Links 等) */
    paymentUrl: text('payment_url'),
    /**
     * 確定条件: independent = 申込/当選で確定(支払いは別管理、Connpass 流)
     *            required   = 支払い確認で確定(それまで payment_pending で定員は保持)
     */
    paymentConfirm: text('payment_confirm', { enum: ['independent', 'required'] })
      .notNull()
      .default('independent'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('slots_event_idx').on(t.eventId)],
);

/**
 * 参加。状態遷移:
 *   applied(申込) → accepted(確定) / waitlisted(補欠・抽選待ち) / rejected(拒否)
 *   waitlisted → accepted(繰上) / consent_pending(承諾待ち繰上) → accepted
 *   任意の状態 → cancelled(本人キャンセル)
 * AP 写像: waitlisted = TentativeAccept、accepted = Accept、rejected = Reject
 */
export const participations = sqliteTable(
  'participations',
  {
    id: text('id').primaryKey(),
    slotId: text('slot_id')
      .notNull()
      .references(() => slots.id),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id),
    status: text('status', {
      enum: [
        'applied',
        'accepted',
        'payment_pending',
        'waitlisted',
        'consent_pending',
        'rejected',
        'cancelled',
      ],
    }).notNull(),
    /** 参加者一覧から自分を隠すオプトアウト */
    hiddenFromList: integer('hidden_from_list', { mode: 'boolean' })
      .notNull()
      .default(false),
    appliedAt: integer('applied_at', { mode: 'timestamp_ms' }).notNull(),
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
    cancelledAt: integer('cancelled_at', { mode: 'timestamp_ms' }),
  },
  (t) => [
    uniqueIndex('participations_slot_actor_unique').on(t.slotId, t.actorId),
    index('participations_actor_idx').on(t.actorId),
    index('participations_slot_status_idx').on(t.slotId, t.status),
  ],
);

/** 出欠記録。no-show は抽選の重み付けと主催への表示に使う */
export const attendances = sqliteTable('attendances', {
  participationId: text('participation_id')
    .primaryKey()
    .references(() => participations.id),
  status: text('status', { enum: ['attended', 'no_show'] }).notNull(),
  recordedByActorId: text('recorded_by_actor_id')
    .notNull()
    .references(() => actors.id),
  recordedAt: integer('recorded_at', { mode: 'timestamp_ms' }).notNull(),
});

// ---------------------------------------------------------------------------
// メール送信キュー(docs/MAIL.md)
// ---------------------------------------------------------------------------

/**
 * メールの送信キュー。通知メールはここに積まれ、Cron がレート制御しながら
 * トランスポート(Resend / SMTP)経由で送る。
 * マジックリンク等の即時性が必要なメールはキューを通さず直接送る。
 */
export const mailQueue = sqliteTable(
  'mail_queue',
  {
    id: text('id').primaryKey(),
    toEmail: text('to_email').notNull(),
    subject: text('subject').notNull(),
    bodyText: text('body_text').notNull(),
    status: text('status', { enum: ['pending', 'sent', 'failed'] })
      .notNull()
      .default('pending'),
    /** 送信試行回数。上限に達すると failed */
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    /** この時刻以降に送る(再試行のバックオフに使う) */
    scheduledAt: integer('scheduled_at', { mode: 'timestamp_ms' }).notNull(),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    index('mail_queue_pending_idx').on(t.status, t.scheduledAt),
    index('mail_queue_sent_at_idx').on(t.sentAt),
  ],
);

// ---------------------------------------------------------------------------
// 決済(docs/DECISIONS.md 追記参照。将来の Stripe 等は PaymentProvider IF で拡張)
// ---------------------------------------------------------------------------

/**
 * 参加に紐づく支払い記録。
 * MVP は現地払い/外部決済リンクで、確認は主催の手動マーク。
 * 将来 Stripe 統合時は provider/provider_ref に Checkout 情報を持たせ、
 * webhook がここを 'paid' にする。
 */
export const payments = sqliteTable(
  'payments',
  {
    id: text('id').primaryKey(),
    participationId: text('participation_id')
      .notNull()
      .references(() => participations.id),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('JPY'),
    method: text('method', { enum: ['onsite', 'external'] }).notNull(),
    status: text('status', {
      enum: ['pending', 'paid', 'refund_required', 'refunded', 'waived'],
    })
      .notNull()
      .default('pending'),
    /** 将来の決済プロバイダ識別子(stripe 等)と外部参照 */
    provider: text('provider'),
    providerRef: text('provider_ref'),
    /** 手動マークした主催者 */
    markedByActorId: text('marked_by_actor_id').references(() => actors.id),
    paidAt: integer('paid_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [
    uniqueIndex('payments_participation_unique').on(t.participationId),
    index('payments_status_idx').on(t.status),
  ],
);

// ---------------------------------------------------------------------------
// 通知(プラガブルドライバ)とアクション要求
// ---------------------------------------------------------------------------

/**
 * ドメインイベントの outbox。ディスパッチャが未処理分を拾って
 * 通知ドライバ(MVP はメールのみ)へ配る。
 */
export const domainEvents = sqliteTable(
  'domain_events',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(), // 例: 'participation.accepted'
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    processedAt: integer('processed_at', { mode: 'timestamp_ms' }),
  },
  (t) => [index('domain_events_unprocessed_idx').on(t.processedAt, t.createdAt)],
);

/**
 * アクション要求(承諾型繰上など「本人が応答しないと進まない」もの)。
 * 通知ドライバとは別の一級概念。配達保証・既読管理が必要。
 */
export const actionRequests = sqliteTable(
  'action_requests',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id),
    type: text('type').notNull(), // 例: 'promotion.consent'
    payload: text('payload', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    status: text('status', {
      enum: ['pending', 'completed', 'declined', 'expired', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    respondedAt: integer('responded_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (t) => [index('action_requests_actor_status_idx').on(t.actorId, t.status)],
);
