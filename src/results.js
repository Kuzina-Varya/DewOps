import { open, readFile, readdir, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export function validateJob(job) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(job.job_id ?? "")) throw new Error("Invalid job_id");
  const url = new URL(job.url);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Unsupported URL");
}

export function validateQuotes(quotes) {
  if (!Array.isArray(quotes) || !quotes.length || !quotes.every(q => q.text && q.author)) {
    throw new Error("Expected a nonempty array of quotes");
  }
  return quotes;
}

// One worker per deployment. A valid existing result is immutable on redelivery.
export async function saveResult(job, directory, scrape) {
  validateJob(job);
  const destination = join(directory, `${job.job_id}.json`);
  try {
    validateQuotes(JSON.parse(await readFile(destination, "utf8")));
    return destination;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const quotes = validateQuotes(await scrape(job.url));
  const temporary = join(directory, `.${job.job_id}.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o644);
    try {
      await file.writeFile(`${JSON.stringify(quotes, null, 2)}\n`);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, destination);
    const parent = await open(directory, "r");
    try { await parent.sync(); } finally { await parent.close(); }
    return destination;
  } finally {
    await rm(temporary, { force: true });
  }
}

export async function removeInterruptedWrites(directory) {
  // Safe at startup because the Compose deployment has exactly one worker.
  for (const name of await readdir(directory)) {
    if (/^\.[a-zA-Z0-9_-]+\.[a-f0-9-]+\.tmp$/.test(name)) {
      await rm(join(directory, name), { force: true });
    }
  }
}

export async function processJob({ job, id, redis, directory, scrape, beforeAck = async () => {} }) {
  await saveResult(job, directory, scrape);
  await beforeAck(job);
  await redis.sendCommand(["XACK", "jobs", "scrapers", id]);
}
