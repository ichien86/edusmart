FROM node:18-alpine AS builder

WORKDIR /app

# Copy configuration and workspace manifests
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/student-pwa/package.json ./apps/student-pwa/package.json
COPY apps/worker-node/package.json ./apps/worker-node/package.json

# Install dependencies inside Linux container
RUN npm install

# Compile packages sequentially
RUN npx tsc -b packages/schemas
RUN npx tsc -b packages/shuffle
RUN npx tsc -b packages/scoring
RUN npx tsc -b packages/db
RUN npx tsc -b apps/api

FROM node:18-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api

EXPOSE 3000
CMD ["node", "apps/api/dist/server.js"]
