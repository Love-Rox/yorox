import { Link } from 'waku';
import { ActorKindMark } from '../components/actor-kind';
import { Avatar } from '../components/avatar';
import { LoginRequired } from '../components/login-required';
import { buildTimeline } from '../domain/follow';
import { getCurrentUser } from '../server/current-user';
import { getDb } from '../server/data';

const AT_FMT = new Intl.DateTimeFormat('ja-JP', {
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Tokyo',
});
const EVENT_FMT = new Intl.DateTimeFormat('ja-JP', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Tokyo',
});

export default async function TimelinePage() {
  const user = await getCurrentUser();
  if (!user) return <LoginRequired />;

  const db = await getDb();
  const items = await buildTimeline(db, user.actorId);

  return (
    <div className="max-w-2xl">
      <title>タイムライン - Yorox</title>
      <h1 className="display t-xl">タイムライン</h1>
      <p className="mt-1 text-sm text-neutral">
        フォロー中のユーザー・グループの公開活動が新しい順に並びます
      </p>

      {items.length === 0 ? (
        <div className="mt-8 border-2 border-rule p-6">
          <p>まだ表示できる活動がありません。</p>
          <p className="mt-2 text-sm text-neutral">
            ユーザーやグループのページにある「フォロー」ボタンを押すと、
            そのアカウントの新しいイベント・お知らせ・参加予定がここに流れます。
          </p>
        </div>
      ) : (
        <ul className="mt-6">
          {items.map((item, i) => {
            const actorLink =
              item.actorKind === 'group'
                ? `/g/${item.actorHandle}`
                : `/u/${item.actorHandle}`;
            return (
              <li
                key={`${item.kind}-${item.at.getTime()}-${i}`}
                className="flex gap-3 border-b border-rule py-4"
              >
                <Link to={actorLink} className="shrink-0">
                  <Avatar avatarUrl={item.actorAvatarUrl} displayName={item.actorName} />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <ActorKindMark
                      kind={item.actorKind}
                      isPersonal={item.actorIsPersonalGroup}
                      size={13}
                      className="shrink-0"
                    />
                    <Link to={actorLink} className="link font-bold">
                      {item.actorName}
                    </Link>
                    <span className="meta-mono text-neutral">{AT_FMT.format(item.at)}</span>
                  </div>
                  {item.kind === 'event' && (
                    <p className="mt-1">
                      新しいイベントを公開:{' '}
                      <Link
                        to={`/g/${item.eventGroupHandle}/events/${item.eventId}`}
                        className="link font-bold"
                      >
                        {item.eventTitle}
                      </Link>
                      {item.eventStartsAt && (
                        <span className="meta-mono ml-2 text-sm text-neutral">
                          {EVENT_FMT.format(item.eventStartsAt)}
                        </span>
                      )}
                    </p>
                  )}
                  {item.kind === 'post' && (
                    <p className="mt-1">
                      お知らせ:{' '}
                      <Link to={`/g/${item.postGroupHandle}`} className="link">
                        {item.postExcerpt}
                      </Link>
                    </p>
                  )}
                  {item.kind === 'participation' && (
                    <p className="mt-1">
                      <Link
                        to={`/g/${item.eventGroupHandle}/events/${item.eventId}`}
                        className="link font-bold"
                      >
                        {item.eventTitle}
                      </Link>{' '}
                      に参加予定
                      {item.eventStartsAt && (
                        <span className="meta-mono ml-2 text-sm text-neutral">
                          {EVENT_FMT.format(item.eventStartsAt)}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
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
