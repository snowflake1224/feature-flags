# Technology stack

Versions are from package manifests / Compose / Terraform **as present in the repository**. “Why” is inferred from usage when the repo does not spell out rationale.

---

## Programming languages

| Name | Version | Purpose | Where | Notes |
|---|---|---|---|---|
| TypeScript | ^5.4.5 | API, dashboard, JS SDK | `backend`, `frontend`, `packages/sdk-js` | Strict compile via `tsc` / Nest / Next |
| JavaScript (ESM) | — | Node example | `examples/node-demo/index.mjs` | Imports workspace SDK |
| Python | >=3.9 (CI 3.11) | SDK + demo | `sdks/python`, `examples/python-demo` | Hatchling package |

---

## Frontend

| Name | Version | Purpose | Where |
|---|---|---|---|
| Next.js | 14.2.5 | App Router dashboard | `frontend/` |
| React / react-dom | ^18.3.1 | UI | client components (`"use client"`) |
| Tailwind CSS | ^3.4.4 | Styling | `tailwind.config.ts`, `globals.css` |
| PostCSS + Autoprefixer | as in `frontend/package.json` | CSS pipeline | `postcss.config.mjs` |

**Not used:** Redux, React Query, SWR, WebSocket client. State is React `useState`/`useEffect`. Fetch via `frontend/lib/api.ts`.

**Config:** `output: "standalone"` (`frontend/next.config.mjs`) for Docker. `NEXT_PUBLIC_API_URL` baked in at build time. `reactStrictMode: true`.

---

## Backend / frameworks

| Name | Version | Purpose | Where |
|---|---|---|---|
| NestJS (`@nestjs/common/core/platform-express`) | ^10.3.7 | HTTP API, DI, modules | `backend/src` |
| Express | via Nest platform | HTTP + SSE `Response` | `sdk.controller.ts` uses `@Res()` |
| RxJS | ^7.8.1 | Nest peer; **no custom observables** in app code | dependency only |
| class-validator / class-transformer | ^0.14 / ^0.5 | DTO validation | `CreateFlagDto`, `CreateProjectDto`, `ToggleDto`; global `ValidationPipe` |
| Prisma Client + Prisma CLI | ^5.12.1 | ORM | `backend/prisma/schema.prisma` |
| nanoid | ^3.3.7 | salts, SDK key suffix | flags, segments, projects |
| reflect-metadata | ^0.2.2 | Nest decorators | `main.ts` import |

---

## Databases

| Name | Version | Purpose | Config |
|---|---|---|---|
| PostgreSQL | 16 (image `postgres:16-alpine`; Terraform `POSTGRES_16`) | Source of truth | `DATABASE_URL`; Compose user/db `flagship` |

Prisma `url = env("DATABASE_URL")`. Connection: `PrismaService` `$connect` on module init. **Pooling:** Prisma defaults (not customized in schema). **Isolation:** not configured. **Replication:** not in app; Cloud SQL Terraform is `ZONAL`, backups enabled.

---

## Caches

| Name | Version | Purpose | Where |
|---|---|---|---|
| Redis | 7 (Compose `redis:7-alpine`; Memorystore `REDIS_7_0`) | Dataset JSON cache + pub/sub | `backend/src/redis/redis.service.ts` |
| ioredis | ^5.4.1 | Client | two connections: command + subscriber |

In-process caches (not Redis): `SdkAuthService` Map TTL 30s.

---

## Message queues

**Not applicable.** Redis **pub/sub** is used as a notification bus (`PUBLISH`/`SUBSCRIBE`), not a durable work queue. No Kafka, RabbitMQ, SQS, Redis Streams in code.

---

## Real-time technologies

| Name | Purpose | Where |
|---|---|---|
| Server-Sent Events | Dataset `put`/`patch`, keep-alive comments | `sdk.controller.ts:35-61` |
| `eventsource` npm | JS SDK EventSource with headers | `packages/sdk-js` dependency `^2.0.2` |

No Socket.IO, no native WebSocket server.

---

## Authentication

| Mechanism | Used? | Where |
|---|---|---|
| Bearer SDK key / `x-sdk-key` | Yes | `SdkAuthService` |
| `x-api-key` vs `ADMIN_API_KEY` | Optional | `AdminGuard` |
| `x-actor-email` / `x-actor` | Audit label only | `Actor` decorator |
| JWT | **Configured, unused in code** | `JWT_SECRET` in `.env.example`, Compose, Terraform, `deploy.yml` — **no `jsonwebtoken` / passport / jwt verify** in source |

---

## AI/ML technologies

**Not applicable.** Experiment “stats” are a classical two-proportion z-test (`stats.ts`), not ML.

---

## Cloud services (IaC / CI — may be unused until applied)

| Service | Purpose | Where |
|---|---|---|
| Google Cloud Run v2 | API container | `infra/terraform/main.tf`, `deploy.yml` |
| Cloud SQL PostgreSQL | Managed DB, private IP | Terraform |
| Memorystore Redis | Managed Redis | Terraform |
| Secret Manager | DATABASE_URL, REDIS_URL, JWT_SECRET | Terraform |
| Artifact Registry | Docker repo `flagship` | Terraform + deploy |
| VPC + VPC Access Connector | Private egress from Cloud Run | Terraform |
| Workload Identity Federation | GitHub → GCP auth | `deploy.yml` secrets |

Frontend **is not** provisioned in Terraform (API only).

---

## Infrastructure / containers / orchestration

| Name | Purpose |
|---|---|
| Docker | `backend/Dockerfile`, `frontend/Dockerfile` multi-stage Node 20-slim |
| Docker Compose | Postgres, Redis always; backend+frontend `profiles: [full]` |
| Kubernetes | **Not present** |
| Terraform | >= 1.5, google provider ~> 5.30; GCS backend **commented out** |

---

## CI/CD

| Workflow | File | What it does |
|---|---|---|
| CI | `.github/workflows/ci.yml` | Build/test JS SDK; backend with Postgres+Redis services; frontend typecheck+build; Python pytest |
| Deploy | `deploy.yml` | Build backend image, push AR, `gcloud run deploy` public, min instances 1, secrets |
| SDK release | `sdk-release.yml` | On `sdk-v*` tags: npm publish `@flagship/sdk`; Python `twine upload` |

---

## Testing

| Tool | Version | Use |
|---|---|---|
| Vitest | ^1.5.0 | SDK, backend service, and frontend pure-helper tests |
| pytest | >=8 (optional extra) | Python engine and shared golden-vector tests |
| Playwright | ^1.49.1 | Seeded-stack portfolio smoke test in CI |
| k6 | script only | `infra/k6/eval-latency.js` — not run in CI |

No Cypress or Nest `supertest` API tests. The dedicated Playwright CI job
provisions and seeds the stack before running the browser smoke.

---

## Observability

**Minimal.** `console.log` on API listen (`main.ts:19`). Health JSON. No OpenTelemetry, Prometheus, Sentry, structured logger module.

k6 custom Trend `dataset_read_latency` exists only inside the k6 script.

---

## Development tooling

npm workspaces, Nest CLI, tsup (SDK CJS+ESM+dts), ts-node (seed), prisma generate/push/migrate scripts, Docker.

Root scripts: `build:sdk`, `dev:backend`, `dev:frontend`, `infra:up/down`, `test` (sdk-js + backend only — **not Python**).

---

## Third-party APIs

**None at runtime.** SDKs talk only to this project’s HTTP API. No Stripe, GitHub, SendGrid, etc.

---

## Other dependencies worth classifying as unused-as-core

| Dependency | Status |
|---|---|
| `JWT_SECRET` env | Provisioned, **unused by app** |
| RxJS | Nest requirement, unused directly |
| `kind` on SdkKey (`client` vs `server`) | Stored; **auth does not branch on kind** (`sdk-auth.service.ts` copies `kind` but controllers ignore it) |
| `inExperiment` on hash pick | `pickVariation` **always returns `inExperiment: false`** (`hash.ts:44-49`) |

---

## How they interact (short)

Dashboard (Next) → HTTP → Nest (Express) → Prisma → Postgres. Nest → ioredis → Redis. Nest evaluation imports `@flagship/sdk` (built workspace package). JS SDK → fetch + EventSource → Nest. Python SDK → `requests` → Nest. Terraform describes GCP wiring for the same Nest process + Postgres + Redis.
