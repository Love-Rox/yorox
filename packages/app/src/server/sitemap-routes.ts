/**
 * sitemap.xml。主要な静的ページ + 公開グループ + 公開イベントを列挙する。
 */
import { and, eq, gte, isNull } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono/tiny';
import { createDb, schema } from '../db/client';
import { requestOrigin } from './http';

async function getEnv(): Promise<Env> {
  const { env } = await import('cloudflare:workers');
  return env;
}

const STATIC_PATHS = [
  '/',
  '/docs',
  '/docs/faq',
  '/docs/participants',
  '/docs/organizers',
  '/docs/federation',
  '/docs/mcp',
  '/docs/instance-owners',
  '/legal/terms',
  '/legal/privacy',
  '/legal/tokushoho',
];

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

const sitemap = new Hono();

sitemap.get('/sitemap.xml', async (c) => {
  const db = createDb((await getEnv()).DB);
  const origin = await requestOrigin(c);

  const entries: { loc: string; lastmod?: Date }[] = STATIC_PATHS.map((p) => ({
    loc: `${origin}${p}`,
  }));

  // 公開グループ
  const groups = await db
    .select({ handle: schema.actors.handle })
    .from(schema.actors)
    .innerJoin(schema.groups, eq(schema.actors.id, schema.groups.actorId))
    .where(and(eq(schema.actors.kind, 'group'), eq(schema.groups.isPersonal, false)));
  for (const g of groups) {
    if (g.handle) entries.push({ loc: `${origin}/g/${g.handle}` });
  }

  // 公開・今後のイベント
  const events = await db
    .select({
      id: schema.events.id,
      handle: schema.actors.handle,
      updatedAt: schema.events.updatedAt,
    })
    .from(schema.events)
    .innerJoin(schema.actors, eq(schema.events.groupActorId, schema.actors.id))
    .where(
      and(
        eq(schema.events.visibility, 'public'),
        isNull(schema.events.cancelledAt),
        gte(schema.events.startsAt, new Date()),
      ),
    )
    .limit(2000);
  for (const e of events) {
    if (e.handle) entries.push({ loc: `${origin}/g/${e.handle}/events/${e.id}`, lastmod: e.updatedAt });
  }

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) =>
      `  <url><loc>${xmlEscape(e.loc)}</loc>${e.lastmod ? `<lastmod>${e.lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`,
  )
  .join('\n')}
</urlset>`;

  return c.body(body, 200, {
    'content-type': 'application/xml; charset=utf-8',
    'cache-control': 'public, max-age=3600',
  });
});

export default function sitemapRoutes(opts: { app: Hono }): MiddlewareHandler {
  opts.app.route('/', sitemap);
  return (_c, next) => next();
}
