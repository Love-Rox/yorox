/**
 * サーバーエントリ。実体はビルドターゲットで切り替わる
 * (waku.config.ts の '#server-entry' エイリアス)。
 * - cloudflare: src/waku.server.cloudflare.tsx(既定)
 * - node:       src/waku.server.node.tsx(Docker 自己ホスト)
 */
export { default } from '#server-entry';
