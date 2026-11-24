import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";

test("job command exits within its deadline when Redis accepts TCP but never replies", { timeout: 5000 }, async t => {
  const sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on("error", () => {});
    socket.on("close", () => sockets.delete(socket));
  });
  t.after(() => {
    for (const socket of sockets) socket.destroy();
    server.close();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const child = spawn(process.execPath, ["src/jobctl.js", "pending"], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, REDIS_URL: `redis://127.0.0.1:${server.address().port}`, JOBCTL_TIMEOUT_MS: "500" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  let errors = "";
  child.stderr.on("data", data => { errors += data; });
  const started = Date.now();
  const [code] = await once(child, "exit");
  assert.equal(code, 1);
  assert.match(errors, /Job command timed out after 500 ms/);
  assert.ok(Date.now() - started < 4000, "must not reconnect or wait forever");
});
