import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { Avatar } from '../../../components/avatar';
import { ActorKindBadge } from '../../../components/actor-kind';
import { Markdown } from '../../../lib/markdown';
import { getCurrentUser } from '../../../server/current-user';
import {
  countFollowers,
  getDb,
  getGroupByHandle,
  listGroupEvents,
  listGroupPosts,
  listOrganizers,
} from '../../../server/data';
import { hasGroupPermission } from '../../../server/route-auth';

const DATE_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
});

export default async function GroupPage({ handle }: { handle: string }) {
  const db = await getDb();
  const result = await getGroupByHandle(db, handle);
  if (!result) return notFound();

  const { actor, group } = result;
  const user = await getCurrentUser();
  const canCreate = user
    ? await hasGroupPermission(db, actor.id, user.actorId, 'event.create')
    : false;
  const canSettings = user
    ? (await hasGroupPermission(db, actor.id, user.actorId, 'group.settings')) ||
      (await hasGroupPermission(db, actor.id, user.actorId, 'member.manage'))
    : false;
  const events = await listGroupEvents(db, actor.id, { includeDrafts: canCreate });
  const organizers = await listOrganizers(db, actor.id);
  const followerCount = await countFollowers(db, actor.id);
  const posts = await listGroupPosts(db, actor.id);

  return (
    <div>
      <title>{`${actor.displayName} - Yorox`}</title>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="display t-xl">{actor.displayName}</h1>
            <ActorKindBadge kind="group" isPersonal={group.isPersonal} />
          </div>
          <p className="meta-mono mt-1 text-sm text-neutral">
            @{actor.handle}
            {followerCount > 0 && (
              <span className="ml-3">フォロワー {followerCount}</span>
            )}
          </p>
        </div>
        <span className="flex gap-3">
          {canSettings && (
            <Link to={`/g/${handle}/settings`} className="btn-quiet">
              設定
            </Link>
          )}
          {canCreate && (
            <Link to={`/g/${handle}/events/new`} className="btn">
              イベント作成
            </Link>
          )}
        </span>
      </div>
      {group.descriptionMd && (
        <div className="mt-4">
          <Markdown source={group.descriptionMd} />
        </div>
      )}

      {organizers.length > 0 && (
        <section className="mt-6">
          <h2 className="meta-mono text-sm text-neutral">運営メンバー</h2>
          <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {organizers.map((o) => (
              <li key={o.actorId} className="flex items-center gap-2">
                <Avatar avatarUrl={o.avatarUrl} displayName={o.displayName} size="sm" />
                {o.handle ? (
                  <Link to={`/u/${o.handle}`} className="link font-bold">
                    {o.displayName}
                  </Link>
                ) : (
                  <span className="font-bold">{o.displayName}</span>
                )}
                <span className="meta-mono ml-1 text-sm text-neutral">({o.roleName})</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- タイムライン(お知らせ投稿) ---- */}
      {(posts.length > 0 || canCreate) && (
        <section id="timeline" className="mt-8 scroll-mt-4">
          <h2 className="meta-mono border-b-2 border-ink pb-2 text-sm text-neutral">
            タイムライン
          </h2>
          {canCreate && (
            <form method="post" action={`/g/${handle}/posts`} className="mt-3">
              <textarea
                name="body"
                rows={3}
                required
                maxLength={3000}
                className="input leading-relaxed"
                placeholder="グループからのお知らせを投稿(Markdown 可)。フォロワーのタイムラインにも届きます"
              />
              <button type="submit" className="btn-quiet mt-2 cursor-pointer">
                投稿する
              </button>
            </form>
          )}
          {posts.length > 0 && (
            <ul className="mt-2">
              {posts.map((post) => (
                <li key={post.id} className="border-b border-rule py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="meta-mono text-sm text-neutral">
                      {DATE_FMT.format(post.createdAt)}
                      {post.authorName && <span className="ml-2">by {post.authorName}</span>}
                    </div>
                    {(user?.actorId === post.authorActorId || canSettings) && (
                      <form method="post" action={`/g/${handle}/posts/${post.id}/delete`}>
                        <button
                          type="submit"
                          className="min-h-11 cursor-pointer text-sm text-neutral underline underline-offset-3 hover:text-accent"
                        >
                          削除
                        </button>
                      </form>
                    )}
                  </div>
                  <div className="mt-1">
                    <Markdown source={post.bodyMd} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {group.tokushoho && (
        <p className="mt-6 text-sm">
          <Link to={`/g/${handle}/legal/tokushoho`} className="link">
            特定商取引法に基づく表記
          </Link>
        </p>
      )}

      <p className="meta-mono mt-10 border-b-2 border-ink pb-2 text-sm text-neutral">
        イベント · {events.length}件
      </p>
      {events.length === 0 ? (
        <p className="mt-4 text-neutral">イベントはまだありません。</p>
      ) : (
        <ul>
          {events.map((event) => (
            <li key={event.id} className="border-b border-rule py-4">
              <div className="min-w-0">
                <Link to={`/g/${handle}/events/${event.id}`} className="event-row__title">
                  {event.title}
                </Link>
                {event.visibility === 'draft' && (
                  <span className="ml-2 border border-neutral px-2 py-0.5 text-sm text-neutral">
                    下書き
                  </span>
                )}
                <div className="meta-mono mt-1 text-sm text-neutral">
                  {DATE_FMT.format(event.startsAt)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
