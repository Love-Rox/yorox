/**
 * リモート参加者向けの AP 通知ドライバ。
 * メールアドレスを持たない Fediverse エイリアスアカウントに、
 * 主催グループ名義のダイレクト Note(メンション付き)で
 * 繰上・抽選結果などを届ける。
 */
import { activities, AS_CONTEXT, type ApObject } from '@yorox/ap';
import { escapeHtml } from '../lib/html';
import { and, eq, isNotNull } from 'drizzle-orm';
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';
import { deliverWithRetry } from '../server/ap-delivery';
import type { Notification, NotificationDriver } from './driver';

type ActorRow = typeof schema.actors.$inferSelect;

/**
 * AP 通知ドライバ。
 * - 宛先がリモート(Fediverse エイリアス)なら、そのアカウントへメンションで届ける
 *   (メールを持たない参加者への唯一の到達手段)
 * - 宛先がローカルユーザーで、連携 Fediverse への通知を有効にしているなら、
 *   その人が連携(claim)したリモートアカウントへメンションで届ける
 */
export class ApNoteDriver implements NotificationDriver {
  readonly name = 'ap-note';

  constructor(private readonly db: Db) {}

  async send(n: Notification): Promise<void> {
    if (!n.slotId) return;
    if (!n.allowAp) return;
    const actor = await this.db.query.actors.findFirst({
      where: eq(schema.actors.id, n.actorId),
    });
    if (!actor) return;

    // 届け先(inbox を持つリモートアクター)を決める
    let recipients: ActorRow[];
    if (actor.state === 'local') {
      const aliases = await this.db.query.actors.findMany({
        where: and(
          eq(schema.actors.claimedByActorId, actor.id),
          isNotNull(schema.actors.domain),
        ),
      });
      // ユーザーが宛先を選んでいれば、その ID に絞る(null = 全連携アカウント)
      const user = await this.db.query.users.findFirst({
        where: eq(schema.users.actorId, actor.id),
      });
      const targets = user?.notifyApTargets ?? null;
      recipients = targets ? aliases.filter((a) => targets.includes(a.id)) : aliases;
    } else {
      recipients = [actor];
    }
    if (recipients.length === 0) return;

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

    for (const recipient of recipients) {
      const inboxUrl = recipient.sharedInboxUrl ?? recipient.inboxUrl;
      if (!inboxUrl) continue;
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
}
