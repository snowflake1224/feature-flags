# Flagship infrastructure (Terraform)

Provisions the Flagship API on **Cloud Run**, backed by **Cloud SQL
(PostgreSQL)** and **Memorystore (Redis)**, with **Secret Manager** holding
connection strings and a **VPC connector** for private egress.

## Usage

```bash
cd infra/terraform
terraform init
terraform apply \
  -var project_id=YOUR_PROJECT \
  -var region=us-central1 \
  -var image=us-central1-docker.pkg.dev/YOUR_PROJECT/flagship/flagship-api:latest
```

## What gets created

| Resource                      | Purpose                                  |
| ----------------------------- | ---------------------------------------- |
| `google_cloud_run_v2_service` | The API (control + data plane)           |
| `google_sql_database_instance`| PostgreSQL 16 (private IP)               |
| `google_redis_instance`       | Redis 7 (dataset cache + change pub/sub) |
| `google_secret_manager_*`     | DATABASE_URL, REDIS_URL, JWT_SECRET      |
| `google_vpc_access_connector` | Private egress to SQL/Redis              |
| `google_artifact_registry_*`  | Container image registry                 |

The CI `deploy.yml` workflow builds the image, pushes it to Artifact Registry,
and deploys a new Cloud Run revision using the secrets created here.

> `db-f1-micro` / `BASIC` Redis are cost-minimal defaults for a demo. Bump
> `db_tier`, `redis_tier`, and `min_instances` for production.
