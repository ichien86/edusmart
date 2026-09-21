FROM node:18-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json vitest.config.ts polyfill-crypto.cjs ./
COPY packages/ ./packages/
COPY apps/ ./apps/
COPY tools/ ./tools/

RUN npm install
RUN npx tsc -b packages/schemas packages/shuffle packages/scoring packages/db apps/worker-node

FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/worker-node ./apps/worker-node

CMD ["node", "apps/worker-node/dist/worker.js"]
