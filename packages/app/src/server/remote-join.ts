/**
 * Fediverse からのリモート参加申込(docs/DECISIONS.md の Join 写像)。
 *
 * 経路は2つ:
 * - Join アクティビティ(Mobilizon 等) → Accept / TentativeAccept / Reject を返す
 * - 告知 Note へのリプライ(Misskey / Mastodon)→ 結果をリプライ Note で返す
 *
 * どちらもイベント側 remoteJoinMethods と枠側 allowRemote の両方が
 * 許可されている場合のみ受け付ける。リモートアクターは統一アクターモデルの
 * エイリアス行(remote_unclaimed)としてそのまま participations に入る。
 */
import { activities, AS_CONTEXT, type ApActivity, type ApObject } from '@yorox/ap';
import { escapeHtml } from '../lib/html';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import {
  AlreadyJoinedError,
  cancelParticipation,
  ConditionNotMetError,
  joinSlot,
  SlotFullError,
} from '../domain/participation';
import { ulid } from '../lib/ulid';
import { deliverWithRetry } from './ap-delivery';
import { getSlotCoordinator } from './coordinator';

const ULID_PATTERN = '[0-9A-HJKMNP-TV-Z]{26}';
const EVENT_URI_RE = new RegExp(`/events/(${ULID_PATTERN})(?:/note)?$`);

type RemoteActorRow = typeof schema.actors.$inferSelect;
type EventRow = typeof schema.events.$inferSelect;
type GroupRow = typeof schema.actors.$inferSelect;

/** イベント URI / 告知 Note URI からイベント ID を取り出す */
export function eventIdFromUri(uri: string): string | null {
  const m = EVENT_URI_RE.exec(uri);
  return m ? m[1]! : null;
}

/**
 * リプライ本文からコマンドを読み取る。
 * HTML タグとメンションを落とし、先頭語で判定する。
 */
export function parseReplyCommand(contentHtml: string): 'join' | 'cancel' | null {
  const text = contentHtml
    .replace(/<[^>]*>/g, ' ')
    .replace(/@[\p{L}\p{N}_.@-]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (/^(参加|さんか|join|出席|出ます|行きます)/.test(text)) return 'join';
  if (/^(キャンセル|cancel|不参加|欠席|やめます)/.test(text)) return 'cancel';
  return null;
}

export interface RemoteJoinResult {
  outcome: 'accepted' | 'waitlisted' | 'applied' | 'cancelled' | 'rejected';
  /** 人間可読の説明(リプライ返信・Reject summary に使う) */
  message: string;
}

/** リモート申込を受け付けて参加処理する */
export async function processRemoteJoin(
  db: Db,
  input: {
    event: EventRow;
    group: GroupRow;
    remoteActor: RemoteActorRow;
    method: 'reply' | 'join';
    now?: Date;
  },
): Promise<RemoteJoinResult> {
  const methods = input.event.remoteJoinMethods ?? [];
  if (!methods.includes(input.method)) {
    return {
      outcome: 'rejected',
      message:
        input.method === 'reply'
          ? 'このイベントはリプライでの参加申込を受け付けていません。イベントページからお申し込みください。'
          : 'このイベントは Join アクティビティでの参加申込を受け付けていません。イベントページからお申し込みください。',
    };
  }

  const slots = await db.query.slots.findMany({
    where: and(
      eq(schema.slots.eventId, input.event.id),
      eq(schema.slots.allowRemote, true),
    ),
    orderBy: [asc(schema.slots.sortOrder), asc(schema.slots.createdAt)],
  });
  const slot = slots[0];
  if (!slot) {
    return {
      outcome: 'rejected',
      message:
        'このイベントにはリモート参加を受け付けている枠がありません。イベントページからお申し込みください。',
    };
  }

  try {
    const coordinator = await getSlotCoordinator();
    const deps = coordinator ? { slotCoordinator: coordinator } : {};
    const result = await joinSlot(
      db,
      { slotId: slot.id, actorId: input.remoteActor.id, now: input.now ?? new Date() },
      deps,
    );
    switch (result.status) {
      case 'accepted':
        return { outcome: 'accepted', message: `「${slot.name}」への参加を受け付けました。参加確定です!` };
      case 'waitlisted':
        return {
          outcome: 'waitlisted',
          message: `「${slot.name}」は満席のため補欠として受け付けました。繰り上がったらお知らせします。`,
        };
      case 'applied':
        return {
          outcome: 'applied',
          message: `「${slot.name}」(抽選)への申込を受け付けました。結果をお知らせします。`,
        };
    }
  } catch (err) {
    if (err instanceof AlreadyJoinedError) {
      return { outcome: 'rejected', message: 'すでにこのイベントに申込済みです。' };
    }
    if (err instanceof ConditionNotMetError) {
      return { outcome: 'rejected', message: `参加条件を満たしていません: ${err.message}` };
    }
    if (err instanceof SlotFullError) {
      return { outcome: 'rejected', message: '満席のため受け付けられませんでした。' };
    }
    throw err;
  }
}

/** リモートのキャンセル(Undo(Join) / リプライ「キャンセル」) */
export async function processRemoteCancel(
  db: Db,
  input: { event: EventRow; remoteActor: RemoteActorRow; now?: Date },
): Promise<RemoteJoinResult> {
  const slots = await db.query.slots.findMany({
    where: eq(schema.slots.eventId, input.event.id),
  });
  if (slots.length > 0) {
    const participation = await db.query.participations.findFirst({
      where: and(
        inArray(
          schema.participations.slotId,
          slots.map((s) => s.id),
        ),
        eq(schema.participations.actorId, input.remoteActor.id),
      ),
    });
    if (participation && participation.status !== 'cancelled') {
      await cancelParticipation(db, participation.id, input.now ?? new Date());
      return { outcome: 'cancelled', message: '参加をキャンセルしました。' };
    }
  }
  return { outcome: 'rejected', message: 'このイベントへの申込が見つかりませんでした。' };
}

/** 相手のフルハンドル(@user@domain) */
function fullHandle(actor: RemoteActorRow): string {
  return actor.handle && actor.domain ? `@${actor.handle}@${actor.domain}` : actor.uri;
}

/**
 * 結果をリプライ Note(宛先指定 = ダイレクト相当)で返す。
 * Accept 等のアクティビティは Misskey / Mastodon のタイムラインに
 * 表示されないため、リプライ経由の申込には人間可読の返信を返す。
 */
export async function sendReplyNote(
  db: Db,
  input: {
    group: GroupRow;
    remoteActor: RemoteActorRow;
    /** 省略時はリプライではなく単独のダイレクト Note になる */
    inReplyToUri?: string | undefined;
    /** 省略時は /notes/ 配下の URI になる(claim 完了通知など) */
    eventId?: string | undefined;
    text: string;
  },
): Promise<void> {
  const origin = new URL(input.group.uri).origin;
  const handle = fullHandle(input.remoteActor);
  const idBase = input.eventId
    ? `${origin}/events/${input.eventId}/replies`
    : `${origin}/notes`;
  const note: ApObject = {
    '@context': AS_CONTEXT,
    id: `${idBase}/${ulid()}`,
    type: 'Note',
    attributedTo: input.group.uri,
    to: [input.remoteActor.uri],
    content: `<p><a href="${escapeHtml(input.remoteActor.uri)}" rel="noreferrer">${escapeHtml(handle)}</a> ${escapeHtml(input.text)}</p>`,
    mediaType: 'text/html',
    published: new Date().toISOString(),
    tag: [{ type: 'Mention', href: input.remoteActor.uri, name: handle }],
  };
  if (input.inReplyToUri) note.inReplyTo = input.inReplyToUri;
  const create = activities.create(input.group.uri, note, {
    id: `${note.id}/activity`,
    to: input.remoteActor.uri,
    published: note.published as string,
  });
  const inboxUrl = input.remoteActor.sharedInboxUrl ?? input.remoteActor.inboxUrl;
  if (!inboxUrl) return;
  await deliverWithRetry(db, {
    signerActorId: input.group.id,
    inboxUrl,
    activity: create,
  });
}

/** Join アクティビティへの応答(Accept / TentativeAccept / Reject) */
export async function sendJoinResponse(
  db: Db,
  input: {
    group: GroupRow;
    remoteActor: RemoteActorRow;
    joinActivity: ApActivity;
    result: RemoteJoinResult;
  },
): Promise<void> {
  const origin = new URL(input.group.uri).origin;
  const init = {
    id: `${origin}/activities/${ulid()}`,
    to: input.remoteActor.uri,
    published: new Date().toISOString(),
  };
  let response: ApActivity;
  switch (input.result.outcome) {
    case 'accepted':
      response = activities.accept(input.group.uri, input.joinActivity, init);
      break;
    case 'waitlisted':
    case 'applied':
      response = activities.tentativeAccept(input.group.uri, input.joinActivity, init);
      break;
    default:
      response = activities.reject(input.group.uri, input.joinActivity, input.result.message, init);
      break;
  }
  const inboxUrl = input.remoteActor.sharedInboxUrl ?? input.remoteActor.inboxUrl;
  if (!inboxUrl) return;
  await deliverWithRetry(db, {
    signerActorId: input.group.id,
    inboxUrl,
    activity: response,
  });
}
