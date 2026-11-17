import { createClient } from "redis";
import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { validateJob, validateQuotes } from "./results.js";

const redis = createClient({ url: process.env.REDIS_URL });
redis.on("error", error => console.error(error.message));
const [command, job_id, url] = process.argv.slice(2);
async function fingerprint() {
  validateJob({ job_id, url: "https://example.org" });
  const directory = process.env.RESULTS_DIR || "/app/results";
  const path = join(directory, `${job_id}.json`);
  const data = await readFile(path);
  validateQuotes(JSON.parse(data));
  const info = await stat(path);
  const temporary = (await readdir(directory)).filter(name => name.startsWith(`.${job_id}.`) && name.endsWith(".tmp"));
  if (temporary.length) throw new Error("Temporary result remains");
  return { job_id, sha256: createHash("sha256").update(data).digest("hex"), inode: info.ino, size: info.size, data };
}
async function groupLag() {
  const groups = await redis.sendCommand(["XINFO", "GROUPS", "jobs"]);
  for (const fields of groups) {
    const group = Object.fromEntries(Array.from({ length: fields.length / 2 }, (_, i) => fields.slice(i * 2, i * 2 + 2)));
    if (group.name === "scrapers") return group.lag;
  }
  throw new Error("Consumer group missing");
}
async function main() {
  await redis.connect();
  switch (command) {
    case "submit": {
      validateJob({ job_id, url });
      const stream_id = await redis.sendCommand(["XADD", "jobs", "*", "job_id", job_id, "url", url]);
      return { job_id, stream_id };
    }
    case "pending": {
      const summary = await redis.sendCommand(["XPENDING", "jobs", "scrapers"]);
      const entries = await redis.sendCommand(["XPENDING", "jobs", "scrapers", "-", "+", "100"]);
      return { count: summary[0], entries, lag: await groupLag() };
    }
    case "fingerprint": {
      const { data, ...result } = await fingerprint();
      return result;
    }
    case "verify": {
      const { data, ...result } = await fingerprint();
      const pending = await redis.sendCommand(["XPENDING", "jobs", "scrapers"]);
      if (pending[0] !== 0 || await groupLag() !== 0) throw new Error("Pending or undelivered jobs remain");
      const response = await fetch(`http://nginx/results/${job_id}.json`, { signal: AbortSignal.timeout(3000) });
      if (!response.ok || !data.equals(Buffer.from(await response.arrayBuffer()))) {
        throw new Error("HTTP result differs from the on-disk result");
      }
      return { ...result, pending: pending[0], http_status: response.status };
    }
    default: throw new Error("Expected submit, pending, fingerprint or verify");
  }
}
try { console.log(JSON.stringify(await main())); }
catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (redis.isOpen) await redis.quit(); }
