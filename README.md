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
The code-backed dossier (patterns, API, failure modes, interview notes) is
**[project-description/README.md](project-description/README.md)**. A click-by-click
script is **[project-description/22-demo-guide.md](project-description/22-demo-guide.md)**.

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
├── project-description/ technical dossier and demo guide
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

## 5-minute browser demo

Do this after the quickstart, on **production**. Full script, persona table, and
troubleshooting: **[project-description/22-demo-guide.md](project-description/22-demo-guide.md)**.

1. Open **http://localhost:3000** and open **Demo Project**. The UI selects production.
2. On **Flags**, `new-checkout` is on: included beta keys and `@flagship.dev` emails get the new flow; everyone else is a 20% rollout. `pricing-experiment` is a 50/50 string flag.
3. Open **Live demo** and wait for the authenticated stream’s initial `put`. Compare a browser-local evaluation with the server, then turn `new-checkout` off.
4. Watch the tab receive a `patch`, refetch the dataset, and show the off variation plus refresh latency. That path is Postgres write → Redis cache + pub/sub → SSE `patch` → authenticated dataset fetch. Optionally run `node examples/node-demo/index.mjs` to demonstrate the same path through the Node SDK.
5. Open **Experiments** → **Pricing Layout A/B**. Seeded production traffic (`user-0` … `user-3999`) aims at roughly 10% conversion on control and 14% on the variant. Exact counts change every seed.
6. Open **Audit log** and confirm the toggle was recorded (actor defaults to `demo@flagship.dev`).

The **Live demo** tab also sends exposure/conversion events and refreshes experiment results. Python polls and will not show the kill switch until the next interval (`python examples/python-demo/main.py`).

> **TODO (screenshot):** Projects list with Demo Project. Placeholder only — do not add an image tag until the file exists.
>
> **TODO (screenshot):** Production flags with `new-checkout` on.
>
> **TODO (GIF):** Kill switch, then the Node log flipping `new-checkout` to false.

## Secure demo configuration

The quickstart leaves the control plane open so the dashboard works on localhost. Use that only on a machine you trust.

Before anyone else can reach the API:

- Set `ADMIN_API_KEY` to a long random value. `/projects` routes then require header `x-api-key`; save the same value in dashboard **Settings** so later control-plane requests include it.
- Set `CORS_ORIGIN` to the dashboard origin only.
- Do not publish Postgres or Redis to the network. The seeded SDK keys above are **sample keys committed in the seed script**. Rotate them if the API is reachable, and do not reuse them as production secrets.
- Data-plane routes always require `Authorization: Bearer <sdk key>` (or `x-sdk-key`). Rotation marks old keys inactive in Postgres immediately and the new key works on first use. A process that already resolved the old key can still accept it for up to 30 seconds (in-memory cache, per instance, successful lookups only).
- `JWT_SECRET` is in `.env.example` and Terraform and is **not read by application code**. It does not authenticate requests.

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
