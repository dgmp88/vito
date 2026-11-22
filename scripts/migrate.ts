// Applies Kysely migrations from ../migrations to DATABASE_URL.
//
//   npm run db:migrate          # migrate to latest, then regenerate types
//   npm run db:migrate -- down  # roll back the most recent migration
//
// Runs directly under Node's built-in TypeScript type stripping (Node 22.18+).

import { promises as fs } from "node:fs";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";
import { FileMigrationProvider, Kysely, Migrator, PostgresDialect } from "kysely";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL is not set. Add it to .env.");
  process.exit(1);
}

const db = new Kysely<unknown>({
  dialect: new PostgresDialect({ pool: new Pool({ connectionString }) }),
});

const migrator = new Migrator({
  db,
  provider: new FileMigrationProvider({
    fs,
    path,
    migrationFolder: path.join(import.meta.dirname, "../migrations"),
  }),
});

const direction = process.argv[2] === "down" ? "down" : "latest";
const { error, results } =
  direction === "down" ? await migrator.migrateDown() : await migrator.migrateToLatest();

for (const result of results ?? []) {
  const verb = result.direction === "Up" ? "applied" : "rolled back";
  if (result.status === "Success") console.log(`${verb} ${result.migrationName}`);
  else if (result.status === "Error") console.error(`failed ${result.migrationName}`);
}
if (results?.length === 0) console.log("already up to date");

await db.destroy();

if (error) {
  console.error(error);
  process.exit(1);
}
