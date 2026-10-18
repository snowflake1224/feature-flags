# Database design

## Database architecture

- **Technology:** PostgreSQL 16, accessed only through Prisma 5 (`schema.prisma`).
- **Connection:** `PrismaService` extends `PrismaClient`; `$connect` on `OnModuleInit`, `$disconnect` on destroy (`prisma.service.ts`).
- **Pooling:** Prisma default (typically based on `DATABASE_URL`; no `connection_limit` in `.env.example`).
- **Transactions:** **no** explicit `prisma.$transaction` in application services. Nested `create` (project+environments, flag+configs) is a single Prisma nested write (one transaction internally).
- **Isolation:** not set; Postgres default `READ COMMITTED`.
- **Replication:** not in app. Terraform Cloud SQL `availability_type = "ZONAL"` (not HA regional). Backups enabled in Terraform.
- **Migration strategy:**
  - No `backend/prisma/migrations/` directory in the repo.
  - README / scripts: `db:push` (`prisma db push`) or `prisma:migrate`.
  - Docker CMD: `npx prisma migrate deploy || npx prisma db push` (`backend/Dockerfile:39`) — **migrate deploy will fail** without migrations, then db push applies schema.

## ER-style diagram

```text
Project
  | 1
  |--* Environment
  |      |--* SdkKey
  |      |--* FlagConfig
  |      |--* Segment
  |      |--* Experiment
  |      |--* Event
  |--* Flag ----* FlagConfig
  |--* Segment
  |--* Experiment
  |--* AuditLog
```

`FlagConfig` is the join of Flag × Environment (unique `(flagId, environmentId)`).

`Segment` has both `projectId` and `environmentId` (environment-scoped cohort).

`AuditLog.environmentId` is a **plain string optional field**, **not** a Prisma relation/FK.

`Experiment.flagKey` is a **string**, not a FK to `Flag`.

`Event.flagKey` / `variationIndex` similarly denormalized.

---

## Schema (from `backend/prisma/schema.prisma`)

### Project

| Column | Type | Notes |
|---|---|---|
| id | String cuid PK | |
| key | String unique | |
| name | String | |
| createdAt | DateTime now | |

Relations: environments, flags, segments, experiments, auditLogs.

### Environment

| Column | Type | Notes |
|---|---|---|
| id | cuid PK | |
| projectId | FK Project CASCADE | |
| key | String | |
| name | String | |
| color | String default `#6366f1` | |
| production | Boolean default false | UI badge only |
| createdAt | DateTime | |

**Unique:** `(projectId, key)`.

### SdkKey

| Column | Type | Notes |
|---|---|---|
| id | cuid PK | |
| environmentId | FK CASCADE | |
| key | String unique | the secret |
| kind | String default `"server"` | unused in auth logic |
| active | Boolean default true | |
| createdAt | DateTime | |

### Flag

| Column | Type | Notes |
|---|---|---|
| id | cuid PK | |
| projectId | FK CASCADE | |
| key | String | |
| name, description | String | description default `""` |
| kind | String default `"boolean"` | |
| variations | Json | array of values |
| temporary | Boolean default true | unused in engine |
| tags | String[] default [] | |
| createdAt, updatedAt | DateTime | @updatedAt |

**Unique:** `(projectId, key)`.

### FlagConfig

| Column | Type | Notes |
|---|---|---|
| id | cuid PK | |
| flagId, environmentId | FKs CASCADE | unique pair |
| on | Boolean default false | kill switch |
| offVariation | Int default 0 | |
| fallthrough | Json | VariationOrRollout |
| targets | Json default `[]` | |
| rules | Json default `[]` | |
| prerequisites | Json default `[]` | |
| salt | String | hashing |
| version | Int default 1 | bumped on config change |
| updatedAt | DateTime | |

### Segment

| Column | Type | Notes |
|---|---|---|
| id | cuid PK | |
| projectId, environmentId | FKs CASCADE | |
| key, name | String | unique `(environmentId, key)` |
| description | String default `""` | |
| included, excluded | String[] | |
| rules | Json default `[]` | |
| salt | String | |
| version | Int default 1 | monotonic; incremented on update |
| updatedAt | DateTime | |

`Segment.version` is included in the environment dataset version, so rule or membership edits are visible to SDKs. Flag-config versions remain a separate counter.

### AuditLog

| Column | Type | Notes |
|---|---|---|
| id | cuid PK | |
| projectId | FK CASCADE | |
| environmentId | String? | **no FK** |
| actor | String default `"system"` | |
| action, entityType, entityId | String | |
| entityKey, comment | String defaults `""` | |
| before, after | Json? | |
| createdAt | DateTime | |

**Indexes:** `[projectId, createdAt]`, `[entityType, entityId]`.

### Experiment

| Column | Type | Notes |
|---|---|---|
| id | cuid PK | |
| projectId, environmentId | FKs | unique `(environmentId, key)` |
| key, name, flagKey | String | |
| exposureEvent, goalEvent | String | |
| metricKind | String default `"binary"` | |
| status | String default `"running"` | **never updated in services** |
| createdAt | DateTime | |

### Event

| Column | Type | Notes |
|---|---|---|
| id | cuid PK | |
| environmentId | FK CASCADE | |
| eventKey, contextKey | String | |
| flagKey | String? | |
| variationIndex | Int? | |
| value | Float? | |
| metadata | Json? | |
| ts | DateTime default now | |

**Indexes:** `[environmentId, eventKey, ts]`, `[environmentId, flagKey]`.

---

## Query patterns

| Pattern | Where | Notes |
|---|---|---|
| Nested create | project, flag | no explicit `$transaction` |
| findMany + include | list flags/projects | |
| findUnique compound | flag `projectId_key`, segment `environmentId_key`, experiment `environmentId_key` | |
| update + increment | FlagConfig.version, Segment.version | `{ version: { increment: 1 } }` |
| updateMany | deactivate SDK keys | |
| delete | flag, segment | cascade |
| createMany | seed events, seed sdk keys | chunks of 1000 in seed (`seed.ts:194-196`) |
| event.findMany | experiment results | **no pagination**; filters env + flagKey + eventKey in `[exposure, goal]` |
| ingest | `event.create` per event | batch is N inserts |
| audit list | `take` cap 500 | |
| health | `$queryRaw SELECT 1` | |

**Joins:** Prisma `include` (flag+configs+environment; sdkKey+environment).

**Upserts:** none in services.

**Locking:** none (`SELECT FOR UPDATE` not used). Concurrent toggles: last writer wins; both increment version.

**Pagination:** only audit `take`. Flag list is unbounded.

### Why indexes exist (inference + schema comments)

- `AuditLog [projectId, createdAt]`: dashboard audit timeline.
- `AuditLog [entityType, entityId]`: optional filter (API supports `entityId` only, not entityType).
- `Event [environmentId, eventKey, ts]`: time-bounded event queries — **results query does not filter `ts`**, so this index is only partially aligned.
- `Event [environmentId, flagKey]`: experiment results filter on env+flagKey (+ eventKey via IN). A composite including `eventKey` might fit better; current indexes still help.

JSON columns (`rules`, `fallthrough`, …) are **not indexed**; not queried inside JSON by SQL.

## Seed behavior

Deletes existing `demo` project (CASCADE children), recreates data (`seed.ts:13-15`). Deterministic SDK keys for examples.
