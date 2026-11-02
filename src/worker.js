
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand
} from "@aws-sdk/client-sqs";

import {
  S3Client,
  PutObjectCommand
} from "@aws-sdk/client-s3";

import { scrapeQuotes } from "./scraper.js";

// Read a required environment variable.
function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

// Connection settings.
const endpoint = requiredEnv("AWS_ENDPOINT");
const region = requiredEnv("AWS_REGION");
const queueUrl = requiredEnv("SQS_QUEUE_URL");
const bucket = requiredEnv("S3_BUCKET");

const credentials = {
  accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
  secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY")
};

// Create AWS clients.
const sqs = new SQSClient({
  region,
  endpoint,
  credentials
});

const s3 = new S3Client({
  region,
  endpoint,
  credentials,
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED"
});

// Process a single queue message.
async function processMessage(message) {
  if (!message.Body || !message.ReceiptHandle) {
    throw new Error("Invalid SQS message");
  }

  const task = JSON.parse(message.Body);

  if (
    typeof task.taskId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,80}$/.test(task.taskId)
  ) {
    throw new Error("Invalid taskId");
  }

  if (typeof task.url !== "string") {
    throw new Error("Invalid task URL");
  }

  const url = new URL(task.url);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Unsupported URL protocol");
  }

  console.log(`Processing task: ${task.taskId}`);

  // Scrape the website.
  const quotes = await scrapeQuotes(url.toString());

  if (!Array.isArray(quotes) || quotes.length === 0) {
    throw new Error("Scraper returned no quotes");
  }

  // Save the result to S3.
  const key = `results/${task.taskId}.json`;

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: JSON.stringify(quotes, null, 2),
      ContentType: "application/json; charset=utf-8"
    })
  );

  console.log(`Saved ${quotes.length} quotes to S3: ${key}`);

  // Delete the message only after successful S3 upload.
  await sqs.send(
    new DeleteMessageCommand({
      QueueUrl: queueUrl,
      ReceiptHandle: message.ReceiptHandle
    })
  );

  console.log(`Task ${task.taskId} completed`);
}

// Keep receiving tasks.
async function startWorker() {
  console.log("Worker started. Waiting for SQS messages...");

  while (true) {
    try {
      const response = await sqs.send(
        new ReceiveMessageCommand({
          QueueUrl: queueUrl,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 10
        })
      );

      for (const message of response.Messages ?? []) {
        await processMessage(message);
      }
    } catch (error) {
      console.error("Worker error:", error);

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

startWorker().catch((error) => {
  console.error("Worker stopped:", error);
  process.exitCode = 1;
});
