import { S3Client } from "@aws-sdk/client-s3";
import { SQSClient } from "@aws-sdk/client-sqs";

export function clients(env = process.env) {
  if (!env.AWS_ENDPOINT_URL) throw new Error("AWS_ENDPOINT_URL is required");
  const config = { endpoint: env.AWS_ENDPOINT_URL, region: env.AWS_REGION };
  return { s3: new S3Client({ ...config, forcePathStyle: true }), sqs: new SQSClient(config) };
}
