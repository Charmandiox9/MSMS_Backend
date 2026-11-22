ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack enable pnpm
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN pnpm install --frozen-lockfile
RUN pnpm exec prisma generate
COPY . .
RUN pnpm run build

FROM builder AS production-deps
RUN pnpm prune --prod --ignore-scripts

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NODE_ENV=production PORT=3001
RUN apk add --no-cache ffmpeg && addgroup -S nodejs && adduser -S marsys -G nodejs

FROM base AS migration
COPY --from=builder --chown=marsys:nodejs /app/package.json ./
COPY --from=builder --chown=marsys:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=marsys:nodejs /app/prisma ./prisma
COPY --from=builder --chown=marsys:nodejs /app/prisma.config.ts ./
USER marsys
CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

# Opt-in, single-replica Dokploy deployment: migrate before bootstrap/API startup.
# Retains the pinned CLI and migrations; runtime below is the lean alternative.
FROM migration AS dokploy
COPY --from=builder --chown=marsys:nodejs /app/dist ./dist
COPY --chown=marsys:nodejs docker/start.sh docker/deploy.sh ./docker/
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=120s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/bin/sh", "/app/docker/deploy.sh"]
CMD ["node", "dist/main.js"]

FROM base AS runtime
COPY --from=builder --chown=marsys:nodejs /app/package.json ./
COPY --from=production-deps --chown=marsys:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=marsys:nodejs /app/dist ./dist
COPY --chown=marsys:nodejs docker/start.sh ./docker/start.sh
USER marsys
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/bin/sh", "/app/docker/start.sh"]
CMD ["node", "dist/main.js"]

# Default local production simulation: migrate, bootstrap, then run compiled JS.
FROM dokploy AS runner
