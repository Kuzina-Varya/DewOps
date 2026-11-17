import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { ListQueuesCommand, SendMessageCommand, GetQueueAttributesCommand } from "@aws-sdk/client-sqs";
import { GetObjectCommand } from "@aws-sdk/client-s3";
import { clients } from "./aws.js";

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const { s3, sqs } = clients();
async function resources() { return JSON.parse(await readFile("out/resources.json", "utf8")); }
async function main() {
  switch (process.argv[2]) {
    case "wait": {
      for (let i = 0; i < 60; i++) {
        try { await sqs.send(new ListQueuesCommand({})); return; }
        catch { await delay(1000); }
      }
      throw new Error("Floci did not become ready");
    }
    case "configure": {
      const outputs = JSON.parse(await readFile("/infra/outputs.json", "utf8"));
      const config = { bucket: outputs.bucket_name.value, queueUrl: outputs.queue_url.value };
      await mkdir("out", { recursive: true });
      await writeFile("out/resources.json", JSON.stringify(config));
      await writeFile("out/resources.env", "S3_BUCKET=" + config.bucket + "\nSQS_QUEUE_URL=" + config.queueUrl + "\n");
      return;
    }
    case "run": {
      const { bucket, queueUrl } = await resources();
      const id = randomUUID();
      await sqs.send(new SendMessageCommand({ QueueUrl: queueUrl,
        MessageBody: JSON.stringify({ id, url: process.env.SCRAPE_URL || "https://quotes.toscrape.com/scroll" }) }));
      const deadline = Date.now() + 240000;
      let result;
      while (Date.now() < deadline) {
        try {
          const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: id + ".json" }));
          result = JSON.parse(await response.Body.transformToString());
        } catch (error) {
          if (error.name !== "NoSuchKey" && error.$metadata?.httpStatusCode !== 404) throw error;
        }
        if (result) {
          if (!Array.isArray(result) || !result.length || !result.every(q => q.text && q.author)) {
            throw new Error("Result must contain nonempty quotes");
          }
          const { Attributes } = await sqs.send(new GetQueueAttributesCommand({ QueueUrl: queueUrl,
            AttributeNames: ["ApproximateNumberOfMessages", "ApproximateNumberOfMessagesNotVisible", "ApproximateNumberOfMessagesDelayed"] }));
          if (Object.values(Attributes).every(value => value === "0")) {
            await writeFile("out/result.json", JSON.stringify(result, null, 2) + "\n");
            console.log("Verified", id + ".json", result.length, "quotes; queue is empty");
            return;
          }
        }
        await delay(2000);
      }
      throw new Error("Timed out waiting for S3 result and empty queue");
    }
    case "clean":
      for (const name of await readdir("out")) {
        await rm("out/" + name, { recursive: true, force: true });
      }
      await mkdir("out", { recursive: true });
      return;
    default: throw new Error("Expected wait, configure, run or clean");
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
