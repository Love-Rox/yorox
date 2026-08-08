import { Link } from 'waku';
import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
  unstable_redirect as redirect,
} from 'waku/router/server';
import { getCurrentUser } from '../../../../../server/current-user';
import { getDb, getEventDetail } from '../../../../../server/data';
import { hasGroupPermission } from '../../../../../server/route-auth';

/** Date → datetime-local 値(JST)。MVP は Asia/Tokyo 固定 */
function toLocalInput(d: Date | null): string {
  if (!d) return '';
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 16);
}

export default async function EditEventPage({
  handle,
  eventId,
}: {
  handle: string;
  eventId: string;
}) {
  const db = await getDb();
  const user = await getCurrentUser();
  if (!user) return redirect('/login');

  const detail = await getEventDetail(db, eventId);
  if (!detail || detail.groupActor?.handle !== handle) return notFound();
  const canEdit = await hasGroupPermission(
    db,
    detail.event.groupActorId,
    user.actorId,
    'event.edit',
  );
  if (!canEdit) return notFound();

  const { event } = detail;
  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');

  return (
    <div className="max-w-xl">
      <title>{`編集: ${event.title} - Yorox`}</title>
      <p className="text-sm">
        <Link to={`/g/${handle}/events/${eventId}`} className="link">
          ← イベントページへ戻る
        </Link>
      </p>
      <h1 className="display mt-2 t-lg">イベントを編集</h1>
      {error && (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          入力内容を確認してください(タイトルと開始日時は必須です)。
        </p>
      )}
      <form method="post" action={`/events/${eventId}/update`} className="mt-6 space-y-5">
        <label className="block">
          <span className="text-sm font-bold">タイトル *</span>
          <input
            type="text"
            name="title"
            required
            maxLength={200}
            defaultValue={event.title}
            className="input mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold">本文(Markdown)</span>
          <textarea
            name="description_md"
            rows={8}
            defaultValue={event.descriptionMd ?? ''}
            className="input mt-1 min-h-40 leading-relaxed"
          />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-bold">開始日時 *</span>
            <input
              type="datetime-local"
              name="starts_at"
              required
              defaultValue={toLocalInput(event.startsAt)}
              className="input meta-mono mt-1"
            />
          </label>
          <label className="block">
            <span className="text-sm font-bold">終了日時</span>
            <input
              type="datetime-local"
              name="ends_at"
              defaultValue={toLocalInput(event.endsAt)}
              className="input meta-mono mt-1"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-sm font-bold">会場名</span>
          <input
            type="text"
            name="venue_name"
            maxLength={200}
            defaultValue={event.venueName ?? ''}
            className="input mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold">会場住所</span>
          <input
            type="text"
            name="venue_address"
            maxLength={300}
            defaultValue={event.venueAddress ?? ''}
            className="input mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold">オンライン URL</span>
          <input
            type="url"
            name="online_url"
            defaultValue={event.onlineUrl ?? ''}
            className="input meta-mono mt-1"
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold">セッション欄の表示ラベル</span>
          <select
            name="sessions_label"
            defaultValue={event.sessionsLabel}
            className="input mt-1"
          >
            <option value="sessions">セッション</option>
            <option value="timetable">タイムテーブル</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-bold">参加者への案内(Markdown)</span>
          <textarea
            name="participant_info_md"
            rows={4}
            defaultValue={event.participantInfoMd ?? ''}
            className="input mt-1 leading-relaxed"
            placeholder={'参加確定者だけに表示されます。\n配信URL、入館方法、緊急連絡先など。'}
          />
          <span className="mt-1 block text-sm text-neutral">
            参加確定者と主催メンバーにのみ表示されます
          </span>
        </label>
        <button type="submit" className="btn cursor-pointer">
          保存する
        </button>
      </form>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'dynamic',
  } as const;
};
