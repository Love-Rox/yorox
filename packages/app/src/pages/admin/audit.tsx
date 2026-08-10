import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { LoginRequired } from '../../components/login-required';
import { auditLabel, isSiteAdmin, listAllAudit } from '../../domain/audit';
import { getCurrentUser } from '../../server/current-user';
import { getDb } from '../../server/data';

/** サイト全体の監査ログ(サイト管理者のみ) */
export default async function AdminAuditPage() {
  const user = await getCurrentUser();
  if (!user) return <LoginRequired />;

  const db = await getDb();
  if (!(await isSiteAdmin(db, user.actorId))) return notFound();

  const rows = await listAllAudit(db, 200);

  return (
    <div>
      <title>監査ログ(サイト全体) - Yorox</title>
      <h1 className="display t-xl">監査ログ(サイト全体)</h1>
      <p className="mt-2 text-sm text-neutral">
        このインスタンスで行われた管理操作の履歴です(直近200件)。
        グループ単位の履歴は各グループの設定画面にもあります。
      </p>

      {rows.length > 0 ? (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b-2 border-ink text-left">
                <th className="py-1.5 pr-3">日時</th>
                <th className="py-1.5 pr-3">操作</th>
                <th className="py-1.5 pr-3">操作者</th>
                <th className="py-1.5 pr-3">グループ</th>
                <th className="py-1.5">対象</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-rule align-top">
                  <td className="meta-mono py-1.5 pr-3 whitespace-nowrap">
                    {r.createdAt.toLocaleString('ja-JP')}
                  </td>
                  <td className="py-1.5 pr-3">{auditLabel(r.action)}</td>
                  <td className="py-1.5 pr-3">
                    {r.actorHandle ? (
                      <Link to={`/u/${r.actorHandle}`} className="link">
                        @{r.actorHandle}
                      </Link>
                    ) : (
                      (r.actorName ?? 'システム')
                    )}
                  </td>
                  <td className="meta-mono py-1.5 pr-3 text-neutral">
                    {r.groupActorId ? `${r.groupActorId.slice(0, 8)}…` : '—'}
                  </td>
                  <td className="meta-mono py-1.5 text-neutral">
                    {r.targetType ?? ''}
                    {r.targetId ? ` ${r.targetId.slice(0, 8)}…` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="mt-6 text-neutral">まだ記録がありません。</p>
      )}
    </div>
  );
}

export const getConfig = async () => {
  return { render: 'dynamic' } as const;
};
