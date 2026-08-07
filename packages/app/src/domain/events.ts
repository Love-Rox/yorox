/**
 * ドメインイベント(通知 outbox)の発行。
 * ディスパッチャ(src/notifications)が未処理分を拾ってドライバへ配る。
 */
import type { Db } from '../db/client';
import { schema } from '../db/client';
import { ulid } from '../lib/ulid';

export type DomainEventType =
  | 'participation.accepted'
  | 'participation.waitlisted'
  | 'participation.applied'
  | 'participation.rejected'
  | 'participation.cancelled'
  | 'participation.promoted'
  | 'participation.consent_requested'
  | 'lottery.completed'
  | 'event.published';

export async function emitDomainEvent(
  db: Db,
  type: DomainEventType,
  payload: Record<string, unknown>,
  now: Date = new Date(),
): Promise<void> {
  await db.insert(schema.domainEvents).values({
    id: ulid(),
    type,
    payload,
    createdAt: now,
  });
}
