# Flagship

A **LaunchDarkly-style feature flag & remote config platform**. Roll out
features gradually, target users and segments, run experiments, and kill bad
releases in near-real-time.

<p>
  <img alt="stack" src="https://img.shields.io/badge/backend-NestJS-e0234e" />
  <img alt="db" src="https://img.shields.io/badge/db-PostgreSQL-336791" />
  <img alt="cache" src="https://img.shields.io/badge/cache-Redis-dc382d" />
  <img alt="frontend" src="https://img.shields.io/badge/dashboard-Next.js-black" />
  <img alt="sdks" src="https://img.shields.io/badge/SDKs-TS%20%2B%20Python-blue" />
</p>

## What's inside

| Capability | Where |
|---|---|
| Projects, environments, flags, segments, targeting rules | `backend/src/{projects,flags,segments}` |
| Percentage rollouts via **stable hashing** | `packages/sdk-js/src/hash.ts` |
| Shared **evaluation engine** (server + SDKs) | `packages/sdk-js/src/engine.ts`, `sdks/python/flagship/engine.py` |
| **JS/TS SDK** (polling + SSE streaming) | `packages/sdk-js` |
| **Python SDK** (polling) | `sdks/python` |
| **Audit log** for every change | `backend/src/audit` |
| **Kill switch** with near-real-time propagation (Redis pub/sub → SSE) | `backend/src/flags` + `backend/src/sdk` |
| **Experiments dashboard** w/ conversion metrics + significance | `frontend` + `backend/src/experiments` |
| Dashboard UX (Next.js + Tailwind) | `frontend` |
| Docker, CI, **Terraform** (Cloud Run/SQL/Redis), **k6** load test | `docker-compose.yml`, `.github/workflows`, `infra` |

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for the HLD (control vs data
plane), LLD (evaluation engine, rule parser, rollout algorithm), and scaling.

## Repository layout

```
feature-flags/
├── backend/            NestJS API (control plane + data plane) + Prisma + seed
├── frontend/           Next.js dashboard (flags, targeting, segments, audit, experiments)
├── packages/sdk-js/    @flagship/sdk — TS engine + client (published to npm)
├── sdks/python/        flagship-sdk — Python engine + client
├── examples/           runnable Node & Python demos
├── infra/terraform/    Cloud Run + Cloud SQL + Memorystore + Secret Manager
├── infra/k6/           evaluation-latency load test
├── docs/               architecture
└── docker-compose.yml  Postgres + Redis (+ full-stack profile)
```

## Quickstart (local)

Prereqs: Node 20+, Docker, (optional) Python 3.9+.

```bash
cd feature-flags

# 1. Install workspace deps and start Postgres + Redis
npm install
npm run infra:up

# 2. Build the SDK (the backend imports its engine)
npm run build:sdk

# 3. Set up the database + seed demo data
cp .env.example .env
cd backend
npm run prisma:generate
npm run db:push          # or: npm run prisma:migrate
npm run seed             # creates the "demo" project, flags, a segment, an experiment
cd ..

# 4. Run the API and the dashboard (two terminals)
npm run dev:backend      # http://localhost:4000  (health: /health)
npm run dev:frontend     # http://localhost:3000
```

Open the dashboard at **http://localhost:3000**, pick the **demo** project, and
you'll see the seeded flags, a beta-users segment, the pricing A/B experiment
with real conversion numbers, and a populated audit log. Flip a flag's toggle to
exercise the kill switch.

The seed prints ready-to-use SDK keys:

```
Production SDK key:  sdk-production-demo00000000
Development SDK key: sdk-development-demo0000000
```

### Try the SDKs

```bash
# Node (uses the workspace @flagship/sdk)
node examples/node-demo/index.mjs

# Python
pip install -e sdks/python
python examples/python-demo/main.py
```

### Full stack in Docker

```bash
docker compose --profile full up --build
# API on :4000, dashboard on :3000
```

## Testing & load

```bash
npm run test --workspace @flagship/sdk     # engine + hashing (stickiness, uniformity)
npm run test --workspace backend           # experiment statistics
cd sdks/python && pip install -e ".[dev]" && pytest

# Latency load test (needs the API running + a valid SDK key)
k6 run -e SDK_KEY=sdk-production-demo00000000 infra/k6/eval-latency.js
```

## Deploy

CI (`.github/workflows/ci.yml`) builds/tests backend, frontend, and both SDKs.
`sdk-release.yml` publishes versioned SDK releases on `sdk-v*` tags. `deploy.yml`
builds the API image and deploys to **Cloud Run**; provision the backing
infrastructure with **[Terraform](infra/terraform/README.md)**.
