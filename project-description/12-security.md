# Security

Be precise in interviews: this is a **demo-grade** control plane. Do not claim SSO, JWT sessions, or per-project ACLs.

---

## Authentication

| Mechanism | Threat | Mitigation | Location | Limitations |
|---|---|---|---|---|
| Optional `ADMIN_API_KEY` | Anonymous admin API | Shared static header `x-api-key` | `admin.guard.ts` | Unset = **no auth**. Single global secret, not per-user. Not in `.env.example`. Dashboard never sends it. |
| SDK key Bearer / `x-sdk-key` | Anonymous dataset theft | Lookup `SdkKey` where `active` | `sdk-auth.service.ts` | Key is a **capability** for an entire environment dataset (all flags/rules). Kind `client` vs `server` **not enforced**. |
| Actor header | Impersonation of audit identity | None — header is trusted | `actor.decorator.ts` | Anyone can set `x-actor-email`. |

**JWT:** `JWT_SECRET` exists in env/IaC/CI **without application verification**. Do not say “we use JWT”.

**Passwords / sessions / cookies:** not implemented.

**OIDC:** comments say “swap this for real OIDC/JWT” (`admin.guard.ts:10`) — **not done**.

---

## Authorization

**None beyond “has admin key or none required” and “has SDK key for some environment”.**

Knowing a project cuid allows `GET/PATCH` that project if admin API is reachable. **No check** that `environmentId` belongs to `projectId` on nested routes (IDOR / cross-project env id).

---

## Secrets management

| Secret | Where |
|---|---|
| `DATABASE_URL` | env, Terraform Secret Manager, Cloud Run |
| `REDIS_URL` | same |
| `JWT_SECRET` | provisioned unused |
| SDK keys | stored **plaintext** in Postgres `SdkKey.key`; shown in Settings UI |

Compose uses password `flagship`. Terraform generates random DB password.

GitHub: `NPM_TOKEN`, `PYPI_TOKEN`, GCP WIF secrets — for CI, not runtime app.

---

## CORS

`enableCors({ origin: process.env.CORS_ORIGIN?.split(",") ?? "*", credentials: true })` (`main.ts:8-11`).

**Limitation:** default `*` with `credentials: true` is a problematic combination in browsers; local `.env.example` sets `http://localhost:3000`.

**CSRF:** no CSRF tokens. Dashboard is bearer-less cookie-less JSON; CSRF is lower risk unless cookies are added later. Admin key in header is not automatically sent by foreign sites (custom header).

---

## XSS

React text interpolation reduces HTML injection. Audit/flag JSON rendered in `<pre>` and `<code>`. **Dangerous:** `JSON.stringify` into DOM is text, not `dangerouslySetInnerHTML`. Flag names are React children (escaped).

`matchesRegex` operator compiles `new RegExp(String(ruleValue))` (`operators.ts:65-68`) — ReDoS risk on **evaluation**, not XSS.

---

## SQL injection

Prisma parameterized queries. `$queryRaw` health uses tagged template `SELECT 1` — safe. Event `metadata` stored as JSON via Prisma.

---

## Input validation

Partial (see `09-backend-internals.md`). Targeting JSON **not schema-validated**. Regex operator can throw internally and returns false.

Flag keys validated on create only.

---

## Rate limiting / abuse

**Not implemented.** Dataset GET and event POST can be flooded. SSE can hold connections (resource exhaustion).

k6 script is a load test, not a limiter.

---

## File uploads

**Not applicable.**

---

## SSE security

Same SDK key as dataset. Stream exposes full dataset on `put` (same as GET). No origin check beyond CORS (EventSource is GET with Authorization header via `eventsource` package).

---

## Database permissions

Compose: user `flagship` owns DB. Terraform: Cloud SQL user `flagship`; Cloud Run SA has `cloudsql.client` + secret accessor. **Least privilege for tables is not defined** (app uses a full DB user).

---

## Container / network security

- Images: `node:20-slim`; openssl for Prisma.
- Cloud Run: `--allow-unauthenticated` (`deploy.yml:51`); Terraform `allUsers` invoker (`main.tf:231-236`) — **public API**.
- Terraform VPC: Cloud Run egress `PRIVATE_RANGES_ONLY` to reach private SQL/Redis.
- Local Compose publishes Postgres/Redis ports to host.

TLS termination: Cloud Run provides HTTPS to clients. App listens HTTP inside the container.

---

## Encryption

- In transit: not terminated in Nest; depends on platform.
- At rest: Cloud SQL/Memorystore product defaults — **not configured in Terraform beyond instance create**.
- SDK keys / dataset: not encrypted at application layer.

---

## Gaps to volunteer in interviews

1. Open admin API by default.
2. Public Cloud Run invoker.
3. Plaintext SDK keys in DB and UI.
4. Unused JWT secret (config drift).
5. Positive SDK-key cache: a key already resolved on that API process can keep working for up to 30s after revoke. Not shared across instances. New keys and never-cached invalid keys are not delayed.
6. Full ruleset downloadable with any SDK key (by design for server SDKs; dangerous if key leaks).
7. No rate limits, no audit of SDK reads.
8. Health endpoint public (info: postgres/redis down).
