import { fsRouter } from 'waku';
import adapter from 'waku/adapters/cloudflare';
import crawlLog from './server/crawl-log';
import apRoutes from './server/ap-routes';
import stripeRoutes from './server/stripe-routes';
import calendarRoutes from './server/calendar-routes';
import contactRoutes from './server/contact-routes';
import mcpRoutes from './server/mcp-routes';
import sitemapRoutes from './server/sitemap-routes';
import authRoutes from './server/auth-routes';
import passkeyRoutes from './auth/passkey-routes';
import eventRoutes from './server/event-routes';
import fileRoutes from './server/file-routes';
import groupRoutes from './server/group-routes';
import manageRoutes from './server/manage-routes';
import profileRoutes from './server/profile-routes';
import { runScheduledJobs } from './server/scheduled';

export default adapter(fsRouter(import.meta.glob('./pages/**/*.{tsx,ts}')), {
  middlewareFns: [
    crawlLog,
    apRoutes,
    stripeRoutes,
    calendarRoutes,
    contactRoutes,
    mcpRoutes,
    sitemapRoutes,
    authRoutes,
    passkeyRoutes,
    eventRoutes,
    manageRoutes,
    fileRoutes,
    groupRoutes,
    profileRoutes,
  ],
  middlewareModules: import.meta.glob('./middleware/*.ts'),
  handlers: {
    // Cron Trigger: 抽選締切の実行と通知 outbox のディスパッチ
    async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
      await runScheduledJobs(env);
    },
  } satisfies ExportedHandler<Env>,
});
