# Design patterns

This chapter names the patterns that are actually in the repository, the file that implements each one, and the tradeoff that pattern buys. Labels such as “strategy” or “control plane” are only used when the code matches the pattern. Where the code is only *similar* to a textbook pattern, that is called out.

Related reading: [03-system-architecture.md](./03-system-architecture.md), [04-component-architecture.md](./04-component-architecture.md), [17-design-decisions-and-tradeoffs.md](./17-design-decisions-and-tradeoffs.md), [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md).

## How to talk about these in an interview

Prefer “this is a modular monolith with two logical planes” over “we run a control-plane service and a data-plane service.” The second sentence is not what Terraform or `AppModule` deploy.

---

## Modular monolith and logical planes

**What is exact.** One NestJS process owns admin CRUD and SDK endpoints. `backend/src/app.module.ts` imports every feature module into a single application. Terraform and Cloud Run ship one `flagship-api` service. The Next.js app is a separate process; the Python SDK is a library, not a service.

**What the planes mean.** The split is by request path and storage, not by deployable unit:

| Plane | Entry | Source it trusts on the hot path |
|---|---|---|
| Control | `/projects/...` controllers, `AdminGuard` | PostgreSQL via Prisma |
| Data | `backend/src/sdk/sdk.controller.ts` | Redis dataset cache, then a compile on miss |

`DatasetService` is the bridge: control-plane writes call `refresh()`, which compiles rows into one `ClientDataset` and publishes a version.

**Tradeoff.** One binary is easy to run and keeps the evaluation engine on both sides of the bridge. A slow request, a crash, or a deploy affects admin writes and SDK streams together. Scaling Cloud Run adds copies of *both* planes. Splitting them is a future move described in [14-scalability-and-performance.md](./14-scalability-and-performance.md), not the current topology.

---

## Dependency injection

**Exact: Nest constructor injection.** Services are `@Injectable()` classes. Modules declare `providers` and `controllers`. Infrastructure modules are `@Global()` so feature modules receive them without re-importing: `PrismaModule`, `RedisModule`, `CommonModule`, `DatasetModule`, `AuditModule`, `EventsModule`.

Example shape: `FlagsService` takes `PrismaService`, `AuditService`, and `DatasetService` in its constructor. `FlagsModule` only lists `FlagsService`; the globals supply the rest.

**Not in this repo.** A hand-rolled container, property injection, or a service locator. Tests that need a fake database construct the pure engine directly (`packages/sdk-js/test/engine.test.ts`) instead of booting Nest.

**Tradeoff.** The graph is visible and matches Nest’s lifecycle (`OnModuleInit` connects Redis). The cost is framework coupling: the data-plane hot path still pays Nest/Express even though evaluation itself is framework-free.

---

## Guards and decorators

These are two different mechanisms. Do not fold SDK auth into “the guard.”

**Guard (exact).** `AdminGuard` in `backend/src/common/admin.guard.ts` implements Nest `CanActivate`. Controllers opt in with `@UseGuards(AdminGuard)` (`projects`, `flags`, `segments`, `experiments`, `audit`). If `ADMIN_API_KEY` is set, the guard requires header `x-api-key`. If it is unset, the guard allows the request. That is a permissive demo default, not an authentication framework.

**Param decorator (exact).** `Actor` in `backend/src/common/actor.decorator.ts` reads `x-actor-email` or `x-actor`, otherwise `"system"`. It labels audit rows. It does not authorize anything.

**SDK auth is a service, not a guard.** `SdkController` calls `SdkAuthService.resolveFromRequest()` at the start of each handler. Missing or inactive keys throw `UnauthorizedException`. There is no `@UseGuards` on `/sdk/*`.

**Other decorators** (`@Controller`, `@Injectable`, `@Module`, `@Global`) are Nest metadata. They are not a policy language.

**Tradeoff.** Guards make the optional admin check consistent and easy to forget on a new controller (health is intentionally unguarded). Putting SDK auth in the controller keeps the data-plane dependency explicit, and it also means a new SDK route can ship without the check if someone copies the wrong handler.

---

## Shared kernel

**Exact for TypeScript.** `packages/sdk-js` is the kernel the API and the JS SDK both run:

- Types (`ClientDataset`, `Flag`, `EvalContext`) in `packages/sdk-js/src/types.ts`
- Pure evaluation in `packages/sdk-js/src/engine.ts`
- Bucketing in `packages/sdk-js/src/hash.ts`

The backend imports that package (`evaluate` in `backend/src/events/events.service.ts` and the dashboard evaluate path; `bucket` in `backend/prisma/seed.ts`). Dashboard “test targeting” and event attribution therefore call the same function a Node client calls after it has a dataset.

**Python is a separate port, checked by a shared fixture.** `sdks/python/flagship/` (`engine.py`, `hashing.py`, `operators.py`) does not depend on `@flagship/sdk`. It reimplements the algorithm. `testdata/golden-vectors.json` is the shared golden-vector file both runners load: `packages/sdk-js` Vitest (`test/golden-vectors.test.ts`) and `sdks/python` pytest (`tests/test_golden_vectors.py`). Each test locates that file by walking up from its own directory, so the workspace cwd does not matter. The vectors fix exact bucket points for inputs with no seed, seed `0`, and a non-zero seed, plus representative evaluations: missing flag, kill switch, individual targets, segment include / exclude / email / percentage, clause match and negate, fallthrough rollout, a rule rollout that carries seed `0`, prerequisite success, failure, and cycle, and the same percentage rollout with and without a seed. Those cases must match. The fixture does not cover every operator or the streaming client. The Python package is still not the TypeScript kernel.

**Tradeoff.** One TS kernel prevents the API and the JS SDK from drifting. The Python port can still drift outside the golden cases, especially where a 60-bit bucket is converted to a float (see [18-algorithms-and-data-structures.md](./18-algorithms-and-data-structures.md)). The shared file is what fails the build when the cases it lists diverge.

---

## Compiled read model

**Exact.** `DatasetService.buildDataset` loads flag configs and segments for one environment and returns a `ClientDataset`: a denormalized JSON document of flags, segments, salts, and one integer `version`. SDKs evaluate that document. They do not join PostgreSQL.

This is a **read model** (a projection rebuilt from the write models), not event sourcing. The write models remain `Flag`, `FlagConfig`, `Segment`, and the other Prisma rows. The audit log is a side record, not the log you replay to rebuild state.

`version` on the dataset is an aggregate so clients can drop a strictly older snapshot (`packages/sdk-js/src/client.ts` ignores `dataset.version < engine.version`). It is not a vector clock.

**Segment revisions.** `Segment.version` is a monotonic integer, default 1, incremented atomically when that segment is updated. The environment aggregate includes those segment versions as well as flag-config versions. A segment-only edit therefore changes the published dataset version. Creating a segment adds a new version term; deleting one removes it. The older formula (flag-config versions plus `segments.length * 1_000_000` only) did not change when rules were edited in place.

**Tradeoff.** One document makes local evaluation and caching simple. The document is always a full snapshot: every patch still pulls the whole environment. A crash after the Postgres commit and before `refresh()` leaves Redis stale until TTL (3600s) or the next write. There is no outbox.

---

## Cache-aside and write-through

Both names fit **different methods** on `DatasetService`. Using either name for the whole system is too coarse.

**Cache-aside (exact on read).** `getDataset` (`backend/src/dataset/dataset.service.ts`):

1. `GET flagship:dataset:{environmentId}`
2. On hit, return the JSON
3. On miss, `buildDataset` from PostgreSQL, `SET` with TTL, return

Callers of the read path do not write Postgres.

**Write-through of the projection (exact on mutate).** Flag and segment services commit the Prisma write first, then call `refresh()`, which rebuilds the document, `SET`s Redis, and `PUBLISH`es `{ version }`. The cache is updated on the mutation path instead of waiting for the next miss. The object written to Redis is the compiled document, not the Prisma row.

**Not this pattern.** `invalidateDataset` (`DEL`) exists on `RedisService` and is unused. Invalidation is overwrite. There is no write-behind queue.

**Tradeoff.** Hits stay off PostgreSQL, which is the latency goal. The synchronous refresh makes the writer wait on compile + Redis, and a failed refresh after a successful commit splits the two stores. The 30s SDK-key map in `SdkAuthService` is a *different* cache: in-process, positive lookups only, not the dataset.

---

## Pub/sub observer

**Two observer layers, neither is a class named `Observer`.**

1. **Redis is the subject** for processes. `publishChange` publishes on `flagship:changes:{environmentId}`. Each SSE connection registers a listener through `subscribeToChanges` (`backend/src/redis/redis.service.ts`) and writes `event: patch`. Redis pub/sub is at-most-once and not durable. A client that is disconnected misses the message and catches up on the next `GET /sdk/dataset` or poll.
2. **`FlagshipClient.onChange`** is an in-process observer (`packages/sdk-js/src/client.ts`). After `applyDataset`, every listener runs. The JS SDK’s `patch` handler does not trust the version inside the SSE payload; it re-fetches the dataset and then notifies.

The shared Redis connection is in subscriber mode, so a second connection (`client`) runs `GET`/`SET`/`PUBLISH`. One `SUBSCRIBE` per channel is enough for every local socket; each socket still needs its own listener.

**Required unsubscribe behavior.** Closing one SSE response must remove only that listener. The channel is `UNSUBSCRIBE`d when the last local listener for it is gone. Unsubscribing the channel on the first disconnect drops every other stream on that process.

**Tradeoff.** Fan-out across API instances works as long as they share Redis. The API still holds one HTTP connection per streaming SDK. Pub/sub does not queue for offline clients.

The Python client does not subscribe. It polls (`sdks/python/flagship/client.py`).

---

## SDK facade

**Exact.** `FlagshipClient` (`packages/sdk-js/src/client.ts`, and the smaller Python class) is a facade over dataset sync plus `Engine`:

- `start` / streaming or polling / `waitForReady`
- `boolVariation`, `stringVariation`, `numberVariation`, `jsonVariation`, `variation`, `allFlags`
- `track` for exposures and conversions
- `close`

Callers do not parse SSE, send the SDK key, or compare versions. The facade returns the caller’s default when no dataset is loaded or when `maxStalenessMs` is exceeded.

**Tradeoff.** The surface is small enough for the examples in `examples/node-demo` and `examples/python-demo`. The facade hides failure modes (swallowed `track` errors, last-good dataset) that operators must still understand. Browser `EventSource` cannot set `Authorization`, so a browser demo cannot use this class’s streaming transport directly; it has to stream with `fetch` and the SDK key.

---

## Pure functional core and the evaluation pipeline

**Pure core (exact).** `evaluate(dataset, flagKey, context, defaultValue)` in `packages/sdk-js/src/engine.ts` is synchronous and has no I/O. The same inputs return the same `{ value, variationIndex, reason }`. `Engine` holds a dataset only so a client can swap it; the decision procedure does not read the clock except when a clause compares dates that are already on the context.

**Pipeline (ordered procedure, not an object pipeline).** `evaluateFlag` is one private method with a fixed order. There is no list of handler objects:

1. Prerequisite cycle → caller default, `MALFORMED_FLAG`
2. Prerequisites → `offVariation` if a prerequisite is missing, off, or not the required variation
3. Kill switch (`flag.on === false`) → `offVariation`
4. Individual targets (context key)
5. Targeting rules, first match, clauses AND-ed
6. Fallthrough variation or weighted rollout

That is **not** Chain of Responsibility and **not** the Strategy pattern. Adding an operator means extending `matchSingle` in `packages/sdk-js/src/operators.ts` (a conditional), not registering a new strategy object.

**Streaming vs polling** is the closest thing people call a strategy. It is a `mode` string in `FlagshipClient.start` (`"streaming"` or `"polling"`), not a `DataSource` interface with two classes. The Python client only implements polling.

**Tradeoff.** A single function is easy to test and to port. The order is implicit in source order, so a future rule type has to be inserted carefully. Percentage stickiness lives in `hash.ts` (`sha1` of `flagKey.salt.bucketBy`, first 15 hex digits). It is pure as well, and it is not stored assignments.

---

## Fail-closed

“Fail closed” in this codebase means several concrete defaults, not one policy object.

| Situation | Result | Where |
|---|---|---|
| Flag key absent | Caller `defaultValue`, reason `FLAG_NOT_FOUND` | `Engine.evaluate` |
| Prerequisite failed or prerequisite flag off | `offVariation` | `evaluateFlag` |
| Flag off | `offVariation`, reason `OFF` | `evaluateFlag` |
| Variation index missing, or prerequisite cycle | Caller `defaultValue`, `MALFORMED_FLAG` | `result` / cycle check |
| Segment key missing | Clause does not match (`false`) | `matchSegment` |
| SDK has no dataset, or dataset older than `maxStalenessMs` | Caller default, reason `ERROR` | `FlagshipClient.variation` |

`offVariation` is the **flag author’s** safe value (seeded `new-checkout` uses index 1, `false`). `defaultValue` is the **caller’s** fallback when the flag cannot be resolved. They are different. A kill switch does not return `defaultValue` if the dataset is loaded and the off variation exists.

Segment mismatch fails closed for membership (the user is not in the segment) and then the flag continues to later rules or fallthrough. That is not the same as serving `offVariation`.

`track` does the opposite of fail-closed for analytics: errors are logged and swallowed so a metrics outage does not break the request. Flag evaluation is unchanged.

**Tradeoff.** Serving `offVariation` on a bad prerequisite is predictable. Serving the last good dataset when Redis is down prefers availability over freshness, which is the right default for most flags and the wrong default for a safety interlock unless the app sets `maxStalenessMs`.

---

## Append-only audit

**Exact at the API.** `AuditService` (`backend/src/audit/audit.service.ts`) only `create`s and `list`s. Mutating services pass `before` / `after` snapshots. There is no update or delete route for audit rows. The dashboard reads them in `AuditTab`.

**Not a database immutability guarantee.** `AuditLog` cascades when its `Project` is deleted (`onDelete: Cascade` in `backend/prisma/schema.prisma`). Reseeding deletes the `demo` project and the log with it. Nothing prevents a raw SQL `UPDATE`. Actor identity is the client-supplied header from the `Actor` decorator.

**Tradeoff.** Incident review gets a history without building event sourcing. The log can disagree with Redis if the audit insert or the later `refresh()` fails midway. It is not a compliance-grade ledger.

---

## Names that do not match the code

| Label you might reach for | What the code actually is |
|---|---|
| Strategy | `mode` if/else for stream vs poll; operator `if`/`switch` in `operators.ts` |
| Chain of responsibility | One ordered function, `evaluateFlag` |
| Microservices / independently scaled data plane | Logical planes in one Nest process |
| CQRS framework | A compiled read model rebuilt synchronously in-process |
| Event sourcing | Append-only audit beside normalized tables; Postgres rows are the truth |
| Circuit breaker | No breaker library. Last-good dataset and `maxStalenessMs` are client policies |
| Repository per aggregate | Services call `PrismaService` directly |
| Shared-nothing cache | Dataset cache is Redis; SDK-key cache is a per-process `Map` |
| Queue / outbox | `refresh()` is inline. [08-cache-queue-and-storage.md](./08-cache-queue-and-storage.md) documents that no work queue exists |

---

## Short mapping

| Pattern | Primary path | Honest limit |
|---|---|---|
| Modular monolith, logical planes | `backend/src/app.module.ts`, `sdk.controller.ts` | Not independently scaled |
| Dependency injection | Nest constructors, `@Global()` modules | Framework-bound |
| Guard | `backend/src/common/admin.guard.ts` | Optional; open when unset |
| Decorator | `backend/src/common/actor.decorator.ts` | Audit label only |
| Shared kernel | `packages/sdk-js/src/{engine,hash,types}.ts` | Python is a port; `testdata/golden-vectors.json` checks bucket and representative evaluation |
| Compiled read model | `backend/src/dataset/dataset.service.ts` | Full snapshot, no outbox |
| Cache-aside | `getDataset` | Miss hits Postgres |
| Write-through projection | `refresh` after Prisma writes | Not the same as writing the row through |
| Pub/sub observer | `redis.service.ts`, `FlagshipClient.onChange` | At-most-once; Python polls |
| Facade | `FlagshipClient` | Hides staleness and swallowed `track` |
| Pure core / pipeline | `engine.ts` `evaluate` / `evaluateFlag` | Order is source order, not plugins |
| Fail-closed | `offVariation`, caller default, segment miss | Last-good dataset is fail-open on freshness |
| Append-only audit | `audit.service.ts` | Cascade-deleted with the project |
