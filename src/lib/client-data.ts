"use client";
// Browser helpers: call the query API and adapt its totals to the chart components.
import { useEffect, useRef, useState } from "react";
import type { Agg, TimePoint } from "./analytics";
import type {
  QAgg,
  QFilters,
  QInvoicesRequest,
  QInvoicesResult,
  QLinesRequest,
  QLinesResult,
  QPoint,
  QRequest,
  QResult,
} from "./dash-types";

const r2 = (n: number) => Math.round(n * 100) / 100;

export const toAgg = (q: QAgg): Agg => ({ key: q.key, lines: q.lines, qty: q.qty, net: q.net, gross: q.gross, vat: r2(q.gross - q.net) });

/** "YYYY-MM-DD" (or a local ISO time) → Date in the browser's clock, without time-zone shifts. */
export function localDate(s: string): Date {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return new Date(NaN);
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0));
}

export const toPoint = (p: QPoint): TimePoint => ({ ...toAgg(p), invoices: p.invoices, start: localDate(p.start), end: localDate(p.end) });

export async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchQuery = (req: QRequest, signal?: AbortSignal) => postJson<QResult>("/api/query", req, signal);
export const fetchLines = (req: QLinesRequest, signal?: AbortSignal) => postJson<QLinesResult>("/api/lines", req, signal);
export const fetchInvoices = (req: QInvoicesRequest, signal?: AbortSignal) => postJson<QInvoicesResult>("/api/invoices", req, signal);

export const exportUrl = (f: QFilters) => `/api/export?f=${encodeURIComponent(JSON.stringify(f))}`;

/**
 * Runs a query whenever `key` changes (debounced), cancelling the previous one.
 * `initial` is used until the first refetch, so the server-rendered page shows data immediately.
 */
export function useQuery<T>(make: (signal: AbortSignal) => Promise<T>, key: string, initial: T | null = null, delay = 150) {
  const [data, setData] = useState<T | null>(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const first = useRef(initial !== null);
  const makeRef = useRef(make);
  makeRef.current = make;

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      makeRef
        .current(ctrl.signal)
        .then((d) => {
          setData(d);
          setError(false);
        })
        .catch((e) => {
          if ((e as Error).name !== "AbortError") setError(true);
        })
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }, delay);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key, delay]);

  return { data, loading, error };
}
