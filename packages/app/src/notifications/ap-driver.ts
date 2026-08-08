/**
 * リモート参加者向けの AP 通知ドライバ。
 * メールアドレスを持たない Fediverse エイリアスアカウントに、
 * 主催グループ名義のダイレクト Note(メンション付き)で
 * 繰上・抽選結果などを届ける。
 */
import { activities, AS_CONTEXT, type ApObject } from '@yorox/ap';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { deliverWithRetry } from '../server/ap-delivery';
import type { Notification, NotificationDriver } from './driver';

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

export class ApNoteDriver implements NotificationDriver {
  readonly name = 'ap-note';

  constructor(private readonly db: Db) {}

  async send(n: Notification): Promise<void> {
    if (!n.slotId) return;
    const recipient = await this.db.query.actors.findFirst({
      where: eq(schema.actors.id, n.actorId),
    });
    // ローカルアカウントはメール等の既存ドライバが担当する
    if (!recipient || recipient.state === 'local') return;
    const inboxUrl = recipient.sharedInboxUrl ?? recipient.inboxUrl;
    if (!inboxUrl) return;

    const slot = await this.db.query.slots.findFirst({
      where: eq(schema.slots.id, n.slotId),
    });
    if (!slot) return;
    const event = await this.db.query.events.findFirst({
      where: eq(schema.events.id, slot.eventId),
    });
    if (!event) return;
    const group = await this.db.query.actors.findFirst({
      where: eq(schema.actors.id, event.groupActorId),
    });
    if (!group) return;

    const origin = new URL(group.uri).origin;
    const eventUrl = group.handle
      ? `${origin}/g/${group.handle}/events/${event.id}`
      : `${origin}/events/${event.id}`;
    const handle =
      recipient.handle && recipient.domain
        ? `@${recipient.handle}@${recipient.domain}`
        : recipient.uri;

    const note: ApObject = {
      '@context': AS_CONTEXT,
      id: `${origin}/events/${event.id}/replies/${ulid()}`,
      type: 'Note',
      attributedTo: group.uri,
      to: [recipient.uri],
      content: `<p><a href="${escapeHtml(recipient.uri)}" rel="noreferrer">${escapeHtml(handle)}</a> 【${escapeHtml(event.title)}】${escapeHtml(n.bodyText)}</p><p><a href="${escapeHtml(eventUrl)}" rel="noreferrer">${escapeHtml(eventUrl)}</a></p>`,
      mediaType: 'text/html',
      published: new Date().toISOString(),
      tag: [{ type: 'Mention', href: recipient.uri, name: handle }],
    };
    const create = activities.create(group.uri, note, {
      id: `${note.id}/activity`,
      to: recipient.uri,
      published: note.published as string,
    });
    await deliverWithRetry(this.db, {
      signerActorId: group.id,
      inboxUrl,
      activity: create,
    });
  }
}
