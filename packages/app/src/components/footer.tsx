import { Link } from 'waku';

/**
 * Ft4 Dense colophon — mono の一段組コロフォン。
 * セルフホストのインスタンス情報を刻む(印刷物の奥付の流儀)。
 */
export const Footer = async () => {
  const env = (await import('cloudflare:workers')).env as Env;
  const hasContact = !!env.CONTACT_EMAIL;
  const main = 'hover:text-ink hover:underline underline-offset-3';
  const sub = 'text-neutral hover:text-ink hover:underline underline-offset-3';
  return (
    <footer className="mt-20 border-t border-rule bg-paper-2/50">
      <div className="mx-auto w-full max-w-5xl px-[clamp(1rem,4vw,1.5rem)] py-8">
        <nav aria-label="サイト" className="flex flex-wrap gap-x-5 gap-y-2 text-sm font-bold">
          <Link to="/docs" className={main}>
            使い方
          </Link>
          <Link to="/docs/participants" className={main}>
            参加者向け
          </Link>
          <Link to="/docs/organizers" className={main}>
            主催者向け
          </Link>
          <Link to="/docs/federation" className={main}>
            分散型のしくみ
          </Link>
          <Link to="/docs/instance-owners" className={main}>
            サイトオーナー向け
          </Link>
        </nav>
        <nav aria-label="規約" className="mt-2 flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/legal/terms" className={sub}>
            利用規約
          </Link>
          <Link to="/legal/privacy" className={sub}>
            プライバシー
          </Link>
          <Link to="/legal/tokushoho" className={sub}>
            特定商取引法
          </Link>
          {hasContact && (
            <Link to="/contact" className={sub}>
              お問い合わせ
            </Link>
          )}
        </nav>
        <div className="mt-6 text-sm leading-7 text-neutral">
          このインスタンスは{' '}
          <span className="meta-mono">
            Yorox v{__YOROX_VERSION__} ({__YOROX_COMMIT__})
          </span>{' '}
          で運営されています。Yorox
          は分散型のイベント管理プラットフォームです — 中央に頼らず、自分たちの寄合を自分たちの手で。
          ソースコード:{' '}
          <a href="https://github.com/Love-Rox/yorox" className="link" rel="noreferrer">
            github.com/Love-Rox/yorox
          </a>
        </div>
      </div>
    </footer>
  );
};
