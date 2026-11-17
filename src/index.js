import { createClient } from "redis";
import { access, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import { scrapeQuotes } from "./scraper.js";
import { processJob, removeInterruptedWrites } from "./results.js";

const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", error => console.error("Redis:", error.message));
const directory = process.env.RESULTS_DIR || "/app/results";
const control = process.env.CONTROL_DIR || "/app/control";
const idle = Number(process.env.CLAIM_IDLE_MS || 15000);
const consumer = hostname() + "-" + randomUUID();
let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function exists(path) {
  try { await access(path); return true; }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
// A local, root-controlled test gate; never enabled by a job or an HTTP endpoint.
async function beforeAck(job) {
  const gate = join(control, "fault-" + job.job_id + ".armed");
  if (await exists(gate)) {
    await writeFile(join(control, "fault-" + job.job_id + ".ready"), "saved-before-ack\n");
    while (await exists(gate)) {
      if (stopping) throw new Error("Stopped at fault gate; message remains pending");
      await delay(100);
    }
  }
}
async function handle([id, fields]) {
  const job = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, i) => fields.slice(i * 2, i * 2 + 2)));
  // Renew the PEL idle clock during a long browser operation or the fault-test gate.
  const heartbeat = setInterval(() => {
    redis.sendCommand(["XCLAIM", "jobs", "scrapers", consumer, "0", id, "JUSTID"])
      .catch(error => console.error("Heartbeat:", error.message));
  }, Math.max(1000, Math.floor(idle / 3)));
  try {
    await processJob({ job, id, redis, directory, scrape: scrapeQuotes, beforeAck });
    console.log("Completed", job.job_id, id);
  } catch (error) {
    console.error("Retained pending message", id, error);
  } finally {
    clearInterval(heartbeat);
  }
}
async function main() {
  await redis.connect();
  try {
    await redis.sendCommand(["XGROUP", "CREATE", "jobs", "scrapers", "0", "MKSTREAM"]);
  } catch (error) { if (!error.message.includes("BUSYGROUP")) throw error; }
  await removeInterruptedWrites(directory);
  let cursor = "0-0";
  console.log("Worker ready", consumer);
  while (!stopping) {
    try {
      const claimed = await redis.sendCommand(["XAUTOCLAIM", "jobs", "scrapers", consumer, String(idle), cursor, "COUNT", "1"]);
      cursor = claimed[0];
      if (claimed[1].length) {
        for (const message of claimed[1]) await handle(message);
        continue;
      }
      const streams = await redis.sendCommand(["XREADGROUP", "GROUP", "scrapers", consumer, "COUNT", "1", "BLOCK", "2000", "STREAMS", "jobs", ">"]);
      for (const [, messages] of streams || []) for (const message of messages) await handle(message);
    } catch (error) {
      console.error("Stream error:", error.message);
      await delay(1000);
    }
  }
  await redis.quit();
}
main().catch(error => { console.error(error); process.exitCode = 1; redis.destroy(); });
