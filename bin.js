#!/usr/bin/env node
import Valkey from "iovalkey";
import { buildServer } from "./server.js";

const token = process.env.TOKEN;
if (!token) {
  console.error("valkey-http-server: TOKEN environment variable is required");
  process.exit(1);
}

const client = new Valkey(process.env.VALKEY_URL || "redis://localhost:6379");
const port = Number(process.env.PORT || 8080);

const app = buildServer({ client, token, logger: true });

app
  .listen({ port, host: "0.0.0.0" })
  .then(() => console.log(`valkey-http-server listening on :${port}`))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
