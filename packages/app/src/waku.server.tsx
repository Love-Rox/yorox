import { fsRouter } from 'waku';
import adapter from 'waku/adapters/cloudflare';
import apRoutes from './server/ap-routes';
import authRoutes from './server/auth-routes';
import eventRoutes from './server/event-routes';
import fileRoutes from './server/file-routes';
import manageRoutes from './server/manage-routes';
import { runScheduledJobs } from './server/scheduled';

export default adapter(fsRouter(import.meta.glob('./pages/**/*.{tsx,ts}')), {
  middlewareFns: [apRoutes, authRoutes, eventRoutes, manageRoutes, fileRoutes],
  middlewareModules: import.meta.glob('./middleware/*.ts'),
  handlers: {
    // Cron Trigger: 抽選締切の実行と通知 outbox のディスパッチ
    async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext) {
      await runScheduledJobs(env);
    },
  } satisfies ExportedHandler<Env>,
});
