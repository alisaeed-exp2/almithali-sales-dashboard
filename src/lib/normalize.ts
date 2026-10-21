// Cleaning and derived attributes for the Odoo journal-item (account.move.line) sales export.
// The SQL functions am_channel / am_route / am_city in db/schema.sql mirror channelOf / routeOf / cityOf here.
// When the export carries "Invoice Type" and "Product Category", those values win over the derived ones.

export type RawRow = Record<string, unknown>;

export const VAT_RATE = 0.15; // KSA VAT

/** Look up a column regardless of case, spacing or punctuation differences ("Invoice/Bill Date" = "invoice bill date"). */
export function pick(row: RawRow, ...names: string[]): unknown {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const keys = Object.keys(row);
  for (const name of names) {
    const k = keys.find((key) => norm(key) === norm(name));
    if (k !== undefined && row[k] !== null && row[k] !== undefined) return row[k];
  }
  return undefined;
}

export const str = (v: unknown) => (v === undefined || v === null ? "" : String(v).trim().replace(/\s+/g, " "));
export const num = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** Title-case names typed in ALL CAPS or all lower case. Arabic text is left as it is. */
export function tidyName(s: string): string {
  if (!s) return "Unknown";
  if (!/[a-z]/i.test(s)) return s;
  const allSame = s === s.toUpperCase() || s === s.toLowerCase();
  if (!allSame) return s;
  return s
    .toLowerCase()
    .split(" ")
    .map((w) => w.replace(/(^|-)([a-z])/g, (_m, p, c) => p + c.toUpperCase()))
    .join(" ");
}

const pad = (n: number) => String(n).padStart(2, "0");
const ymdOf = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? `${y}-${pad(m)}-${pad(d)}` : null;
};

/**
 * Invoice date → "YYYY-MM-DD". Accepts ISO dates, Odoo's US format (10/21/2026, month first),
 * day-first dates when the first number cannot be a month (21/10/2026), Excel serials and Date objects.
 */
export function toYmd(v: unknown): string | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : ymdOf(v.getFullYear(), v.getMonth() + 1, v.getDate());
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null; // Excel serial (days since 1899-12-30)
    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
    return ymdOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
  }
  const s = str(v);
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ymdOf(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (m) {
    const a = +m[1],
      b = +m[2];
    return a > 12 ? ymdOf(+m[3], b, a) : ymdOf(+m[3], a, b);
  }
  return null;
}

/**
 * Channel: the export's "Invoice Type" when it says B2B or B2C; otherwise from the reference
 * ("S60797" → B2B, "RC011/2568" → B2C). Mirrors SQL am_channel(ref, typ).
 */
export function channelOf(ref: string, invoiceType = ""): "B2B" | "B2C" | "Unknown" {
  const ty = invoiceType.toUpperCase();
  if (ty.includes("B2B")) return "B2B";
  if (ty.includes("B2C")) return "B2C";
  const r = ref.trim();
  if (/^S[0-9]+$/i.test(r)) return "B2B";
  return r ? "B2C" : "Unknown";
}

/** Sales route = part of the reference before "/" (RC011/2568 → RC011); every B2B sale is "B2B direct". */
export function routeOf(ref: string): string {
  const r = ref.trim();
  if (/^S[0-9]+$/i.test(r)) return "B2B direct";
  if (!r) return "Unknown";
  return r.split("/")[0].trim().toUpperCase();
}

/** "DAMMAM" → "Dammam"; "0" or empty → "Unknown" (same as SQL initcap). */
export function cityOf(c: string): string {
  const s = c.trim();
  if (!s || s === "0") return "Unknown";
  return s.toLowerCase().replace(/(^|[^a-z0-9])([a-z])/g, (_m, p, ch) => p + ch.toUpperCase());
}

export interface ProductInfo {
  code: string; // FGP-BK-00184
  name: string; // Ideal Mafrood Bread (Bag 6 Pcs)-260 Gm
  category: string;
  brand: string;
}

const CATEGORY: Record<string, string> = { BK: "Bakery", EP: "Sweets & pastries", WP: "Cakes & muffins" };

/** "[FGP-BK-00184] Ideal Mafrood Bread (Bag 6 Pcs)-260 Gm" → code, display name, category (from the code), brand (from the name). */
export function deriveProduct(product: string): ProductInfo {
  const m = product.match(/^\s*\[([^\]]+)\]\s*(.*)$/);
  const code = m ? m[1].trim() : "";
  const name = (m ? m[2] : product).replace(/\s+/g, " ").trim() || product;
  const seg = code.split("-")[1]?.toUpperCase() ?? "";
  const lower = name.toLowerCase();
  return {
    code,
    name,
    category: CATEGORY[seg] ?? "Other",
    brand: /\bideal\b/.test(lower) ? "Ideal" : /\blo(a)?vin\b|\bloven\b/.test(lower) ? "Loavin Bake" : /\bhealthy\b/.test(lower) ? "Healthy" : "Other",
  };
}

/**
 * Category as written in the export's "Product Category" column. Odoo exports the full path
 * ("All / Saleable / Bakery"); the last part is the category shown on the dashboard.
 */
export function cleanCategory(v: string): string {
  const parts = v.split("/").map((x) => x.trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "";
}

/** The category to show for a line: the export's own value when present, otherwise the one derived from the product code. */
export const categoryOf = (product: string, fileCategory = "") => cleanCategory(fileCategory) || deriveProduct(product).category;

/** Display name of a product without its [code] prefix. */
export const productName = (product: string) => deriveProduct(product).name;
