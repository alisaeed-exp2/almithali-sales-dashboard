// Maps an Odoo journal-item export row to a database row (the export columns + the line key).
// Used in the browser to prepare an upload and on the server to validate it again.
import { cleanCategory, num, pick, str, toYmd, type RawRow } from "./normalize";

/** The columns every export contains, and that the sales_lines table stores. */
export const EXPORT_COLUMNS = [
  "Journal Entry",
  "Invoice/Bill Date",
  "Partner",
  "Product",
  "Quantity",
  "Unit Price",
  "Subtotal",
  "Total",
  "Journal Entry/Reference",
  "Journal Entry/Partner/City",
] as const;

/**
 * Optional columns. When present and filled in, they are used as given; when missing or blank the dashboard
 * falls back to its own rules (channel from the reference, category from the product code).
 * Each accepts a few header spellings (case, spaces and punctuation are ignored).
 */
export const OPTIONAL_COLUMNS = {
  invoiceType: ["Invoice Type", "Sales Type", "Customer Type", "Type", "Channel"],
  productCategory: ["Product Category", "Product/Product Category", "Category"],
} as const;

export const REQUIRED_COLUMNS = ["Journal Entry", "Invoice/Bill Date", "Product", "Subtotal"] as const;

/** Lines without a product but with an amount (rare manual lines) are kept under this name. */
export const NO_PRODUCT = "Other charges";

export interface SaleRow {
  line_key: string; // "Journal Entry | Product"
  journal_entry: string;
  invoice_date: string; // YYYY-MM-DD
  partner: string;
  product: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  total: number;
  reference: string;
  partner_city: string;
  invoice_type: string; // "" when the file has no Invoice Type
  product_category: string; // "" when the file has no Product Category
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Which expected columns are missing from the file's header row. */
export function missingColumns(headers: string[]): string[] {
  const have = new Set(headers.map(norm));
  return EXPORT_COLUMNS.filter((c) => !have.has(norm(c)));
}

/** Which optional columns the file has (so the upload dialog can say what will be used). */
export function optionalColumnsFound(headers: string[]): { invoiceType: boolean; productCategory: boolean } {
  const have = new Set(headers.map(norm));
  return {
    invoiceType: OPTIONAL_COLUMNS.invoiceType.some((c) => have.has(norm(c))),
    productCategory: OPTIONAL_COLUMNS.productCategory.some((c) => have.has(norm(c))),
  };
}

/** B2B / B2C from the Invoice Type cell; anything else is left blank so the reference rule applies. */
export function cleanInvoiceType(v: string): string {
  const u = v.toUpperCase();
  return u.includes("B2B") ? "B2B" : u.includes("B2C") ? "B2C" : "";
}

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const r4 = (v: number) => Math.round(v * 10000) / 10000;

export const lineKey = (entry: string, product: string) => `${entry} | ${product}`;

/** The reference in brackets in "INV25279897 (RC011/2568)", used when the reference column is empty. */
const refFromEntry = (entry: string) => entry.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() ?? "";

export interface ConvertResult {
  rows: SaleRow[];
  /** Rows that look like sales but cannot be stored (no invoice number or no valid date). */
  skipped: number;
  /** Zero-value lines without a product (tax and receivable lines Odoo exports with each invoice). */
  ignored: number;
  /** Lines merged because the same product appeared twice on one invoice. */
  merged: number;
}

/**
 * Convert sheet rows into database rows. Fully blank rows and zero-value lines without a product are ignored.
 * The same product twice on one invoice is merged into one line (quantities and amounts added up).
 */
export function toSaleRows(raw: RawRow[]): ConvertResult {
  const byKey = new Map<string, SaleRow>();
  let skipped = 0,
    ignored = 0,
    merged = 0;
  for (const r of raw) {
    const blank = !Object.values(r).some((v) => v !== null && v !== undefined && String(v).trim() !== "");
    if (blank) continue;
    const entry = str(pick(r, "Journal Entry"));
    const date = toYmd(pick(r, "Invoice/Bill Date", "Invoice Date", "Date"));
    let product = str(pick(r, "Product"));
    const subtotal = num(pick(r, "Subtotal"));
    const total = num(pick(r, "Total"));
    const quantity = num(pick(r, "Quantity"));
    if (!product) {
      if (subtotal === 0 && total === 0 && quantity === 0) {
        ignored++;
        continue;
      }
      product = NO_PRODUCT;
    }
    if (!entry || !date) {
      skipped++;
      continue;
    }
    const key = lineKey(entry, product);
    const row: SaleRow = {
      line_key: key,
      journal_entry: entry,
      invoice_date: date,
      partner: str(pick(r, "Partner")),
      product,
      quantity: r3(quantity),
      unit_price: r4(num(pick(r, "Unit Price"))),
      subtotal: r2(subtotal),
      total: r2(total),
      reference: str(pick(r, "Journal Entry/Reference", "Reference")) || refFromEntry(entry),
      partner_city: str(pick(r, "Journal Entry/Partner/City", "City")),
      invoice_type: cleanInvoiceType(str(pick(r, ...OPTIONAL_COLUMNS.invoiceType))),
      product_category: cleanCategory(str(pick(r, ...OPTIONAL_COLUMNS.productCategory))).slice(0, 120),
    };
    const prev = byKey.get(key);
    if (prev) {
      merged++;
      prev.quantity = r3(prev.quantity + row.quantity);
      prev.subtotal = r2(prev.subtotal + row.subtotal);
      prev.total = r2(prev.total + row.total);
      prev.unit_price = prev.quantity ? r4(prev.subtotal / prev.quantity) : row.unit_price;
    } else byKey.set(key, row);
  }
  return { rows: [...byKey.values()], skipped, ignored, merged };
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Server-side check of an uploaded row; returns null when it is not acceptable. */
export function checkRow(x: unknown): SaleRow | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const s = (k: string, max = 300) => (typeof o[k] === "string" ? (o[k] as string).trim().slice(0, max) : "");
  const n = (k: string, dp: number) => {
    const v = o[k];
    if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e11) return 0;
    const f = Math.pow(10, dp);
    return Math.round(v * f) / f;
  };
  const entry = s("journal_entry", 120);
  const product = s("product", 300);
  const date = s("invoice_date", 10);
  if (!entry || !product || !YMD.test(date)) return null;
  return {
    line_key: lineKey(entry, product),
    journal_entry: entry,
    invoice_date: date,
    partner: s("partner"),
    product,
    quantity: n("quantity", 3),
    unit_price: n("unit_price", 4),
    subtotal: n("subtotal", 2),
    total: n("total", 2),
    reference: s("reference", 120),
    partner_city: s("partner_city", 120),
    invoice_type: cleanInvoiceType(s("invoice_type", 20)),
    product_category: s("product_category", 120),
  };
}
