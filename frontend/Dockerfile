# Build context is the repo root (see docker-compose.yml).
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json package-lock.json* ./
COPY frontend/package.json frontend/
RUN npm install

COPY frontend frontend
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace frontend

# ---- runtime (Next.js standalone) ----
FROM node:20-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=builder /app/frontend/.next/standalone ./
COPY --from=builder /app/frontend/.next/static ./frontend/.next/static
COPY --from=builder /app/frontend/public ./frontend/public

EXPOSE 3000
CMD ["node", "frontend/server.js"]
