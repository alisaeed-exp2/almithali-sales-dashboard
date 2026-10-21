"use client";
import { useEffect, useMemo, type ReactNode } from "react";
import type { Metric, QDim, QFilters, QLine } from "@/lib/dash-types";
import { fetchLines, fetchQuery, localDate, toAgg, toPoint, useQuery } from "@/lib/client-data";
import { categoryOf, channelOf, cityOf, deriveProduct, routeOf } from "@/lib/normalize";
import { fmtDate, fmtInt, fmtMoney, fmtMoneyExact, fmtPct, fmtPrice, fmtQty } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { BarList } from "./charts/BarList";
import { TimeChart } from "./charts/TimeChart";
import { InvoiceTable } from "./InvoiceTable";

function Shell({ title, kicker, onClose, children, actions }: { title: string; kicker: string; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const { t } = useI18n();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <div className="kicker">{kicker}</div>
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label={t("drawer.close")}>
            ×
          </button>
        </header>
        {actions && <div className="drawer-actions">{actions}</div>}
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

/** What each profile breaks down into (each bar drills further). */
const BREAKDOWNS: Record<QDim, QDim[]> = {
  channel: ["route", "partner", "category"],
  route: ["partner", "product", "city"],
  city: ["partner", "route", "product"],
  partner: ["product", "category", "route"],
  category: ["product", "brand", "partner"],
  brand: ["product", "category", "partner"],
  product: ["partner", "route", "city"],
};

interface EntityProps {
  dim: QDim;
  value: string;
  filters: QFilters; // dashboard filters
  rankList: { key: string; net: number }[]; // the dashboard's list for this dimension (for the rank)
  scopeNet: number;
  scopeQty: number;
  metric: Metric;
  refreshKey: string;
  onClose: () => void;
  onFilter: (dim: QDim, value: string) => void;
  onDrill: (dim: QDim, value: string) => void;
  onInvoice: (entry: string) => void;
}

/** Profile of one customer, route, product… within the current filters. */
export function EntityDrawer({ dim, value, filters, rankList, scopeNet, scopeQty, metric, refreshKey, onClose, onFilter, onDrill, onInvoice }: EntityProps) {
  const { t, v: lab, dimLabel, intl, locale } = useI18n();
  const scoped = useMemo<QFilters>(() => ({ ...filters, dims: { ...filters.dims, [dim]: [value] } }), [filters, dim, value]);
  const key = `${JSON.stringify(scoped)}|${refreshKey}`;
  const parts = dim === "product" ? (["totals", "series", "dims", "prices"] as const) : (["totals", "series", "dims"] as const);
  const { data } = useQuery((signal) => fetchQuery({ filters: scoped, parts: [...parts], dims: BREAKDOWNS[dim] }, signal), key);
  const tot = data?.totals;
  const sorted = [...rankList].sort((a, b) => b.net - a.net);
  const rank = sorted.findIndex((r) => r.key === value) + 1;
  const points = (data?.series?.points ?? []).map(toPoint);
  const active = points.filter((p) => p.lines > 0);
  const info = dim === "product" ? deriveProduct(value) : null;

  return (
    <Shell
      title={lab(value)}
      kicker={info?.code ? `${dimLabel(dim)} · ${info.code}` : dimLabel(dim)}
      onClose={onClose}
      actions={
        <button className="btn" onClick={() => onFilter(dim, value)}>
          {t("drawer.filterThis", { dim: locale === "en" ? dimLabel(dim).toLowerCase() : dimLabel(dim) })}
        </button>
      }
    >
      {!data ? (
        <div className="empty">{t("state.loading")}</div>
      ) : (
        <>
          <div className="mini-kpis">
            <div>
              <span>{t("chart.net")}</span>
              <b className="num">{fmtMoney(tot?.net ?? 0)}</b>
              <em>{t("drawer.selection", { p: fmtPct((tot?.net ?? 0) / (scopeNet || 1)) })}</em>
            </div>
            <div>
              <span>{t("chart.qty")}</span>
              <b className="num">{fmtQty(tot?.qty ?? 0)}</b>
              <em>{t("drawer.selection", { p: fmtPct((tot?.qty ?? 0) / (scopeQty || 1)) })}</em>
            </div>
            <div>
              <span>{t("chart.invoices")}</span>
              <b className="num">{fmtInt(tot?.invoices ?? 0)}</b>
              <em>{t("drawer.avgInvoice", { v: fmtMoney(tot?.invoices ? tot.net / tot.invoices : 0) })}</em>
            </div>
            <div>
              <span>{t("drawer.rank")}</span>
              <b>
                <span className="num">{rank ? `#${rank}` : "—"}</span> <small>{t("drawer.of", { n: sorted.length })}</small>
              </b>
              <em>{t("drawer.grossVat", { v: fmtMoney(tot?.gross ?? 0) })}</em>
            </div>
          </div>
          {active.length > 0 && (
            <p className="drawer-note">
              {t("drawer.activeRange", {
                from: fmtDate(active[0].start, intl),
                to: fmtDate(new Date(active[active.length - 1].end.getTime() - 86_400_000), intl),
                customers: fmtInt(tot?.customers ?? 0),
                products: fmtInt(tot?.products ?? 0),
                price: tot?.qty ? fmtPrice(Math.round((tot.net / tot.qty) * 100) / 100) : "—",
              })}
            </p>
          )}

          <h3 className="drawer-h">{t(metric === "qty" ? "drawer.overTimeQty" : "drawer.overTimeSales")}</h3>
          <TimeChart points={points} grain={data.series?.grain ?? "day"} metric={metric} />

          {dim === "product" && (data.prices?.length ?? 0) > 0 && (
            <>
              <h3 className="drawer-h">{t("drawer.pricePoints")}</h3>
              <div className="price-points">
                {data.prices!.map((p) => (
                  <div key={`${p.price}`} className="price-point">
                    <b className="num">{fmtPrice(p.price)}</b>
                    <span>{t("drawer.pricePointNote", { qty: fmtQty(p.qty), customers: fmtInt(p.customers), channels: p.channels.map(lab).join(" · ") })}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          {BREAKDOWNS[dim].map((b) => (
            <div key={b}>
              <h3 className="drawer-h">{t("drawer.by", { dim: dimLabel(b) })}</h3>
              <BarList rows={(data.dims?.[b] ?? []).filter((r) => !scoped.dims[b]?.length || scoped.dims[b]!.includes(r.key)).map(toAgg)} metric={metric} limit={6} onToggle={(k) => onDrill(b, k)} />
            </div>
          ))}
          <p className="muted small-note">
            {t("drawer.periodNote", {
              from: data.range ? fmtDate(localDate(filters.from || data.range.min), intl) : "",
              to: data.range ? fmtDate(localDate(filters.to || data.range.max), intl) : "",
            })}
          </p>
        </>
      )}

      <h3 className="drawer-h">{t("drawer.invoices")}</h3>
      <InvoiceTable filters={scoped} cols={["date", "invoice", dim === "partner" ? "route" : "partner", "net"]} pageSize={10} compact onRow={(v) => onInvoice(v.journal_entry)} refreshKey={refreshKey} />
    </Shell>
  );
}

/** One invoice with all its lines (regardless of the dashboard filters). */
export function InvoiceDrawer({ entry, onClose, onDrill, onLine }: { entry: string; onClose: () => void; onDrill: (dim: QDim, value: string) => void; onLine: (l: QLine) => void }) {
  const { t, v: lab, dimLabel, intl } = useI18n();
  const { data, error } = useQuery((signal) => fetchLines({ filters: { dims: {}, from: "", to: "", search: "" }, invoice: entry, sort: "net", dir: "desc", pageSize: 200 }, signal), `inv|${entry}`);
  const rows = data?.rows ?? [];
  const first = rows[0];
  const sum = (f: (l: QLine) => number) => rows.reduce((s, l) => s + f(l), 0);
  const net = sum((l) => l.subtotal),
    gross = sum((l) => l.total);
  const link = (dim: QDim, value: string, cls = "") => (
    <button className={`link-btn ${cls}`} onClick={() => onDrill(dim, value)}>
      {lab(value)}
    </button>
  );
  const number = entry.replace(/\s*\(.*\)\s*$/, "");

  return (
    <Shell title={number} kicker={t("drawer.invoice")} onClose={onClose}>
      {!data ? (
        <div className="empty">{error ? t("state.error") : t("state.loading")}</div>
      ) : !first ? (
        <div className="empty">{t("table.noRows")}</div>
      ) : (
        <>
          <dl className="detail-list">
            {(
              [
                [t("drawer.date"), <span className="num">{fmtDate(localDate(first.invoice_date), intl)}</span>],
                [t("drawer.reference"), <span className="num">{first.reference || "—"}</span>],
                [dimLabel("partner"), link("partner", first.partner)],
                [dimLabel("city"), link("city", cityOf(first.partner_city))],
                [
                  `${dimLabel("route")} · ${dimLabel("channel")}`,
                  <>
                    {link("route", routeOf(first.reference), "num")} · {link("channel", channelOf(first.reference, first.invoice_type))}
                  </>,
                ],
                [t("drawer.totals"), <span className="num">{t("drawer.invoiceTotals", { lines: fmtInt(rows.length), qty: fmtQty(sum((l) => l.quantity)) })}</span>],
                [t("drawer.net"), <span className="num">{fmtMoneyExact(net)}</span>],
                [t("drawer.vat"), <span className="num">{fmtMoneyExact(gross - net)}</span>],
                [t("drawer.gross"), <span className="num strong">{fmtMoneyExact(gross)}</span>],
              ] as [string, ReactNode][]
            ).map(([k, val]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{val}</dd>
              </div>
            ))}
          </dl>
          <h3 className="drawer-h">{t("drawer.lines", { n: fmtInt(rows.length) })}</h3>
          <div className="table-wrap">
            <table className="table rtable compact">
              <thead>
                <tr>
                  <th>
                    <span className="th-btn">{t("table.product")}</span>
                  </th>
                  <th className="r">
                    <span className="th-btn">{t("table.qty")}</span>
                  </th>
                  <th className="r">
                    <span className="th-btn">{t("table.price")}</span>
                  </th>
                  <th className="r">
                    <span className="th-btn">{t("table.netShort")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.line_key} className="clickable" onClick={() => onLine(l)}>
                    <td data-label={t("table.product")}>
                      <span className="clip">{lab(l.product)}</span>
                    </td>
                    <td data-label={t("table.qty")} className="r num">
                      {fmtQty(l.quantity)}
                    </td>
                    <td data-label={t("table.price")} className="r num">
                      {fmtPrice(l.unit_price)}
                    </td>
                    <td data-label={t("table.netShort")} className="r num">
                      {fmtMoneyExact(l.subtotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Shell>
  );
}

/** One invoice line. */
export function LineDrawer({ l, onClose, onDrill, onInvoice }: { l: QLine; onClose: () => void; onDrill: (dim: QDim, value: string) => void; onInvoice: (entry: string) => void }) {
  const { t, v: lab, dimLabel, intl } = useI18n();
  const info = deriveProduct(l.product);
  const link = (dim: QDim, value: string) => (
    <button className="link-btn" onClick={() => onDrill(dim, value)}>
      {lab(value)}
    </button>
  );
  const rows: [string, ReactNode][] = [
    [
      t("drawer.invoice"),
      <button className="link-btn num" onClick={() => onInvoice(l.journal_entry)}>
        {l.journal_entry}
      </button>,
    ],
    [t("drawer.date"), <span className="num">{fmtDate(localDate(l.invoice_date), intl)}</span>],
    [dimLabel("partner"), link("partner", l.partner)],
    [`${dimLabel("route")} · ${dimLabel("channel")}`, <>{link("route", routeOf(l.reference))} · {link("channel", channelOf(l.reference, l.invoice_type))}</>],
    [dimLabel("city"), link("city", cityOf(l.partner_city))],
    [dimLabel("product"), link("product", l.product)],
    [t("drawer.codeCategoryBrand"), <>{info.code || "—"} · {link("category", categoryOf(l.product, l.product_category))} · {link("brand", info.brand)}</>],
    [t("table.qty"), <span className="num">{fmtQty(l.quantity)}</span>],
    [t("table.price"), <span className="num">{fmtPrice(l.unit_price)}</span>],
    [t("drawer.net"), <span className="num">{fmtMoneyExact(l.subtotal)}</span>],
    [t("drawer.vat"), <span className="num">{fmtMoneyExact(l.total - l.subtotal)}</span>],
    [t("drawer.gross"), <span className="num strong">{fmtMoneyExact(l.total)}</span>],
  ];
  return (
    <Shell title={lab(l.product)} kicker={t("drawer.line")} onClose={onClose}>
      <dl className="detail-list">
        {rows.map(([k, val]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{val}</dd>
          </div>
        ))}
      </dl>
    </Shell>
  );
}
