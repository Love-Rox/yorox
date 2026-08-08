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

export default defineConfig({
  vite: {
    define: {
      __YOROX_VERSION__: JSON.stringify(version),
      __YOROX_COMMIT__: JSON.stringify(commit),
    },
    environments: {
      rsc: {
        optimizeDeps: {
          include: ['hono/tiny'],
        },
        build: {
          rolldownOptions: {
            platform: 'neutral',
          },
        },
      },
      ssr: {
        optimizeDeps: {
          include: ['waku > rsc-html-stream/server'],
        },
        build: {
          rolldownOptions: {
            platform: 'neutral',
          },
        },
      },
    },
    plugins: [
      tailwindcss(),
      react(),
      babel({ presets: [reactCompilerPreset()] }),
      cloudflare({
        viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] },
        inspectorPort: false,
      }),
    ],
  },
});
