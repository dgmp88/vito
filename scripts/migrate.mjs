// Apply a single SQL migration to the Neon database.
//
//   npm run migrate 20260704_120000_initial_schema.sql
//
// Reads the named file from /migrations and runs it. Migrations are applied
// out-of-band with this script rather than on the request path — the app assumes
// the schema already exists. Keep the SQL idempotent (CREATE TABLE IF NOT EXISTS,
// etc.) since there's no tracking of what's been run.
//
// DATABASE_URL is loaded from .env via `node --env-file` (see package.json).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Client } from "@neondatabase/serverless";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: npm run migrate <file>.sql  (name of a file in /migrations)");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env.");
  process.exit(1);
}

// Accept either a bare filename or a path; we only care about the basename.
const name = arg.split("/").pop();
const path = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations", name);
const script = readFileSync(path, "utf8");

const client = new Client(process.env.DATABASE_URL);
await client.connect();
await client.query(script);
await client.end();

console.log(`Applied: ${name}`);
