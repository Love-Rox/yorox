import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { getDb, getGroupByHandle } from '../../../../server/data';
import { TOKUSHOHO_FIELDS } from '../../../../domain/tokushoho';

/** グループ(事業者)ごとの特定商取引法に基づく表記(公開) */
export default async function GroupTokushohoPage({ handle }: { handle: string }) {
  const db = await getDb();
  const result = await getGroupByHandle(db, handle);
  if (!result) return notFound();
  const { actor, group } = result;
  const t = group.tokushoho;
  if (!t) {
    // 未設定なら共通(プラットフォーム)表記へ誘導
    return (
      <article className="max-w-[70ch]">
        <title>特定商取引法に基づく表記 - Yorox</title>
        <h1 className="display t-xl">特定商取引法に基づく表記</h1>
        <p className="mt-4 text-neutral">
          {actor.displayName} はまだ独自の表記を設定していません。
        </p>
        <p className="mt-2">
          <Link to="/legal/tokushoho" className="link">
            インスタンス運営者の表記を見る
          </Link>
        </p>
      </article>
    );
  }

  return (
    <article className="max-w-[70ch]">
      <title>{`特定商取引法に基づく表記 - ${actor.displayName}`}</title>
      <p className="text-sm">
        <Link to={`/g/${handle}`} className="link">
          ← {actor.displayName}
        </Link>
      </p>
      <h1 className="display mt-2 t-xl">特定商取引法に基づく表記</h1>
      <p className="mt-2 text-sm text-neutral">
        販売事業者: {actor.displayName}(@{actor.handle})
      </p>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {TOKUSHOHO_FIELDS.map((f) => (
              <tr key={f.key} className="border-b border-rule align-top">
                <th className="w-44 py-2 pr-3 text-left font-bold">{f.label}</th>
                <td className="py-2 whitespace-pre-wrap">{t[f.key] || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </article>
  );
}

export const getConfig = async () => ({ render: 'dynamic' }) as const;
