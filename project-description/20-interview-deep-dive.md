# Interview deep-dive

Answers reflect **this repository**. Hypothetical scaling is separated.

---

## Project overview questions

**What is Flagship?**  
A self-hosted feature-flag platform: NestJS API, Postgres, Redis, Next.js dashboard, JS/Python SDKs with local evaluation.

**Who uses it?**  
Operators (dashboard) and app developers (SDKs). No end-user accounts.

**Is it production-ready?**  
It runs locally and has Cloud Run/Terraform **templates**. Auth, migrations, analytics, and SSE lifecycle have demo-grade gaps. Live prod is **Not determinable from the repo**.

**Why is it interesting?**  
Control vs data plane in one binary; sticky hashing; shared engine; SSE kill switches.

---

## Architecture questions

**Microservices?**  
No. Modular Nest monolith + separate Next app + libraries.

**Control plane vs data plane?**  
Logical split: admin writes Postgres+audit+refresh; SDK reads Redis/SSE/events. Same process (`app.module.ts`).

**What happens if the API dies?**  
SDKs keep last dataset (unless maxStaleness). Dashboard dies. New bootstraps fail.

**Why Redis and Postgres?**  
Postgres durable truth; Redis compiled snapshot + pub/sub. See `17-design-decisions-and-tradeoffs.md`.

---

## Backend questions

**Walk through toggle.**  
`FlagsTab` → `POST toggle` → `FlagConfig.update` on+version → audit → `buildDataset` → Redis SET → PUBLISH → JSON. SSE clients patch then GET dataset. Engine sees `on: false` → `offVariation`.

**Why dedicated toggle?**  
Comment in `flags.service.ts:160-163`: isolated, audited (`flag.killswitch`).

**How is the dataset built?**  
All FlagConfigs+flags and segments for env; map to engine types; version sum (`dataset.service.ts:19-68`).

**Does GET /sdk/dataset hit Postgres?**  
Only on Redis miss or Redis error (error → likely 500).

---

## Database questions

**Schema highlight?**  
Flag vs FlagConfig (per-env targeting). Event/Experiment denormalized flagKey. AuditLog.environmentId not a FK.

**Transactions?**  
No explicit `$transaction` in services; nested Prisma creates are transactional.

**How do you migrate?**  
No migration files in git; `db push`. Docker tries `migrate deploy` then push.

**Indexes?**  
Audit `(projectId, createdAt)`; Event `(environmentId, eventKey, ts)` and `(environmentId, flagKey)`.

---

## API questions

**List SDK endpoints.**  
`GET /sdk/dataset`, `GET /sdk/stream`, `POST /sdk/events`. Auth Bearer SDK key.

**Why patch not full dataset on SSE?**  
Comment in `sdk.controller.ts:30-33`: lightweight fan-out; clients pull when behind.

**Validation?**  
Only some DTOs. Rules JSON unvalidated.

---

## Distributed systems questions

**Current implementation:** single-region implied; one Redis; pub/sub at-most-once; no consensus.

**Proposed:** multi-region would need replicated config (or regional caches + primary writes) — **not built**.

**Is Redis a source of truth?**  
No. TTL 1h; rebuild from Postgres.

**Split brain two API instances?**  
Both subscribe; both can refresh; last SET wins; both publish. OK for flags.

---

## Concurrency questions

**Two dashboards toggle.**  
Last SQL commit wins; two version increments; two publishes.

**Python eval vs poll.**  
`threading.Lock` around engine (`client.py`).

**SSE unsubscribe bug.**  
`subscribeToChanges` unsubscribe may UNSUBSCRIBE channel for other local streams (`redis.service.ts:80-83`).

---

## Networking questions

**SSE vs WS?**  
One-way updates; HTTP; EventSource reconnect. No WS server.

**Heartbeats?**  
`: keep-alive` every 25s so proxies don’t idle-timeout.

**CORS?**  
`CORS_ORIGIN` or `*`.

**Cloud Run unauthenticated?**  
Yes, `deploy.yml` and Terraform `allUsers`.

---

## Security questions

**How do you auth the dashboard?**  
You mostly don’t. Optional `ADMIN_API_KEY`. Actor header is not auth.

**JWT?**  
Env/IaC only; **unused in code**.

**SDK key leak?**  
Attacker downloads full targeting for that environment.

**SQL injection?**  
Prisma.

**Rate limits?**  
None.

---

## Performance questions

**Flag read latency?**  
In-process after bootstrap. k6 measures **dataset HTTP**, not eval.

**SHA-1 cost?**  
Negligible vs network.

**Hot key?**  
`flagship:dataset:{prodEnvId}` — every SDK GET.

---

## Scalability questions

**Current:** local eval; Redis GET; Cloud Run max 20 in Terraform; no event pipeline.

**10x:** instance cache of dataset; batch events; fix health codes; run k6.

**100x:** split data plane; CDN; warehouse events; reduce SSE (poll or dedicated streamer).

**1000x:** edge snapshots; shard events; don’t scan Event table.

---

## Failure-handling questions

**What happens if Redis is down?**  
Startup still proceeds (`redis.service.ts:27-28`). Dataset GET/SET/SSE fail. Compile path needs Redis for cache but `getDataset` tries GET first — throws. Admin refresh throws after DB write possible.

**If Postgres is down?**  
Writes fail; SDK Redis hits still work until TTL; auth cache miss fails; health postgres down.

**If evaluate throws?**  
Uncaught in ingest → 500. Engine itself returns error results rather than throw for missing flags.

**SDK offline?**  
Last dataset; optional staleness → defaults.

---

## Testing questions

**What do tests prove?**  
Engine subset, hash stickiness/uniformity, z-test.

**What’s missing?**  
HTTP/SSE/Redis/Prisma/frontend/cross-language golden hashes.

---

## Technology-specific questions

**Why Nest?**  
Inference: modules/DI/guards for a structured API. Could have been Fastify/Express.

**Why ioredis two connections?**  
Pub/sub in Redis requires a connection in subscriber mode; commands use another (`redis.service.ts:5-7`).

**Why EventSource package?**  
Browser EventSource can’t set Authorization; Node SDK uses `eventsource` with headers (`client.ts:114`).

**Why Prisma JSON for rules?**  
Flexible targeting without SQL schema for every operator.

---

## Code-level questions

**Evaluation order?**  
Prereq → off → targets → rules → fallthrough (`engine.ts:22-27`).

**Is `in` set membership?**  
`matchSingle` `in` is `===` against one rule value; engine ORs `values[]`. Context arrays: any element matches.

**Why 15 hex digits?**  
Match LaunchDarkly-style 60-bit bucket (`hash.ts:11-15`).

**Why `inExperiment` always false?**  
`pickVariation` hardcodes false (`hash.ts:44`). Dead field.

**Version formula?**  
Aggregate of flag-config versions and segment versions. Segment updates increment `Segment.version`, so a segment-only edit changes the dataset version clients compare.

**Control variation?**  
Index 0 in results.

---

## “Why X instead of Y?”

See `17-design-decisions-and-tradeoffs.md`. Short hits:

- Local eval vs RPC: latency, offline, identical tests.
- SSE vs poll: kill-switch freshness vs connection cost (Python chose poll).
- Hash vs stored assignment: no user table, sticky ramps.
- Postgres events vs Kafka: demo simplicity.

---

## “What happens if X fails?”

Covered above; also `13-error-handling-and-resilience.md`.

**Audit insert fails after flag update:** cache not refreshed; DB has new `on`; SDKs stale until TTL/next write.

---

## “How would you scale this?”

Always: **current** = snapshot eval + Redis + optional Cloud Run replicas. **Proposed** = not in repo (CDN, split plane, event warehouse).

---

## “What would you change if you rebuilt it?”

Reasonable, still honest:

1. Real auth (OIDC) + per-project RBAC; remove unused JWT or actually use it.
2. Checked-in Prisma migrations.
3. Instance memory cache + ETag for dataset.
4. Schema-validate rules; UI builder not raw JSON.
5. Event pipeline + pre-aggregates; don’t z-test on peeking.
6. Cross-language hash golden tests; implement Python SSE or document poll SLA.
7. Keep the shared Redis subscriber refcounted; 503 health when deps down.
8. Rate-limit `/sdk/*`.

---

## Most likely interviewer attack points

| Attack | You must know |
|---|---|
| **Sticky rollout math** | SHA-1 15 hex / 60-bit; salt; why 10%⊂20%; tests in `hash.test.ts` |
| **Eval order & fail-closed** | prereqs, kill switch, offVariation vs defaultValue |
| **Consistency** | Postgres vs Redis TTL vs SDK last-good vs version compare |
| **SSE fan-out** | pub/sub to **API instances**, then each writes its sockets; patch then full GET |
| **Security theater** | open admin, public Cloud Run, JWT unused, keys in plaintext |
| **“Is this CAP?”** | Don’t overclaim; clients prefer availability; admin prefers DB durability |
| **Experiment stats** | pooled two-proportion z; p&lt;0.05; control=0; in-memory scan |
| **Scale story** | eval is not the wall; SSE+events+hot Redis key are |
| **Python vs JS** | poll vs SSE; pick_variation return type; possible float hash divergence |
| **Code bugs / sharp edges** | unused `invalidateDataset`; `inExperiment` always false; SDK auth cache keeps a resolved key ≤30s after rotate (per process, positive entries only); shared Redis subscriber must drop a channel only when its last local listener leaves |

### How to practice

Narrate **one kill-switch sequence** and **one hashing example** (`user-42` same point forever). Then volunteer **three gaps**. That reads as ownership, not a tutorial dump.
