# Build context is the repo root (see docker-compose.yml) so we can resolve the
# @flagship/sdk workspace dependency.
FROM node:20-slim AS builder
WORKDIR /app

RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install deps using the workspace manifests for better layer caching.
COPY package.json package-lock.json* ./
COPY packages/sdk-js/package.json packages/sdk-js/
COPY backend/package.json backend/
RUN npm install

# Build the SDK (backend imports the engine from it), then the backend.
COPY packages/sdk-js packages/sdk-js
RUN npm run build --workspace @flagship/sdk

COPY backend backend
RUN npm run prisma:generate --workspace backend \
  && npm run build --workspace backend

# ---- runtime ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/sdk-js/dist ./packages/sdk-js/dist
COPY --from=builder /app/packages/sdk-js/package.json ./packages/sdk-js/package.json
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY --from=builder /app/backend/prisma ./backend/prisma
COPY --from=builder /app/backend/package.json ./backend/package.json

WORKDIR /app/backend
EXPOSE 4000
# Apply migrations then start. `migrate deploy` is a no-op if already applied.
CMD ["sh", "-c", "npx prisma migrate deploy || npx prisma db push; node dist/main.js"]
