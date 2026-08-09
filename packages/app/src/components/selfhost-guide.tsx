import { Link } from 'waku';

/** セルフホストガイドのステップ構成(ナビと目次で共用) */
export const GUIDE_STEPS = [
  { slug: '', title: '概要', short: '全体の流れと必要なもの' },
  { slug: 'setup', title: 'STEP 1: 起動する', short: 'Docker で立ち上げて最初のログイン' },
  { slug: 'domain', title: 'STEP 2: 公開する', short: 'ドメイン・HTTPS・リバースプロキシ' },
  { slug: 'settings', title: 'STEP 3: 設定する', short: 'メール・アップロード・OAuth' },
  { slug: 'operations', title: 'STEP 4: 運用する', short: '更新・バックアップ・トラブル対応' },
] as const;

/** ガイド各ページ共通のヘッダー+ステップナビ */
export function GuideNav({ current }: { current: string }) {
  return (
    <nav className="mt-4 border-2 border-ink">
      <ol className="flex flex-wrap">
        {GUIDE_STEPS.map((s) => {
          const href = s.slug ? `/docs/self-hosting/${s.slug}` : '/docs/self-hosting';
          const active = s.slug === current;
          return (
            <li key={s.slug} className="border-r border-rule last:border-r-0">
              {active ? (
                <span className="block bg-ink px-3 py-2 text-sm font-bold text-paper">
                  {s.title}
                </span>
              ) : (
                <Link to={href} className="block px-3 py-2 text-sm hover:bg-paper-2">
                  {s.title}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** コマンド表示 */
export function Cmd({ children }: { children: string }) {
  return (
    <pre className="meta-mono mt-3 overflow-x-auto border border-rule bg-paper-2 p-3 text-sm leading-relaxed">
      {children}
    </pre>
  );
}

/** 次のステップへの導線 */
export function NextStep({ slug }: { slug: string }) {
  const step = GUIDE_STEPS.find((s) => s.slug === slug);
  if (!step) return null;
  return (
    <p className="mt-10">
      <Link
        to={`/docs/self-hosting/${slug}`}
        className="btn inline-block"
      >
        次へ: {step.title} →
      </Link>
    </p>
  );
}

/** SELF_HOSTING_GUIDE=1 のインスタンスのみ表示(オプトイン) */
export async function isGuideEnabled(): Promise<boolean> {
  const { env } = await import('cloudflare:workers');
  return env.SELF_HOSTING_GUIDE === '1';
}
