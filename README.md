# Flagship

Boolean feature flags with percentage rollouts, a dashboard toggle, and an audit
row for every flip.

## The failure this is built around

You ship a feature to 10% of users, then raise it to 20%. If bucketing is random
per request, or keyed on something that reshuffles, some of the original 10% fall
out and see the old behavior again. Users flip between versions and your
rollout data is worthless.

Flagship buckets each user with a stable hash of `(flag, salt, user key)` mapped
to a point in `[0, 1)`. A user is in the rollout when their point is below the
percentage. Raising 10% to 20% only adds users whose point is in `[0.1, 0.2)`;
nobody already inside leaves. The tests in
[`packages/sdk-js/test`](packages/sdk-js/test) check exactly that.

## How it works

- Postgres stores the flag config: on/off, rollout percentage, and simple
  audience rules (an attribute equals a value, or an email ends with a domain).
- The API compiles each environment's flags into one JSON flag set and caches it
  in Redis.
- The JavaScript client ([`packages/sdk-js`](packages/sdk-js)) fetches that flag
  set every few seconds and evaluates flags locally against the copy it holds.
- The dashboard toggle flips a flag and writes an audit row with who did it.

## Run it

Prereqs: Node 20+ and Docker.

```bash
npm install
npm run infra:up              # Postgres + Redis
npm run build:sdk             # the backend imports the engine

cp .env.example .env
cd backend
npm run prisma:generate
npm run db:push
npm run seed                  # demo project, new-checkout flag, SDK keys
cd ..

npm run dev:backend           # http://localhost:4000
npm run dev:frontend          # http://localhost:3000
```

Open the **Demo Project**. `new-checkout` is a 20% rollout in production, plus
one rule: emails ending in `@flagship.dev` always get it. The **Live demo** tab
polls the flag set like an SDK would; turn the flag off and the next fetch shows
the change. The **Audit log** tab shows who flipped it.

Node client: `node examples/node-demo/index.mjs` (uses the seeded key
`sdk-production-demo00000000`).

Tests: `npm test` runs the SDK, backend, and frontend unit tests.

Everything in Docker, including Prometheus and Grafana:

```bash
docker compose --profile full up --build
# API :4000, dashboard :3000, Prometheus :9090, Grafana :3001
```

## Tradeoff: clients evaluate a fetched copy

Clients never call the API per flag read; they evaluate the last flag set they
fetched. Reads are fast and keep working if the API is down, but a toggle shows
up on the next fetch, not instantly. With a few-second poll that is fine for
rollouts. A kill switch in production would push the change instead of waiting
for the poll.

## Metrics

`GET /metrics` serves Prometheus counters: `flagship_kills_total` (flags turned
off), `flagship_dataset_fetches_total` (flag set fetches by clients), and
`flagship_evaluations_total` (evaluations done by the API for the dashboard's
test panel; client-side evaluations are local and not counted). The compose
`full` profile scrapes it with [`infra/prometheus/prometheus.yml`](infra/prometheus/prometheus.yml)
and provisions one Grafana board ([`infra/grafana/dashboards/flagship.json`](infra/grafana/dashboards/flagship.json)).

## Deploying

Terraform is only meant for the demo host, and none is checked in yet. See
[`infra/terraform/README.md`](infra/terraform/README.md) for what I would add.

Before exposing the API, set `ADMIN_API_KEY` (dashboard routes then require
`x-api-key`), restrict `CORS_ORIGIN`, and rotate the seeded SDK keys, which are
committed in the seed script.

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
