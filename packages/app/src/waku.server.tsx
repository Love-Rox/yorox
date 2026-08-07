import { fsRouter } from 'waku';
import adapter from 'waku/adapters/cloudflare';
import apRoutes from './server/ap-routes';

export default adapter(fsRouter(import.meta.glob('./pages/**/*.{tsx,ts}')), {
  middlewareFns: [apRoutes],
  middlewareModules: import.meta.glob('./middleware/*.ts'),
  handlers: {
    // Queues / Cron 等の追加ハンドラは連合・抽選実装時にここへ足す
    // https://developers.cloudflare.com/workers/runtime-apis/handlers/
  } satisfies ExportedHandler<Env>,
});
