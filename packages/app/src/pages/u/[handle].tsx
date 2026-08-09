import { and, desc, eq, isNull } from 'drizzle-orm';
import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { Avatar } from '../../components/avatar';
import { ActorKindBadge, ActorKindMark } from '../../components/actor-kind';
import { ServiceIcon } from '../../components/service-icon';
import { Markdown } from '../../lib/markdown';
import { schema } from '../../db/client';
import { getCurrentUser } from '../../server/current-user';
import { getDb } from '../../server/data';

const DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeZone: 'Asia/Tokyo',
});

export default async function UserProfilePage({ handle }: { handle: string }) {
  const db = await getDb();
  const actor = await db.query.actors.findFirst({
    where: and(
      eq(schema.actors.handle, handle),
      isNull(schema.actors.domain),
      eq(schema.actors.kind, 'user'),
    ),
  });
  if (!actor) return notFound();

  const me = await getCurrentUser();
  const isSelf = me?.actorId === actor.id;

  // 連携済み Fediverse アカウント(claim)。rel=me で相互リンクになる
  const fediAliases = await db.query.actors.findMany({
    where: eq(schema.actors.claimedByActorId, actor.id),
  });

  // 所属グループ(公開情報)
  const memberships = await db
    .select({
      handle: schema.actors.handle,
      displayName: schema.actors.displayName,
      isPersonal: schema.groups.isPersonal,
      roleName: schema.groupRoles.name,
    })
    .from(schema.groupMembers)
    .innerJoin(schema.actors, eq(schema.groupMembers.groupActorId, schema.actors.id))
    .innerJoin(schema.groups, eq(schema.groupMembers.groupActorId, schema.groups.actorId))
    .innerJoin(schema.groupRoles, eq(schema.groupMembers.roleId, schema.groupRoles.id))
    .where(eq(schema.groupMembers.memberActorId, actor.id));

  // 本人の個人グループ(= 主催ページ)。ハンドルを共有する
  const personalGroup = memberships.find((m) => m.isPersonal);

  // 公開イベントへの参加(本人が一覧非表示にしたものは除く)
  const participations = await db
    .select({
      eventId: schema.events.id,
      title: schema.events.title,
      startsAt: schema.events.startsAt,
      groupHandle: schema.actors.handle,
    })
    .from(schema.participations)
    .innerJoin(schema.slots, eq(schema.participations.slotId, schema.slots.id))
    .innerJoin(schema.events, eq(schema.slots.eventId, schema.events.id))
    .innerJoin(schema.actors, eq(schema.events.groupActorId, schema.actors.id))
    .where(
      and(
        eq(schema.participations.actorId, actor.id),
        eq(schema.participations.status, 'accepted'),
        eq(schema.participations.hiddenFromList, false),
        eq(schema.events.visibility, 'public'),
        eq(schema.events.participantListPublic, true),
      ),
    )
    .orderBy(desc(schema.events.startsAt))
    .limit(10);

  return (
    <div>
      <title>{`${actor.displayName} - Yorox`}</title>
      <header className="flex flex-wrap items-start gap-5">
        <Avatar avatarUrl={actor.avatarUrl} displayName={actor.displayName} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="display t-xl">{actor.displayName}</h1>
                <ActorKindBadge kind="user" />
              </div>
              <p className="meta-mono mt-1 text-sm text-neutral">@{actor.handle}</p>
              {personalGroup && (
                <p className="mt-1 text-sm text-neutral">
                  主催・イベントは{' '}
                  <Link to={`/g/${personalGroup.handle}`} className="link">
                    @{personalGroup.handle} の主催ページ
                  </Link>
                </p>
              )}
            </div>
            {isSelf && (
              <Link to="/settings/profile" className="btn-quiet">
                プロフィールを編集
              </Link>
            )}
          </div>
          {actor.profileLinks && actor.profileLinks.length > 0 && (
            <ul className="mt-3 flex flex-wrap gap-4 text-sm">
              {actor.profileLinks.map((link) => (
                <li key={link}>
                  <a
                    href={link}
                    className="link inline-flex items-center gap-1"
                    rel="me noreferrer"
                    target="_blank"
                  >
                    <ServiceIcon url={link} />
                    {new URL(link).hostname.replace(/^www\./, '')}
                  </a>
                </li>
              ))}
            </ul>
          )}
          {fediAliases.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-4 text-sm">
              {fediAliases.map((a) => (
                <li key={a.id}>
                  <a
                    href={a.uri}
                    className="link meta-mono inline-flex items-center gap-1"
                    rel="me noreferrer"
                    target="_blank"
                  >
                    <ServiceIcon url={a.uri} />
                    {a.domain === 'bsky' ? `@${a.handle}` : `@${a.handle}@${a.domain}`}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      {actor.summary && (
        <section className="mt-6">
          <Markdown source={actor.summary} />
        </section>
      )}

      {memberships.length > 0 && (
        <section className="mt-10">
          <h2 className="display border-b-2 border-ink pb-2 t-md">グループ</h2>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-2">
            {memberships.map((m) => (
              <li key={m.handle} className="flex items-center gap-1.5">
                <ActorKindMark kind="group" isPersonal={m.isPersonal} size={14} className="shrink-0" />
                <Link to={`/g/${m.handle}`} className="link font-bold">
                  {m.displayName}
                </Link>
                <span className="meta-mono text-sm text-neutral">
                  ({m.isPersonal ? '個人グループ' : m.roleName})
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {participations.length > 0 && (
        <section className="mt-10">
          <h2 className="display border-b-2 border-ink pb-2 t-md">参加イベント</h2>
          <ul>
            {participations.map((p) => (
              <li key={p.eventId} className="border-b border-rule py-3">
                <Link
                  to={`/g/${p.groupHandle}/events/${p.eventId}`}
                  className="event-row__title"
                >
                  {p.title}
                </Link>
                <div className="meta-mono mt-0.5 text-sm text-neutral">
                  {DATE_FMT.format(p.startsAt)}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
