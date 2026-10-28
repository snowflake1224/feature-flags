# Terraform

There is no Terraform in this repo. The demo runs with `docker compose --profile full up`,
and any Terraform added here should provision exactly that, nothing more.

## What I would add in a real account

One VM that runs the compose file, a managed Postgres instead of the Postgres
container, and Redis (managed or the container, since it only holds a rebuildable
cache). Secrets (`DATABASE_URL`, `REDIS_URL`, `ADMIN_API_KEY`) go in the VM's
environment from the provider's secret store, not in the repo. No load balancer
or autoscaling until one instance is actually the bottleneck.
