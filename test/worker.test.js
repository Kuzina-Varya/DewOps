import test from "node:test";
import assert from "node:assert/strict";
import { processMessage } from "../src/worker.js";

function fixture(failUpload = false) {
  const calls = [];
  return { calls, input: {
    message: { Body: JSON.stringify({ id: "job-1", url: "https://example.org" }), ReceiptHandle: "receipt" },
    queueUrl: "queue", bucket: "bucket",
    scrape: async () => [{ text: "quote", author: "author", tags: [] }],
    s3: { send: async command => { calls.push(command); if (failUpload) throw new Error("S3 unavailable"); } },
    sqs: { send: async command => calls.push(command) }
  } };
}
test("writes valid JSON before acknowledging the receipt", async () => {
  const { calls, input } = fixture();
  await processMessage(input);
  assert.deepEqual(calls.map(c => c.constructor.name), ["PutObjectCommand", "DeleteMessageCommand"]);
  assert.equal(JSON.parse(calls[0].input.Body)[0].text, "quote");
  assert.equal(calls[0].input.Key, "job-1.json");
  assert.equal(calls[1].input.ReceiptHandle, "receipt");
});
test("S3 failure leaves the message unacknowledged", async () => {
  const { calls, input } = fixture(true);
  await assert.rejects(processMessage(input), /S3 unavailable/);
  assert.equal(calls.length, 1);
});
test("scraper failure leaves the message unacknowledged", async () => {
  const { calls, input } = fixture();
  input.scrape = async () => { throw new Error("browser failed"); };
  await assert.rejects(processMessage(input), /browser failed/);
  assert.equal(calls.length, 0);
});
test("invalid jobs and empty results cannot delete messages", async () => {
  const { calls, input } = fixture();
  input.message.Body = "invalid JSON";
  await assert.rejects(processMessage(input));
  input.message.Body = JSON.stringify({ id: "id", url: "https://example.org" });
  input.scrape = async () => [];
  await assert.rejects(processMessage(input), /Empty/);
  assert.equal(calls.length, 0);
});
