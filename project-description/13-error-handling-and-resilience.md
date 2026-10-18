# Error handling and resilience

There is **no** global Nest exception filter, **no** circuit breaker library, **no** retry/backoff helper, **no** DLQ.

---

## Exception handling

| Case | Behavior |
|---|---|
| `UnauthorizedException` | 401 JSON |
| `NotFoundException` | 404 |
| `BadRequestException` | 400 (flag variations) |
| `ValidationPipe` | 400 |
| Prisma `P2025` / throw | typically **500** (rotate missing env) |
| Unhandled | Nest default 500 |

Health: try/catch per dependency, never throws (`health.controller.ts:15-26`).

Redis subscriber: malformed JSON ignored.

## Validation failures

DTO-backed routes reject bad types/keys. Untyped JSON bodies: stored; evaluation may `MALFORMED_FLAG` or skip rules.

`matchesRegex`: invalid regex → `false` (`operators.ts:67-68`).

## Database failures

Writes fail the HTTP request. Partial failure example: audit insert **after** flag update — if audit throws, client may error **after** config was changed; `refresh` might not run if thrown before it. Order in `toggle`: update → audit → refresh. **Audit failure leaves DB updated but cache stale** until TTL or next write.

Nested creates: Prisma typically all-or-nothing for nested writes.

## Redis failures

Startup: connect errors swallowed; later GET/SET throw → SDK/admin 500.

Cache miss path needs Postgres. If Redis SET fails after compile, `refresh` throws after DB already committed — **stale cache / no publish**.

Pub/sub fail: streaming clients stop getting patches; polling still works if GET works.

## Network failures (SDK)

JS `start()`: initial `fetchDataset().catch` warn (`client.ts:63-65`). If bootstrap option exists, engine already present.

`track()`: catch, `logger.debug` — **never throws to app**.

Stream `onerror`: warn; EventSource reconnect.

Python `_poll_loop`: catch log; `start()` `_fetch()` **can throw** and abort start (`client.py:39-40` — no try around first fetch).

`maxStalenessMs` / `max_staleness`: if `> 0` and last update too old, `variation()` returns default + `ERROR` (`client.ts:158-160`, `client.py:69-72`). Default `0` = **never stale** (serve last dataset forever).

## Timeouts

- Python GET timeout 10s, track 5s (`client.py:52, 108`).
- JS `fetch` / EventSource: **no timeout set**.
- Prisma: default.

## Retries / exponential backoff

**Not implemented** in app code. ioredis `maxRetriesPerRequest: null` (reconnect behavior per ioredis defaults). EventSource reconnect is browser/library.

## Circuit breakers / fallbacks

- Engine missing flag: caller `defaultValue`.
- Prerequisite fail / kill switch: `offVariation`.
- SDK no engine: defaults.
- Health degraded: still 200 — **load balancers using HTTP status will not drain**.

## Dead-letter queues

**Not applicable.**

## Idempotency

Dataset GET is idempotent. Event POST is **not** idempotent (new row each time). Toggle is not idempotent in audit (new audit row) but setting `on: true` twice is same config.

## Partial failure — experiment results

Events with `variationIndex` null skipped (`experiments.service.ts:90`). Exposures and conversions counted via Sets — a conversion without exposure still enters `converted` Set and can inflate rates (denominator is exposures only — conversion without exposure still listed in converted; **rate = conversions/exposures** uses Set sizes independently, so converted users not in exposed still increase numerator... wait: `conversions = b.converted.size` and `conversionRate = conversions/exposures`. Users only in converted increase numerator without denominator. **Possible >100% or biased rates** if goal events ingested without exposures.

## Graceful shutdown

Prisma `$disconnect` and Redis `disconnect` on module destroy. **No** explicit drain of SSE connections (they drop on SIGTERM). Cloud Run may send SIGTERM; Nest default shutdown.

Docker CMD does not use a process manager.

## Recovery

- Redis empty: rebuild from Postgres.
- Postgres restore: Redis may serve old dataset until TTL/refresh — **operators should restart API or wait TTL or toggle a flag**.
- Seed script **deletes** demo project if present (`seed.ts:14-15`) — destructive recovery for demo only.

## k6 / load

Failures counted as HTTP failed rate; not production monitoring.
