import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cloudflare } from '@cloudflare/vite-plugin';
import babel from '@rolldown/plugin-babel';
import tailwindcss from '@tailwindcss/vite';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import { defineConfig } from 'waku/config';

// ビルド時にバージョンとコミット SHA を埋め込む(フッター・nodeinfo 用)
const version = JSON.parse(readFileSync('./package.json', 'utf8')).version as string;
const commit = (() => {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'dev';
  }
})();

// ビルドターゲット: cloudflare(既定)| node(Docker 自己ホスト)
const target = process.env.YOROX_TARGET === 'node' ? 'node' : 'cloudflare';

export default defineConfig({
  vite: {
    define: {
      __YOROX_VERSION__: JSON.stringify(version),
      __YOROX_COMMIT__: JSON.stringify(commit),
      __YOROX_TARGET__: JSON.stringify(target),
    },
    resolve: {
      alias: {
        // サーバーエントリとランタイムをターゲットで切り替える
        '#server-entry':
          target === 'node' ? '/src/waku.server.node.tsx' : '/src/waku.server.cloudflare.tsx',
        ...(target === 'node'
          ? { 'cloudflare:workers': '/src/runtime/cloudflare-node-shim.ts' }
          : {}),
      },
    },
    environments: {
      rsc: {
        optimizeDeps: {
          include: ['hono/tiny'],
        },
        build: {
          rolldownOptions: {
            platform: target === 'node' ? 'node' : 'neutral',
            ...(target === 'node'
              ? { external: ['better-sqlite3', 'nodemailer', 'worker-mailer'] }
              : {}),
          },
        },
      },
      ssr: {
        optimizeDeps: {
          include: ['waku > rsc-html-stream/server'],
        },
        build: {
          rolldownOptions: {
            platform: target === 'node' ? 'node' : 'neutral',
            ...(target === 'node'
              ? { external: ['better-sqlite3', 'nodemailer', 'worker-mailer'] }
              : {}),
          },
        },
      },
    },
    plugins: [
      tailwindcss(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      ...(target === 'cloudflare'
        ? [
            cloudflare({
              viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
              inspectorPort: false,
            }),
          ]
        : []),
    ],
  },
});
