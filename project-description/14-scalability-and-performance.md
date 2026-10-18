# Scalability and performance

## What the current implementation actually does

- **Local evaluation:** after dataset load, flag reads are in-process hash + rule matching (`engine.ts`). This is the primary latency strategy.
- **Dataset HTTP:** intended as Redis `GET` of one JSON blob (`dataset.service.ts:71-73`).
- **Fan-out:** Redis pub/sub + SSE `patch` (small) then clients pull full dataset.
- **API process:** one Node event loop per instance; Terraform Cloud Run `min 1` / `max 20` (`variables.tf`), CPU 1, memory 512Mi (`main.tf:220-224`).
- **Postgres:** single primary (zonal in Terraform). All writes, all experiment scans, auth lookups (cache miss).
- **Redis:** single instance (Compose; Memorystore `BASIC` 1GB default).
- **k6:** ramps to 200 VUs hitting `/sdk/dataset` only; thresholds p95 &lt; 50ms (`infra/k6/eval-latency.js`). **Not run in CI.** Local eval is **not** what k6 measures.
- **Events:** one `INSERT` per event; results load **all** matching rows into memory.
- **SSE:** one long-lived HTTP connection per streaming SDK.

ARCHITECTURE.md claims CDN/ETag and Kafka/ClickHouse as **scaling ideas**, not code.

---

## Already implemented

| Area | Reality |
|---|---|
| Stateless compute (mostly) | No local disk state; **in-process** auth cache and SSE sockets are per instance |
| Shared cache | Redis dataset |
| Shared pub/sub | Redis channels |
| Horizontal API (possible) | Multiple Nest processes + shared Redis/Postgres |
| Indexing | Prisma indexes on audit and events |
| Docker / Cloud Run | Containerized API |
| Sticky rollouts without N user rows | SHA-1 bucket |

---

## Possible future improvements (not implemented)

Label these clearly if asked “how would you scale”.

### 10x

- Run k6 in CI; add Redis/Postgres metrics.
- `createMany` or copy protocol for event ingest; don’t eval synchronously on huge batches.
- Bound experiment queries (`ts` window, pre-aggregate).
- Fix SSE unsubscribe bug; consider Redis keyspace notifications vs per-connection subscribe.
- Health: non-200 on dead dependencies if used as probe.
- Connection pool sizing on Cloud Run.

### 100x

- Separate **data-plane** service (dataset+SSE only) from admin API.
- Edge cache / CDN with short TTL + version/ETag (mentioned in docs, not built).
- Redis Cluster / Memorystore Standard HA.
- Cloud SQL HA (`REGIONAL`), read replicas for audit/results (results still heavy).
- Move events to Redis Streams/Kafka + warehouse (doc suggestion).
- Cap SSE: many connections exhaust Cloud Run 512Mi and fd limits — **polling** or a dedicated streaming gateway (Fan-out via NATS/Redis already; problem is **HTTP connection count**).
- Dataset size: split flags or delta sync (currently full snapshot).

### 1000x

- Multi-region: local eval still works; **kill-switch latency** needs regional Redis or edge config; conflict story for writes (single primary today).
- Shard events by environment.
- Don’t store raw events for analytics; materialized variation counters.
- SDK bootstrap from object storage (immutable dataset files) + signed URLs.

---

## Bottleneck analysis (honest)

| Resource | Hot path | Bottleneck at scale |
|---|---|---|
| CPU | Engine evaluate | Cheap per call; huge rule lists / regex ReDoS |
| Memory | Full dataset per SDK process; API SSE buffers | Many flags × JSON |
| Network | Full dataset pull on every patch | Noisy flags (high churn) |
| Postgres | Writes, event ingest, results scan, auth miss | Events table growth |
| Redis | GET large JSON; pub/sub fan-out to **API instances** not to all SDKs | Large payload; Redis CPU |
| Node | SSE + JSON stringify | Event loop blocked if huge dataset serialize |

### Hot keys

One Redis key per environment. Popular `production` env is a **hot key**. Mitigation not implemented (copy keys, local cache on API with short TTL — API already hits Redis per GET unless you add instance memory cache).

**Note:** API does **not** cache dataset in process; every `/sdk/dataset` hits Redis (or Postgres). High QPS = high Redis QPS of the same blob.

### Hot partitions

Single Postgres table `Event` for all environments (indexed by env). One busy env dominates IO.

### Rate limiting / backpressure

None. Possible future: token bucket per SDK key.

### CDN

Not in repo.

### Sharding / partitioning

Not implemented.

---

## Complexity of evaluate

Let F = flags in prerequisite chain, R = rules, C = clauses, V = clause values, S = segment rules.

Worst case roughly O(F × (R × C × V + segment work + hash)). Hash is SHA-1 of a short string (cheap). Regex can dominate.

---

## Interview sentence

“We scale **reads of flags** by pushing a compiled snapshot to the client. We scale **admin writes** poorly on purpose (low QPS). The first real wall is **SSE connection cardinality** and **event table analytics**, not the hash function.”
