// Server-only. Neon Postgres client.
//
// The connection string lives in `DATABASE_URL` (server secret, never exposed to
// the browser). We use the neon() HTTP driver — no pooling to manage, ideal for
// the per-request server functions in `dbServer.ts`. This module must only ever
// be reached from inside a `"use server"` function (it's imported dynamically
// there) so the driver never lands in the client bundle.
//
// The schema is assumed to already exist: migrations are applied out-of-band via
// `npm run migrate <file>.sql` (see scripts/migrate.mjs), not on the request path.

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set on the server. Add it to .env.");
}

const sql = neon(databaseUrl);

export function getSql(): typeof sql {
  return sql;
}
