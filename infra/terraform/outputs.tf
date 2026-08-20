output "api_url" {
  value       = google_cloud_run_v2_service.api.uri
  description = "Public URL of the Flagship API"
}

output "artifact_registry" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.flagship.repository_id}"
}

output "postgres_connection_name" {
  value = google_sql_database_instance.postgres.connection_name
}

output "redis_host" {
  value = google_redis_instance.cache.host
}
