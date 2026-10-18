# Component architecture

NestJS modules group controllers and services. Global modules: `PrismaModule`, `RedisModule`, `CommonModule`, `DatasetModule` (`app.module.ts`).

## Dependency diagram

```text
                    AppModule
                       |
     +-----------------+------------------+
     |                 |                  |
PrismaModule      RedisModule        CommonModule
     |                 |             (SdkAuth, AdminGuard)
     +--------+--------+
              |
        DatasetModule
              |
    +---------+---------+--------+---------+
    |         |         |        |         |
 Projects   Flags    Segments  Audit     Events
    |         |         |                  |
    +----+----+----+----+                  |
         |         |                       |
      SdkModule    |                ExperimentsModule
         |         |
         +---- uses Dataset + Redis + SdkAuth
                   |
              HealthController
```

`FlagsModule` / `SegmentsModule` depend on `AuditService` + `DatasetService`. `EventsService` uses `DatasetService` + Prisma. `ExperimentsModule` uses Prisma + Audit only (results read `Event` rows). `SdkModule` only declares `SdkController`; it relies on global providers.

`@flagship/sdk` is a **library** imported by backend and JS apps, not a Nest module.

---

## PrismaModule / PrismaService

- **Responsibility:** one `PrismaClient`, connect/disconnect with Nest lifecycle (`prisma.service.ts`).
- **Inputs/outputs:** typed Prisma queries.
- **Concurrency:** Node single-threaded; Prisma connection pool handles concurrent queries (default pool — not configured).
- **Errors:** Prisma exceptions bubble to Nest default exception filter (JSON 500 unless `NotFoundException` etc.).

---

## RedisModule / RedisService

- **Responsibility:** cache dataset; publish version; subscribe for SSE (`redis.service.ts`).
- **Public:** `cacheDataset`, `getCachedDataset`, `invalidateDataset` (defined but **never called** from other files — invalidation is overwrite via `refresh`), `publishChange`, `subscribeToChanges`.
- **State:** `client` + `subscriber` ioredis; lazyConnect; `maxRetriesPerRequest: null`.
- **Concurrency:** Node event loop; subscribe handler JSON-parses and calls SSE write.
- **Caveat:** `subscribeToChanges` attaches a `message` listener and `unsubscribe`s the channel on cleanup. Multiple concurrent SSE connections for the **same** environment on one process share one Redis subscriber; unsubscribing when **one** client disconnects can drop the channel for others on that instance. This is a real concurrency/lifecycle risk.

---

## CommonModule

- **SdkAuthService:** extract Bearer/`x-sdk-key`; lookup `SdkKey` include environment. Successful lookups sit in a per-process `Map` for 30s. Failures are not cached. Rotate does not evict entries.
- **AdminGuard:** if `ADMIN_API_KEY` set, require matching `x-api-key`; else allow all.

---

## DatasetModule / DatasetService

- **Responsibility:** compile control-plane rows → `ClientDataset`; cache-aside GET; write-through on `refresh`.
- **Algorithm:** load environment, all `flagConfig`+`flag`, all segments; map to engine types. Environment `version` includes each flag config’s `version` and each segment’s `version`. Segment updates increment `Segment.version`, so a segment-only edit changes the published integer.
- **Side effects:** Redis SET + PUBLISH on refresh.
- **Failure:** `findUniqueOrThrow` if environment missing.

---

## Projects

- **Controller:** `projects.controller.ts` — AdminGuard, validation on create key `[a-z0-9-]+`.
- **Service:** create project+envs+keys; list with flag counts; get with sdkKeys; rotate keys.
- **Does not** call `DatasetService` (empty datasets until flags exist).

---

## Flags

- **Controller:** CRUD, toggle, evaluate.
- **Service:** create across envs; updateConfig; toggle; remove.
- **Engine use:** evaluate endpoint only.
- **Validation:** create DTO (`key` charset, kind enum); `updateConfig` body is **untyped** `Record<string, unknown>` — no class-validator on rules JSON shape.

---

## Segments

- **Service:** create (new salt, `version` defaults to 1), update (atomically increments `version`), delete. Every mutation calls `dataset.refresh`.

**Dataset version and clients.** The environment integer includes flag-config versions and segment versions, so a segment-only edit changes `ClientDataset.version`. Clients still **apply an equal version** and ignore a strictly older one. JS: `if (this.engine && dataset.version < this.engine.version) return` (`client.ts`). Python applies when `dataset.version >= engine.version`. SSE `publishChange` still sends `{ version }`, and clients re-fetch the document rather than patching it in place.

---

## Audit

- **Service:** `record` insert; `list` by project, optional entityId, limit cap 500.
- **Controller:** GET query `limit`, `entityId`.

---

## Events

- **No dedicated HTTP controller.** Ingested via `SdkController`.
- **Service:** if `flagKey` is set, `evaluate` with the full evaluation context (falling back to `{ key: contextKey }` when attributes were not sent); `event.create` each time. `contextKey` remains the stored identity.

---

## Experiments

- **Service:** list/create/results.
- **results:** load all matching events into memory; Sets per variation (`experiments.service.ts:70-97`).
- **Stats:** `twoProportionTest` (`stats.ts`).

---

## SdkModule / SdkController

- **Interfaces:** GET dataset, GET stream, POST events.
- **Auth:** SDK key, not AdminGuard.
- **Stream:** flush headers; write put; subscribe; interval 25s; on `close` cleanup.

---

## HealthController

- Not behind AdminGuard.
- Excluded from global prefix in `main.ts` but prefix is `""` anyway.

---

## JS SDK components

| Module | Role |
|---|---|
| `types.ts` | Dataset/flag/clause types shared with backend |
| `operators.ts` | Clause predicates |
| `hash.ts` | bucket + pickVariation |
| `engine.ts` | evaluation |
| `client.ts` | networking + Engine |
| `index.ts` | re-exports |

Python: `engine.py`, `operators.py`, `hashing.py`, `client.py`.

---

## Frontend components

See `10-frontend-architecture.md`. Boundary: `api` object only talks HTTP; **dashboard does not open SSE**.

---

## Why these boundaries exist (inference, marked)

- **Global Prisma/Redis/Dataset:** many modules need them without import cycles.
- **Flags vs Dataset:** writes stay in FlagsService; compile is centralized so every mutation refreshes the same way.
- **Toggle vs updateConfig:** comment in `flags.service.ts:160-163` — kill switch is a fast, heavily audited single-field update.
- **SDK vs admin controllers:** different auth and latency profiles.
- **Engine in a package:** backend and clients must not drift; Python is a manual port (tests overlap but are not bitwise cross-checked in CI).
