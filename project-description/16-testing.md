# Testing

## Unit tests

### `@flagship/sdk` (Vitest)

| File | Protects |
|---|---|
| `packages/sdk-js/test/engine.test.ts` | missing flag; kill switch; targets beat fallthrough; `in` rules; numeric compare; deterministic rollout; segment include; prerequisite fail-closed |
| `packages/sdk-js/test/hash.test.ts` | deterministic bucket; range [0,1); uniformity 10% on 20k keys within 8–12%; stickiness 10%→20%; pickVariation 30/70 weights |
| `packages/sdk-js/test/track.test.ts` | full context and legacy context key event payload |
| `packages/sdk-js/test/golden-vectors.test.ts` | shared exact buckets and representative evaluation parity with Python |

**Not tested in JS:** the complete transport lifecycle, reconnect timing, and every operator edge case.

### Backend (Vitest)

| File | Protects |
|---|---|
| `backend/test/stats.test.ts` | `normalCdf` ~Φ; significant uplift example; noise not significant; zero exposures safe |
| `backend/test/redis.subscribe.test.ts` | per-channel listener fan-out and safe last-listener unsubscribe |
| `backend/test/events.context.test.ts` | full-context attribution, legacy context key, validation |
| `backend/test/segment-version.test.ts` | monotonic segment revision and dataset aggregate version |
| `backend/test/ownership.test.ts` | nested project/environment ownership outcomes |

These are focused service tests with fakes; they do not replace a live Postgres/Redis integration test.

### Python (pytest)

`sdks/python/tests/test_engine.py` covers the basic engine, while
`sdks/python/tests/test_golden_vectors.py` consumes the same
`testdata/golden-vectors.json` as TypeScript.

**Not tested:** client polling/retry behavior and parity beyond the shared fixture.

CI Python job: `pip install -e ".[dev]"` && `pytest` (`ci.yml`).

Root `npm test` runs SDK, backend, and frontend Vitest suites. Python remains a
separate pytest command; `npm run test:parity` runs both shared-vector suites.

## Integration tests

**None** (no supertest, no testcontainers beyond CI service containers used only to start backend **build/test** — backend test file does not hit DB).

CI backend job runs `db:push`, backend Vitest, and `nest build`. Postgres/Redis
are available, but the focused tests still use fakes.

## End-to-end / API / component tests

Frontend Vitest protects targeting construction, local evaluation, SSE parsing,
and audit diff formatting. `e2e/portfolio.spec.ts` is a Playwright smoke test
for a seeded stack. The `portfolio-smoke` CI job provisions PostgreSQL and
Redis, seeds the database, starts both applications, and runs that browser path.

## Load tests

`infra/k6/eval-latency.js`: ramping-vus 0→50→200→0; `GET /sdk/dataset` with Bearer; p95 &lt; 50ms, p99 &lt; 120ms, error rate &lt; 1%. Custom Trend `dataset_read_latency`.

**Not in CI.** Requires running API + valid SDK key.

## Mocking / fixtures

Engine tests use in-memory datasets. Backend service tests use small Prisma and
Redis fakes. Cross-language behavior uses `testdata/golden-vectors.json`.

## Test database

CI creates empty schema via `db:push`. Seed is **not** run in CI. Stats tests need no DB.

## Coverage

**No** coverage config or reports in repo. **Not determinable.**

## What behavior is protected (summary)

- Core evaluation order for a subset of cases.
- Hash stickiness/uniformity and shared JS/Python parity vectors.
- Z-test sanity.
- Full-context event attribution, segment revisions, ownership checks, and Redis listener lifecycle.
- Frontend targeting helpers, local evaluation, SSE framing, and readable diffs.

## Important untested areas (interview honesty)

- Kill-switch Redis→SSE→client chain
- Dataset compile mapping vs Prisma JSON
- Admin auth on/off
- SDK auth cache
- Experiment Set aggregation / control index 0 assumption
- Terraform
- Authentication and failure-mode browser journeys beyond the seeded happy path
- Reconnect behavior against a real Redis/SSE stack
