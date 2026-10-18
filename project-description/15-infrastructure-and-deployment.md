# Infrastructure and deployment

## Local development

From root `README.md`:

1. `npm install`
2. `npm run infra:up` → Compose **postgres + redis only**
3. `npm run build:sdk`
4. `cp .env.example .env`; backend `prisma:generate`, `db:push`, `seed`
5. `npm run dev:backend` (:4000), `npm run dev:frontend` (:3000)

Python: `pip install -e sdks/python`.

Env: `.env.example` (`PORT`, `DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `CORS_ORIGIN`, `NEXT_PUBLIC_API_URL`).

## Docker Compose

`docker-compose.yml`:

| Service | Image / build | Ports | Profile |
|---|---|---|---|
| postgres | postgres:16-alpine | 5432 | default |
| redis | redis:7-alpine | 6379 | default |
| backend | `backend/Dockerfile` context `.` | 4000 | `full` |
| frontend | `frontend/Dockerfile` context `.` | 3000 | `full` |

Healthchecks: `pg_isready`, `redis-cli ping`. Backend depends on both healthy.

Backend env in Compose: production NODE_ENV, DB/Redis URLs to service names, JWT_SECRET, CORS to localhost:3000.

Frontend: `NEXT_PUBLIC_API_URL=http://localhost:4000` (browser-side).

Volume: `pgdata`.

`docker compose --profile full up --build` runs entire stack.

## Dockerfiles

**Backend:** multi-stage Node 20-slim; npm install workspace manifests; build SDK then backend; copy dist + prisma; CMD migrate deploy **or** db push then `node dist/main.js`. Expose 4000.

**Frontend:** build Next standalone; run `node frontend/server.js`. Expose 3000. `NEXT_TELEMETRY_DISABLED=1`.

`.dockerignore` files exist for both.

## Kubernetes

**Not present.**

## Cloud infrastructure (Terraform)

`infra/terraform/` — **code to provision**, not evidence of a live environment.

Enables APIs: run, sqladmin, redis, secretmanager, vpcaccess, artifactregistry, servicenetworking.

Creates: Artifact Registry `flagship`, VPC, VPC connector `10.8.0.0/28`, private service connection, Cloud SQL Postgres 16 `db-f1-micro` zonal private IP backups on, database/user, Memorystore Redis BASIC 1GB, secrets, SA `flagship-api`, Cloud Run v2 `flagship-api` (image var, port 4000, min/max instances, VPC egress private ranges, 1 CPU 512Mi), public invoker.

GCS backend for state is **commented** (`versions.tf:9-10`).

Outputs: `api_url`, artifact registry path, postgres connection name, redis host.

**Frontend is not deployed by Terraform.**

## Environment variables / secrets

See `09-backend-internals.md` and Terraform secret ids `flagship-database-url`, `flagship-redis-url`, `flagship-jwt-secret`.

## Build process

| Artifact | How |
|---|---|
| `@flagship/sdk` | `tsup` CJS+ESM+dts (`tsup.config.ts`) |
| backend | `nest build` → `dist/main.js` |
| frontend | `next build` standalone |
| Python | hatchling (`pyproject.toml`) |

CI must `build:sdk` before backend compile because Nest imports `@flagship/sdk`.

## Deployment process (CI)

`.github/workflows/deploy.yml` on `main` pushes to `backend/**`, `packages/sdk-js/**`, or workflow file; also `workflow_dispatch`.

1. WIF auth to GCP
2. docker build `-f backend/Dockerfile` tag `{region}-docker.pkg.dev/{project}/flagship/flagship-api:{sha}`
3. `gcloud run deploy flagship-api` `--allow-unauthenticated` `--min-instances 1` secrets DATABASE_URL, REDIS_URL, JWT_SECRET

**Does not** run Terraform. Assumes registry/secrets/SQL already exist.

## SDK publish

Tag `sdk-v*` → npm publish + PyPI twine (`sdk-release.yml`).

## CI test

`.github/workflows/ci.yml`: sdk-js, backend (services postgres/redis), frontend typecheck+build, python pytest. **No k6. No deploy in CI test job.**

## Networking / service discovery

Compose DNS names `postgres`, `redis`. Cloud Run uses secret URLs to private IPs. No Consul/K8s Services.

## Reverse proxy / TLS

Not in repo. Cloud Run HTTPS at the edge. SSE header `X-Accel-Buffering: no` anticipates nginx.

## Health / probes

`GET /health` JSON. **Not wired** as Cloud Run startup probe in Terraform (no `startup_probe` block). Cloud Run default TCP/HTTP probes **Not determinable** beyond platform defaults. Health returns 200 when degraded — weak for liveness if used blindly.

## Scaling

Terraform `min_instances` / `max_instances` (defaults 1 and 20). Deploy workflow `--min-instances 1` (max not set in gcloud command — **may differ** from Terraform max).

## Logging / monitoring

No Cloud Logging dashboard as code. App logs to stdout.

## Deployment diagram

```text
GitHub Actions (deploy.yml)
    | docker build + push
    v
Artifact Registry
    | gcloud run deploy
    v
Cloud Run flagship-api  --VPC connector-->  Cloud SQL (private)
                         --VPC connector-->  Memorystore
                         <-- HTTPS public --  browsers/SDKs (allUsers)

Local:
docker compose postgres+redis
npm nest + next
```

## Discrepancy

README: “deploys to Cloud Run; provision with Terraform”. Accurate as **intended workflow**. Live GCP project IDs are secrets — **Not determinable from the repository** whether production is running.
