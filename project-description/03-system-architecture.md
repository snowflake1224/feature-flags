# System architecture (HLD)

## Overall architecture

Flagship is a **two-plane design implemented as a single NestJS process** plus a separate Next.js UI and client libraries.

- **Control plane:** correctness, audit, CRUD. PostgreSQL is source of truth.
- **Data plane:** serve compiled `ClientDataset` from Redis; SSE notifications; event ingest.

This matches `docs/ARCHITECTURE.md`. The README’s “control plane vs data plane” is **logical**, not two independently deployed microservices. Terraform deploys **one** Cloud Run service `flagship-api`.

## ASCII architecture diagram

```text
                         TRUST: operator browser
  +------------------+
  | Next.js :3000    |  (no session store; sends x-actor-email)
  | Dashboard        |
  +--------+---------+
           | HTTP JSON  (CORS_ORIGIN)
           v
  +----------------------------------------------+
  | NestJS API :4000                             |
  |  AdminGuard (optional x-api-key)             |
  |  ValidationPipe                              |
  |                                              |
  |  Projects/Flags/Segments/Audit/Experiments   |
  |           |                                  |
  |           v                                  |
  |     PrismaService -------- SQL ------------->+---- PostgreSQL :5432
  |           |                                  |     (durable models)
  |           v                                  |
  |     DatasetService.refresh/get               |
  |           |                                  |
  |           +---- GET/SET dataset ------------>+---- Redis :6379
  |           +---- PUBLISH changes ------------>|     cache + pub/sub
  |                                              |
  |  SdkAuthService (Bearer / x-sdk-key)         |
  |  GET /sdk/dataset  GET /sdk/stream  POST /sdk/events
  |  Engine.evaluate (in-process, @flagship/sdk) |
  +----------------------+-----------------------+
                         ^
                         | HTTP + SSE
                         |
          +--------------+---------------+
          | JS FlagshipClient            |
          | Python FlagshipClient        |
          | (local Engine after fetch)   |
          +------------------------------+
                         TRUST: anyone with an SDK key
                         (Cloud Run: allUsers invoker)
```

### Explain every arrow

| Arrow | Protocol | Payload | Why |
|---|---|---|---|
| Dashboard → API | HTTP JSON | CRUD bodies, `x-actor-email` | Operator UI |
| API → Postgres | SQL via Prisma | Row writes/reads | Source of truth |
| API → Redis SET | Redis protocol | JSON `ClientDataset` | Hot-path read |
| API → Redis PUBLISH | pub/sub | `{ version }` | Notify SSE subscribers |
| Redis → API subscriber | pub/sub | same | Fan-out to SSE `Response.write` |
| SDK → GET dataset | HTTP | JSON dataset | Bootstrap / poll / post-patch pull |
| SDK → GET stream | HTTP SSE | `event: put\|patch` | Live updates |
| SDK → POST events | HTTP JSON | metric events | Experiments |
| API → Engine | in-process | dataset + context | Test eval + event variation |

## Major services / processes

| Process | Role | How started |
|---|---|---|
| `postgres` container or Cloud SQL | Persistence | Compose / Terraform |
| `redis` container or Memorystore | Cache + bus | Compose / Terraform |
| Nest `node dist/main.js` | All HTTP | `npm run dev:backend` / Docker / Cloud Run |
| Next `next dev` or `node frontend/server.js` | Dashboard | local / Compose profile `full` |
| SDK in customer app | Evaluate + optional SSE/poll | library |

**No worker process. No separate gateway. No queue consumer.**

## Clients

1. Browser dashboard (Next).
2. Node/browser apps using `@flagship/sdk` (`eventsource` for SSE).
3. Python apps using `flagship-sdk` (HTTP poll only).

## Network and trust boundaries

```text
+------------------ unauthenticated by default ------------------+
| Dashboard and API if ADMIN_API_KEY unset                       |
| Cloud Run: --allow-unauthenticated / allUsers invoker          |
+----------------------------------------------------------------+
        |
        | SDK key required only on /sdk/*
        v
+------------------ data plane ----------------------------------+
| Dataset is the full targeting ruleset for an environment       |
| Anyone with the key can download flags/segments/rules          |
+----------------------------------------------------------------+
        |
        | VPC connector PRIVATE_RANGES_ONLY (Terraform)
        v
+------------------ private data --------------------------------+
| Cloud SQL private IP, Memorystore on VPC                       |
+----------------------------------------------------------------+
```

Local Compose publishes Postgres `5432` and Redis `6379` to the host (convenient, not locked down).

## Communication protocols

- HTTP/1.1 JSON for REST.
- SSE (`text/event-stream`) for streams; comments `: keep-alive` every 25s.
- Redis RESP for cache and pub/sub.
- PostgreSQL wire via Prisma.

TLS: **not configured in-app**. Relies on Cloud Run HTTPS or local HTTP. **Not determinable** whether a reverse proxy is used in a real deploy.

## External services

None at application runtime. GCP is optional infrastructure.

## Storage

- Postgres: all relational models (`schema.prisma`).
- Redis: ephemeral dataset copy (TTL 3600s).
- No object storage, no local file blob store.

---

## Component cards

### Next.js dashboard

- **Why:** Operator UX.
- **Enters:** User clicks; `fetch` to `NEXT_PUBLIC_API_URL`.
- **Leaves:** HTTP requests; renders JSON.
- **State:** React component state only (no shared store). Actor in `localStorage` key `flagship.actor` if set.
- **Deps:** API must be reachable from the browser (CORS).
- **Failure:** Home page shows “Could not reach API” (`page.tsx:47-50`). Other tabs often uncaught promise failures (gap).

### NestJS API

- **Why:** Single place for writes, compile, SDK IO.
- **Enters:** HTTP.
- **Leaves:** JSON, SSE bytes, Prisma, Redis.
- **State:** in-process SDK-key cache; SSE subscriptions; ioredis connections.
- **Deps:** Postgres (writes, cache miss, auth lookup), Redis (cache/pubsub — connect errors ignored at startup).
- **Failure:** process death drops SSE clients; clients reconnect (EventSource). Cache miss hits Postgres. If Postgres down: admin and auth and cache-miss fail; health `postgres: down`.

### PostgreSQL

- **Why:** Durable flags, audit, events.
- **Enters:** SQL.
- **Leaves:** rows.
- **State:** all models.
- **Failure:** API errors; SDKs may still serve last Redis dataset until TTL.

### Redis

- **Why:** Fast dataset GET; pub/sub across API instances.
- **Enters:** SET/GET/PUBLISH/SUBSCRIBE.
- **Leaves:** cached JSON; change messages.
- **Failure:** `getDataset` compiles from Postgres (`dataset.service.ts:71-77`). SSE will not receive live patches if pub/sub is down; polling still works. `onModuleInit` swallows connect failure (`redis.service.ts:27-28`).

### `@flagship/sdk` Engine

- **Why:** One evaluation truth.
- **Enters:** dataset + context.
- **Leaves:** `{ value, variationIndex, reason }`.
- **State:** none (pure aside from dataset reference).
- **Failure:** missing flag → default + ERROR; malformed variation index → default.

### JS / Python clients

- **Why:** Embed in apps.
- **Failure:** initial fetch logged/warned; last dataset retained; optional staleness → default values.

## Horizontal scaling (architectural, not proven)

Multiple Cloud Run instances can share Redis: cache is shared; each instance’s subscriber connection receives `PUBLISH`. Terraform sets `max_instance_count` default 20 (`variables.tf:38-39`). SSE connections are **sticky to the instance** that accepted them; that is expected for SSE.

## Discrepancies vs `docs/ARCHITECTURE.md`

| Doc claim | Code |
|---|---|
| Cloud CDN / reverse proxy with ETag | **Not implemented** in API (no ETag middleware found) |
| Kafka/ClickHouse for high volume | **Not implemented** |
| JWT for actors | **Not implemented**; `JWT_SECRET` unused |
