resource "aws_s3_bucket" "results" {
  bucket        = "dewops-scraper-results"
  force_destroy = true
}

resource "aws_sqs_queue" "tasks" {
  name                       = "dewops-scraper-tasks"
  visibility_timeout_seconds = 300
}