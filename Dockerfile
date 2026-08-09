# Yorox — Docker 自己ホスト用イメージ(Node + SQLite + ファイルストレージ)
# ビルド:  docker build -t yorox .
# 起動:    docker run -p 8080:8080 -v yorox-data:/data yorox
# 設定は環境変数(compose.yaml 参照)。データは /data(SQLite + アップロード)

FROM node:22-slim AS build
RUN corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/app/package.json packages/app/
COPY packages/ap/package.json packages/ap/
COPY packages/slot-coordinator/package.json packages/slot-coordinator/
RUN pnpm install --frozen-lockfile
COPY . .
RUN cd packages/app && YOROX_TARGET=node pnpm build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080 \
    HOST=0.0.0.0 \
    MIGRATIONS_DIR=/app/drizzle/migrations
# ランタイムで必要なのはネイティブ依存の better-sqlite3 と nodemailer のみ
# (それ以外はサーバーバンドルに同梱される)
RUN npm install --no-save --omit=dev better-sqlite3@13 nodemailer@9 \
  && npm cache clean --force
COPY --from=build /repo/packages/app/dist ./dist
COPY --from=build /repo/packages/app/drizzle ./drizzle
VOLUME /data
EXPOSE 8080
CMD ["node", "dist/serve-node.js"]
