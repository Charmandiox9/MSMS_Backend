ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402
FROM ${NODE_IMAGE} AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN npm ci --no-audit --no-fund
RUN npx prisma generate
COPY . .
RUN npm run build

FROM builder AS production-deps
RUN npm prune --omit=dev --ignore-scripts --no-audit --no-fund
# Prisma Client declares the CLI as an optional peer; npm may retain it after prune.
# Only the dedicated migration image needs this package.
RUN node -e "const fs=require('node:fs');fs.rmSync('node_modules/prisma',{recursive:true,force:true});fs.rmSync('node_modules/.bin/prisma',{force:true})"

FROM ${NODE_IMAGE} AS base
WORKDIR /app
ENV NODE_ENV=production PORT=3001
RUN addgroup -S nodejs && adduser -S marsys -G nodejs

FROM base AS migration
COPY --from=builder --chown=marsys:nodejs /app/package*.json ./
COPY --from=builder --chown=marsys:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=marsys:nodejs /app/prisma ./prisma
COPY --from=builder --chown=marsys:nodejs /app/prisma.config.ts ./
USER marsys
CMD ["npx", "prisma", "migrate", "deploy"]

FROM base AS runner
COPY --from=builder --chown=marsys:nodejs /app/package*.json ./
COPY --from=production-deps --chown=marsys:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=marsys:nodejs /app/dist ./dist
USER marsys
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
