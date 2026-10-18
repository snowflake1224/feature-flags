# Real-time and concurrency

## WebSockets

**Not applicable.**

## Long polling

**Not implemented** as a server mode. Clients may **interval poll** `GET /sdk/dataset` (JS `mode: "polling"`, Python always).

## SSE (implemented)

**Endpoint:** `GET /sdk/stream` (`sdk.controller.ts:35-61`).

### Connection lifecycle

1. Authenticate SDK key.
2. SSE headers including `X-Accel-Buffering: no` (hints nginx not to buffer).
3. Immediate `put` with full dataset (not a snapshot-isolation DB transaction — `getDataset` then write).
4. Subscribe Redis channel for that environment.
5. Heartbeat comment every **25_000 ms**.
6. On HTTP close: stop heartbeat, `unsubscribe()`, `res.end()`.

### Rooms / channels

One Redis channel per **environment id**. Not per flag, not per user, not per SDK key. All SDKs for production share one channel.

### Presence

**Not implemented.** Server does not track connected clients.

### Broadcasting

`PUBLISH` after `refresh`. Every subscriber on that channel gets `{ version }`. Server then writes SSE `patch` to **that** TCP connection. No in-process fan-out list beyond Redis.

Dashboard browsers are **not** on this channel.

### Ordering

Patches carry only version. Client always **re-pulls full dataset**. Apply rule: ignore if `dataset.version < engine.version` (JS). Concurrent patches → extra GETs; last applied is the highest version seen (if versions stall, last fetch wins).

**No** Lamport clocks, version vectors, CRDTs, OT.

### Duplicate events

Duplicate `patch` → duplicate GET. Harmless if dataset identical.

### Reconnection

JS: `EventSource.onerror` logs; library auto-reconnects. New connection receives a fresh `put`. **No** `Last-Event-ID` handling on server.

Python: no SSE; poll only.

### Race: write vs stream

Possible order: client has version N; refresh publishes N+1; client GET delayed and receives N+1; a second refresh N+2 arrives as patch before GET returns — GET might return N+2 if refresh finished, or N+1 if interleaved. Client apply uses version comparison.

Possible: GET returns older than an in-flight newer apply — dropped if strictly older.

### Race: auth cache vs rotate

See [12-security.md](./12-security.md). Postgres deactivates the key immediately. A process that already cached that successful lookup can still accept it for up to 30s. The cache is not shared, and negative lookups are not stored.

---

## Optimistic / pessimistic concurrency

- **No** `FlagConfig.version` check-and-set from clients (dashboard last-write-wins).
- SQL `version: { increment: 1 }` is atomic per update.
- **No** row locks in Prisma queries.

Two operators toggling the same flag: both succeed; final `on` is the later commit; two refreshes.

---

## Locks / distributed locks

**None** (no Redlock). Compile+SET is not mutexed; two refreshes interleave reads of Postgres — both should be valid snapshots; last SET wins.

---

## SDK thread safety (Python)

`FlagshipClient` uses `threading.Lock` around engine replace and evaluate (`client.py:55-73`). Poll thread vs user thread.

JS: single-threaded event loop; `fetchDataset` concurrent overlapping fetches possible (patch + poll) — two `applyDataset` calls; version guard helps.

---

## Evaluation concurrency

Engine is CPU-bound and **synchronous**. No shared mutable dataset during `evaluate` except `this.dataset` pointer. `update()` replaces the object reference (`engine.ts:32-34`). In JS, evaluate running while update happens: one call uses old or new dataset (no tearing of a single evaluate because it's sync). Python lock held during evaluate and update.

Prerequisite `seen` Set is **per evaluate call**, not global.

---

## Hashing concurrency

Pure functions; no shared state.

---

## Event ingest concurrency

Parallel `POST /sdk/events` = parallel `INSERT`. No uniqueness on `(contextKey, eventKey)` — **duplicate exposures possible**; results use `Set` of contextKeys so duplicates in DB **collapse** for rates.

---

## Conflict resolution

**Last writer wins** on flag config. Audit stores before/after for humans, not for merge.

---

## Concepts not in this repo

CRDTs, OT, vector clocks, Raft, Kafka offset tracking, SSE last-event-id resume, sticky sessions config (Cloud Run may still load-balance new connections).
