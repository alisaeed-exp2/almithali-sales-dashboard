// Server-only database access (PostgreSQL on Railway). Never import this from a client component.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Pool, type PoolClient } from "pg";
import type { SaleRow } from "./sale-rows";
import { deriveProduct } from "./normalize";

const g = globalThis as unknown as { __amPool?: Pool; __amSchema?: Promise<void>; __amDataVersion?: number };

export function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!g.__amPool) g.__amPool = new Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 });
  return g.__amPool;
}

export function requirePool(): Pool {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not set");
  return p;
}

/** Bumped after every upload so cached look-ups (filter values) refresh. */
export const dataVersion = () => g.__amDataVersion ?? 0;
const bumpDataVersion = () => (g.__amDataVersion = dataVersion() + 1);

const sqlFile = (name: string) => readFileSync(path.join(process.cwd(), "db", name), "utf8");
let upsertSql: string | undefined;
const UPSERT = () => (upsertSql ??= sqlFile("upsert.sql"));

const columns = (b: SaleRow[]) => [
  b.map((r) => r.line_key),
  b.map((r) => r.journal_entry),
  b.map((r) => r.invoice_date),
  b.map((r) => r.partner),
  b.map((r) => r.product),
  b.map((r) => r.quantity),
  b.map((r) => r.unit_price),
  b.map((r) => r.subtotal),
  b.map((r) => r.total),
  b.map((r) => r.reference),
  b.map((r) => r.partner_city),
];
// Appended after the upload id ($12) as $13 and $14.
const extraColumns = (b: SaleRow[]) => [b.map((r) => r.invoice_type), b.map((r) => r.product_category)];

type Q = Pick<PoolClient, "query">;

/**
 * Add or refresh product attributes. The category comes from the export's "Product Category" when a file supplied one
 * (the most recent upload wins); a product never given one gets the category derived from its code.
 * `fileCategory` maps product → category from the file ("" or absent = not supplied).
 */
async function upsertProducts(db: Q, products: string[], fileCategory: Map<string, string> = new Map()) {
  const list = [...new Set(products)];
  if (!list.length) return;
  const info = list.map((p) => {
    const d = deriveProduct(p);
    const fc = fileCategory.get(p) ?? "";
    return { product: p, code: d.code, name: d.name, category: fc || d.category, brand: d.brand, source: fc ? "file" : "code" };
  });
  await db.query(
    `INSERT INTO products (product, code, name, category, brand, category_source)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
     ON CONFLICT (product) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, brand = EXCLUDED.brand,
       category = CASE WHEN EXCLUDED.category_source = 'file' OR products.category_source <> 'file' THEN EXCLUDED.category ELSE products.category END,
       category_source = CASE WHEN EXCLUDED.category_source = 'file' THEN 'file' ELSE products.category_source END
     WHERE (products.code, products.name, products.brand) IS DISTINCT FROM (EXCLUDED.code, EXCLUDED.name, EXCLUDED.brand)
        OR (EXCLUDED.category_source = 'file' AND (products.category, products.category_source) IS DISTINCT FROM (EXCLUDED.category, 'file'))
        OR (products.category_source <> 'file' AND products.category IS DISTINCT FROM EXCLUDED.category)`,
    [info.map((i) => i.product), info.map((i) => i.code), info.map((i) => i.name), info.map((i) => i.category), info.map((i) => i.brand), info.map((i) => i.source)],
  );
}

/**
 * Rebuild the daily summary and the invoices of the given days from sales_lines (derived data, safe to replace),
 * and queue their months for the monthly roll-up.
 */
export async function refreshDays(db: Q, days: string[], entries: string[] = []) {
  if (!days.length) return;
  const sorted = [...new Set(days)].sort();
  const args = [sorted, sorted[0], sorted[sorted.length - 1]];
  const inDays = `invoice_date BETWEEN $2::date AND $3::date AND invoice_date = ANY($1::date[])`;
  await db.query(`DELETE FROM daily_summary WHERE day = ANY($1::date[])`, [sorted]);
  await db.query(`DELETE FROM invoices WHERE invoice_date = ANY($1::date[]) OR journal_entry = ANY($2::text[])`, [sorted, entries]);
  await db.query(
    `INSERT INTO daily_summary (day, channel, route, partner, city, product, unit_price, lines, qty, net, gross)
     SELECT invoice_date, am_channel(reference, invoice_type), am_route(reference), partner, am_city(partner_city), product, unit_price,
            count(*), sum(quantity), sum(subtotal), sum(total)
       FROM sales_lines WHERE ${inDays}
      GROUP BY 1, 2, 3, 4, 5, 6, 7`,
    args,
  );
  // An invoice belongs to one day, so every invoice of these days was just deleted and is rebuilt whole.
  await db.query(
    `INSERT INTO invoices (journal_entry, invoice_date, reference, partner, city, channel, route, lines, qty, net, gross)
     SELECT journal_entry, max(invoice_date), max(reference), max(partner), max(am_city(partner_city)),
            am_channel(max(reference), max(invoice_type)), am_route(max(reference)), count(*), sum(quantity), sum(subtotal), sum(total)
       FROM sales_lines WHERE ${inDays}
      GROUP BY journal_entry
     ON CONFLICT (journal_entry) DO UPDATE SET invoice_date = EXCLUDED.invoice_date, reference = EXCLUDED.reference, partner = EXCLUDED.partner,
       city = EXCLUDED.city, channel = EXCLUDED.channel, route = EXCLUDED.route, lines = EXCLUDED.lines,
       qty = EXCLUDED.qty, net = EXCLUDED.net, gross = EXCLUDED.gross`,
    args,
  );
  await db.query(
    `INSERT INTO dirty_months (month) SELECT DISTINCT date_trunc('month', d)::date FROM unnest($1::date[]) d ON CONFLICT DO NOTHING`,
    [sorted],
  );
}

/** Rebuild the monthly roll-up for the given months from daily_summary. */
async function refreshMonths(db: Q, months: string[]) {
  if (!months.length) return;
  await db.query(`DELETE FROM monthly_summary WHERE month = ANY($1::date[])`, [months]);
  await db.query(
    `INSERT INTO monthly_summary (month, channel, route, partner, city, product, unit_price, lines, qty, net, gross, first_day, last_day)
     SELECT date_trunc('month', day)::date, channel, route, partner, city, product, unit_price,
            sum(lines), sum(qty), sum(net), sum(gross), min(day), max(day)
       FROM daily_summary
      WHERE day >= (SELECT min(m) FROM unnest($1::date[]) m) AND day < (SELECT max(m) FROM unnest($1::date[]) m) + interval '1 month'
        AND date_trunc('month', day)::date = ANY($1::date[])
      GROUP BY 1, 2, 3, 4, 5, 6, 7`,
    [months],
  );
  await db.query(`DELETE FROM dirty_months WHERE month = ANY($1::date[])`, [months]);
}

/** Bring the monthly roll-up up to date for every month an upload touched. Cheap when nothing is pending. */
export async function refreshDirtyMonths(): Promise<number> {
  const pool = requirePool();
  const pending = await pool.query(`SELECT EXISTS (SELECT 1 FROM dirty_months) AS any`);
  if (!pending.rows[0].any) return 0;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(724002)"); // never alongside an upload batch
    const { rows } = await client.query(`SELECT month::text AS m FROM dirty_months ORDER BY 1`);
    await refreshMonths(client, rows.map((r) => r.m as string));
    await client.query("COMMIT");
    if (rows.length) bumpDataVersion();
    return rows.length;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Rebuild every derived table in one pass each: daily summary and invoices from sales_lines, then the monthly roll-up
 * from the daily summary. Callers truncate the derived tables first (inside the same transaction).
 */
async function refreshAll(db: Q) {
  await db.query(
    `INSERT INTO daily_summary (day, channel, route, partner, city, product, unit_price, lines, qty, net, gross)
     SELECT invoice_date, am_channel(reference, invoice_type), am_route(reference), partner, am_city(partner_city), product, unit_price,
            count(*), sum(quantity), sum(subtotal), sum(total)
       FROM sales_lines GROUP BY 1, 2, 3, 4, 5, 6, 7`,
  );
  await db.query(
    `INSERT INTO invoices (journal_entry, invoice_date, reference, partner, city, channel, route, lines, qty, net, gross)
     SELECT journal_entry, max(invoice_date), max(reference), max(partner), max(am_city(partner_city)),
            am_channel(max(reference), max(invoice_type)), am_route(max(reference)), count(*), sum(quantity), sum(subtotal), sum(total)
       FROM sales_lines GROUP BY journal_entry`,
  );
  await db.query(
    `INSERT INTO monthly_summary (month, channel, route, partner, city, product, unit_price, lines, qty, net, gross, first_day, last_day)
     SELECT date_trunc('month', day)::date, channel, route, partner, city, product, unit_price,
            sum(lines), sum(qty), sum(net), sum(gross), min(day), max(day)
       FROM daily_summary GROUP BY 1, 2, 3, 4, 5, 6, 7`,
  );
  await db.query(`DELETE FROM dirty_months`);
  const p = await db.query(
    `SELECT product, (array_agg(product_category ORDER BY invoice_date DESC, updated_at DESC) FILTER (WHERE product_category <> ''))[1] AS category
       FROM sales_lines GROUP BY product`,
  );
  await db.query(`UPDATE products SET category_source = 'code'`); // re-decided below from the stored lines
  await upsertProducts(db, p.rows.map((r) => r.product as string), new Map(p.rows.filter((r) => r.category).map((r) => [r.product as string, r.category as string])));
}

/**
 * Upsert one batch of lines and refresh the summaries for every day it touches
 * (including the old day of a line whose invoice date changed). Returns counts for this batch.
 */
async function writeBatch(db: Q, rows: SaleRow[], uploadId: number) {
  const keys = rows.map((r) => r.line_key);
  const before = await db.query(`SELECT DISTINCT invoice_date::text AS d FROM sales_lines WHERE line_key = ANY($1::text[])`, [keys]);
  const res = await db.query(UPSERT(), [...columns(rows), uploadId, ...extraColumns(rows)]);
  const days = new Set<string>(before.rows.map((r) => r.d as string));
  rows.forEach((r) => days.add(r.invoice_date));
  await refreshDays(db, [...days], [...new Set(rows.map((r) => r.journal_entry))]);
  await upsertProducts(db, rows.map((r) => r.product), new Map(rows.filter((r) => r.product_category).map((r) => [r.product, r.product_category])));
  return { inserted: res.rows[0].inserted as number, updated: res.rows[0].updated as number };
}

/**
 * Creates or upgrades the tables and builds the summaries when they are missing.
 * Runs once per server process (and before each deploy); never deletes sales lines, never loads sample data.
 */
export function ensureSchema(): Promise<void> {
  if (!g.__amSchema) {
    g.__amSchema = (async () => {
      const pool = getPool();
      if (!pool) return;
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(724001)"); // one initialiser at a time
        await client.query(sqlFile("schema.sql"));
        // Build the derived tables if lines exist but any of them is empty (first deploy, or a new table added).
        const s = await client.query(
          `SELECT EXISTS (SELECT 1 FROM sales_lines) AS lines, EXISTS (SELECT 1 FROM daily_summary) AS daily,
                  EXISTS (SELECT 1 FROM monthly_summary) AS monthly, EXISTS (SELECT 1 FROM invoices) AS inv`,
        );
        const r = s.rows[0];
        if (r.lines && (!r.daily || !r.monthly || !r.inv)) {
          await client.query("SELECT pg_advisory_xact_lock(724002)");
          await client.query("TRUNCATE daily_summary, monthly_summary, invoices, dirty_months");
          await refreshAll(client);
        }
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        g.__amSchema = undefined; // retry on the next request
        throw e;
      } finally {
        client.release();
      }
    })();
  }
  return g.__amSchema;
}

// ---------- chunked uploads ----------

export async function startUpload(fileName: string, rowsInFile: number): Promise<number> {
  await ensureSchema();
  const r = await requirePool().query(`INSERT INTO uploads (file_name, rows_in_file, state) VALUES ($1, $2, 'in_progress') RETURNING id`, [
    fileName.slice(0, 255),
    Math.max(0, Math.floor(rowsInFile)),
  ]);
  return r.rows[0].id;
}

export interface ChunkResult {
  inserted: number;
  updated: number;
  unchanged: number;
}

/** Save one batch in its own transaction. Re-sending the same batch is harmless (it counts as unchanged). */
export async function saveChunk(uploadId: number, rows: SaleRow[], skipped: number): Promise<ChunkResult> {
  await ensureSchema();
  const client = await requirePool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(724002)"); // one writer at a time keeps the summaries consistent
    const u = await client.query(`SELECT state FROM uploads WHERE id = $1`, [uploadId]);
    if (!u.rows[0]) throw new UploadError("unknown_upload");
    const c = rows.length ? await writeBatch(client, rows, uploadId) : { inserted: 0, updated: 0 };
    const unchanged = rows.length - c.inserted - c.updated;
    await client.query(
      `UPDATE uploads SET inserted = inserted + $2, updated = updated + $3, unchanged = unchanged + $4,
              skipped = skipped + $5, chunks = chunks + 1 WHERE id = $1`,
      [uploadId, c.inserted, c.updated, unchanged, skipped],
    );
    await client.query("COMMIT");
    bumpDataVersion();
    return { ...c, unchanged };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export interface UploadSummary {
  uploadId: number;
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  totalLines: number;
}

export async function finishUpload(uploadId: number, rowsInFile?: number): Promise<UploadSummary> {
  const pool = requirePool();
  const u = await pool.query(
    `UPDATE uploads SET state = 'completed', completed_at = now(), rows_in_file = coalesce($2, rows_in_file) WHERE id = $1
     RETURNING inserted, updated, unchanged, skipped`,
    [uploadId, typeof rowsInFile === "number" && rowsInFile >= 0 ? Math.floor(rowsInFile) : null],
  );
  if (!u.rows[0]) throw new UploadError("unknown_upload");
  await refreshDirtyMonths();
  const t = await pool.query(`SELECT coalesce(sum(lines), 0)::int AS n FROM monthly_summary`);
  bumpDataVersion();
  return { uploadId, ...u.rows[0], totalLines: t.rows[0].n };
}

export interface RebuildResult {
  days: number;
  lines: number;
  seconds: number;
}

/**
 * Rebuild the summaries, invoices and product attributes from sales_lines, e.g. after rows were edited or deleted
 * directly in the database. Runs in one transaction, so the dashboard keeps showing the old totals until it finishes.
 */
export async function rebuildSummary(): Promise<RebuildResult> {
  const t0 = Date.now();
  await ensureSchema();
  const client = await requirePool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(724002)"); // waits for any upload batch in progress
    await client.query("TRUNCATE daily_summary, monthly_summary, invoices, dirty_months");
    await client.query("DELETE FROM products WHERE product NOT IN (SELECT DISTINCT product FROM sales_lines)");
    await refreshAll(client);
    const r = await client.query("SELECT count(DISTINCT day)::int AS days, coalesce(sum(lines), 0)::int AS lines FROM daily_summary");
    await client.query("COMMIT");
    bumpDataVersion();
    return { days: r.rows[0].days, lines: r.rows[0].lines, seconds: Math.round((Date.now() - t0) / 100) / 10 };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export class UploadError extends Error {}
