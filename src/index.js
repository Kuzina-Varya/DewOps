import { ReceiveMessageCommand } from "@aws-sdk/client-sqs";
import { clients } from "./aws.js";
import { scrapeQuotes } from "./scraper.js";
import { processMessage } from "./worker.js";

const queueUrl = process.env.SQS_QUEUE_URL;
const bucket = process.env.S3_BUCKET;
if (!queueUrl || !bucket) throw new Error("SQS_QUEUE_URL and S3_BUCKET are required");
const { s3, sqs } = clients();
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
while (!stopping) {
  try {
    const { Messages = [] } = await sqs.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 10, VisibilityTimeout: 180
    }));
    for (const message of Messages) {
      try {
        await processMessage({ message, queueUrl, bucket, s3, sqs, scrape: scrapeQuotes });
      } catch (error) {
        console.error("Job failed; message retained for retry:", error);
      }
    }
  } catch (error) {
    console.error("Receive failed:", error);
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}
