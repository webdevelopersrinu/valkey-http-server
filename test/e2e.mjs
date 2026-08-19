// Live end-to-end: real proxy + real iovalkey + real Valkey + the real HTTP client.
// Run Valkey on :6379 first, then: node test/e2e.mjs
import assert from "node:assert";
import Valkey from "iovalkey";
import { buildServer } from "../server.js";
import { Valkey as HttpClient } from "../../valkey-http/index.js";

const TOKEN = "e2e-secret";
const backend = new Valkey("redis://localhost:6379");
const app = buildServer({ client: backend, token: TOKEN });

await app.listen({ port: 8099, host: "127.0.0.1" });
const valkey = new HttpClient({ url: "http://127.0.0.1:8099", token: TOKEN });

try {
  await valkey.del("e2e:hits");
  await valkey.set("e2e:hits", 1);
  assert.strictEqual(await valkey.incr("e2e:hits"), 2, "incr over HTTP");
  assert.strictEqual(await valkey.get("e2e:hits"), "2", "get over HTTP");

  const pipe = await valkey.pipeline([["SET", "e2e:a", "x"], ["GET", "e2e:a"]]);
  assert.strictEqual(pipe[1].result, "x", "pipeline over HTTP");

  let blocked = false;
  try { await valkey.call("FLUSHALL"); } catch { blocked = true; }
  assert.ok(blocked, "FLUSHALL must be blocked by the proxy");

  const bad = await fetch("http://127.0.0.1:8099/", {
    method: "POST",
    headers: { authorization: "Bearer wrong", "content-type": "application/json" },
    body: JSON.stringify(["GET", "e2e:hits"]),
  });
  assert.strictEqual(bad.status, 401, "bad token must be rejected");

  await valkey.del("e2e:hits", "e2e:a");
  console.log("E2E PASSED ✅  real Valkey round-trip, pipeline, denylist, auth");
} finally {
  await app.close();
  backend.disconnect();
}
