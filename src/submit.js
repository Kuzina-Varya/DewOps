
import { randomUUID } from "node:crypto";

import {
  SQSClient,
  SendMessageCommand
} from "@aws-sdk/client-sqs";

import {
  S3Client,
  GetObjectCommand
} from "@aws-sdk/client-s3";

function requiredEnv(name) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

const config = {
  region: requiredEnv("AWS_REGION"),
  endpoint: requiredEnv("AWS_ENDPOINT"),
  credentials: {
    accessKeyId: requiredEnv("AWS_ACCESS_KEY_ID"),
    secretAccessKey: requiredEnv("AWS_SECRET_ACCESS_KEY")
  }
};

const sqs = new SQSClient(config);

const s3 = new S3Client({
  ...config,
  forcePathStyle: true
});

const queueUrl = requiredEnv("SQS_QUEUE_URL");
const bucket = requiredEnv("S3_BUCKET");

const sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const taskId = randomUUID();
  const url = "https://quotes.toscrape.com/scroll";
  const key = `results/${taskId}.json`;

  // Send exactly one task.
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ taskId, url })
    })
  );

  console.log(`Task sent to SQS: ${taskId}`);

  // Wait for the scraper to save its result.
  const deadline = Date.now() + 180_000;

  while (Date.now() < deadline) {
    try {
      const response = await s3.send(
        new GetObjectCommand({
          Bucket: bucket,
          Key: key
        })
      );

      const content = await response.Body.transformToString();
      const quotes = JSON.parse(content);

      if (!Array.isArray(quotes) || quotes.length === 0) {
        throw new Error("S3 contains an empty or invalid result");
      }

      console.log(`Valid JSON found in S3: ${key}`);
      console.log(`Quotes collected: ${quotes.length}`);
      return;
    } catch (error) {
      if (error?.$metadata?.httpStatusCode !== 404) {
        throw error;
      }
    }

    await sleep(2000);
  }

  throw new Error(`Task ${taskId} timed out`);
}

main()
  .catch((error) => {
    console.error("Task verification failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    sqs.destroy();
    s3.destroy();
  });
