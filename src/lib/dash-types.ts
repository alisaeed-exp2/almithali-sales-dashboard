// Shapes exchanged between the dashboard (browser) and the query API (server).
// Everything is pre-aggregated on the server, so the browser never holds sales lines in bulk.

/** Dimensions available from the sales export. Channel, route and city come from the invoice; category and brand from the product. */
export type QDim = "channel" | "route" | "city" | "partner" | "category" | "brand" | "product";
export const QDIMS: QDim[] = ["channel", "route", "city", "partner", "category", "brand", "product"];
/** Dimensions that belong to a whole invoice (invoice counts are exact for these). */
export const INVOICE_DIMS: QDim[] = ["channel", "route", "city", "partner"];

export type Metric = "net" | "gross" | "qty";
export const METRICS: Metric[] = ["net", "gross", "qty"];

export interface QFilters {
  dims: Partial<Record<QDim, string[]>>;
  from: string; // "YYYY-MM-DD" or ""
  to: string; // "YYYY-MM-DD" or ""
  search: string;
}

export const emptyQFilters = (): QFilters => ({ dims: {}, from: "", to: "", search: "" });

/** Totals for a group. VAT is gross − net. */
export interface QAgg {
  key: string;
  lines: number;
  qty: number;
  net: number;
  gross: number;
}

export type QGrain = "day" | "week" | "month";

export interface QPoint extends QAgg {
  start: string; // "YYYY-MM-DD"
  end: string; // exclusive
  invoices: number;
}

export interface QCustomerRow extends QAgg {
  city: string;
  channel: string;
  routes: string[];
  invoices: number;
  products: number;
  lastDay: string; // last invoice date, YYYY-MM-DD
  topProduct: string;
  topShare: number;
}

export interface QRouteRow extends QAgg {
  channel: string;
  cities: string[];
  customers: number;
  invoices: number;
  products: number;
  lastDay: string; // last invoice date, YYYY-MM-DD
  topCustomer: string;
  topShare: number;
}

/** One price point actually charged for a product. */
export interface QPriceRow {
  product: string;
  price: number;
  channels: string[];
  lines: number;
  qty: number;
  net: number;
  customers: number;
}

export interface QMatrix {
  rowDim: QDim;
  colDim: QDim;
  cells: { r: string; c: string; agg: QAgg }[];
}

export interface QUploadInfo {
  fileName: string;
  uploadedAt: string;
  inserted: number;
  updated: number;
}

/** Which parts of the dashboard to compute (all by default). */
export type QPart = "totals" | "dims" | "values" | "series" | "matrix" | "prices" | "routes" | "customers";
export const QPARTS: QPart[] = ["totals", "dims", "values", "series", "matrix", "prices", "routes", "customers"];

export interface QRequest {
  filters: QFilters;
  parts?: QPart[];
  dims?: QDim[]; // limit "dims" to these
  matrix?: { rowDim: QDim; colDim: QDim };
}

export interface QTotals extends QAgg {
  invoices: number;
  customers: number;
  routes: number;
  products: number;
}

export interface QResult {
  range: { min: string; max: string } | null; // whole database, "YYYY-MM-DD"
  totals?: QTotals;
  totalsAll?: QAgg & { invoices: number };
  dims?: Partial<Record<QDim, QAgg[]>>; // cross-filtered: each ignores its own filter
  values?: Partial<Record<QDim, string[]>>; // every value in the database, for filter menus
  series?: { grain: QGrain; points: QPoint[] };
  matrix?: QMatrix;
  prices?: QPriceRow[];
  routes?: QRouteRow[];
  customers?: QCustomerRow[];
  lastUpload?: QUploadInfo | null;
  ms?: number;
}

/** One invoice line as stored. */
export interface QLine {
  line_key: string;
  journal_entry: string;
  invoice_date: string;
  partner: string;
  product: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  total: number;
  reference: string;
  partner_city: string;
}

export type QLineSort = "date" | "invoice" | "partner" | "product" | "qty" | "price" | "net";

/** Optional exact invoice, for the invoice drawer. */
export interface QLinesRequest {
  filters: QFilters;
  invoice?: string;
  /** Free text matched against the invoice number and reference only (this list, not the dashboard). */
  q?: string;
  sort?: QLineSort;
  dir?: "asc" | "desc";
  page?: number; // 0-based
  pageSize?: number; // max 200
}

export interface QLinesResult {
  rows: QLine[];
  total: number;
}

/** One invoice, aggregated from its lines. */
export interface QInvoice {
  journal_entry: string;
  invoice_date: string;
  reference: string;
  partner: string;
  city: string;
  channel: string;
  route: string;
  lines: number;
  qty: number;
  net: number;
  gross: number;
}

export type QInvoiceSort = "date" | "invoice" | "partner" | "route" | "lines" | "qty" | "net";

export interface QInvoicesRequest {
  filters: QFilters;
  /** Free text matched against the invoice number and reference only (this list, not the dashboard). */
  q?: string;
  sort?: QInvoiceSort;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface QInvoicesResult {
  rows: QInvoice[];
  total: number;
}
