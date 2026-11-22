// Server-only. Kysely over Neon's serverless Pool (WebSocket, pg-compatible, so
// transactions work). Only ever imported dynamically from inside "use server"
// bodies, so the driver never reaches the client bundle.

import { Pool } from "@neondatabase/serverless";
import { Kysely, PostgresDialect } from "kysely";
import type { DB } from "./schema";

let db: Kysely<DB> | undefined;

export function getDb(): Kysely<DB> {
  if (db) return db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set on the server. Add it to .env.");
  db = new Kysely<DB>({ dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }) });
  return db;
}
