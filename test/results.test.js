import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { processJob, removeInterruptedWrites } from "../src/results.js";

const quotes = [{ text: "A quote", author: "Author", tags: [] }];
async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), "quotes-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const commands = [];
  const input = { job: { job_id: "abc", url: "https://example.org" }, id: "1-0", directory,
    redis: { sendCommand: async args => {
      assert.deepEqual(JSON.parse(await readFile(join(directory, "abc.json"))), quotes);
      assert.deepEqual(await readdir(directory), ["abc.json"]);
      commands.push(args);
    } }, scrape: async () => quotes };
  return { input, commands };
}
test("acknowledges only a valid, completely written result without a temporary file", async t => {
  const { input, commands } = await fixture(t);
  await processJob(input);
  assert.deepEqual(commands, [["XACK", "jobs", "scrapers", "1-0"]]);
});
test("redelivery preserves original bytes and inode without scraping again", async t => {
  const { input } = await fixture(t);
  await processJob(input);
  const before = await stat(join(input.directory, "abc.json"));
  input.scrape = async () => { throw new Error("must not scrape a completed job"); };
  await processJob(input);
  const after = await stat(join(input.directory, "abc.json"));
  assert.equal(before.ino, after.ino);
  assert.equal(before.mtimeMs, after.mtimeMs);
});
test("browser failure and invalid results leave the entry pending", async t => {
  const { input, commands } = await fixture(t);
  input.scrape = async () => { throw new Error("browser failed"); };
  await assert.rejects(processJob(input), /browser failed/);
  input.scrape = async () => [];
  await assert.rejects(processJob(input), /nonempty/);
  assert.deepEqual(commands, []);
  assert.deepEqual(await readdir(input.directory), []);
});
test("disk failure cannot acknowledge a message", async t => {
  const { input, commands } = await fixture(t);
  input.directory = join(input.directory, "missing");
  await assert.rejects(processJob(input), /ENOENT/);
  assert.deepEqual(commands, []);
});
test("interruption after rename leaves a result but no acknowledgement", async t => {
  const { input, commands } = await fixture(t);
  input.beforeAck = async () => { throw new Error("crashed before ack"); };
  await assert.rejects(processJob(input), /crashed/);
  assert.deepEqual(commands, []);
  assert.deepEqual(JSON.parse(await readFile(join(input.directory, "abc.json"))), quotes);
  input.beforeAck = async () => {};
  await processJob(input);
  assert.equal(commands.length, 1);
});
test("invalid identifiers cannot escape the results directory", async t => {
  const { input, commands } = await fixture(t);
  input.job.job_id = "../escape";
  await assert.rejects(processJob(input), /job_id/);
  assert.deepEqual(commands, []);
});
test("startup removes interrupted temporary writes and keeps completed JSON", async t => {
  const { input } = await fixture(t);
  await writeFile(join(input.directory, ".abc.1234-abcd.tmp"), "partial");
  await writeFile(join(input.directory, "abc.json"), JSON.stringify(quotes));
  await removeInterruptedWrites(input.directory);
  assert.deepEqual(await readdir(input.directory), ["abc.json"]);
});
