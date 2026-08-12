import { unstable_getRequest as getRequest, unstable_notFound as notFound, unstable_redirect as redirect } from 'waku/router/server';
import { LoginRequired } from '../../../../components/login-required';
import { HelpTip } from '../../../../components/help-tip';
import { SurveyBuilder } from '../../../../components/survey-builder';
import { getCurrentUser } from '../../../../server/current-user';
import { getDb, getGroupByHandle } from '../../../../server/data';
import { hasGroupPermission } from '../../../../server/route-auth';
import { getUploadConfig } from '../../../../storage/driver';

export default async function NewEventPage({ handle }: { handle: string }) {
  const db = await getDb();
  const user = await getCurrentUser();
  if (!user) return <LoginRequired />;

  const result = await getGroupByHandle(db, handle);
  if (!result) return notFound();
  if (!(await hasGroupPermission(db, result.actor.id, user.actorId, 'event.create'))) {
    return notFound();
  }

  const { env } = await import('cloudflare:workers');
  const uploads = getUploadConfig(env);

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
      <form
        method="post"
        action={`/g/${handle}/events`}
        encType="multipart/form-data"
        className="mt-6 space-y-5"
      >
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
          <span className="mt-1 block text-sm text-neutral">
            物理会場の名称です。オンライン開催のみの場合は空欄にして、下の「オンライン
            URL」に配信・通話の URL を入力してください(両方あるハイブリッドも可)
          </span>
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
        <div className="block">
          <span className="text-sm font-bold">サムネイル画像</span>
          <span className="mt-1 block text-sm text-neutral">
            イベントページとシェア時(OGP)に表示されます。横長(1200×630 目安)推奨。
            未設定でも、タイトルと日時から OGP 画像を自動生成します。
          </span>
          {uploads.enabled && (
            <label className="mt-2 block">
              <span className="text-sm text-neutral">画像をアップロード</span>
              <input
                type="file"
                name="thumbnail_file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="mt-1 block text-sm"
              />
              <span className="mt-1 block text-sm text-neutral">
                PNG / JPEG / WebP / GIF、{Math.floor(uploads.maxBytes / 1024 / 1024)}MB まで。
                指定すると下の URL より優先されます
              </span>
            </label>
          )}
          <label className="mt-2 block">
            <span className="text-sm text-neutral">または画像の URL</span>
            <input
              type="url"
              name="thumbnail_url"
              className="input meta-mono mt-1"
              placeholder="https://example.com/banner.png"
            />
          </label>
        </div>
        <label className="block">
          <span className="text-sm font-bold">ハッシュタグ</span>
          <input
            type="text"
            name="hashtags"
            className="input mt-1"
            placeholder="#yorox #勉強会(空白区切り、最大5個)"
          />
          <span className="mt-1 block text-sm text-neutral">
            共有ボタンから SNS に投稿するときに添えられます。未入力ならグループの既定タグを使います
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
        <fieldset className="block">
          <legend className="text-sm font-bold">Fediverse からの参加申込<HelpTip text="フォロワーのタイムラインに流れる告知へのリプライ、または Mobilizon 等からの Join でイベントに申込できるようにします。実際に受け付けるには枠側の「リモート参加を受け入れる」も必要です。" /></legend>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" name="remote_join_reply" defaultChecked />
            <span>告知へのリプライ(「参加」)で申込を受け付ける</span>
          </label>
          <label className="mt-1 flex items-center gap-2">
            <input type="checkbox" name="remote_join_activity" defaultChecked />
            <span>Join アクティビティ(Mobilizon 等)を受け付ける</span>
          </label>
          <span className="mt-1 block text-sm text-neutral">
            実際に申込できるのは「連合参加可」に設定した枠だけです
          </span>
        </fieldset>
        <fieldset className="block">
          <legend className="text-sm font-bold">申込アンケート(イベント共通)<HelpTip text="どの枠から申し込んでも聞く質問です。枠だけの追加質問は、枠を作るときに設定できます。回答は主催者だけが見られます。あとから編集画面でも変更できます。" /></legend>
          <p className="mt-1 text-sm text-neutral">
            申込時に聞く質問です。どの枠から申し込んでも表示されます。回答は主催者だけが確認できます。
          </p>
          <div className="mt-2">
            <SurveyBuilder name="survey_json" />
          </div>
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" name="survey_remote_policy" value="block" />
            <span>
              必須アンケートがあるとき、Fediverse / Bluesky からのリモート申込を断る
              <span className="mt-1 block text-sm text-neutral">
                オフ(既定)なら、リモート申込は必須質問を免除して受け付けます(回答なしとして記録)。
              </span>
            </span>
          </label>
        </fieldset>
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
