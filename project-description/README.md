# Flagship — Technical Documentation

Flagship is a **LaunchDarkly-style feature flag and remote config platform** implemented as a NestJS + PostgreSQL control plane, a Redis-backed data plane, a Next.js dashboard, and local-evaluation SDKs (TypeScript and Python).

This folder is a technical dossier of **what the repository actually implements**. It is intended for interview preparation: architecture, code-level behavior, failure modes, and explicit gaps.

## Project summary

- **Repo layout:** npm workspaces (`packages/sdk-js`, `backend`, `frontend`) plus a separate Python SDK (`sdks/python`).
- **Runtime shape:** one NestJS process serving both admin APIs and SDK endpoints; not a microservices mesh.
- **Hot path:** SDKs download a compiled environment dataset, then evaluate flags **in process**. After bootstrap, a flag read does not call the network.
- **Kill switch:** admin toggle writes Postgres, recompiles the dataset, caches it in Redis, publishes on Redis pub/sub; SSE clients receive a `patch` and re-pull the dataset.

## Documentation map

| File | Contents |
|---|---|
| [00-overview.md](./00-overview.md) | Project identity, interview pitches, structure |
| [01-problem-and-requirements.md](./01-problem-and-requirements.md) | Implemented functional/non-functional requirements |
| [02-technology-stack.md](./02-technology-stack.md) | Inventory of technologies as used |
| [03-system-architecture.md](./03-system-architecture.md) | HLD, diagrams, failure of each component |
| [04-component-architecture.md](./04-component-architecture.md) | Module boundaries and dependencies |
| [05-data-flow.md](./05-data-flow.md) | End-to-end request and SSE flows |
| [06-api-reference.md](./06-api-reference.md) | Every implemented HTTP/SSE endpoint |
| [07-database-design.md](./07-database-design.md) | Prisma schema, indexes, query patterns |
| [08-cache-queue-and-storage.md](./08-cache-queue-and-storage.md) | Redis cache + pub/sub (no work queue) |
| [09-backend-internals.md](./09-backend-internals.md) | NestJS request lifecycle, services |
| [10-frontend-architecture.md](./10-frontend-architecture.md) | Next.js dashboard |
| [11-realtime-and-concurrency.md](./11-realtime-and-concurrency.md) | SSE, versioning, races |
| [12-security.md](./12-security.md) | Auth, CORS, gaps |
| [13-error-handling-and-resilience.md](./13-error-handling-and-resilience.md) | Failures and fallbacks |
| [14-scalability-and-performance.md](./14-scalability-and-performance.md) | What scales today vs hypothetical |
| [15-infrastructure-and-deployment.md](./15-infrastructure-and-deployment.md) | Docker, Terraform, CI |
| [16-testing.md](./16-testing.md) | Unit tests, k6, untested areas |
| [17-design-decisions-and-tradeoffs.md](./17-design-decisions-and-tradeoffs.md) | Why X instead of Y |
| [18-algorithms-and-data-structures.md](./18-algorithms-and-data-structures.md) | Hashing, evaluation, z-test |
| [19-class-and-module-reference.md](./19-class-and-module-reference.md) | Classes, functions, diagrams |
| [20-interview-deep-dive.md](./20-interview-deep-dive.md) | Q&A and attack points |
| [21-design-patterns.md](./21-design-patterns.md) | Patterns that match the code, and labels that do not |
| [22-demo-guide.md](./22-demo-guide.md) | Seeded browser demo, realtime, troubleshooting |

## Architecture overview

```text
Next.js dashboard  --HTTP-->  NestJS API  --SQL-->  PostgreSQL
                                  |  |                  ^
                                  |  +--compile----+    |
                                  |                v    |
 JS/Python SDKs  --HTTP/SSE-->    +---------->  Redis   |
                                  |     cache + pub/sub |
                                  +--evaluate engine----+
                                     (@flagship/sdk)
```

## Technology stack summary

| Layer | Implementation |
|---|---|
| API | NestJS 10, Express, TypeScript, Prisma 5 |
| Dashboard | Next.js 14 (App Router), React 18, Tailwind 3 |
| Persistence | PostgreSQL 16 |
| Cache / fan-out | Redis 7 (ioredis), pub/sub for SSE |
| Evaluation | Shared TS engine; Python port of the same algorithm |
| Local/prod-ish | Docker Compose; Terraform for GCP Cloud Run + Cloud SQL + Memorystore |
| CI | GitHub Actions (test, Cloud Run deploy, npm/PyPI publish workflows) |

## Most important files

| Path | Why |
|---|---|
| `docs/ARCHITECTURE.md` | Author's HLD/LLD (verify against code) |
| `backend/prisma/schema.prisma` | Source of truth for persistence |
| `backend/src/dataset/dataset.service.ts` | Compile + cache + publish |
| `backend/src/sdk/sdk.controller.ts` | Data-plane HTTP/SSE |
| `packages/sdk-js/src/engine.ts` | Evaluation order |
| `packages/sdk-js/src/hash.ts` | Sticky percentage rollouts |
| `packages/sdk-js/src/client.ts` | Streaming/polling SDK |
| `backend/src/experiments/stats.ts` | Two-proportion z-test |
| `docker-compose.yml` | Local Postgres/Redis (+ optional full stack) |
| `infra/terraform/main.tf` | GCP provisioning (IaC exists; live deploy not proven from repo) |

## Recommended reading order

1. [00-overview.md](./00-overview.md) — interview framing
2. [03-system-architecture.md](./03-system-architecture.md) — HLD
3. [05-data-flow.md](./05-data-flow.md) — write vs read paths
4. [18-algorithms-and-data-structures.md](./18-algorithms-and-data-structures.md) — engine + hashing + stats
5. [07-database-design.md](./07-database-design.md) and [08-cache-queue-and-storage.md](./08-cache-queue-and-storage.md)
6. [06-api-reference.md](./06-api-reference.md)
7. [12-security.md](./12-security.md) and [13-error-handling-and-resilience.md](./13-error-handling-and-resilience.md)
8. [17-design-decisions-and-tradeoffs.md](./17-design-decisions-and-tradeoffs.md)
9. [21-design-patterns.md](./21-design-patterns.md) — which pattern names are exact
10. [22-demo-guide.md](./22-demo-guide.md) — before a live walkthrough
11. [20-interview-deep-dive.md](./20-interview-deep-dive.md)

## Interview preparation

Memorize these five facts; interviewers will push on them:

1. **Local evaluation** is the latency design. The network is for dataset sync, not per-flag reads.
2. **Postgres is source of truth; Redis is a compiled artifact + notification bus**, not a second source of truth.
3. **Sticky rollouts** come from SHA-1 bucketing of `flagKey.salt.bucketBy`, not from storing user→variation mappings.
4. **Kill-switch freshness** is Redis pub/sub → SSE `patch` → client `GET /sdk/dataset`, not pushing the full payload on every change.
5. **Honest gaps:** optional admin API key (open in local/default), unused `JWT_SECRET`, no Prisma migration files in-repo, Cloud Run `--allow-unauthenticated`, experiment analysis scans events in-process, no rate limiting, Python SDK is polling-only.

Existing architecture notes live in [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md). Where README/docs and code disagree, **this dossier follows the code**. The browser script is [22-demo-guide.md](./22-demo-guide.md).
