import { test } from "node:test";
import assert from "node:assert";
import { buildServer } from "../server.js";

/** In-memory fake with the bits of the iovalkey surface the proxy uses. */
function fakeClient() {
  const store = new Map();
  const run = async (cmd, ...args) => {
    switch (String(cmd).toUpperCase()) {
      case "SET": store.set(args[0], String(args[1])); return "OK";
      case "GET": return store.has(args[0]) ? store.get(args[0]) : null;
      case "INCR": {
        const n = (Number(store.get(args[0])) || 0) + 1;
        store.set(args[0], String(n));
        return n;
      }
      default: throw new Error(`unknown command ${cmd}`);
    }
  };
  return {
    call: run,
    pipeline() {
      const ops = [];
      return {
        call(cmd, ...args) { ops.push([cmd, args]); return this; },
        async exec() {
          const out = [];
          for (const [cmd, args] of ops) {
            try { out.push([null, await run(cmd, ...args)]); }
            catch (e) { out.push([e, null]); }
          }
          return out;
        },
      };
    },
  };
}

const TOKEN = "test-secret";
const authed = (payload, url = "/") => ({
  method: "POST",
  url,
  headers: { authorization: `Bearer ${TOKEN}` },
  payload,
});
const make = () => buildServer({ client: fakeClient(), token: TOKEN });

test("buildServer requires client and token", () => {
  assert.throws(() => buildServer({ token: TOKEN }), /client` is required/);
  assert.throws(() => buildServer({ client: fakeClient() }), /token` is required/);
});

test("rejects a request with no token", async () => {
  const res = await make().inject({ method: "POST", url: "/", payload: ["GET", "x"] });
  assert.strictEqual(res.statusCode, 401);
});

test("rejects a request with a wrong token", async () => {
  const res = await make().inject({
    method: "POST", url: "/",
    headers: { authorization: "Bearer nope" },
    payload: ["GET", "x"],
  });
  assert.strictEqual(res.statusCode, 401);
});

test("runs an allowed command end-to-end", async () => {
  const app = make();
  await app.inject(authed(["SET", "x", "1"]));
  const res = await app.inject(authed(["INCR", "x"]));
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().result, 2);
});

test("blocks a denylisted command", async () => {
  const res = await make().inject(authed(["FLUSHALL"]));
  assert.strictEqual(res.statusCode, 403);
  assert.match(res.json().error, /not allowed/);
});

test("blocks denylist case-insensitively", async () => {
  const res = await make().inject(authed(["config", "SET", "x", "1"]));
  assert.strictEqual(res.statusCode, 403);
});

test("rejects a non-array body", async () => {
  const res = await make().inject(authed({ cmd: "GET" }));
  assert.strictEqual(res.statusCode, 400);
});

test("pipeline runs a batch", async () => {
  const res = await make().inject(authed([["SET", "a", "x"], ["GET", "a"]], "/pipeline"));
  assert.strictEqual(res.statusCode, 200);
  const body = res.json();
  assert.strictEqual(body[1].result, "x");
});

test("pipeline blocks a denylisted command in the batch", async () => {
  const res = await make().inject(authed([["GET", "a"], ["FLUSHALL"]], "/pipeline"));
  assert.strictEqual(res.statusCode, 403);
});

test("health check needs no work but still needs auth", async () => {
  const res = await make().inject({
    method: "GET", url: "/health",
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.json().status, "ok");
});
