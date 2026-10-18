# Design decisions and tradeoffs

Rationale is **inferred** from code comments where noted; otherwise marked **inference**.

---

### Decision: Modular monolith (one Nest process for admin + SDK)

**Alternatives:** split control-plane and data-plane services; serverless functions per route; sidecar.

**Why (inference + docs):** small team/demo; shared engine import; simpler local Compose. [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) still describes two planes. Those planes are logical. The data plane is not a separately scaled service.

**Tradeoffs:** noisy neighbor (admin query vs SSE on one event loop); scale/failure domains coupled; Cloud Run one service.

**Consequences:** easier DX; at high SSE count you scale the whole API; deploy.yml only ships backend.

---

### Decision: PostgreSQL + Prisma as source of truth

**Alternatives:** Mongo (schemaless rules already JSON); Dynamo; etcd for flags.

**Why (inference):** relational projects/envs/FKs/cascade; SQL indexes for audit/events; Prisma nested writes.

**Tradeoffs:** JSON targeting not queryable; migrations folder missing; experiment scans OLTP.

**Consequences:** durable audit; events will hurt before flags will.

---

### Decision: Redis cache + pub/sub, not a second database of flags

**Alternatives:** clients poll Postgres (bad); only in-memory on API (multi-instance wrong); Kafka for all notifications; Redis as primary (durability risk).

**Why:** comments in `dataset.service.ts` and `redis.service.ts` — SDK hot path must not depend on Postgres; pub/sub for kill switch.

**Tradeoffs:** consistency window; TTL staleness; pub/sub unreliability; extra moving part.

**Consequences:** cache miss falls back to compile; ops must run Redis for live SSE.

---

### Decision: Full-dataset snapshot, not per-flag fetch or JSON-patch diffs

**Alternatives:** `GET /flags/:key`; RFC 6902 patches; streaming flag-only updates.

**Why (inference):** local eval needs segments+prereqs; simpler engine; patch event is version-only then full pull (`sdk.controller.ts` comments).

**Tradeoffs:** bandwidth on any change; large JSON; no partial update.

**Consequences:** good for small flag sets; noisy at 10k flags / high churn.

---

### Decision: Local evaluation with a shared pure engine

**Alternatives:** server-side eval RPC per request (LaunchDarkly also supports; this repo’s SDKs are local-only).

**Why:** `engine.ts` header — testable, identical server/SDK, microsecond reads, works offline with bootstrap.

**Tradeoffs:** targeting changes require dataset sync; leaking rules to anyone with SDK key; duplicate Python port.

**Consequences:** security model is “key sees all rules”; must keep Python in sync manually.

---

### Decision: SHA-1 15-hex LaunchDarkly-style bucket, per-flag salt

**Alternatives:** store user→variation in Redis; murmurhash; SHA-256; random assignment.

**Why:** comments `hash.ts:6-13` — stickiness without storage; salt decorrelates flags.

**Tradeoffs:** SHA-1 is deprecated for **crypto**, still fine as a **uniform hash** here; 60-bit float conversion; `inExperiment` unused.

**Consequences:** ramps are sticky; cannot “re-randomize” without salt/seed change (seed exists on Rollout).

---

### Decision: SSE instead of WebSockets for streaming

**Alternatives:** WebSocket; gRPC stream; poll-only.

**Why (inference):** one-way server push; HTTP-friendly; EventSource reconnect.

**Tradeoffs:** headers via `eventsource` polyfill; proxies; no client-to-server on that socket (events use POST); Python omitted SSE.

**Consequences:** kill switch ~ pub/sub + GET; Python freshness = poll interval.

---

### Decision: Optional shared ADMIN_API_KEY, actor header for audit

**Alternatives:** OIDC, session cookies, JWT (secret is provisioned!).

**Why:** comment `admin.guard.ts` — local dashboard works out of the box.

**Tradeoffs:** production danger if env not set; JWT_SECRET leftover.

**Consequences:** interview must admit demo auth.

---

### Decision: Kill switch as dedicated toggle endpoint

**Why:** `flags.service.ts:160-163` — isolated, audited, fast.

**Alternatives:** only PATCH `on`.

**Tradeoffs:** two ways to set `on` (PATCH also allows `on`).

**Consequences:** dashboard uses toggle; PATCH can still flip `on` with `flag.updated` audit instead of killswitch action.

---

### Decision: First-match rule list, clauses AND, values OR

**Why:** standard flag engines (LaunchDarkly-like types in `types.ts`).

**Tradeoffs:** rule order is load-bearing; no boolean expression AST.

**Consequences:** dashboard edits raw JSON — easy to mis-order.

---

### Decision: Experiments as events in Postgres + in-process z-test

**Alternatives:** Amplitude/GA; warehouse; sequential testing; Bayesian.

**Why (inference):** self-contained demo; seed shows significance.

**Tradeoffs:** not statistically rigorous (no MDE, peeking, multiple testing); loads all events; binary test even for `numeric` kind.

**Consequences:** fine for interview demo; not production analytics.

---

### Decision: Control = variation index 0

**Why:** `experiments.service.ts:99`.

**Tradeoffs:** boolean flags `[true,false]` control is `true` (index 0), which may not match product “control”. Seed pricing uses `["control","variant"]` so 0 is control.

**Consequences:** must design variations array order carefully.

---

### Decision: npm workspaces + Python sidecar package

**Why:** backend depends on `@flagship/sdk` engine.

**Tradeoffs:** Docker build context is repo root; Python not in `npm test`.

---

### Decision: Prisma db push / missing migrations in git

**Why:** unknown; likely demo speed.

**Tradeoffs:** production migrate deploy in Docker is a no-op fail then push — **schema drift risk**.

---

### Decision: Cloud Run public + private SQL/Redis

**Why:** Terraform comments — API public, data private.

**Tradeoffs:** entire API including admin is public at network layer; rely on app auth (weak).

---

### Decision: No message queue for events

**Why:** simplicity (`events.service` direct insert).

**Tradeoffs:** ingest latency = DB; no burst absorption.

ARCHITECTURE.md explicitly names this as a future move.

---

## Cross-cutting: consistency vs availability

SDKs choose **availability** (last dataset). Dashboard/API writes choose **Postgres durability**. Redis is best-effort projection. This is an AP-ish client cache with a CP-ish admin DB (loosely; not formally PACELC-tuned).
