// Server-side aggregation for the dashboard, built for millions of invoice lines:
//  - whole months read monthly_summary and only the partial months at the edges of a date range read daily_summary;
//  - invoice counts and the invoice list read the invoices table (one row per invoice);
//  - a search is first resolved to the customers, products, routes and cities it matches, then applied as
//    indexed equality filters (no ILIKE over millions of rows);
//  - sales_lines itself is read only for paged line lists, product-filtered invoice lists and the CSV export.
import { dataVersion, ensureSchema, refreshDirtyMonths, requirePool } from "./db";
import type {
  QAgg,
  QCustomerRow,
  QDim,
  QFilters,
  QGrain,
  QInvoice,
  QInvoicesRequest,
  QInvoicesResult,
  QLine,
  QLinesRequest,
  QLinesResult,
  QPart,
  QPoint,
  QPriceRow,
  QRequest,
  QResult,
  QRouteRow,
} from "./dash-types";
import { INVOICE_DIMS, QDIMS, QPARTS } from "./dash-types";

/** summary = month/day union, daily = daily_summary, inv = invoices, lines = sales_lines. */
type Src = "summary" | "daily" | "inv" | "lines";

/** What a search text matches, per searchable dimension. */
type Matches = Partial<Record<"partner" | "product" | "route" | "city", string[]>>;
/** Filters with the search already resolved. */
interface RF extends QFilters {
  matches?: Matches;
}

const PRODUCT_EXPR = { category: "coalesce(p.category, 'Other')", brand: "coalesce(p.brand, 'Other')", product: "s.product" };
const SUMMARY_EXPR = { channel: "s.channel", route: "s.route", city: "s.city", partner: "s.partner", ...PRODUCT_EXPR };

const EXPR: Record<Src, Partial<Record<QDim, string>>> = {
  summary: SUMMARY_EXPR,
  daily: SUMMARY_EXPR,
  inv: { channel: "s.channel", route: "s.route", city: "s.city", partner: "s.partner" },
  lines: { channel: "am_channel(s.reference, s.invoice_type)", route: "am_route(s.reference)", city: "am_city(s.partner_city)", partner: "s.partner", ...PRODUCT_EXPR },
};

const DAY: Record<Src, string> = { summary: "s.day", daily: "s.day", inv: "s.invoice_date", lines: "s.invoice_date" };
const JOIN_P = "LEFT JOIN products p ON p.product = s.product";

const AGG = {
  summary: `coalesce(sum(s.lines), 0)::int AS lines, coalesce(sum(s.qty), 0)::float8 AS qty,
            coalesce(sum(s.net), 0)::float8 AS net, coalesce(sum(s.gross), 0)::float8 AS gross`,
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

class Params {
  vals: unknown[] = [];
  add(v: unknown) {
    this.vals.push(v);
    return `$${this.vals.length}`;
  }
}

const like = (p: Params, q: string) => p.add(`%${q.replace(/[\\%_]/g, (m) => "\\" + m)}%`);

// ---------- dates: whole months vs edge days ----------

const pad = (n: number) => String(n).padStart(2, "0");
const ymdUTC = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parseYmd = (s: string) => new Date(s + "T00:00:00Z");
const monthStart = (s: string) => s.slice(0, 8) + "01";
const addMonths = (s: string, n: number) => {
  const d = parseYmd(monthStart(s));
  d.setUTCMonth(d.getUTCMonth() + n);
  return ymdUTC(d);
};
const addDays = (s: string, n: number) => {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymdUTC(d);
};

/**
 * FROM clause for the summary: monthly_summary rows for the whole months inside [from, to], plus daily_summary rows for
 * the days of a partial month at either end. Date filters are applied here, so where() skips them for this source.
 * Monthly rows carry the month's first day in `day`.
 */
function summaryFrom(f: QFilters, p: Params): string {
  const lo = f.from && DATE_RE.test(f.from) ? f.from : "";
  const hi = f.to && DATE_RE.test(f.to) ? f.to : "";
  const A = lo ? (lo.endsWith("-01") ? lo : addMonths(lo, 1)) : ""; // first whole month
  const B = hi ? (addDays(hi, 1).endsWith("-01") ? addDays(hi, 1) : monthStart(hi)) : ""; // end of whole months (exclusive)
  const cols = "channel, route, partner, city, product, unit_price, lines, qty, net, gross";
  const parts: string[] = [];
  if (!(A && B && A >= B)) {
    const c = [A ? `month >= ${p.add(A)}::date` : "", B ? `month < ${p.add(B)}::date` : ""].filter(Boolean);
    parts.push(`SELECT month AS day, ${cols}, first_day, last_day FROM monthly_summary${c.length ? " WHERE " + c.join(" AND ") : ""}`);
    const edges: string[] = [];
    if (lo && A > lo) edges.push(`(day >= ${p.add(lo)}::date AND day < ${p.add(A)}::date)`);
    if (hi && B && B <= hi) edges.push(`(day >= ${p.add(B)}::date AND day <= ${p.add(hi)}::date)`);
    if (edges.length) parts.push(`SELECT day, ${cols}, day AS first_day, day AS last_day FROM daily_summary WHERE ${edges.join(" OR ")}`);
  } else {
    const c = [`day >= ${p.add(lo)}::date`, `day <= ${p.add(hi)}::date`];
    parts.push(`SELECT day, ${cols}, day AS first_day, day AS last_day FROM daily_summary WHERE ${c.join(" AND ")}`);
  }
  return `(${parts.join(" UNION ALL ")}) s ${JOIN_P}`;
}

function fromOf(src: Src, f: QFilters, p: Params): string {
  if (src === "summary") return summaryFrom(f, p);
  if (src === "daily") return `daily_summary s ${JOIN_P}`;
  if (src === "inv") return "invoices s";
  return `sales_lines s ${JOIN_P}`;
}

/** Dimension filters, dates (except for the summary union, which applies its own) and the resolved search. */
function where(f: RF, src: Src, p: Params, except?: QDim, extra: string[] = []): string {
  const c: string[] = [...extra];
  for (const d of QDIMS) {
    const vals = f.dims[d];
    if (d === except || !vals || !vals.length) continue;
    const e = EXPR[src][d];
    if (e) c.push(`${e} = ANY(${p.add(vals)}::text[])`);
  }
  if (src !== "summary") {
    if (f.from && DATE_RE.test(f.from)) c.push(`${DAY[src]} >= ${p.add(f.from)}::date`);
    if (f.to && DATE_RE.test(f.to)) c.push(`${DAY[src]} <= ${p.add(f.to)}::date`);
  }
  if (f.search.trim()) {
    const m = f.matches ?? {};
    const ors = (["partner", "product", "route", "city"] as const)
      .filter((k) => (m[k]?.length ?? 0) > 0 && EXPR[src][k])
      .map((k) => `${EXPR[src][k]} = ANY(${p.add(m[k])}::text[])`);
    c.push(ors.length ? `(${ors.join(" OR ")})` : "FALSE");
  }
  return c.length ? `WHERE ${c.join(" AND ")}` : "";
}

/** Invoice counts come from the invoices table unless a product-level filter (or a search that matched products) is on. */
const needsLines = (f: RF) =>
  (!!f.search.trim() && (f.matches?.product?.length ?? 0) > 0) || QDIMS.some((d) => !INVOICE_DIMS.includes(d) && (f.dims[d]?.length ?? 0) > 0);

/** (key, invoices) grouped by an invoice-level dimension or a date bucket, or one row "all". */
async function invoiceMap(f: RF, group?: QDim | QGrain) {
  const p = new Params();
  const src: Src = needsLines(f) ? "lines" : "inv";
  const isGrain = group === "day" || group === "week" || group === "month";
  const keyExpr = isGrain ? `to_char(date_trunc('${group}', ${DAY[src]}), 'YYYY-MM-DD')` : group ? EXPR[src][group as QDim] : "'all'";
  const w = where(f, src, p);
  const sql =
    src === "lines"
      ? `SELECT ${keyExpr} AS key, count(DISTINCT s.journal_entry)::int AS invoices FROM ${fromOf(src, f, p)} ${w} GROUP BY 1`
      : `SELECT ${keyExpr} AS key, count(*)::int AS invoices FROM ${fromOf(src, f, p)} ${w} GROUP BY 1`;
  const rows = await q(sql, p);
  return new Map(rows.map((r) => [String(r.key), Number(r.invoices) || 0]));
}

const toAgg = (r: Record<string, unknown>, key = String(r.key ?? "")): QAgg => ({
  key,
  lines: Number(r.lines) || 0,
  qty: Number(r.qty) || 0,
  net: Number(r.net) || 0,
  gross: Number(r.gross) || 0,
});

async function q(sql: string, p: Params | unknown[] = []) {
  const vals = p instanceof Params ? p.vals : p;
  return (await requirePool().query(sql, vals)).rows as Record<string, unknown>[];
}

// ---------- search ----------

const searchCache = globalThis as unknown as { __amSearch?: Map<string, { v: number; m: Matches }> };

/** The customers, products, routes and cities whose names contain the search text (cached per upload). */
async function resolveSearch(text: string): Promise<Matches> {
  const s = text.trim().slice(0, 100);
  if (!s) return {};
  const cache = (searchCache.__amSearch ??= new Map());
  const hit = cache.get(s.toLowerCase());
  if (hit && hit.v === dataVersion()) return hit.m;
  const p = new Params();
  const v = like(p, s);
  const rows = await q(
    `SELECT 'partner' AS k, partner AS v FROM (SELECT DISTINCT partner FROM invoices) x WHERE partner ILIKE ${v}
     UNION ALL SELECT 'route', route FROM (SELECT DISTINCT route FROM invoices) x WHERE route ILIKE ${v}
     UNION ALL SELECT 'city', city FROM (SELECT DISTINCT city FROM invoices) x WHERE city ILIKE ${v}
     UNION ALL SELECT 'product', product FROM products WHERE product ILIKE ${v} OR name ILIKE ${v}
     LIMIT 20000`,
    p,
  );
  const m: Matches = {};
  for (const r of rows) (m[r.k as keyof Matches] ??= []).push(String(r.v));
  if (cache.size > 200) cache.clear();
  cache.set(s.toLowerCase(), { v: dataVersion(), m });
  return m;
}

async function resolve(f: QFilters): Promise<RF> {
  return f.search.trim() ? { ...f, matches: await resolveSearch(f.search) } : f;
}

// ---------- time series ----------

function nextBucket(d: Date, g: QGrain) {
  const x = new Date(d);
  if (g === "day") x.setUTCDate(x.getUTCDate() + 1);
  else if (g === "week") x.setUTCDate(x.getUTCDate() + 7);
  else x.setUTCMonth(x.getUTCMonth() + 1);
  return x;
}

function pickGrain(days: number): QGrain {
  if (days <= 62) return "day";
  if (days <= 190) return "week";
  return "month";
}

async function series(f: RF): Promise<{ grain: QGrain; points: QPoint[] }> {
  const p0 = new Params();
  const span = await q(
    `SELECT min(s.first_day)::text AS a, max(s.last_day)::text AS b FROM ${summaryFrom(f, p0)} ${where(f, "summary", p0)}`,
    p0,
  );
  if (!span[0]?.a) return { grain: "day", points: [] };
  const days = Math.round((parseYmd(String(span[0].b)).getTime() - parseYmd(String(span[0].a)).getTime()) / 86_400_000) + 1;
  const grain = pickGrain(days);
  // Days and weeks need exact dates (daily summary, short ranges only); months read the monthly roll-up.
  const src: Src = grain === "month" ? "summary" : "daily";
  const p = new Params();
  const sf: RF = grain === "month" ? f : { ...f, from: f.from || String(span[0].a), to: f.to || String(span[0].b) };
  const [rows, inv] = await Promise.all([
    q(
      `SELECT to_char(date_trunc('${grain}', s.day), 'YYYY-MM-DD') AS key, ${AGG.summary} FROM ${fromOf(src, sf, p)} ${where(sf, src, p)} GROUP BY 1 ORDER BY 1`,
      p,
    ),
    invoiceMap(f, grain),
  ]);
  if (!rows.length) return { grain, points: [] };
  const byKey = new Map(rows.map((r) => [String(r.key), toAgg(r)]));
  const points: QPoint[] = [];
  let cur = parseYmd(String(rows[0].key));
  const last = parseYmd(String(rows[rows.length - 1].key)).getTime();
  while (cur.getTime() <= last && points.length < 5000) {
    const k = ymdUTC(cur);
    const end = nextBucket(cur, grain);
    const agg = byKey.get(k) ?? { key: k, lines: 0, qty: 0, net: 0, gross: 0 };
    points.push({ ...agg, key: k, start: k, end: ymdUTC(end), invoices: inv.get(k) ?? 0 });
    cur = end;
  }
  return { grain, points };
}

// ---------- cached filter values ----------

const cache = globalThis as unknown as { __amValues?: { v: number; at: number; values: Partial<Record<QDim, string[]>> } };

async function values(): Promise<Partial<Record<QDim, string[]>>> {
  const c = cache.__amValues;
  if (c && c.v === dataVersion() && Date.now() - c.at < 60_000) return c.values;
  const out: Partial<Record<QDim, string[]>> = {};
  const SRC: Record<QDim, string> = {
    channel: "SELECT DISTINCT channel AS key FROM invoices",
    route: "SELECT DISTINCT route AS key FROM invoices",
    city: "SELECT DISTINCT city AS key FROM invoices",
    partner: "SELECT DISTINCT partner AS key FROM invoices",
    category: "SELECT DISTINCT category AS key FROM products",
    brand: "SELECT DISTINCT brand AS key FROM products",
    product: "SELECT product AS key FROM products",
  };
  await Promise.all(
    QDIMS.map(async (d) => {
      const rows = await q(`${SRC[d]} ORDER BY 1 LIMIT 5000`);
      out[d] = rows.map((r) => String(r.key));
    }),
  );
  cache.__amValues = { v: dataVersion(), at: Date.now(), values: out };
  return out;
}

// ---------- main query ----------

export function cleanFilters(x: unknown): QFilters {
  const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
  const dimsIn = (o.dims && typeof o.dims === "object" ? o.dims : {}) as Record<string, unknown>;
  const dims: QFilters["dims"] = {};
  for (const d of QDIMS) {
    const v = dimsIn[d];
    if (Array.isArray(v)) dims[d] = v.filter((s): s is string => typeof s === "string").slice(0, 500);
  }
  const s = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : "");
  let from = DATE_RE.test(s("from")) ? s("from") : "";
  let to = DATE_RE.test(s("to")) ? s("to") : "";
  if (from && to && from > to) [from, to] = [to, from];
  return { dims, from, to, search: s("search").slice(0, 100) };
}

/** Largest value per group (e.g. top product per customer) from rows of (g, k, net). */
function topOf(rows: Record<string, unknown>[]) {
  const top = new Map<string, { key: string; net: number }>();
  for (const t of rows) {
    const cur = top.get(String(t.g));
    if (!cur || Number(t.net) > cur.net) top.set(String(t.g), { key: String(t.k), net: Number(t.net) });
  }
  return top;
}

/** Summary query helper: FROM + WHERE built with one parameter list. */
function sum(f: RF, p: Params, except?: QDim) {
  const from = summaryFrom(f, p);
  return `${from} ${where(f, "summary", p, except)}`;
}

export async function runQuery(req: QRequest): Promise<QResult> {
  const t0 = Date.now();
  await ensureSchema();
  await refreshDirtyMonths();
  const f = await resolve(req.filters);
  const parts = new Set<QPart>(req.parts ?? QPARTS);
  const res: QResult = { range: null };
  const jobs: Promise<void>[] = [];

  jobs.push(
    (async () => {
      const r = await q(`SELECT (SELECT min(day) FROM daily_summary)::text AS a, (SELECT max(day) FROM daily_summary)::text AS b`);
      res.range = r[0]?.a ? { min: String(r[0].a), max: String(r[0].b) } : null;
    })(),
  );

  if (parts.has("totals")) {
    jobs.push(
      (async () => {
        const p = new Params();
        const body = sum(f, p);
        // Distinct counts via GROUP BY sub-queries: several times faster than count(DISTINCT …) on large summaries.
        const sub = (col: string) => `(SELECT count(*) FROM (SELECT ${col} FROM ${body} GROUP BY 1) x)::int`;
        const [r, inv] = await Promise.all([
          q(`SELECT ${AGG.summary}, ${sub("s.partner")} AS customers, ${sub("s.route")} AS routes, ${sub("s.product")} AS products FROM ${body}`, p),
          invoiceMap(f),
        ]);
        res.totals = {
          ...toAgg(r[0], "all"),
          invoices: inv.get("all") ?? 0,
          customers: Number(r[0].customers),
          routes: Number(r[0].routes),
          products: Number(r[0].products),
        };
      })(),
      (async () => {
        const [r, i] = await Promise.all([q(`SELECT ${AGG.summary} FROM monthly_summary s`), q(`SELECT count(*)::int AS n FROM invoices`)]);
        res.totalsAll = { ...toAgg(r[0], "all"), invoices: Number(i[0].n) };
      })(),
      (async () => {
        const r = await q(`SELECT file_name, uploaded_at, inserted, updated FROM uploads WHERE state = 'completed' ORDER BY id DESC LIMIT 1`);
        res.lastUpload = r[0]
          ? { fileName: String(r[0].file_name), uploadedAt: new Date(r[0].uploaded_at as string).toISOString(), inserted: Number(r[0].inserted), updated: Number(r[0].updated) }
          : null;
      })(),
    );
  }

  if (parts.has("dims")) {
    const which = req.dims?.length ? req.dims : QDIMS;
    res.dims = {};
    for (const d of which) {
      jobs.push(
        (async () => {
          const p = new Params();
          const rows = await q(`SELECT ${EXPR.summary[d]} AS key, ${AGG.summary} FROM ${sum(f, p, d)} GROUP BY 1 ORDER BY net DESC, qty DESC LIMIT 500`, p);
          res.dims![d] = rows.map((r) => toAgg(r));
        })(),
      );
    }
  }

  if (parts.has("values")) jobs.push(values().then((v) => void (res.values = v)));

  if (parts.has("series")) jobs.push(series(f).then((s) => void (res.series = s)));

  if (parts.has("matrix") && req.matrix && QDIMS.includes(req.matrix.rowDim) && QDIMS.includes(req.matrix.colDim) && req.matrix.rowDim !== req.matrix.colDim) {
    const { rowDim, colDim } = req.matrix;
    jobs.push(
      (async () => {
        const p = new Params();
        const rows = await q(`SELECT ${EXPR.summary[rowDim]} AS r, ${EXPR.summary[colDim]} AS c, ${AGG.summary} FROM ${sum(f, p)} GROUP BY 1, 2 ORDER BY net DESC LIMIT 3000`, p);
        res.matrix = { rowDim, colDim, cells: rows.map((r) => ({ r: String(r.r), c: String(r.c), agg: toAgg(r, `${r.r}|${r.c}`) })) };
      })(),
    );
  }

  if (parts.has("prices")) {
    jobs.push(
      (async () => {
        const p = new Params();
        const rows = await q(
          `SELECT s.product, s.unit_price::float8 AS price, array_agg(DISTINCT s.channel) AS channels, ${AGG.summary},
                  count(DISTINCT s.partner)::int AS customers
             FROM ${sum(f, p)}
            GROUP BY 1, 2 ORDER BY qty DESC LIMIT 600`,
          p,
        );
        res.prices = rows.map(
          (r): QPriceRow => ({
            product: String(r.product),
            price: Number(r.price),
            channels: (r.channels as string[]) ?? [],
            lines: Number(r.lines),
            qty: Number(r.qty),
            net: Number(r.net),
            customers: Number(r.customers),
          }),
        );
      })(),
    );
  }

  if (parts.has("routes")) {
    jobs.push(
      (async () => {
        const p = new Params();
        const body = sum(f, p);
        const [rows, tops, inv] = await Promise.all([
          q(
            `SELECT s.route AS key, ${AGG.summary}, max(s.channel) AS channel, (array_agg(DISTINCT s.city))[1:6] AS cities,
                    count(DISTINCT s.partner)::int AS customers, count(DISTINCT s.product)::int AS products, max(s.last_day)::text AS last_day
               FROM ${body} GROUP BY 1 ORDER BY net DESC LIMIT 500`,
            p,
          ),
          q(`SELECT s.route AS g, s.partner AS k, sum(s.net)::float8 AS net FROM ${body} GROUP BY 1, 2`, p),
          invoiceMap(f, "route"),
        ]);
        const top = topOf(tops);
        res.routes = rows.map((r): QRouteRow => {
          const a = toAgg(r);
          const tp = top.get(a.key);
          return {
            ...a,
            channel: String(r.channel),
            cities: (r.cities as string[]) ?? [],
            customers: Number(r.customers),
            invoices: inv.get(a.key) ?? 0,
            products: Number(r.products),
            lastDay: String(r.last_day ?? ""),
            topCustomer: tp?.key ?? "",
            topShare: tp && a.net ? tp.net / a.net : 0,
          };
        });
      })(),
    );
  }

  if (parts.has("customers")) {
    jobs.push(
      (async () => {
        const p = new Params();
        const body = sum(f, p);
        const [rows, tops, inv] = await Promise.all([
          q(
            `SELECT s.partner AS key, ${AGG.summary}, max(s.city) AS city, max(s.channel) AS channel, (array_agg(DISTINCT s.route))[1:6] AS routes,
                    count(DISTINCT s.product)::int AS products, max(s.last_day)::text AS last_day
               FROM ${body} GROUP BY 1 ORDER BY net DESC LIMIT 1000`,
            p,
          ),
          q(`SELECT s.partner AS g, s.product AS k, sum(s.net)::float8 AS net FROM ${body} GROUP BY 1, 2`, p),
          invoiceMap(f, "partner"),
        ]);
        const top = topOf(tops);
        res.customers = rows.map((r): QCustomerRow => {
          const a = toAgg(r);
          const tp = top.get(a.key);
          return {
            ...a,
            city: String(r.city),
            channel: String(r.channel),
            routes: (r.routes as string[]) ?? [],
            invoices: inv.get(a.key) ?? 0,
            products: Number(r.products),
            lastDay: String(r.last_day ?? ""),
            topProduct: tp?.key ?? "",
            topShare: tp && a.net ? tp.net / a.net : 0,
          };
        });
      })(),
    );
  }

  await Promise.all(jobs);
  res.ms = Date.now() - t0;
  return res;
}

// ---------- invoice lines ----------

const invoiceText = (p: Params, text: string) => {
  const v = like(p, text.trim().slice(0, 60));
  return `(s.journal_entry ILIKE ${v} OR s.reference ILIKE ${v})`;
};

const LINE_SORT: Record<string, string> = {
  date: "s.invoice_date",
  invoice: "s.journal_entry",
  partner: "s.partner",
  product: "s.product",
  qty: "s.quantity",
  price: "s.unit_price",
  net: "s.subtotal",
};

const LINE_COLS = `s.line_key, s.journal_entry, s.invoice_date::text AS invoice_date, s.partner, s.product, s.quantity::float8 AS quantity,
  s.unit_price::float8 AS unit_price, s.subtotal::float8 AS subtotal, s.total::float8 AS total, s.reference, s.partner_city,
  s.invoice_type, s.product_category`;

export async function runLines(req: QLinesRequest): Promise<QLinesResult> {
  await ensureSchema();
  const size = Math.min(200, Math.max(1, Math.floor(req.pageSize ?? 25)));
  const page = Math.max(0, Math.floor(req.page ?? 0));
  const col = LINE_SORT[req.sort ?? "date"] ?? LINE_SORT.date;
  const dir = req.dir === "asc" ? "ASC" : "DESC";
  const p = new Params();
  const extra = req.invoice ? [`s.journal_entry = ${p.add(req.invoice)}`] : [];
  if (!req.invoice && req.q?.trim()) extra.push(invoiceText(p, req.q));
  const f: RF = req.invoice ? { dims: {}, from: "", to: "", search: "" } : await resolve(req.filters);
  const w = where(f, "lines", p, undefined, extra);
  const from = fromOf("lines", f, p);
  const [rows, count] = await Promise.all([
    q(`SELECT ${LINE_COLS} FROM ${from} ${w} ORDER BY ${col} ${dir}, s.line_key ${dir} LIMIT ${size} OFFSET ${page * size}`, p),
    q(`SELECT count(*)::int AS n FROM ${from} ${w}`, p),
  ]);
  return { rows: rows as unknown as QLine[], total: Number(count[0].n) };
}

// ---------- invoices ----------

const INV_SORT: Record<string, string> = {
  date: "invoice_date",
  invoice: "journal_entry",
  partner: "partner",
  route: "route",
  lines: "lines",
  qty: "qty",
  net: "net",
};

/**
 * Invoices matching the filters. Invoice-level filters read the invoices table; product-level filters (or a search that
 * matched products) build the invoices from their matching lines, so the amounts are those of the matching lines.
 */
export async function runInvoices(req: QInvoicesRequest): Promise<QInvoicesResult> {
  await ensureSchema();
  const size = Math.min(200, Math.max(1, Math.floor(req.pageSize ?? 25)));
  const page = Math.max(0, Math.floor(req.page ?? 0));
  const col = INV_SORT[req.sort ?? "date"] ?? INV_SORT.date;
  const dir = req.dir === "asc" ? "ASC" : "DESC";
  const f = await resolve(req.filters);
  const p = new Params();
  const extra = req.q?.trim() ? [invoiceText(p, req.q)] : [];
  if (!needsLines(f)) {
    const w = where(f, "inv", p, undefined, extra);
    const [rows, count] = await Promise.all([
      q(
        `SELECT journal_entry, invoice_date::text AS invoice_date, reference, partner, city, channel, route, lines,
                qty::float8 AS qty, net::float8 AS net, gross::float8 AS gross
           FROM invoices s ${w} ORDER BY ${col} ${dir}, journal_entry ${dir} LIMIT ${size} OFFSET ${page * size}`,
        p,
      ),
      q(`SELECT count(*)::int AS n FROM invoices s ${w}`, p),
    ]);
    return { rows: rows as unknown as QInvoice[], total: Number(count[0].n) };
  }
  const w = where(f, "lines", p, undefined, extra);
  const from = fromOf("lines", f, p);
  const [rows, count] = await Promise.all([
    q(
      `SELECT s.journal_entry, max(s.invoice_date)::text AS invoice_date, max(s.reference) AS reference, max(s.partner) AS partner,
              max(am_city(s.partner_city)) AS city, max(am_channel(s.reference, s.invoice_type)) AS channel, max(am_route(s.reference)) AS route,
              count(*)::int AS lines, sum(s.quantity)::float8 AS qty, sum(s.subtotal)::float8 AS net, sum(s.total)::float8 AS gross
         FROM ${from} ${w}
        GROUP BY s.journal_entry
        ORDER BY ${col} ${dir}, s.journal_entry ${dir} LIMIT ${size} OFFSET ${page * size}`,
      p,
    ),
    q(`SELECT count(DISTINCT s.journal_entry)::int AS n FROM ${from} ${w}`, p),
  ]);
  return { rows: rows as unknown as QInvoice[], total: Number(count[0].n) };
}

/** Streams every line matching the filters as CSV, in pages, so memory stays flat for millions of rows. */
export function exportCsv(filters: QFilters): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const head = ["Journal Entry", "Invoice/Bill Date", "Reference", "Channel", "Route", "Partner", "City", "Product", "Category", "Brand", "Quantity", "Unit Price", "Subtotal", "VAT", "Total"];
  const esc = (v: unknown) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  let last: { d: string; k: string } | null = null;
  let f: RF | null = null;
  return new ReadableStream({
    async pull(ctrl) {
      try {
        if (!f) {
          await ensureSchema();
          f = await resolve(filters);
          ctrl.enqueue(enc.encode("﻿" + head.join(",") + "\n"));
        }
        const p = new Params();
        const extra = last ? [`(s.invoice_date, s.line_key) > (${p.add(last.d)}::date, ${p.add(last.k)})`] : [];
        const w = where(f, "lines", p, undefined, extra);
        const rows = await q(
          `SELECT ${LINE_COLS}, am_channel(s.reference, s.invoice_type) AS channel, am_route(s.reference) AS route, am_city(s.partner_city) AS city,
                  coalesce(p.category, 'Other') AS category, coalesce(p.brand, 'Other') AS brand
             FROM ${fromOf("lines", f, p)} ${w}
            ORDER BY s.invoice_date, s.line_key LIMIT 10000`,
          p,
        );
        if (!rows.length) return ctrl.close();
        const lines = rows.map((r) => {
          const net = Number(r.subtotal),
            gross = Number(r.total);
          return [r.journal_entry, r.invoice_date, r.reference, r.channel, r.route, r.partner, r.city, r.product, r.category, r.brand, Number(r.quantity), Number(r.unit_price), net.toFixed(2), (gross - net).toFixed(2), gross.toFixed(2)]
            .map(esc)
            .join(",");
        });
        ctrl.enqueue(enc.encode(lines.join("\n") + "\n"));
        const lr = rows[rows.length - 1];
        last = { d: String(lr.invoice_date), k: String(lr.line_key) };
        if (rows.length < 10000) ctrl.close();
      } catch (e) {
        ctrl.error(e);
      }
    },
  });
}
