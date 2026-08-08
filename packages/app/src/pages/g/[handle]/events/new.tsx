import { unstable_getRequest as getRequest, unstable_notFound as notFound, unstable_redirect as redirect } from 'waku/router/server';
import { getCurrentUser } from '../../../../server/current-user';
import { getDb, getGroupByHandle } from '../../../../server/data';
import { hasGroupPermission } from '../../../../server/route-auth';

export default async function NewEventPage({ handle }: { handle: string }) {
  const db = await getDb();
  const user = await getCurrentUser();
  if (!user) return redirect('/login');

  const result = await getGroupByHandle(db, handle);
  if (!result) return notFound();
  if (!(await hasGroupPermission(db, result.actor.id, user.actorId, 'event.create'))) {
    return notFound();
  }

  const url = new URL(getRequest().url);
  const error = url.searchParams.get('error');

  return (
    <div className="max-w-xl">
      <title>イベント作成 - Yorox</title>
      <p className="text-sm text-neutral">{result.actor.displayName}</p>
      <h1 className="display mt-1 t-xl">イベント作成</h1>
      <p className="mt-2 text-sm text-neutral">
        まず下書きとして保存されます。参加枠を設定してから公開してください。
      </p>
      {error && (
        <p role="alert" className="mt-4 border-2 border-accent p-3 text-sm text-accent">
          入力内容を確認してください(タイトルと開始日時は必須です)。
        </p>
      )}
      <form method="post" action={`/g/${handle}/events`} className="mt-6 space-y-5">
        <label className="block">
          <span className="text-sm font-bold">タイトル *</span>
          <input type="text" name="title" required maxLength={200} className="input mt-1" />
        </label>
        <label className="block">
          <span className="text-sm font-bold">本文(Markdown)</span>
          <textarea
            name="description_md"
            rows={8}
            className="input mt-1 min-h-40 leading-relaxed"
            placeholder={'## タイムテーブル\n\n- 19:00 開場…'}
          />
        </label>
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-bold">開始日時 *</span>
            <input type="datetime-local" name="starts_at" required className="input meta-mono mt-1" />
          </label>
          <label className="block">
            <span className="text-sm font-bold">終了日時</span>
            <input type="datetime-local" name="ends_at" className="input meta-mono mt-1" />
          </label>
        </div>
        <label className="block">
          <span className="text-sm font-bold">会場名</span>
          <input type="text" name="venue_name" maxLength={200} className="input mt-1" />
        </label>
        <label className="block">
          <span className="text-sm font-bold">会場住所</span>
          <input type="text" name="venue_address" maxLength={300} className="input mt-1" />
        </label>
        <label className="block">
          <span className="text-sm font-bold">オンライン URL</span>
          <input
            type="url"
            name="online_url"
            className="input meta-mono mt-1"
            placeholder="https://meet.example.com/…"
          />
        </label>
        <label className="block">
          <span className="text-sm font-bold">サムネイル画像 URL</span>
          <input
            type="url"
            name="thumbnail_url"
            className="input meta-mono mt-1"
            placeholder="https://example.com/banner.png"
          />
          <span className="mt-1 block text-sm text-neutral">
            イベントページとシェア時(OGP)に表示されます。横長(1200×630 目安)推奨
          </span>
        </label>
        <label className="block">
          <span className="text-sm font-bold">参加者への案内(Markdown)</span>
          <textarea
            name="participant_info_md"
            rows={4}
            className="input mt-1 leading-relaxed"
            placeholder={'参加確定者だけに表示されます。\n配信URL、入館方法、緊急連絡先など。'}
          />
          <span className="mt-1 block text-sm text-neutral">
            参加確定者と主催メンバーにのみ表示されます
          </span>
        </label>
        <button type="submit" className="btn cursor-pointer">
          下書きを作成
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
