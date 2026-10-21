// Chart-facing types. Totals are computed on the server (see query.ts) and adapted in client-data.ts.
import type { Metric } from "./dash-types";

export interface Agg {
  key: string;
  lines: number;
  qty: number;
  net: number; // Subtotal, before VAT
  gross: number; // Total, incl. VAT
  vat: number; // gross − net
}

export const metricOf = (a: Agg, m: Metric) => a[m];

export type Grain = "day" | "week" | "month";

export interface TimePoint extends Agg {
  start: Date;
  end: Date; // exclusive
  invoices: number;
}
