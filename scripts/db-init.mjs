// Runs before every Railway deploy (preDeployCommand): creates or upgrades the tables.
// Building the daily summary happens in the app on first use (src/lib/db.ts ensureSchema).
// Safe to run any number of times; it never deletes data and never loads sample data.
import { readFileSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("db-init: DATABASE_URL not set, skipping");
  process.exit(0);
}
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("SELECT pg_advisory_lock(724001)");
  await client.query(readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8"));
  const { rows } = await client.query("SELECT count(*)::int AS n FROM sales_lines");
  console.log(`db-init: schema ok, ${rows[0].n} sales lines stored`);
} catch (e) {
  console.error("db-init failed:", e);
  process.exitCode = 1;
} finally {
  await client.end();
}
