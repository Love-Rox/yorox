/**
 * RSC からログイン中ユーザーを取得するヘルパー。
 * cookie → auth_sessions → actors を解決する。
 */
import { eq } from 'drizzle-orm';
import { unstable_getHeaders as getHeaders } from 'waku/router/server';
import { getSessionUserActorId, SESSION_COOKIE } from '../auth/session';
import { schema } from '../db/client';
import { getDb } from './data';

export interface CurrentUser {
  actorId: string;
  handle: string | null;
  displayName: string;
}

function readSessionToken(): string | undefined {
  const cookieHeader = getHeaders()['cookie'];
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return undefined;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const db = await getDb();
  const actorId = await getSessionUserActorId(db, readSessionToken());
  if (!actorId) return null;
  const actor = await db.query.actors.findFirst({
    where: eq(schema.actors.id, actorId),
  });
  if (!actor) return null;
  return {
    actorId: actor.id,
    handle: actor.handle,
    displayName: actor.displayName,
  };
}
