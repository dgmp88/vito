// Server-only. Neon Postgres client plus a small migration runner.
//
// The connection string lives in `DATABASE_URL` (server secret, never exposed to
// the browser). We use the neon() HTTP driver — no pooling to manage, ideal for
// the per-request server functions in `dbServer.ts`. This module must only ever
// be reached from inside a `"use server"` function (it's imported dynamically
// there) so the driver never lands in the client bundle.

import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let sql: Sql | undefined;

export function getSql(): Sql {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set on the server. Add it to .env.");
    }
    sql = neon(url);
  }
  return sql;
}

// SQL files in /migrations, inlined at build time and keyed by path. Sorting by
// the `{date}_{time}_{name}.sql` filename gives chronological apply order.
const migrationScripts = import.meta.glob("../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

// Run pending migrations once per server process. On failure we clear the cached
// promise so a later request can retry rather than being stuck with a rejection.
let migrated: Promise<void> | undefined;

export function runMigrations(): Promise<void> {
  if (!migrated) {
    migrated = migrate().catch(error => {
      migrated = undefined;
      throw error;
    });
  }
  return migrated;
}

async function migrate(): Promise<void> {
  const sql = getSql();

  // Track which migrations have run so each applies exactly once.
  await sql`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  const rows = (await sql`SELECT name FROM schema_migrations`) as { name: string }[];
  const applied = new Set(rows.map(row => row.name));

  const pending = Object.entries(migrationScripts)
    .map(([path, script]) => ({ name: path.split("/").pop()!, script }))
    .filter(migration => !applied.has(migration.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const { name, script } of pending) {
    const statements = splitStatements(script);
    // Each migration runs as one transaction: all its statements plus the record
    // of having applied it commit together, so a failure never half-applies.
    await sql.transaction(txn => [
      ...statements.map(statement => txn.query(statement)),
      txn`INSERT INTO schema_migrations (name) VALUES (${name})`,
    ]);
  }
}

/**
 * Split a migration file into individual statements. The neon HTTP driver runs
 * one command per query, so we strip line comments and split on semicolons —
 * fine for our DDL, which has no semicolons inside statement bodies.
 */
function splitStatements(script: string): string[] {
  return script
    .split("\n")
    .filter(line => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map(statement => statement.trim())
    .filter(Boolean);
}
