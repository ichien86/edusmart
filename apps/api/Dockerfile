FROM node:18-alpine AS builder

WORKDIR /app

# Copy all workspaces for proper monorepo resolution
COPY package.json package-lock.json tsconfig.base.json vitest.config.ts polyfill-crypto.cjs ./
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY tools/ ./tools/

# Install dependencies and compile
RUN npm install
RUN npx tsc -b packages/schemas packages/shuffle packages/scoring packages/db apps/api

FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api

EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
