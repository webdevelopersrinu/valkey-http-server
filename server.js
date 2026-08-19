import Fastify from "fastify";
import { timingSafeEqual } from "node:crypto";

/**
 * Commands that must never be reachable over HTTP — they can wipe data,
 * reconfigure, or run arbitrary code on the server.
 */
export const DEFAULT_DENY = new Set([
  "FLUSHALL",
  "FLUSHDB",
  "CONFIG",
  "DEBUG",
  "SHUTDOWN",
  "SCRIPT",
  "FUNCTION",
  "EVAL",
  "EVALSHA",
  "SLAVEOF",
  "REPLICAOF",
  "MODULE",
  "ACL",
  "SWAPDB",
  "MIGRATE",
  "RESET",
]);

function safeEqual(a, b) {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  // timingSafeEqual throws on length mismatch, so guard first.
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/**
 * Build the proxy as a Fastify instance. The Valkey client is injected so the
 * server is testable without a live database.
 *
 * @param {{ client: any, token: string, deny?: Set<string>, logger?: boolean }} opts
 *   client - an iovalkey (or compatible) instance with `.call()` and `.pipeline()`
 *   token  - bearer token required on every request
 */
export function buildServer({ client, token, deny = DEFAULT_DENY, logger = false } = {}) {
  if (!client) throw new TypeError("valkey-http-server: `client` is required");
  if (!token) throw new TypeError("valkey-http-server: `token` is required");

  const app = Fastify({ logger });
  const isBlocked = (cmd) => deny.has(String(cmd).toUpperCase());

  // Guard 1: every request must carry the correct bearer token.
  app.addHook("onRequest", async (req, reply) => {
    const header = req.headers.authorization || "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!safeEqual(provided, token)) {
      return reply.code(401).send({ error: "unauthorized" });
    }
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Single command: body is ["SET","key","value"]
  app.post("/", async (req, reply) => {
    const command = req.body;
    if (!Array.isArray(command) || command.length === 0) {
      return reply.code(400).send({ error: "body must be a non-empty JSON array" });
    }
    const [cmd, ...args] = command;
    if (isBlocked(cmd)) {
      return reply.code(403).send({ error: `command not allowed: ${cmd}` });
    }
    try {
      return { result: await client.call(cmd, ...args) };
    } catch (err) {
      return reply.code(400).send({ error: err.message });
    }
  });

  // Pipeline: body is [["SET","a","1"],["GET","a"]]
  app.post("/pipeline", async (req, reply) => {
    const commands = req.body;
    if (!Array.isArray(commands) || !commands.every(Array.isArray)) {
      return reply.code(400).send({ error: "body must be a JSON array of command arrays" });
    }
    for (const [cmd] of commands) {
      if (isBlocked(cmd)) {
        return reply.code(403).send({ error: `command not allowed: ${cmd}` });
      }
    }
    const pipe = client.pipeline();
    for (const [cmd, ...args] of commands) pipe.call(cmd, ...args);
    const out = await pipe.exec();
    return out.map(([err, result]) => ({
      result: err ? null : result,
      error: err ? err.message : null,
    }));
  });

  return app;
}
