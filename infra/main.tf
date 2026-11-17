resource "aws_s3_bucket" "results" {
  bucket        = "dewops-results"
  force_destroy = true
}

resource "aws_sqs_queue" "jobs" {
  name                       = "dewops-jobs"
  visibility_timeout_seconds = 180
  receive_wait_time_seconds  = 10
}
