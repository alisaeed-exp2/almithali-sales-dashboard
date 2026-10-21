// Plain-language findings computed from the server's totals for the current selection.
// Every finding that is about one customer, route, product… links to its drill-down.
import type { QAgg, QDim, QResult } from "./dash-types";
import type { I18n } from "./i18n-core";
import { fmtInt, fmtMoney, fmtPct, fmtPrice, fmtQty } from "./format";
import { localDate } from "./client-data";

export type Tone = "info" | "good" | "warn" | "risk";
export interface Insight {
  tone: Tone;
  title: string;
  body: string;
  drill?: { dim: QDim; value: string };
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
}

export function insights(d: QResult, filtersOn: Partial<Record<QDim, boolean>>, i18n: I18n): Insight[] {
  const out: Insight[] = [];
  const t = d.totals;
  if (!t || !t.lines || t.net === 0) return out;
  const { t: tr, v: lab, intl } = i18n;
  const share = (x: number) => (t.net ? x / t.net : 0);
  // A dimension that is itself filtered shows every value (cross-filtering), so findings only use
  // dimensions that are not filtered.
  const dim = (k: QDim): QAgg[] => (filtersOn[k] ? [] : (d.dims?.[k] ?? []).filter((x) => x.net !== 0 || x.qty !== 0));
  const customers = dim("partner");
  const products = dim("product");
  const channels = dim("channel");
  const routes = dim("route");
  const cities = dim("city");
  const categories = dim("category");

  // Customer concentration
  if (customers.length) {
    const c = customers[0];
    const hhi = customers.reduce((h, x) => h + Math.pow(share(x.net) * 100, 2), 0);
    const top3 = customers.slice(0, 3).reduce((s, x) => s + x.net, 0);
    out.push({
      tone: share(c.net) > 0.4 ? "risk" : hhi > 1500 ? "warn" : "info",
      title: tr("insight.customerTitle", { share: fmtPct(share(c.net)), customer: lab(c.key) }),
      body: tr("insight.customerBody", {
        customer: lab(c.key),
        net: fmtMoney(c.net),
        top3: fmtPct(share(top3)),
        n: fmtInt(customers.length),
        hhi: fmtInt(Math.round(hhi)),
        level: tr(hhi > 2500 ? "insight.hhiHigh" : hhi > 1500 ? "insight.hhiMid" : "insight.hhiLow"),
      }),
      drill: { dim: "partner", value: c.key },
    });
  }

  // Best-selling product
  if (products.length > 1) {
    const [a, b] = products;
    const byQty = [...products].sort((x, y) => y.qty - x.qty)[0];
    out.push({
      tone: "good",
      title: tr("insight.productTitle", { product: lab(a.key), share: fmtPct(share(a.net)) }),
      body: tr(byQty.key === a.key ? "insight.productBodySame" : "insight.productBody", {
        net: fmtMoney(a.net),
        qty: fmtQty(a.qty),
        second: lab(b.key),
        top2: fmtPct(share(a.net + b.net)),
        n: fmtInt(products.length),
        volume: lab(byQty.key),
        volumeQty: fmtQty(byQty.qty),
      }),
      drill: { dim: "product", value: a.key },
    });
  }

  // Channel mix (B2B vs B2C)
  if (channels.length > 1) {
    const b2b = channels.find((c) => c.key === "B2B");
    const b2c = channels.find((c) => c.key === "B2C");
    if (b2b && b2c) {
      const unit = (x: QAgg) => (x.qty ? x.net / x.qty : 0);
      out.push({
        tone: "info",
        title: tr("insight.channelTitle", { share: fmtPct(share(b2c.net)) }),
        body: tr("insight.channelBody", {
          b2c: fmtMoney(b2c.net),
          b2b: fmtMoney(b2b.net),
          b2bShare: fmtPct(share(b2b.net)),
          b2cUnit: fmtPrice(Math.round(unit(b2c) * 100) / 100),
          b2bUnit: fmtPrice(Math.round(unit(b2b) * 100) / 100),
        }),
        drill: { dim: "channel", value: "B2B" },
      });
    }
  }

  // Price spread: the same product sold at different unit prices
  const prices = (d.prices ?? []).filter((p) => p.price > 0 && p.qty > 0);
  if (!filtersOn.product && prices.length) {
    const byProduct = new Map<string, typeof prices>();
    prices.forEach((p) => byProduct.set(p.product, [...(byProduct.get(p.product) ?? []), p]));
    let best: { product: string; lo: number; hi: number; points: number; qty: number } | null = null;
    byProduct.forEach((rows, product) => {
      if (rows.length < 2) return;
      const lo = Math.min(...rows.map((r) => r.price)),
        hi = Math.max(...rows.map((r) => r.price));
      const qty = rows.reduce((s, r) => s + r.qty, 0);
      if (hi / lo >= 1.05 && (!best || (hi / lo - 1) * qty > (best.hi / best.lo - 1) * best.qty)) best = { product, lo, hi, points: rows.length, qty };
    });
    const bp = best as { product: string; lo: number; hi: number; points: number; qty: number } | null;
    if (bp) {
      out.push({
        tone: "warn",
        title: tr("insight.priceTitle", { product: lab(bp.product), lo: fmtPrice(bp.lo), hi: fmtPrice(bp.hi) }),
        body: tr("insight.priceBody", { n: bp.points, gap: fmtPct(bp.hi / bp.lo - 1), qty: fmtQty(bp.qty) }),
        drill: { dim: "product", value: bp.product },
      });
    }
  }

  // Free goods: units with a zero price
  const free = (d.prices ?? []).filter((p) => p.price === 0 && p.qty > 0);
  if (free.length) {
    const qty = free.reduce((s, p) => s + p.qty, 0);
    const top = [...free].sort((a, b) => b.qty - a.qty)[0];
    out.push({
      tone: "warn",
      title: tr("insight.freeTitle", { qty: fmtQty(qty) }),
      body: tr("insight.freeBody", { n: free.length, product: lab(top.product), topQty: fmtQty(top.qty) }),
      drill: { dim: "product", value: top.product },
    });
  }

  // Leading sales route
  const realRoutes = routes.filter((r) => r.key !== "B2B direct");
  if (realRoutes.length > 1) {
    const r = realRoutes[0];
    out.push({
      tone: share(r.net) > 0.3 ? "warn" : "info",
      title: tr("insight.routeTitle", { route: lab(r.key), share: fmtPct(share(r.net)) }),
      body: tr((d.routes?.find((x) => x.key === r.key)?.customers ?? 0) === 1 ? "insight.routeBodyOne" : "insight.routeBody", {
        net: fmtMoney(r.net),
        median: fmtMoney(median(realRoutes.map((x) => x.net))),
        n: fmtInt(realRoutes.length),
        customers: fmtInt(d.routes?.find((x) => x.key === r.key)?.customers ?? 0),
      }),
      drill: { dim: "route", value: r.key },
    });
  }

  // Cities
  const known = cities.filter((c) => c.key !== "Unknown");
  if (known.length > 1) {
    const c = known[0];
    const unknown = cities.find((x) => x.key === "Unknown");
    out.push({
      tone: "info",
      title: tr("insight.cityTitle", { city: lab(c.key), share: fmtPct(share(c.net)) }),
      body: tr(unknown ? "insight.cityBodyUnknown" : "insight.cityBody", {
        n: fmtInt(known.length),
        second: lab(known[1].key),
        secondShare: fmtPct(share(known[1].net)),
        unknown: fmtMoney(unknown?.net ?? 0),
        unknownShare: fmtPct(share(unknown?.net ?? 0)),
      }),
      drill: { dim: "city", value: unknown && share(unknown.net) > 0.1 ? "Unknown" : c.key },
    });
  }

  // Category mix
  if (categories.length > 1) {
    const [a, b] = categories;
    out.push({
      tone: "info",
      title: tr("insight.categoryTitle", { category: lab(a.key), share: fmtPct(share(a.net)) }),
      body: tr("insight.categoryBody", { second: lab(b.key), secondShare: fmtPct(share(b.net)), n: categories.length }),
      drill: { dim: "category", value: b.key },
    });
  }

  // Invoice size
  if (t.invoices > 1) {
    out.push({
      tone: "info",
      title: tr("insight.invoiceTitle", { avg: fmtMoney(t.net / t.invoices) }),
      body: tr("insight.invoiceBody", {
        n: fmtInt(t.invoices),
        lines: (t.lines / t.invoices).toFixed(1),
        qty: fmtQty(Math.round((t.qty / t.invoices) * 10) / 10),
        customers: fmtInt(t.customers),
      }),
    });
  }

  // Busiest period
  const pts = d.series?.points ?? [];
  if (pts.length > 2) {
    const peak = [...pts].sort((x, y) => y.net - x.net)[0];
    const g = d.series!.grain;
    const label = (s: string) =>
      g === "month"
        ? localDate(s).toLocaleDateString(intl, { month: "long", year: "numeric" })
        : localDate(s).toLocaleDateString(intl, { day: "2-digit", month: "short", year: "numeric", weekday: g === "day" ? "short" : undefined });
    const active = pts.filter((p) => p.net !== 0).length || 1;
    out.push({
      tone: "info",
      title: tr(g === "day" ? "insight.peakDayTitle" : g === "week" ? "insight.peakWeekTitle" : "insight.peakMonthTitle", { when: label(peak.start) }),
      body: tr("insight.peakBody", { net: fmtMoney(peak.net), invoices: fmtInt(peak.invoices), avg: fmtMoney(t.net / active) }),
    });
  }
  return out;
}
