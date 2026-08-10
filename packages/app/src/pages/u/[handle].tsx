import { and, desc, eq, isNull } from 'drizzle-orm';
import { Link } from 'waku';
import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
} from 'waku/router/server';
import { Avatar } from '../../components/avatar';
import { FollowButton } from '../../components/follow-button';
import { ActorKindBadge, ActorKindMark } from '../../components/actor-kind';
import { ServiceIcon, serviceLinkLabel } from '../../components/service-icon';
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
  const { countFollowers } = await import('../../server/data');
  const { countFollowing, isFollowing } = await import('../../domain/follow');
  const followerCount = await countFollowers(db, actor.id);
  const followingCount = await countFollowing(db, actor.id);
  const following = me && !isSelf ? await isFollowing(db, me.actorId, actor.id) : false;

  // 連携済み Fediverse アカウント(claim)。rel=me で相互リンクになる
  const fediAliases = await db.query.actors.findMany({
    where: eq(schema.actors.claimedByActorId, actor.id),
  });

  // 本人が「プロフィールに表示」を選んだ連携アカウント(Google は対象外)
  const publicOauth = (
    await db.query.oauthAccounts.findMany({
      where: and(
        eq(schema.oauthAccounts.userActorId, actor.id),
        eq(schema.oauthAccounts.public, true),
      ),
    })
  ).filter((o) => o.provider !== 'google');

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
      {(() => {
        const origin = new URL(getRequest().url).origin;
        const desc = actor.summary
          ? actor.summary.replace(/[#*_`>\-]/g, '').slice(0, 120)
          : `${actor.displayName} のプロフィール - Yorox`;
        return (
          <>
            <meta property="og:type" content="profile" />
            <meta property="og:site_name" content="Yorox" />
            <meta property="og:title" content={actor.displayName} />
            <meta property="og:description" content={desc} />
            <meta property="og:url" content={`${origin}/u/${actor.handle}`} />
            <meta property="og:image" content={`${origin}/u/${actor.handle}/ogp.png`} />
            <meta property="og:image:width" content="1200" />
            <meta property="og:image:height" content="630" />
            <meta name="twitter:card" content="summary_large_image" />
            <meta name="description" content={desc} />
          </>
        );
      })()}
      <header className="flex flex-wrap items-start gap-5">
        <Avatar avatarUrl={actor.avatarUrl} displayName={actor.displayName} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="display t-xl">{actor.displayName}</h1>
                <ActorKindBadge kind="user" />
              </div>
              <p className="meta-mono mt-1 text-sm text-neutral">
                @{actor.handle}
                {followerCount > 0 && <span className="ml-3">フォロワー {followerCount}</span>}
                {followingCount > 0 && <span className="ml-3">フォロー {followingCount}</span>}
              </p>
              {personalGroup && (
                <p className="mt-1 text-sm text-neutral">
                  主催・イベントは{' '}
                  <Link to={`/g/${personalGroup.handle}`} className="link">
                    @{personalGroup.handle} の主催ページ
                  </Link>
                </p>
              )}
            </div>
            {me && !isSelf && (
              <FollowButton
                targetActorId={actor.id}
                following={following}
                backPath={`/u/${handle}`}
              />
            )}
            {isSelf && (
              <Link to="/settings/profile" className="btn-quiet">
                プロフィールを編集
              </Link>
            )}
          </div>
          {((actor.profileLinks?.length ?? 0) > 0 || publicOauth.length > 0) && (
            <ul className="mt-3 flex flex-wrap gap-4 text-sm">
              {(actor.profileLinks ?? []).map((link) => (
                <li key={link}>
                  <a
                    href={link}
                    className="link inline-flex items-center gap-1"
                    rel="me noreferrer"
                    target="_blank"
                  >
                    <ServiceIcon url={link} />
                    {serviceLinkLabel(link)}
                  </a>
                </li>
              ))}
              {publicOauth.map((o) => {
                // GitHub はユーザーページへ、Discord はプロフィール(アプリで開く)へ
                const href =
                  o.provider === 'github'
                    ? `https://github.com/${o.label ?? ''}`
                    : `https://discord.com/users/${o.providerUserId}`;
                return (
                  <li key={o.id}>
                    <a
                      href={href}
                      className="link inline-flex items-center gap-1"
                      rel="me noreferrer"
                      target="_blank"
                    >
                      <ServiceIcon url={href} />
                      {o.label ?? o.provider}
                    </a>
                  </li>
                );
              })}
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-ink pb-2">
            <h2 className="display t-md">グループ</h2>
            {isSelf && (
              <Link to="/groups/new" className="btn-quiet">
                共用グループを作成
              </Link>
            )}
          </div>
          {isSelf && (
            <p className="mt-2 text-sm text-neutral">
              個人グループはあなた1人用です。仲間と共同で運営するなら共用グループを作成してください。
            </p>
          )}
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
