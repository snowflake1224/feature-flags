# Class and module reference

Generated Prisma Client types are omitted except as models in `07-database-design.md`.

---

## ASCII class / module diagram (backend + engine)

```text
Nest AppModule
  HealthController ---- PrismaService, RedisService
  ProjectsController ---- ProjectsService ---- Prisma, AuditService
  FlagsController ---- FlagsService ---- Prisma, Audit, DatasetService
                 ---- evaluate() from @flagship/sdk
  SegmentsController ---- SegmentsService ---- Prisma, Audit, Dataset
  AuditController ---- AuditService ---- Prisma
  ExperimentsController ---- ExperimentsService ---- Prisma, Audit, stats.twoProportionTest
  SdkController ---- SdkAuthService, DatasetService, RedisService, EventsService
EventsService ---- Prisma, DatasetService, evaluate()
DatasetService ---- Prisma, RedisService
RedisService ---- ioredis client + subscriber
SdkAuthService ---- Prisma  (Map cache)
AdminGuard
Actor decorator

@flagship/sdk
  FlagshipClient ---- Engine, EventSource/fetch
  Engine ---- matchSingle, bucket, pickVariation
```

**Inheritance:** `PrismaService extends PrismaClient`. Nest uses composition (constructor injection). `AdminGuard implements CanActivate`. RedisService implements `OnModuleInit, OnModuleDestroy`.

---

## Backend

### `PrismaService` — `backend/src/prisma/prisma.service.ts`

- **Fields:** PrismaClient surface.
- **Lifecycle:** `$connect` / `$disconnect`.
- **Invariant:** one shared client per process.

### `RedisService` — `backend/src/redis/redis.service.ts`

- **Fields:** `client`, `subscriber`, `url`.
- **Ctor:** two `new Redis(..., { maxRetriesPerRequest: null, lazyConnect: true })`.
- **Methods:** `onModuleInit/Destroy`, `cacheDataset(environmentId, dataset, ttlSeconds=3600)`, `getCachedDataset<T>`, `invalidateDataset`, `publishChange`, `subscribeToChanges` → unsubscribe fn.
- **Invariant:** subscriber connection used only for pub/sub.

### `DatasetService` — `backend/src/dataset/dataset.service.ts`

- **Methods:** `buildDataset(environmentId): Promise<ClientDataset>`, `getDataset`, `refresh`.
- **Deps:** Prisma, Redis.
- **Invariant:** `refresh` is the write-side projection update.

### `SdkAuthService` — `backend/src/common/sdk-auth.service.ts`

- **Fields:** `cache` Map, `ttlMs = 30000`.
- **Methods:** `extractKey(req)`, `resolve(key)`, `resolveFromRequest(req)`.
- **Throws:** `UnauthorizedException`.

### `AdminGuard` — `backend/src/common/admin.guard.ts`

- **Method:** `canActivate` — compare `ADMIN_API_KEY` to `x-api-key` if set.

### `AuditService` — `backend/src/audit/audit.service.ts`

- **Methods:** `record(AuditInput)`, `list(projectId, { limit, entityId })`.
- **Invariant:** append-only (no update/delete API).

### `ProjectsService` — `backend/src/projects/projects.service.ts`

- **Helpers:** `sdkKey(envKey)` → `sdk-{env}-{12}`.
- **Methods:** `create`, `list`, `get`, `rotateSdkKey`.

### `FlagsService` — `backend/src/flags/flags.service.ts`

- **Methods:** `create`, `list`, `get`, `updateConfig`, `toggle`, `remove`.
- **Invariant:** new flags off everywhere; unique salt per config.

### `SegmentsService` — `backend/src/segments/segments.service.ts`

- **Methods:** `list`, `create`, `update`, `remove`.
- **Update:** increments `Segment.version` atomically, then `dataset.refresh`, so the environment dataset version changes.

### `EventsService` — `backend/src/events/events.service.ts`

- **Methods:** `ingest`, `ingestBatch`.
- **Side effect:** may call `evaluate`. Uses the full `EvalContext` when the payload includes it; otherwise `{ key: contextKey }`. `contextKey` is still what is stored.

### `ExperimentsService` — `backend/src/experiments/experiments.service.ts`

- **Methods:** `list`, `create`, `results`.

### Controllers

Thin: validate/delegate. `FlagsController.evaluateForContext` is the only controller that calls the engine. `SdkController.stream` is the only one using raw `Response`.

### `HealthController` — `backend/src/health/health.controller.ts`

- **Method:** `health()`.

### Standalone `twoProportionTest` / `normalCdf` — `backend/src/experiments/stats.ts`

Pure functions; no class.

---

## `@flagship/sdk`

### Types — `packages/sdk-js/src/types.ts`

Interfaces: `Clause`, `Rollout`, `Flag`, `Segment`, `ClientDataset`, `EvalContext`, `EvalResult`, etc. **No classes.**

### `matchSingle` — `operators.ts`

`(contextValue, op, ruleValue) => boolean`

### `bucket` / `pickVariation` — `hash.ts`

See `18-algorithms-and-data-structures.md`.

### `Engine` — `engine.ts`

- **Ctor:** `(dataset: ClientDataset)`
- **Fields:** private `dataset`
- **Methods:** `update`, getter `version`, `allFlagKeys()`, `evaluate<T>(flagKey, context, defaultValue)`
- **Private:** `evaluateFlag`, `matchClause`, `matchSegment`, `resolveVariationOrRollout`, `off`, `result`, `errorResult`, `attr`
- **Invariant:** no IO; `seen` prevents prereq cycles
- **Lifecycle:** created by client or per one-shot `evaluate()` helper (`engine.ts:235-242`)

### `FlagshipClient` — `client.ts`

- **Ctor:** `FlagshipClientOptions` (sdkKey, baseUrl, mode, pollingIntervalMs, maxStalenessMs, bootstrap, logger)
- **Fields:** engine, EventSource, poll timer, lastUpdatedAt, ready promise, listeners
- **Methods:** `start`, `waitForReady`, `onChange`, `bool/string/number/jsonVariation`, `variation`, `allFlags`, `track`, `close`
- **Private:** `fetchDataset`, `applyDataset` (drop older versions), `connectStream`, `isStale`, `headers`
- **Lifecycle:** construct → `start` → use → `close`
- **Deps:** `fetch`, `eventsource`

### Package exports — `index.ts`

Re-exports types, Engine, evaluate, hash, matchSingle, FlagshipClient.

---

## Python `flagship`

| Symbol | File | Notes |
|---|---|---|
| `Engine` dataclass | `engine.py` | `dataset` dict |
| `EvalResult` / `EvalReason` | `engine.py` | |
| `FlagshipClient` | `client.py` | thread + lock |
| `bucket` / `pick_variation` | `hashing.py` | pick returns int |
| `match_single` | `operators.py` | |

`__init__.py` exports the public surface.

---

## Frontend (React function components)

No class components. Notable:

| Component | Path | Props / state |
|---|---|---|
| `ProjectsPage` | `app/page.tsx` | lists/creates projects |
| `ProjectDashboard` | `components/dashboard/ProjectDashboard.tsx` | projectId; env/tab state |
| `FlagsTab` | `FlagsTab.tsx` | projectId, envId |
| `FlagDrawer` | `FlagDrawer.tsx` | overlay editor |
| `api` | `lib/api.ts` | object of fetch functions |

`ui.tsx`: `Button`, `Card`, `Badge`, `Input`, `Textarea`, `Toggle` — presentational.

---

## Infra (not classes)

Terraform resources in `infra/terraform/main.tf`. k6 default function in `infra/k6/eval-latency.js`.

---

## Relationships (short)

- **Composition:** FlagshipClient owns Engine; DatasetService uses Prisma+Redis; FlagsService uses Audit+Dataset.
- **Association:** FlagConfig belongs to Flag and Environment (Prisma).
- **Dependency:** backend `package.json` `"@flagship/sdk": "*"` workspace.
- **No inheritance** in domain engine (Python/TS).
