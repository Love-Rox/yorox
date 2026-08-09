import { Link } from 'waku';
import {
  unstable_getRequest as getRequest,
  unstable_notFound as notFound,
} from 'waku/router/server';
import { LoginRequired } from '../../../../../components/login-required';
import { HelpTip } from '../../../../../components/help-tip';
import { getCurrentUser } from '../../../../../server/current-user';
import { getDb, getEventDetail } from '../../../../../server/data';
import { hasGroupPermission } from '../../../../../server/route-auth';
import { getUploadConfig } from '../../../../../storage/driver';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_input: '入力内容を確認してください(タイトルと開始日時は必須です)。',
  uploads_disabled: 'このインスタンスではファイルアップロードが無効です。',
  no_file: 'ファイルが選択されていません。',
  too_large: 'ファイルサイズが上限を超えています。',
  bad_type: '対応していない画像形式です(PNG / JPEG / WebP / GIF)。',
};

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
  if (!user) return <LoginRequired />;

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
  const { env } = await import('cloudflare:workers');
  const uploads = getUploadConfig(env);

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
          {ERROR_MESSAGES[error] ?? 'エラーが発生しました。'}
        </p>
      )}

      {uploads.enabled && (
        <section className="mt-6 border-2 border-ink p-4">
          <h2 className="text-sm font-bold">サムネイル画像をアップロード</h2>
          {event.thumbnailUrl && (
            <img
              referrerPolicy="no-referrer"
              src={event.thumbnailUrl}
              alt="現在のサムネイル"
              className="mt-2 max-h-40 border border-rule object-cover"
            />
          )}
          <form
            method="post"
            action={`/events/${eventId}/thumbnail`}
            encType="multipart/form-data"
            className="mt-3 flex flex-wrap items-center gap-3"
          >
            <input
              type="file"
              name="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              required
              className="text-sm"
            />
            <button type="submit" className="btn-quiet cursor-pointer">
              アップロード
            </button>
          </form>
          <p className="mt-2 text-sm text-neutral">
            PNG / JPEG / WebP / GIF、{Math.floor(uploads.maxBytes / 1024 / 1024)}MB まで。
            横長(1200×630 目安)推奨。アップロードすると下の URL 欄より優先されます
          </p>
        </section>
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
          <span className="mt-1 block text-sm text-neutral">
            物理会場の名称です。オンライン開催のみの場合は空欄にして、下の「オンライン
            URL」に配信・通話の URL を入力してください(両方あるハイブリッドも可)
          </span>
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
          <span className="text-sm font-bold">サムネイル画像 URL</span>
          <input
            type="url"
            name="thumbnail_url"
            defaultValue={event.thumbnailUrl ?? ''}
            className="input meta-mono mt-1"
            placeholder="https://example.com/banner.png"
          />
          <span className="mt-1 block text-sm text-neutral">
            イベントページとシェア時(OGP)に表示されます。横長(1200×630 目安)推奨
          </span>
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
        <fieldset className="block">
          <legend className="text-sm font-bold">Fediverse からの参加申込<HelpTip text="フォロワーのタイムラインに流れる告知へのリプライ、または Mobilizon 等からの Join でイベントに申込できるようにします。実際に受け付けるには枠側の「リモート参加を受け入れる」も必要です。" /></legend>
          <label className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              name="remote_join_reply"
              defaultChecked={(event.remoteJoinMethods ?? []).includes('reply')}
            />
            <span>告知へのリプライ(「参加」)で申込を受け付ける</span>
          </label>
          <label className="mt-1 flex items-center gap-2">
            <input
              type="checkbox"
              name="remote_join_activity"
              defaultChecked={(event.remoteJoinMethods ?? []).includes('join')}
            />
            <span>Join アクティビティ(Mobilizon 等)を受け付ける</span>
          </label>
          <span className="mt-1 block text-sm text-neutral">
            実際に申込できるのは「連合参加可」に設定した枠だけです
          </span>
        </fieldset>
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
