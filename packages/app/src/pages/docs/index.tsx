import { Link } from 'waku';
import { isGuideEnabled } from '../../components/selfhost-guide';

const GUIDES = [
  {
    href: '/docs/faq',
    title: 'よくある質問',
    description: 'ログイン・申込・キャンセル・出欠・Fediverse 連携などの FAQ',
  },
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
    href: '/docs/mcp',
    title: 'MCP 連携',
    description: 'AI クライアント(Claude 等)から Yorox を操作する',
  },
  {
    href: '/docs/instance-owners',
    title: 'サイトオーナー向けガイド',
    description: '自分の Yorox インスタンスを建てて運営する',
  },
];

export default async function DocsIndexPage() {
  const guideEnabled = await isGuideEnabled();
  const guides = guideEnabled
    ? [
        ...GUIDES,
        {
          href: '/docs/self-hosting',
          title: '自分のサーバーで運営する',
          description: 'Docker で自分のインスタンスを立てる(4ステップガイド)',
        },
      ]
    : GUIDES;
  return (
    <div>
      <title>使い方 - Yorox</title>
      <h1 className="display t-xl">使い方</h1>
      <p className="mt-2 max-w-[65ch] text-neutral">
        Yorox は分散型で運用できるイベント管理プラットフォームです。
        立場に合わせたガイドを用意しています。
      </p>
      <ul className="mt-8 space-y-4">
        {guides.map((guide) => (
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
    render: 'dynamic',
  } as const;
};
