output "bucket_name" {
  value = aws_s3_bucket.results.id
}

output "queue_url" {
  value = aws_sqs_queue.jobs.url
}
