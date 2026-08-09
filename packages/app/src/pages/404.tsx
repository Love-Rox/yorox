import { Link } from 'waku';

/** 404 ページ(unstable_notFound / 未定義ルートで表示) */
export default async function NotFoundPage() {
  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <title>ページが見つかりません - Yorox</title>
      {/* リソ風の版ズレ 404 */}
      <p aria-hidden className="display relative t-display leading-none">
        <span className="absolute inset-0 -translate-x-1 -translate-y-1 text-accent">
          404
        </span>
        <span className="relative">404</span>
      </p>
      <h1 className="display mt-4 t-lg">ページが見つかりません</h1>
      <p className="mt-3 text-sm text-neutral">
        URL が変わったか、削除されたか、もともと存在しないページです。
        イベントは主催グループのページから探せます。
      </p>
      <p className="mt-6 flex flex-wrap justify-center gap-4">
        <Link to="/" className="btn">
          トップへ戻る
        </Link>
        <Link to="/docs/faq" className="btn-quiet">
          FAQ を見る
        </Link>
      </p>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
