import { PutObjectCommand } from "@aws-sdk/client-s3";
import { DeleteMessageCommand } from "@aws-sdk/client-sqs";

export async function processMessage({ message, queueUrl, bucket, s3, sqs, scrape }) {
  const job = JSON.parse(message.Body);
  if (!job.id || !job.url) throw new Error("Job requires id and url");
  const url = new URL(job.url);
  if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid URL protocol");
  const quotes = await scrape(url.href);
  if (!Array.isArray(quotes) || !quotes.length) throw new Error("Empty scrape result");
  const key = job.id + ".json";
  await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key,
    Body: JSON.stringify(quotes, null, 2) + "\n", ContentType: "application/json" }));
  await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
  console.log("Saved and acknowledged", key);
}
