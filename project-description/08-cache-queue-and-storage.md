# Cache, queue, and storage

## Object / blob storage

**Not applicable.** No S3, GCS buckets for payloads, or local upload API.

## Message queues

**Not applicable as a work queue.** There is no consumer group, retry, DLQ, or at-least-once job processing.

Redis **pub/sub** is documented here because it is the change-notification mechanism.

---

## Redis cache (dataset)

### What is cached

The compiled `ClientDataset` JSON for one environment (`dataset.service.ts:71-77`, `redis.service.ts:44-56`).

### Key structure

```text
flagship:dataset:{environmentId}
```

`environmentId` is the Prisma cuid, **not** the SDK key and **not** `environment.key` (`redis.service.ts:36-38`). Comment on the method says `sdkKeyOrEnvId` but callers pass environment id.

### TTL / eviction

`SET key json EX 3600` — **1 hour** (`cacheDataset` default `ttlSeconds = 3600`).

After expiry: next `getDataset` is a **cache miss** → rebuild from Postgres → SET again.

Redis eviction policy: **not configured** in Compose (Redis default `noeviction` unless host changes it). **Not determinable** for Memorystore beyond product defaults.

### Pattern

**Cache-aside** on read (`get` then build). **Write-through** on `refresh` (always rebuild from DB, SET, then publish) — not write-behind.

`invalidateDataset` (`DEL`) exists **but is unused**.

### Invalidation

Every control-plane mutation that should affect targeting calls `refresh`, which overwrites the key. Deletes of flags refresh remaining env datasets.

If a writer **crashes after Postgres commit and before SET**, Redis may serve **stale** dataset until TTL or another write. There is **no transactional outbox**.

### Consistency

- Cache is a **projection**, not source of truth.
- Version field lets SDKs ignore older datasets (`client.ts:98-100`).
- Segment-only updates increment `Segment.version`, and that version is part of the environment aggregate, so the published integer changes (see [04-component-architecture.md](./04-component-architecture.md)). Clients still refetch on an SSE patch.

### Failure behavior

- Redis GET fail: ioredis throws unless connection is down in ways that return errors; **not specially caught** in `getCachedDataset`. Could 500 the SDK endpoint.
- Connect on startup: `.catch(() => undefined)` — API starts even if Redis is down; later commands fail.
- Pub/sub down: cache might still work if command connection works; SSE patches stop; polling still refreshes.

---

## Redis pub/sub (not a queue)

### Channel

```text
flagship:changes:{environmentId}
```

### Producer

`DatasetService.refresh` → `publishChange(environmentId, { version: dataset.version })` (`redis.service.ts:63-65`).

### Consumers

Each SSE connection registers `subscribeToChanges` (`sdk.controller.ts:50-52`). Handler `res.write` a `patch` event.

### Message format

JSON `{ "version": number }` only — **not** the dataset, **not** a flag diff.

### Delivery semantics

Pub/sub is **fire-and-forget, at-most-once, no persistence**. If no subscriber is connected, the message is gone. SDKs that only poll will see the change on the next interval (or never if they are offline and then use a stale in-memory copy).

### Ordering

Redis pub/sub per channel is roughly ordered for a single publisher. Multiple API instances publishing is rare (two admins); versions should still increase if both incremented configs. **No vector clocks.**

### Retry / DLQ / idempotency / backpressure

**None.** Slow `res.write` can buffer in Node; no explicit backpressure. Duplicate patches only cause extra dataset GETs (idempotent if version unchanged).

### Multi-instance fan-out

This **does** work: every API instance that called `SUBSCRIBE` on that channel gets the message (dedicated `subscriber` connection). That is why SSE is compatible with multiple Cloud Run instances, **provided Redis is shared**.

### Subscribe implementation details

- `void this.subscriber.subscribe(chan)` every new SSE client (repeated SUBSCRIBE to same channel is OK in Redis).
- Global `this.subscriber.on("message", listener)` **per subscription** — N listeners if N streams; each listener filters `incoming === chan` (`redis.service.ts:69-77`).
- Unsubscribe on connection close may `UNSUBSCRIBE` the channel while other local streams still need it (**bug risk**).

---

## Other caches

### SdkAuthService in-process Map

- Key: raw SDK key string.
- Value: `{ environmentId, environmentKey, projectId, kind }` + expiry 30s (`sdk-auth.service.ts`).
- Only **successful** resolutions are stored. Invalid keys hit Postgres every time.
- **Not** deleted on rotate. A key that was already resolved keeps working on that process until TTL.
- Per API instance (not Redis). After rotate, other instances still honor their own entries until those expire. A newly created key is a cache miss and works immediately.

### Next.js

`cache: "no-store"` on dashboard fetch (`api.ts:16`). No Redis on frontend.

### SDK memory

The `Engine` holds the last dataset until process restart / `close`. This is the **availability** cache, not Redis.

---

## What ARCHITECTURE.md suggests but repo does not implement

- Cloud CDN / reverse proxy ETag in front of `/sdk/dataset`
- Redis Streams / Kafka for events
- ClickHouse / BigQuery aggregates
