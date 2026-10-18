# Problem and requirements

Requirements below are **implemented behavior**, not a product spec invented after the fact. Inferred NFRs are labeled.

---

## Functional requirements

### FR1 — Multi-project, multi-environment tenancy (logical)

**What:** Create a project with a unique `key` and `name`. Each project gets `production` and `development` environments and one server SDK key per environment.

**Where:** `backend/src/projects/projects.service.ts:19-51`, controller `POST /projects`.

**Components:** `ProjectsService`, Prisma `Project` / `Environment` / `SdkKey`, `AuditService`.

**API:** `POST /projects`, `GET /projects`, `GET /projects/:projectId`.

**DB:** Insert project + two environments in one nested create; then insert SDK keys. Audit `project.created`.

---

### FR2 — SDK key rotation

**What:** Deactivate all active keys for an environment and issue a new `sdk-{envKey}-{12chars}` key.

**Where:** `projects.service.ts:70-88`.

**API:** `POST /projects/environments/:environmentId/rotate-key`.

**DB:** `sdkKey.updateMany` `active: false`; `sdkKey.create`. Audit `sdkkey.rotated`.

**Note:** Deactivation is immediate in Postgres, and the new key works on the next lookup. `SdkAuthService` caches **successful** resolutions only, in a per-process `Map`, for 30s (`ttlMs` in `sdk-auth.service.ts`). Rotate does not delete those entries, and the map is not in Redis. A key already resolved on that API process can still authenticate until the entry expires. Other instances have their own maps. Unknown or inactive keys that were not cached are rejected on the spot.

---

### FR3 — Flag CRUD and per-environment config

**What:** Flags belong to a project (`@@unique([projectId, key])`). Kind: boolean/string/number/json. Variations stored as JSON. Creating a flag creates a `FlagConfig` for every existing environment, **on: false**, `offVariation` = last variation index, empty targets/rules/prerequisites, unique 16-char `nanoid` salt.

**Where:** `flags.service.ts:36-86`, `flags.controller.ts`.

**API:**
- `POST /projects/:projectId/flags`
- `GET /projects/:projectId/flags`
- `GET /projects/:projectId/flags/:key`
- `PATCH /projects/:projectId/flags/:key/environments/:environmentId`
- `DELETE /projects/:projectId/flags/:key`

**DB:** Nested `flag.create` with `configs.create`; updates increment `FlagConfig.version`; delete cascades configs.

**Dashboard:** create + list + drawer save (`FlagsTab`, `FlagDrawer`). Delete is **API-only** (no delete button in `FlagsTab.tsx`).

---

### FR4 — Kill switch

**What:** Isolated update of `FlagConfig.on` plus version bump, audit (`flag.enabled` / `flag.killswitch`), `dataset.refresh`.

**Where:** `flags.service.ts:164-196`.

**API:** `POST /projects/:projectId/flags/:key/environments/:environmentId/toggle` body `{ on, comment? }`.

---

### FR5 — Dashboard test targeting

**What:** Evaluate a flag for a JSON context using the compiled dataset and the shared engine.

**Where:** `flags.controller.ts:88-96`.

**API:** `POST .../evaluate`.

**DB/cache:** `DatasetService.getDataset` (Redis then Postgres compile).

---

### FR6 — Segments

**What:** Per-environment segments with `included`/`excluded` keys, JSON rules, salt. Referenced from flag clauses via `segmentMatch`.

**Where:** `segments.service.ts`, engine `matchSegment` in `engine.ts:142-161`.

**API:** list/create/update/delete under `/projects/:projectId/environments/:environmentId/segments`.

**Version:** `Segment.version` is an integer, default 1. Updates increment it atomically. That value is included in the environment dataset version, so editing rules or membership changes the version SDKs observe.

**Dashboard:** list + create only (`SegmentsTab.tsx`). Update/delete are **API-only**.

---

### FR7 — Dataset compile, cache, notify

**What:** Build `ClientDataset` from all flag configs + segments for an environment; cache; publish version.

**Where:** `dataset.service.ts:19-85`.

**Trigger:** every flag/segment write path calls `refresh`.

**Redis:** `SET ... EX 3600`, `PUBLISH`.

---

### FR8 — SDK bootstrap, stream, poll

**What:** Authenticated read of dataset; optional SSE with `put`/`patch`/heartbeat.

**Where:** `sdk.controller.ts`.

**API:** `GET /sdk/dataset`, `GET /sdk/stream`.

**Clients:** JS `FlagshipClient` streaming default or polling (`client.ts`); Python polling only (`client.py`).

---

### FR9 — Local evaluation semantics

**What:** Prerequisites → kill switch → targets → rules → fallthrough; operators; sticky rollouts.

**Where:** `packages/sdk-js/src/engine.ts`, `operators.ts`, `hash.ts`; Python equivalents.

**Not an HTTP API** except evaluate + implicit use in event ingest.

---

### FR10 — Metric event ingest

**What:** Store events; if `flagKey` is present, resolve `variationIndex` with the engine at ingest. The payload keeps `contextKey` and also carries the full evaluation context (key plus attributes). Attribution calls `evaluate` with that context so segment and attribute rules match a client `variation()` call. A body that only sends `contextKey` still ingests; those events are attributed as `{ key: contextKey }` with no attributes. The row stores `contextKey` for later aggregation.

**Where:** `backend/src/events/events.service.ts`, `packages/sdk-js/src/client.ts` (`track`).

**API:** `POST /sdk/events` (single object or `{ events: [] }`). Batch is a sequential loop, not `createMany`.

---

### FR11 — Experiments and results

**What:** Experiment document (flagKey, exposureEvent, goalEvent, metricKind). Results group unique `contextKey`s per variation for exposure vs goal; two-proportion z-test vs variation 0.

**Where:** `experiments.service.ts`, `stats.ts`.

**API:** `GET/POST .../experiments`, `GET .../experiments/:key/results`.

**Dashboard:** list + results (`ExperimentsTab.tsx`). Create is **API-only** (UI copy tells the user that).

**metricKind `numeric`:** stored on the experiment and `avgValue`/`totalValue` are computed, but significance is **always** the binary conversion z-test, not a t-test of means.

---

### FR12 — Audit log

**What:** Append-only rows with actor, action, before/after JSON.

**Where:** `audit.service.ts`.

**API:** `GET /projects/:projectId/audit?limit&entityId`.

**Cap:** `take` min(limit default 100, 500).

---

### FR13 — Health check

**What:** Ping Postgres (`SELECT 1`) and Redis `PING`; return `{ status: ok|degraded, checks, ts }`.

**Where:** `health.controller.ts`. HTTP status is **always 200** even when degraded (Nest default).

---

### FR14 — Seeded demo

**What:** Project `demo`, fixed SDK keys, beta segment, `new-checkout`, `pricing-experiment`, experiment `pricing-ab`, ~4000 synthetic users’ events.

**Where:** `backend/prisma/seed.ts`.

---

## Non-functional requirements

| NFR | Status | Evidence |
|---|---|---|
| **Latency (flag read after bootstrap)** | Inferred / designed | Engine is sync in-memory (`engine.ts:14-20`). No measured p99 in CI. |
| **Latency (dataset HTTP)** | Stated target, not proven in CI | k6 thresholds p95 &lt; 50ms, p99 &lt; 120ms (`infra/k6/eval-latency.js:30-34`). Running k6 is optional. |
| **Throughput** | Not demonstrated | k6 ramps to 200 VUs against `/sdk/dataset` only. |
| **Availability (SDK)** | Implemented policy | Last-good dataset; optional `maxStalenessMs` (`client.ts:130-160`). Redis connect errors swallowed on API startup (`redis.service.ts:27-28`). |
| **Availability (API health)** | Partial | Health reports degraded but still 200. |
| **Consistency** | Eventual for SDKs | Writes commit Postgres then refresh Redis. Brief window if process crashes after DB write and before refresh. Clients ignore older dataset versions. |
| **Durability** | Postgres | Prisma writes. Redis TTL 1h is cache, not durable store. Audit is insert-only (no update API). |
| **Scalability** | Partial architecture | Stateless API *in principle*; SSE holds connections on instances. Terraform `max_instances` default 20. No autoscaling proof. |
| **Security** | Minimal | Optional `ADMIN_API_KEY`; SDK Bearer keys; Prisma parameterized queries. See `12-security.md`. |
| **Fault tolerance** | Partial | SDK last-good; Redis miss rebuilds from Postgres; no circuit breaker library. |
| **Resource efficiency** | Inferred | Local eval avoids per-flag RPCs. Dataset is full env snapshot (grows with flag count). |
| **Real-time** | SSE, not WebSocket | `GET /sdk/stream`. Python SDK has no SSE. |
| **Kill-switch SLO** | Claimed in docs | Architecture doc says “typically well under a second globally”. Repo has **no measured SLO**. Inferred: Redis pub/sub + one HTTP GET, same region. |

### Explicitly not implemented as requirements

- Multi-region active-active
- CDN/edge cache configuration
- Per-user assignment persistence
- Feature workflows / approvals / scheduled rollouts
- RBAC / SSO
- Rate limiting
- Kafka/ClickHouse experiment pipeline (mentioned as future in `docs/ARCHITECTURE.md:145`, **not implemented**)
