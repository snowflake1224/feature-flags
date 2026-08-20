locals {
  services = [
    "run.googleapis.com",
    "sqladmin.googleapis.com",
    "redis.googleapis.com",
    "secretmanager.googleapis.com",
    "vpcaccess.googleapis.com",
    "artifactregistry.googleapis.com",
    "servicenetworking.googleapis.com",
  ]
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}

# --- Artifact Registry for container images ---
resource "google_artifact_registry_repository" "flagship" {
  location      = var.region
  repository_id = "flagship"
  format        = "DOCKER"
  depends_on    = [google_project_service.enabled]
}

# --- Networking: private VPC + connector so Cloud Run reaches SQL/Redis privately ---
resource "google_compute_network" "vpc" {
  name                    = "flagship-vpc"
  auto_create_subnetworks = true
  depends_on              = [google_project_service.enabled]
}

resource "google_vpc_access_connector" "connector" {
  name          = "flagship-conn"
  region        = var.region
  network       = google_compute_network.vpc.id
  ip_cidr_range = "10.8.0.0/28"
  depends_on    = [google_project_service.enabled]
}

resource "google_compute_global_address" "private_ip" {
  name          = "flagship-private-ip"
  purpose       = "VPC_PEERING"
  address_type  = "INTERNAL"
  prefix_length = 16
  network       = google_compute_network.vpc.id
}

resource "google_service_networking_connection" "private_vpc" {
  network                 = google_compute_network.vpc.id
  service                 = "servicenetworking.googleapis.com"
  reserved_peering_ranges = [google_compute_global_address.private_ip.name]
}

# --- Cloud SQL (PostgreSQL) ---
resource "google_sql_database_instance" "postgres" {
  name             = "flagship-pg"
  database_version = "POSTGRES_16"
  region           = var.region
  depends_on       = [google_service_networking_connection.private_vpc]

  settings {
    tier              = var.db_tier
    availability_type = "ZONAL"
    ip_configuration {
      ipv4_enabled    = false
      private_network = google_compute_network.vpc.id
    }
    backup_configuration {
      enabled = true
    }
  }
  deletion_protection = false
}

resource "google_sql_database" "flagship" {
  name     = "flagship"
  instance = google_sql_database_instance.postgres.name
}

resource "random_password" "db" {
  length  = 24
  special = false
}

resource "google_sql_user" "flagship" {
  name     = "flagship"
  instance = google_sql_database_instance.postgres.name
  password = random_password.db.result
}

# --- Memorystore (Redis) ---
resource "google_redis_instance" "cache" {
  name               = "flagship-redis"
  tier               = var.redis_tier
  memory_size_gb     = var.redis_memory_gb
  region             = var.region
  authorized_network = google_compute_network.vpc.id
  redis_version      = "REDIS_7_0"
  depends_on         = [google_project_service.enabled]
}

# --- Secrets ---
resource "google_secret_manager_secret" "database_url" {
  secret_id = "flagship-database-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "database_url" {
  secret      = google_secret_manager_secret.database_url.id
  secret_data = "postgresql://flagship:${random_password.db.result}@${google_sql_database_instance.postgres.private_ip_address}:5432/flagship?schema=public"
}

resource "google_secret_manager_secret" "redis_url" {
  secret_id = "flagship-redis-url"
  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_version" "redis_url" {
  secret      = google_secret_manager_secret.redis_url.id
  secret_data = "redis://${google_redis_instance.cache.host}:${google_redis_instance.cache.port}"
}

resource "google_secret_manager_secret" "jwt_secret" {
  secret_id = "flagship-jwt-secret"
  replication {
    auto {}
  }
}

resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "google_secret_manager_secret_version" "jwt_secret" {
  secret      = google_secret_manager_secret.jwt_secret.id
  secret_data = random_password.jwt.result
}

# --- Service account for the API ---
resource "google_service_account" "api" {
  account_id   = "flagship-api"
  display_name = "Flagship API"
}

resource "google_secret_manager_secret_iam_member" "api_secrets" {
  for_each = {
    db    = google_secret_manager_secret.database_url.id
    redis = google_secret_manager_secret.redis_url.id
    jwt   = google_secret_manager_secret.jwt_secret.id
  }
  secret_id = each.value
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.api.email}"
}

resource "google_project_iam_member" "api_sql_client" {
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = "serviceAccount:${google_service_account.api.email}"
}

# --- Cloud Run service ---
resource "google_cloud_run_v2_service" "api" {
  name     = "flagship-api"
  location = var.region

  template {
    service_account = google_service_account.api.email
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = var.max_instances
    }
    vpc_access {
      connector = google_vpc_access_connector.connector.id
      egress    = "PRIVATE_RANGES_ONLY"
    }
    containers {
      image = var.image
      ports {
        container_port = 4000
      }
      env {
        name  = "NODE_ENV"
        value = "production"
      }
      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "REDIS_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.redis_url.secret_id
            version = "latest"
          }
        }
      }
      env {
        name = "JWT_SECRET"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.jwt_secret.secret_id
            version = "latest"
          }
        }
      }
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
  }
  depends_on = [google_secret_manager_secret_version.database_url]
}

resource "google_cloud_run_v2_service_iam_member" "public" {
  name     = google_cloud_run_v2_service.api.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}
