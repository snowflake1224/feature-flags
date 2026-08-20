terraform {
  required_version = ">= 1.5"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.30"
    }
  }
  # Configure a GCS backend for shared state in real environments:
  # backend "gcs" { bucket = "flagship-tfstate" prefix = "flagship" }
}

provider "google" {
  project = var.project_id
  region  = var.region
}
