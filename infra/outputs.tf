
output "bucket_name" {
  description = "Name of the S3 bucket for scraper results"
  value       = aws_s3_bucket.results.bucket
}

output "queue_url" {
  description = "URL of the SQS task queue"
  value       = aws_sqs_queue.tasks.url
}
