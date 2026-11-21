# Engineering FAQ

This guide prepares engineering walkthroughs on Flagship's deterministic evaluation engine, SDK architecture, Redis snapshot compilation, and trade-offs.

---

## 1. 60-Second Elevator Pitch

> Flagship is a feature-flag control plane and local-evaluation SDK (`@flagship/sdk`, NestJS + Prisma/Postgres, Redis, Next.js). Rather than executing a network RPC on every `boolVariation()` call, the control plane compiles each environment's rules into a versioned JSON snapshot cached in Redis, which SDK clients poll sequentially and evaluate synchronously in memory using a 60-bit SHA-1 sticky hash (`sha1(flag.salt.bucketBy) / 0xFFFFFFFFFFFFFFF`), complete with prerequisite cycle guards, kill switches, audience targeting, immutable before/after audit rows, and Prometheus telemetry.

---

## 2. Core Technical Interview Q&A

### Q1: Why push compiled flag snapshots to SDK memory instead of calling `/sdk/evaluate` on every flag read?
- Calling an API on every `boolVariation()` turns a control-plane outage or Redis blip into an application latency/availability outage.
- Evaluating a cached snapshot locally turns every flag check into an $O(1)$ map lookup + SHA-1 computation (sub-millisecond) and allows apps to keep working through temporary control-plane downtime (`maxStalenessMs` bounds staleness).
- Trade-off: toggles propagate on the next polling tick rather than sub-second push; production upgrades would add SSE / pub-sub invalidation for instant kill-switch propagation.

### Q2: How does your rollout hashing avoid reshuffling users when scaling from 10% to 20%?
- `hash.ts` hashes `flagKey + "." + salt + "." + bucketBy` with SHA-1, reads the first 15 hex digits (60 bits, avoiding IEEE-754 53-bit overflow until division by `0xFFFFFFFFFFFFFFF`), and maps every user stably into `[0, 1)`.
- Raising a rollout percentage $p$ from `10%` to `20%` only widens the interval `[0, 0.10) -> [0, 0.20)`. Every user below `0.10` remains inside. The per-flag random `salt` also ensures two different flags assign independent user percentiles.

### Q3: How does the client avoid race conditions during periodic polling?
- `packages/sdk-js/src/client.ts` schedules the **next** `setTimeout` poll only after the current fetch finishes (or fails), so slow earlier HTTP responses can never overwrite fresher dataset snapshots out of order.

### Q4: How do you guarantee the dashboard's live evaluation tester matches Node SDK behavior identically?
- The NestJS API imports the compiled `@flagship/sdk` `Engine` directly for server-side test evaluation (`POST /sdk/evaluate`), while `frontend/lib/local-eval.ts` implements an identical pure-JS SHA-1 and pins the exact same deterministic test vector (`bucket("new-checkout", "checkoutsalt00000", "user-42") === 0.5588033430205928`).

### Q5: Walk through the verification tests and operational security boundaries.
- **Bucketing tests (`hash.test.ts` & `engine.test.ts`)**: `20,000` keys verify bucket uniformity (`8–12%` at `10%` rollout, `27–33%` on `30/70` variation split); `5,000` keys confirm `0` regressions on `10% -> 20%` upgrades.
- **Control-plane security**: `ADMIN_API_KEY` protects dashboard mutations, `AuditService.record()` appends before/after JSON snapshots with `x-actor-email`, and seeded SDK keys (`sdk-production-demo00000000`) are flagged for rotation before internet deployment.
