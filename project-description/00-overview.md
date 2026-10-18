# Overview

## Project name

**Flagship** (npm workspace name `flagship`, version `0.1.0`). The JS SDK package is `@flagship/sdk`; the Python package is `flagship-sdk`.

## One-line description

A feature-flag and remote-config platform: teams edit flags in a dashboard, SDKs download a compiled ruleset and evaluate targeting locally with sticky percentage rollouts, near-real-time kill switches via Redis pub/sub + SSE, and a basic A/B experiment results UI.

## Problem being solved

Product and engineering teams need to:

- Ship code behind flags and turn features on/off without redeploying.
- Target subsets of users (keys, attributes, reusable segments).
- Ramp traffic gradually without users flip-flopping between variations.
- Kill a bad release quickly.
- Inspect who changed what (audit).
- Measure conversion differences between flag variations.

Flagship implements a **self-hosted** version of that product, not a SaaS multi-tenant marketplace.

## Target users

- **Operators** using the Next.js dashboard (projects, flags, segments, experiments, audit, SDK keys).
- **Application developers** embedding `@flagship/sdk` (Node/JS) or `flagship-sdk` (Python) in their services.

There is **no implemented end-user signup, OIDC, or RBAC**. Dashboard identity is an `x-actor-email` header used only for audit strings (`frontend/lib/api.ts:5-6`, `backend/src/common/actor.decorator.ts:5-8`).

## Core use cases

1. Create a project (auto-creates `production` + `development` environments and server SDK keys).
2. Create flags (boolean/string/number/json) that start **off** in every environment.
3. Toggle a flag (kill switch) for one environment.
4. Edit targeting: fallthrough, rules JSON, individual targets; optional percentage rollout for boolean flags in the UI.
5. Test evaluation for an arbitrary context from the dashboard.
6. Define segments and reference them with `segmentMatch`.
7. SDKs bootstrap dataset, evaluate locally, optionally stream or poll for updates, and `track` experiment events.
8. View experiment conversion rates and a two-proportion z-test vs variation 0.

## Main features (implemented)

| Feature | Where |
|---|---|
| Projects, environments, SDK keys, key rotation | `backend/src/projects` |
| Flags + per-env config | `backend/src/flags` |
| Segments | `backend/src/segments` |
| Audit log | `backend/src/audit` |
| Compiled dataset cache | `backend/src/dataset`, Redis |
| SDK HTTP + SSE | `backend/src/sdk` |
| Event ingest + experiment results | `backend/src/events`, `backend/src/experiments` |
| Shared evaluation engine | `packages/sdk-js/src/engine.ts` |
| Sticky hashing | `packages/sdk-js/src/hash.ts` |
| JS client (SSE or poll) | `packages/sdk-js/src/client.ts` |
| Python client (poll only) | `sdks/python/flagship/client.py` |
| Dashboard | `frontend/` |
| Seed demo data | `backend/prisma/seed.ts` |
| Docker Compose, Terraform, GitHub Actions, k6 | `docker-compose.yml`, `infra/`, `.github/workflows` |

## Major technical challenges (addressed in this repo)

1. **Evaluation consistency** — one engine used by SDKs, dashboard “test targeting”, and event ingest (`evaluate` from `@flagship/sdk`).
2. **Sticky, uniform rollouts** without storing per-user assignments.
3. **Separating write-heavy admin work from read-heavy SDK bootstrap** via a compiled Redis dataset.
4. **Propagating kill switches** without requiring every client to poll aggressively: Redis pub/sub + SSE.
5. **Keeping flag reads off the network** after the dataset is in memory.

## Why it is technically interesting

It is a compact **control-plane / data-plane** design: correctness and audit live in Postgres; latency and fan-out live in Redis + local eval. Interviewers can go deep on hashing, first-match rule engines, SSE fan-out across stateless API instances, and experiment stats — without a huge codebase.

## High-level architecture

A **modular monolith**: one NestJS app (`backend/src/app.module.ts`) imports feature modules. The dashboard is a separate Next.js app. SDKs are libraries, not services.

```text
[Dashboard :3000]  HTTP JSON
        |
        v
[NestJS :4000] ---- Prisma ---- [PostgreSQL]
        |  \
        |   +-- DatasetService.compile
        |                    |
        |                    v
        |               [Redis GET/SET + PUBLISH]
        |
[SDK clients] -- GET /sdk/dataset
              -- GET /sdk/stream (SSE)
              -- POST /sdk/events
```

## Technology summary

TypeScript/Node 20, NestJS, Prisma, PostgreSQL 16, Redis 7, Next.js 14, Tailwind, ioredis, EventSource (JS SDK), requests (Python), Docker, Terraform (GCP), GitHub Actions, Vitest, pytest, k6.

**Not present:** Kubernetes manifests, Kafka/RabbitMQ/SQS, WebSockets, ClickHouse, CDN config in-repo, JWT verification in application code, workers/job queues.

## Current implementation status

This is a **working local/demo platform** (seed + docker-compose + examples). Production-oriented **IaC and CI deploy workflows exist** (`infra/terraform`, `.github/workflows/deploy.yml`). Whether they have been applied to a live GCP project is **Not determinable from the repository.**

Package versions are `0.1.0`. Prisma **migration SQL files are not in the repo**; local README uses `prisma db push`. The backend Dockerfile tries `prisma migrate deploy` then falls back to `db push`.

## Repository structure

```text
feature-flags/
├── backend/                 NestJS API, Prisma schema + seed
├── frontend/                Next.js dashboard
├── packages/sdk-js/         @flagship/sdk (engine + client)
├── sdks/python/             flagship-sdk
├── examples/                node-demo, python-demo
├── infra/terraform/         GCP Cloud Run / SQL / Redis
├── infra/k6/                dataset-read load test
├── docs/ARCHITECTURE.md     author HLD/LLD
├── docker-compose.yml
├── .github/workflows/       ci, deploy, sdk-release
└── project-description/     this documentation package
```

Python SDK is **not** an npm workspace package (root `package.json` workspaces are `packages/*`, `backend`, `frontend` only).

## Important entry points

| Entry | Path |
|---|---|
| API bootstrap | `backend/src/main.ts` |
| Nest modules | `backend/src/app.module.ts` |
| Dashboard home | `frontend/app/page.tsx` |
| Project UI | `frontend/app/projects/[projectId]/page.tsx` |
| SDK public API | `packages/sdk-js/src/index.ts` |
| Seed | `backend/prisma/seed.ts` |
| Compose | `docker-compose.yml` |

## How major pieces interact

1. Dashboard calls `/projects...` with `x-actor-email`.
2. Mutating services write Postgres, append `AuditLog`, call `DatasetService.refresh(environmentId)`.
3. `refresh` rebuilds `ClientDataset`, `SET flagship:dataset:{environmentId}` (TTL 3600s), `PUBLISH flagship:changes:{environmentId}` with `{ version }`.
4. SDKs authenticate with Bearer SDK key; `SdkAuthService` maps key → environment (30s in-process cache).
5. Evaluation is `Engine.evaluate(flagKey, context, default)` against the in-memory dataset.

---

### Project in 30 seconds

Flagship is a self-hosted feature-flag system. Admins configure flags in Postgres. We compile each environment into one JSON ruleset, cache it in Redis, and ship it to SDKs. The SDKs evaluate targeting and percentage rollouts locally with a deterministic hash, so flag reads are in-memory. Kill switches publish through Redis and SSE so clients refresh quickly.

### Project in 2 minutes

I built a LaunchDarkly-style platform split into a **control plane** and a **data plane** inside one NestJS service. Postgres stores projects, environments, flag configs, segments, audit logs, experiments, and metric events. Every write recompiles that environment’s dataset into Redis and publishes a version bump. The Next.js dashboard is the operator UI. JS and Python SDKs download the dataset and run the same evaluation order: prerequisites, kill switch, individual targets, targeting rules, fallthrough/rollout. Rollouts use SHA-1 of `flagKey.salt.userKey` mapped into `[0,1)` so ramping 10% to 20% never evicts users already in the 10%. Experiments ingest events, stamp the variation at ingest using that engine, and run a two-proportion z-test against control.

### Project in 5 minutes

Architecturally this is a **modular monolith**, not microservices. Isolation is by **request path and storage**: admin CRUD always hits Prisma; `GET /sdk/dataset` is designed to be a Redis GET (cache miss rebuilds from Postgres). SSE (`GET /sdk/stream`) writes an initial `put` with the full dataset, then `patch` events with only `{ version }` so fan-out stays small; clients re-GET the dataset. Heartbeats every 25s keep proxies from dropping the connection.

The engine is **pure and synchronous** (`packages/sdk-js/src/engine.ts`). That lets unit tests cover kill switch, targets, rules, segments, and prerequisites without IO, and lets the server reuse it for dashboard evaluation and event attribution. Hashing matches LaunchDarkly-style 15-hex / 60-bit scaling (`hash.ts`). Python ports the same formula (`sdks/python/flagship/hashing.py`) so languages agree; JS tests also check uniformity (~10% ±2pp on 20k keys) and stickiness.

Consistency model: **Postgres is durable truth**; Redis can expire (1h TTL) and will be rebuilt. SDKs prefer availability: if the API is down they keep the last dataset unless `maxStalenessMs` is set. The environment dataset version aggregates flag-config versions and segment versions. `Segment.version` starts at 1 and increments on segment update, so a segment-only edit publishes a newer integer. Clients ignore a strictly older version.

Security is intentionally thin for a demo: control plane is open unless `ADMIN_API_KEY` is set; data plane requires an active SDK key. `JWT_SECRET` is in env/Terraform/CI **but is not read by application code**. Cloud Run workflow deploys the API as publicly invokable (`--allow-unauthenticated`). Experiment analytics are OLTP scans of the `Event` table, fine for the seeded ~thousands of rows, not an analytics warehouse.

I would walk an interviewer through one kill-switch sequence and one rollout-hash example, then the honest bottlenecks: SSE connection count on the API, Redis as a single cache, Prisma event ingest one-row-at-a-time, and in-memory aggregation for experiment results.
