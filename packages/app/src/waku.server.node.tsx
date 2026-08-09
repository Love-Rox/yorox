/**
 * Docker / Node ランタイム用サーバーエントリ。
 * Cloudflare 版と同じ Hono ルート一式を waku の node アダプタに載せる。
 * cron 相当は最初のリクエストで setInterval を起動する(ビルド時の
 * モジュール評価ではタイマーを張らない)。
 */
import type { Hono } from 'hono/tiny';
import type { MiddlewareHandler } from 'hono';
import { fsRouter } from 'waku';
import adapter from 'waku/adapters/node';
import apRoutes from './server/ap-routes';
import stripeRoutes from './server/stripe-routes';
import authRoutes from './server/auth-routes';
import passkeyRoutes from './auth/passkey-routes';
import eventRoutes from './server/event-routes';
import fileRoutes from './server/file-routes';
import groupRoutes from './server/group-routes';
import manageRoutes from './server/manage-routes';
import profileRoutes from './server/profile-routes';
import { runScheduledJobs } from './server/scheduled';

const CRON_INTERVAL_MS = 5 * 60 * 1000;
let cronStarted = false;
let cronRunning = false;

/** 5分毎の定期ジョブ(抽選・通知・AP 配信・予約公開)を起動する */
function cronMiddleware(_opts: { app: Hono }): MiddlewareHandler {
  return async (_c, next) => {
    if (!cronStarted && process.env.YOROX_CRON !== '0') {
      cronStarted = true;
      const tick = async () => {
        // 前回のジョブが 5 分以内に終わらなかった場合の再入防止
        // (同じ未送信メール・AP 行を二重送信しないため)
        if (cronRunning) return;
        cronRunning = true;
        try {
          const { env } = await import('cloudflare:workers');
          await runScheduledJobs(env);
        } catch (err) {
          console.error('[node] scheduled jobs failed:', err);
        } finally {
          cronRunning = false;
        }
      };
      setInterval(tick, CRON_INTERVAL_MS);
      void tick();
      console.log('[node] cron started (every 5 min)');
    }
    return next();
  };
}

export default adapter(fsRouter(import.meta.glob('./pages/**/*.{tsx,ts}')), {
  middlewareFns: [
    cronMiddleware,
    apRoutes,
    stripeRoutes,
    authRoutes,
    passkeyRoutes,
    eventRoutes,
    manageRoutes,
    fileRoutes,
    groupRoutes,
    profileRoutes,
  ],
  middlewareModules: import.meta.glob('./middleware/*.ts'),
});
