/**
 * Ft4 Dense colophon — mono の一段組コロフォン。
 * セルフホストのインスタンス情報を刻む(印刷物の奥付の流儀)。
 */
export const Footer = () => {
  return (
    <footer className="mt-16 border-t border-rule">
      <div className="meta-mono mx-auto w-full max-w-3xl px-[clamp(1rem,4vw,1.5rem)] py-8 text-sm leading-7 text-neutral">
        このインスタンスは Yorox v0.0.0 で運営されています。Yorox
        は分散型のイベント管理プラットフォームです — 中央に頼らず、自分たちの寄合を自分たちの手で。
        ソースコード:{' '}
        <a href="https://github.com/Love-Rox/yorox" className="link" rel="noreferrer">
          github.com/Love-Rox/yorox
        </a>
      </div>
    </footer>
  );
};
