variable "project_id" {
  type        = string
  description = "GCP project ID"
}

variable "region" {
  type    = string
  default = "us-central1"
}

variable "image" {
  type        = string
  description = "Container image for the API (Artifact Registry path)"
  default     = "us-central1-docker.pkg.dev/PROJECT/flagship/flagship-api:latest"
}

variable "db_tier" {
  type    = string
  default = "db-f1-micro"
}

variable "redis_tier" {
  type    = string
  default = "BASIC"
}

variable "redis_memory_gb" {
  type    = number
  default = 1
}

variable "min_instances" {
  type    = number
  default = 1
}

variable "max_instances" {
  type    = number
  default = 20
}
