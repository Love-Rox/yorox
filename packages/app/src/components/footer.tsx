import { Link } from 'waku';

/**
 * Ft4 Dense colophon — mono の一段組コロフォン。
 * セルフホストのインスタンス情報を刻む(印刷物の奥付の流儀)。
 */
export const Footer = () => {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="mx-auto w-full max-w-5xl px-[clamp(1rem,4vw,1.5rem)] py-8">
        <nav aria-label="サイト" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
          <Link to="/docs" className="link">
            使い方
          </Link>
          <Link to="/docs/participants" className="link">
            参加者向け
          </Link>
          <Link to="/docs/organizers" className="link">
            主催者向け
          </Link>
          <Link to="/docs/federation" className="link">
            分散型のしくみ
          </Link>
          <Link to="/docs/instance-owners" className="link">
            サイトオーナー向け
          </Link>
        </nav>
        <div className="meta-mono mt-4 text-sm leading-7 text-neutral">
          このインスタンスは Yorox v{__YOROX_VERSION__} ({__YOROX_COMMIT__})
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
