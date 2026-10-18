# Flagship — Architecture

A LaunchDarkly-style feature flag & remote config platform. This document
covers the high-level design (HLD), low-level design (LLD) of the evaluation
engine, and the scaling model.

---

## 1. High-level design: control plane vs data plane

Flagship is split into two planes with very different requirements.

```
                          CONTROL PLANE                        DATA PLANE
                    (correctness, auditability)          (latency, availability)

┌───────────┐  writes   ┌──────────────┐   compile   ┌───────────┐   read    ┌───────────┐
│ Dashboard │──────────▶│  NestJS API   │────────────▶│  Redis    │◀──────────│  SDKs     │
│ (Next.js) │           │  + PostgreSQL │  + publish  │  (cache + │  stream/  │  (JS/TS,  │
└───────────┘           └──────────────┘   change     │  pub/sub) │  poll     │  Python)  │
      ▲                        │                       └───────────┘           └───────────┘
      │ audit log              │ append-only                  │ SSE "patch"          │
      └────────────────────────┘                              └──────────────────────┘   local eval
```

**Control plane** (`ProjectsService`, `FlagsService`, `SegmentsService`,
`AuditService`): CRUD over projects, environments, flags, segments, targeting
rules. PostgreSQL is the source of truth. Every write is audited and triggers a
recompile of the affected environment's dataset.

**Data plane** (`DatasetService`, `SdkController`): serves a single compiled,
immutable ruleset per environment. The cache-hit path is a Redis read and does
not query PostgreSQL. A cache miss recompiles from PostgreSQL. A slow admin
query does not itself read the dataset key, but both planes run in **one**
NestJS process (one Cloud Run service). They are not independently deployed or
scaled: a blocked event loop, a crash, or a deploy affects admin writes and SDK
streams together. See
[scalability](../project-description/14-scalability-and-performance.md) and
[design patterns](../project-description/21-design-patterns.md).

### Request paths

- **Admin write** → validate → write PostgreSQL → append audit → `DatasetService.refresh()` (recompile + cache in Redis + `PUBLISH`).
- **SDK bootstrap** → `GET /sdk/dataset` → Redis `GET` (cache hit) → JSON ruleset.
- **SDK live updates** → `GET /sdk/stream` (SSE) → on `PUBLISH`, server emits a `patch` event → SDK re-pulls the dataset.
- **Metric event** → `POST /sdk/events` → resolve variation at ingest → store in `Event` table for experiment analysis.

---

## 2. Low-level design: the evaluation engine

The engine (`packages/sdk-js/src/engine.ts`, ported to Python) is **pure and
synchronous**: `(dataset, flagKey, context, default) → { value, variationIndex, reason }`.
It runs identically on the server (dashboard "test targeting", event ingest)
and inside every SDK, so there is exactly one source of evaluation truth.

### Evaluation order (first match wins)

1. **Prerequisites** — if a prerequisite flag is off or serves the wrong
   variation, fail closed to `offVariation`.
2. **Kill switch** — if `flag.on === false`, serve `offVariation` for everyone.
3. **Individual targets** — exact context-key matches (`Target[]`).
4. **Targeting rules** — first rule whose clauses all match wins.
5. **Fallthrough** — the default rule: a single variation or a % rollout.

### Rule parser / clause matching

A rule is `{ clauses: Clause[], variation | rollout }`. A clause is
`{ attribute, op, values[], negate }`. Clauses on a rule are AND-ed; the
`values` within a clause are OR-ed. Multi-valued context attributes match if
**any** element satisfies the clause. Operators: equality (`in`/`notIn`),
string (`contains`, `startsWith`, `endsWith`, `matchesRegex`), numeric
(`greaterThan`, …), `semver*`, date (`before`/`after`), and `segmentMatch`
(delegates to reusable segments with their own include/exclude/rule logic).

### Stable rollout algorithm

Percentage rollouts must be **sticky**: a user in the first 10% must stay there
when you ramp to 20%, never flip-flopping. We achieve this with deterministic
bucketing (`hash.ts`):

```
point   = sha1(`${flagKey}.${salt}.${bucketByValue}`)[:15 hex]  / 0xFFFFFFFFFFFFFFF   ∈ [0,1)
variation = first weighted bucket whose cumulative weight exceeds `point`
```

- Same `(flagKey, salt, bucketBy)` → same point, forever → stickiness.
- The per-flag `salt` decorrelates rollouts across flags so a user isn't always
  in the "unlucky" bucket everywhere.
- SHA-1 gives good uniformity; the unit tests assert a 10% bucket lands within
  8–12% over 20k keys and that ramping 10%→20% never evicts anyone.

The Python and TypeScript implementations use the same formula. Their separate
test runners both consume `testdata/golden-vectors.json`, covering exact bucket
points and representative evaluations. This proves parity for those cases,
while behavior outside the fixture can still drift between ports. See
[algorithms](../project-description/18-algorithms-and-data-structures.md).

---

## 3. Scaling & operational behavior

### Edge cache / low-latency reads

- The compiled dataset is cached in Redis; `GET /sdk/dataset` is a single Redis
  read. Put Cloud CDN / a reverse proxy in front with a short TTL + `ETag`/
  version for near-edge reads.
- SDKs evaluate **locally** — after the initial dataset load, a flag read is an
  in-memory map lookup + hash, i.e. microseconds and zero network. The k6 test
  (`infra/k6/eval-latency.js`) exercises the dataset read path with a p95 < 50ms
  target.

### SDK polling vs streaming

| | Streaming (SSE, default) | Polling |
|---|---|---|
| Freshness | ~milliseconds (kill switch) | up to the interval |
| Connections | 1 long-lived per client | 1 request/interval |
| Best for | most apps, incident response | locked-down networks, batch jobs |

On change, the server publishes a lightweight `patch` (just the new version)
rather than the full payload, so fan-out cost is tiny; clients pull the full
dataset only when their version is behind.

### Stale config behavior

If the API/Redis is unreachable, SDKs keep serving the **last good dataset**
(availability over freshness — the right call for flags). `maxStalenessMs` lets
safety-critical consumers fall back to in-code defaults after a threshold.
Bootstrapping from a local dataset lets SDKs start instantly and offline.

### Near-real-time kill switch propagation

`FlagsService.toggle()` is an isolated, single-row update + audit + `refresh()`.
The `refresh()` `PUBLISH` reaches every subscribed SSE stream immediately, so a
kill switch propagates roughly as fast as Redis pub/sub + one dataset pull —
typically well under a second globally.

### Horizontal scaling

- API instances are stateless; SSE fan-out works across instances because every
  instance subscribes to the same Redis channel. Scale Cloud Run on CPU/conns.
- PostgreSQL is only on the write path and the (rare) cache-miss recompile.
- Redis is the shared cache + bus; use a replicated/clustered tier in prod.

### Experiments pipeline

Metric events (`pricing_viewed`, `subscribed`, …) are ingested with the
variation resolved deterministically at write time (works for key-bucketed
rollouts). Results group exposures/conversions by variation and run a
two-proportion z-test vs control to flag statistical significance. For high
volume, move ingestion behind Redis Streams / Kafka and aggregate into
ClickHouse/BigQuery instead of scanning the `Event` table.
