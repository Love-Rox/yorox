import { Link } from 'waku';

const GUIDES = [
  {
    href: '/docs/participants',
    title: '参加者向けガイド',
    description: 'アカウント作成からイベント参加・キャンセルまで',
  },
  {
    href: '/docs/organizers',
    title: '主催者向けガイド',
    description: 'グループ運営、イベント作成、枠ポリシー、当日運営',
  },
  {
    href: '/docs/federation',
    title: '分散型のしくみ',
    description: 'Yorox はどう繋がるのか — インスタンスと連合の解説',
  },
  {
    href: '/docs/instance-owners',
    title: 'サイトオーナー向けガイド',
    description: '自分の Yorox インスタンスを建てて運営する',
  },
];

export default async function DocsIndexPage() {
  return (
    <div>
      <title>使い方 - Yorox</title>
      <h1 className="display t-xl">使い方</h1>
      <p className="mt-2 max-w-[65ch] text-neutral">
        Yorox は分散型で運用できるイベント管理プラットフォームです。
        立場に合わせたガイドを用意しています。
      </p>
      <ul className="mt-8 space-y-4">
        {GUIDES.map((guide) => (
          <li key={guide.href} className="border-b border-rule pb-4">
            <Link to={guide.href} className="event-row__title">
              {guide.title}
            </Link>
            <p className="mt-1 text-sm text-neutral">{guide.description}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
