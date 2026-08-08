/**
 * リンク URL のホスト名から SNS サービスを判定し、ミニマルな単色 SVG アイコンを返す。
 * アイコンは手書きの簡略シルエット(currentColor、線の声を統一)。
 * 未知のサービスは汎用リンクアイコン。
 */

type Service = 'github' | 'x' | 'bluesky' | 'fediverse' | 'link';

const FEDIVERSE_HINTS = ['mastodon', 'misskey', 'mstdn', 'fedibird', 'pawoo'];

export function detectService(url: string): Service {
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (host === 'github.com' || host.endsWith('.github.com')) return 'github';
    if (host === 'x.com' || host === 'twitter.com') return 'x';
    if (host === 'bsky.app' || host.endsWith('.bsky.app')) return 'bluesky';
    if (FEDIVERSE_HINTS.some((h) => host.includes(h))) return 'fediverse';
    return 'link';
  } catch {
    return 'link';
  }
}

const SERVICE_LABEL: Record<Service, string> = {
  github: 'GitHub',
  x: 'X',
  bluesky: 'Bluesky',
  fediverse: 'Fediverse',
  link: 'リンク',
};

function IconPath({ service }: { service: Service }) {
  switch (service) {
    case 'github':
      // 簡略 Octocat マーク
      return (
        <path
          fill="currentColor"
          d="M8 .5a7.5 7.5 0 0 0-2.37 14.62c.37.07.51-.16.51-.36v-1.4c-2.09.45-2.53-.89-2.53-.89-.34-.87-.83-1.1-.83-1.1-.68-.46.05-.45.05-.45.75.05 1.15.77 1.15.77.67 1.14 1.75.81 2.18.62.07-.48.26-.81.47-1-1.66-.19-3.4-.83-3.4-3.7 0-.82.29-1.49.77-2.01-.08-.19-.33-.95.07-1.98 0 0 .63-.2 2.06.77a7.2 7.2 0 0 1 3.75 0c1.43-.97 2.06-.77 2.06-.77.4 1.03.15 1.79.07 1.98.48.52.77 1.19.77 2.01 0 2.88-1.75 3.51-3.41 3.7.27.23.5.68.5 1.38v2.04c0 .2.14.44.52.36A7.5 7.5 0 0 0 8 .5Z"
        />
      );
    case 'x':
      return (
        <path
          fill="currentColor"
          d="M9.52 6.77 15.48.5h-1.41L8.89 5.94 4.76.5H0l6.25 8.23L0 15.5h1.41l5.47-5.75 4.36 5.75H16L9.52 6.77Zm-1.94 2.04-.63-.82L1.92 1.46h2.17l4.07 5.36.63.82 5.29 6.97h-2.17L7.58 8.81Z"
        />
      );
    case 'bluesky':
      // 簡略バタフライ
      return (
        <path
          fill="currentColor"
          d="M3.47 1.6C5.25 2.94 7.16 5.64 8 7.09c.84-1.45 2.75-4.15 4.53-5.49C13.81.63 16 .1 16 2.36c0 .45-.26 3.79-.41 4.33-.53 1.89-2.46 2.37-4.18 2.08 3 .51 3.77 2.2 2.12 3.9-3.13 3.21-4.5-.81-5.43-1.84-.09-.11-.1-.11-.2 0-.93 1.03-2.3 5.05-5.43 1.84-1.65-1.7-.88-3.39 2.12-3.9-1.72.29-3.65-.19-4.18-2.08C.26 6.15 0 2.81 0 2.36 0 .1 2.19.63 3.47 1.6Z"
        />
      );
    case 'fediverse':
      // 簡略ペンタグラフ(連合のノード)
      return (
        <g fill="none" stroke="currentColor" strokeWidth="1.4">
          <circle cx="8" cy="2.4" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="14" cy="6.8" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="11.7" cy="13.6" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="4.3" cy="13.6" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="2" cy="6.8" r="1.4" fill="currentColor" stroke="none" />
          <path d="M8 2.4 14 6.8l-2.3 6.8H4.3L2 6.8Z" />
        </g>
      );
    default:
      // 汎用リンク(鎖)
      return (
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          d="M6.5 9.5 9.5 6.5M5 8l-2 2a2.5 2.5 0 0 0 3.54 3.54l2-2M11 8l2-2A2.5 2.5 0 0 0 9.46 2.46l-2 2"
        />
      );
  }
}

/** リンク付き登壇者名などに添えるサービスアイコン */
export function ServiceIcon({ url }: { url: string }) {
  const service = detectService(url);
  return (
    <svg
      viewBox="0 0 16 16"
      className="inline-block size-4 align-[-0.15em]"
      role="img"
      aria-label={SERVICE_LABEL[service]}
    >
      <IconPath service={service} />
    </svg>
  );
}
