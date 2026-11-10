# Lento protocol server. Runs TypeScript directly on Bun, no build step.
FROM oven/bun:1.3.9-slim AS deps
WORKDIR /app
COPY package.json bun.lock tsconfig.base.json tsconfig.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/cli/package.json packages/cli/
COPY packages/agents/package.json packages/agents/
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.3.9-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    LENTO_SERVER_HOSTNAME=0.0.0.0 \
    LENTO_DATABASE_PATH=/data/lento.sqlite
# Bun links each workspace's dependencies under packages/*/node_modules, so
# take the whole installed tree, then lay the sources over it.
COPY --from=deps /app ./
COPY packages/core packages/core
COPY packages/server packages/server
COPY scripts/backup.ts scripts/backup.ts
# The base image ships an unprivileged `bun` user. /data is the volume mount point.
RUN mkdir -p /data && chown bun:bun /data
USER bun
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD bun -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["bun", "run", "packages/server/src/index.ts"]
