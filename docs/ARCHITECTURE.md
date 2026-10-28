# Architecture

Four pieces: Postgres holds the config, the API compiles it into a flag set,
clients evaluate the copy they fetched, and every change leaves an audit row.

```
Dashboard ──writes──▶ NestJS API ──▶ Postgres (config + audit)
                          │
                          └─ compiles flag set ─▶ Redis cache
                                                     ▲
JS client ── GET /sdk/dataset every few seconds ─────┘
   └─ evaluates flags locally against the fetched copy
```

## 1. Config lives in Postgres

`backend/prisma/schema.prisma` has projects, environments, SDK keys, flags, and
one `FlagConfig` row per flag per environment. A config row holds:

- `on`: the kill switch.
- `fallthrough`: either one variation, or a percentage rollout across variations.
- `rules`: audience rules. Each rule has a clause that is either
  `in` (an attribute equals one of the listed values) or `endsWith` (for example,
  an email ends with `@flagship.dev`). First matching rule wins.
- `targets`: individual user keys pinned to a variation.
- `salt`: a per-flag random string used in the hash.
- `version`: bumped on every write.

Flags are boolean (`[true, false]`). A flag may instead serve string
variations. The API rejects other rule operators.

Every write goes through `FlagsService`, which updates Postgres, records an
audit row, and calls `DatasetService.refresh()` to rebuild the cached flag set
for that environment.

## 2. Clients evaluate the copy they fetched

`GET /sdk/dataset` (authenticated with an environment SDK key) returns every
flag in the environment as one JSON document. It comes from Redis when cached
and is rebuilt from Postgres otherwise.

The JavaScript client (`packages/sdk-js/src/client.ts`) fetches that document,
then fetches it again a few seconds after each response returns. Fetches never
overlap, so a slow response cannot overwrite a newer one. `boolVariation()`
evaluates synchronously against the copy in memory and never touches the
network.

Consequences:

- A flag read costs a map lookup and one SHA-1, and it keeps working if the API
  is down (the client serves its last copy; `maxStalenessMs` can cap that).
- A toggle takes effect on each client's next fetch. Worst case is one polling
  interval. A production kill switch would add a push channel; this project
  does not.

The evaluation engine (`packages/sdk-js/src/engine.ts`) is pure. The API uses
the same engine for the dashboard's "test targeting" panel. The dashboard's
browser copy (`frontend/lib/local-eval.ts`) reimplements it with a pure-JS
SHA-1, and its tests pin the same hash output as the SDK tests.

Evaluation order: prerequisites, then the kill switch, then individual targets,
then rules, then the fallthrough.

## 3. Hash stickiness

```
point = first 15 hex digits of sha1("<flagKey>.<salt>.<userKey>") / 0xFFFFFFFFFFFFFFF
```

`point` is in `[0, 1)` and never changes for a given flag, salt, and user. A
rollout of `p` percent includes the user when `point < p / 100`. Raising the
percentage only widens the interval, so everyone already inside stays inside.
Lowering it removes users from the top of the interval only.

The salt keeps flags independent: the user who lands in the first 10% of one
flag is not systematically in the first 10% of every flag.

Tests: `packages/sdk-js/test/hash.test.ts` checks determinism, rough uniformity
(a 10% bucket holds 8 to 12% of 20,000 keys), and that no key inside 10% is
outside 20%. `engine.test.ts` runs the same check through full flag evaluation.

## 4. Audit row

`AuditService.record()` appends one `AuditLog` row per change with the actor
(from the dashboard's `x-actor-email` header), the action (`flag.enabled`,
`flag.killswitch`, `flag.updated`, ...), a comment, and before/after JSON. Rows
are never updated or deleted by the API. The dashboard's Audit log tab lists
them with a diff view.

The actor header is not authentication. `ADMIN_API_KEY` gates the dashboard
routes; real deployments would replace both with proper sign-in.

## Metrics

`GET /metrics` serves three in-process Prometheus counters (they reset on
restart): kill switch flips, flag set fetches, and API-side evaluations.
