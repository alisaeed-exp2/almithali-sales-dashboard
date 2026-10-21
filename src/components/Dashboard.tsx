"use client";
import { useMemo, useRef, useState, type ReactNode } from "react";
import type { Metric, QCustomerRow, QDim, QFilters, QLine, QPriceRow, QResult, QRouteRow } from "@/lib/dash-types";
import { METRICS, emptyQFilters } from "@/lib/dash-types";
import { exportUrl, fetchQuery, localDate, toAgg, toPoint, useQuery } from "@/lib/client-data";
import { insights as buildInsights } from "@/lib/insights";
import type { TimePoint } from "@/lib/analytics";
import { fmtDate, fmtDateTime, fmtInt, fmtMoney, fmtPct, fmtPrice, fmtQty } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { BrandLogo } from "./BrandLogo";
import { UploadDialog } from "./UploadDialog";
import { FilterBar } from "./FilterBar";
import { KpiCards } from "./KpiCards";
import { Insights } from "./Insights";
import { BarList } from "./charts/BarList";
import { TimeChart } from "./charts/TimeChart";
import { Donut } from "./charts/Donut";
import { Heatmap } from "./charts/Heatmap";
import { DrillExplorer } from "./DrillExplorer";
import { SortTable, type Col } from "./SortTable";
import { InvoiceTable } from "./InvoiceTable";
import { LineTable } from "./LineTable";
import { EntityDrawer, InvoiceDrawer, LineDrawer } from "./Drawer";

// Chart slots in brand colours, validated so neighbours stay distinct for colour-blind readers.
const SLOTS = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

const NAV: { id: string; key: string; icon: string }[] = [
  { id: "overview", key: "nav.overview", icon: "M3 13h4v8H3zM10 8h4v13h-4zM17 3h4v18h-4z" },
  { id: "insights", key: "nav.insights", icon: "M12 3a6 6 0 0 0-3.5 10.9V17h7v-3.1A6 6 0 0 0 12 3zM9.5 20h5" },
  { id: "trend", key: "nav.trend", icon: "M3 17l6-6 4 4 8-8M15 7h6v6" },
  { id: "customers", key: "nav.customers", icon: "M4 6h16M4 12h10M4 18h13" },
  { id: "mix", key: "nav.mix", icon: "M12 3v9l7 4M12 21a9 9 0 1 1 0-18 9 9 0 0 1 0 18z" },
  { id: "matrix", key: "nav.matrix", icon: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" },
  { id: "drill", key: "nav.drill", icon: "M4 5h16M7 10h10M10 15h4M11.5 19h1" },
  { id: "prices", key: "nav.prices", icon: "M3 12l9-9h8v8l-9 9zM15.5 8.5h.01" },
  { id: "scorecard", key: "nav.scorecard", icon: "M5 3h14v18H5zM9 8h6M9 12h6M9 16h3" },
  { id: "routes", key: "nav.routes", icon: "M5 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM19 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM7 17h6a4 4 0 0 0 0-8h-2a4 4 0 0 1 0-8h6" },
  { id: "invoices", key: "nav.invoices", icon: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6" },
  { id: "lines", key: "nav.lines", icon: "M4 6h16M4 10h16M4 14h16M4 18h10" },
];

function Card({ id, title, sub, actions, children, className = "" }: { id?: string; title: string; sub?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section id={id} className={`card ${className}`}>
      <header className="card-head">
        <div>
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="card-actions">{actions}</div>}
      </header>
      {children}
    </section>
  );
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Panel = { kind: "entity"; dim: QDim; value: string } | { kind: "invoice"; entry: string } | { kind: "line"; line: QLine } | null;

const DEFAULT_MATRIX = { rowDim: "route" as QDim, colDim: "category" as QDim };

export default function Dashboard({ initial, hasDatabase }: { initial: QResult | null; hasDatabase: boolean }) {
  const i18n = useI18n();
  const { t, v: lab, locale, dimLabel, metricLabel, intl } = i18n;
  const [filters, setFilters] = useState<QFilters>(emptyQFilters);
  const [metric, setMetric] = useState<Metric>("net");
  const [panel, setPanel] = useState<Panel>(null);
  const [hmRow, setHmRow] = useState<QDim>(DEFAULT_MATRIX.rowDim);
  const [hmCol, setHmCol] = useState<QDim>(DEFAULT_MATRIX.colDim);
  const [uploadOpen, setUploadOpen] = useState(false);
  const navToggle = useRef<HTMLInputElement>(null);
  const sep = locale === "ar" ? "، " : ", ";

  // A new server render (after an upload) changes this token, which makes every panel refetch.
  const refreshKey = `${initial?.totalsAll?.lines ?? 0}|${initial?.lastUpload?.uploadedAt ?? ""}`;
  const key = `${JSON.stringify(filters)}|${hmRow}|${hmCol}|${refreshKey}`;
  const { data, loading, error } = useQuery((signal) => fetchQuery({ filters, matrix: { rowDim: hmRow, colDim: hmCol } }, signal), key, initial);

  const d = data;
  const agg = useMemo(() => (d?.totals ? toAgg(d.totals) : null), [d]);
  const aggAll = useMemo(() => (d?.totalsAll ? toAgg(d.totalsAll) : null), [d]);
  const filtersOn = useMemo(() => Object.fromEntries(Object.entries(filters.dims).map(([k, v]) => [k, !!v?.length])) as Partial<Record<QDim, boolean>>, [filters]);
  const insightList = useMemo(() => (d ? buildInsights(d, filtersOn, i18n) : []), [d, filtersOn, i18n]);
  const points = useMemo<TimePoint[]>(() => (d?.series?.points ?? []).map(toPoint), [d]);
  const grain = d?.series?.grain ?? "day";
  const dimRows = (k: QDim) => (d?.dims?.[k] ?? []).map(toAgg);
  const nFilters = Object.values(filters.dims).filter((v) => v?.length).length + (filters.from || filters.to ? 1 : 0) + (filters.search ? 1 : 0);

  const colorFor = (dim: QDim) => {
    // Colour follows the entity (alphabetical over every value), never its rank.
    const keys = [...new Set([...(d?.values?.[dim] ?? []), ...(d?.dims?.[dim] ?? []).map((r) => r.key)])].sort();
    return (k: string) => SLOTS[Math.max(0, keys.indexOf(k)) % SLOTS.length];
  };

  // ---------- actions ----------
  const sel = (k: QDim) => filters.dims[k] ?? [];
  const toggle = (k: QDim) => (value: string) => {
    const cur = sel(k);
    setFilters({ ...filters, dims: { ...filters.dims, [k]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] } });
  };
  const setOnly = (pairs: { dim: QDim; value: string }[]) => {
    const dims = { ...filters.dims };
    pairs.forEach((p) => (dims[p.dim] = [p.value]));
    setFilters({ ...filters, dims });
    setPanel(null);
  };
  const openEntity = (dim: QDim) => (value: string) => setPanel({ kind: "entity", dim, value });
  const openInvoice = (entry: string) => setPanel({ kind: "invoice", entry });
  // Clicking a day, week or month column narrows the dates to it.
  const zoomTo =
    points.length > 1
      ? (p: TimePoint) => {
          const end = new Date(p.end);
          end.setDate(end.getDate() - 1);
          setFilters({ ...filters, from: ymd(p.start), to: ymd(end) });
        }
      : undefined;
  const closeNav = () => {
    if (navToggle.current) navToggle.current.checked = false;
  };

  // B2B net in the current selection (the channel list ignores its own filter, so respect it here).
  const chanSel = sel("channel");
  const b2b = !chanSel.length || chanSel.includes("B2B") ? (d?.dims?.channel?.find((c) => c.key === "B2B")?.net ?? 0) : 0;

  // ---------- tables ----------
  const customerCols: Col<QCustomerRow>[] = [
    { key: "customer", label: t("table.customer"), value: (r) => lab(r.key), render: (r) => <span className="strong clip">{lab(r.key)}</span> },
    { key: "city", label: t("table.city"), value: (r) => lab(r.city), render: (r) => lab(r.city) },
    { key: "channel", label: t("table.channel"), value: (r) => r.channel, render: (r) => <span className={`tag tag-${r.channel.toLowerCase()}`}>{lab(r.channel)}</span> },
    { key: "routes", label: t("table.routes"), value: (r) => r.routes.join(" "), render: (r) => <span className="num">{r.routes.map(lab).join(sep)}</span> },
    { key: "invoices", label: t("table.invoices"), value: (r) => r.invoices, align: "end", render: (r) => fmtInt(r.invoices) },
    { key: "qty", label: t("table.qty"), value: (r) => r.qty, align: "end", render: (r) => fmtQty(r.qty) },
    { key: "net", label: t("table.net"), value: (r) => r.net, align: "end", bar: true, render: (r) => fmtMoney(r.net) },
    { key: "share", label: t("table.share"), value: (r) => r.net / (agg?.net || 1), align: "end", render: (r) => fmtPct(r.net / (agg?.net || 1)) },
    { key: "avg", label: t("table.avgInvoice"), value: (r) => r.net / (r.invoices || 1), align: "end", render: (r) => fmtMoney(r.net / (r.invoices || 1)) },
    { key: "top", label: t("table.topProduct"), value: (r) => lab(r.topProduct), render: (r) => (<span className="clip">{lab(r.topProduct)} <span className="num muted">({fmtPct(r.topShare)})</span></span>) },
    { key: "products", label: t("table.products"), value: (r) => r.products, align: "end" },
    { key: "last", label: t("table.lastOrder"), value: (r) => r.lastDay, render: (r) => <span className="num">{r.lastDay}</span> },
  ];

  const routeCols: Col<QRouteRow>[] = [
    { key: "route", label: t("table.route"), value: (r) => r.key, render: (r) => <span className="strong num">{lab(r.key)}</span> },
    { key: "channel", label: t("table.channel"), value: (r) => r.channel, render: (r) => <span className={`tag tag-${r.channel.toLowerCase()}`}>{lab(r.channel)}</span> },
    { key: "cities", label: t("table.cities"), value: (r) => r.cities.join(" "), render: (r) => r.cities.map(lab).join(sep) },
    { key: "customers", label: t("table.customers"), value: (r) => r.customers, align: "end" },
    { key: "invoices", label: t("table.invoices"), value: (r) => r.invoices, align: "end", render: (r) => fmtInt(r.invoices) },
    { key: "qty", label: t("table.qty"), value: (r) => r.qty, align: "end", bar: true, render: (r) => fmtQty(r.qty) },
    { key: "net", label: t("table.net"), value: (r) => r.net, align: "end", bar: true, render: (r) => fmtMoney(r.net) },
    { key: "share", label: t("table.share"), value: (r) => r.net / (agg?.net || 1), align: "end", render: (r) => fmtPct(r.net / (agg?.net || 1)) },
    { key: "avg", label: t("table.avgInvoice"), value: (r) => r.net / (r.invoices || 1), align: "end", render: (r) => fmtMoney(r.net / (r.invoices || 1)) },
    { key: "top", label: t("table.topCustomer"), value: (r) => lab(r.topCustomer), render: (r) => (<span className="clip">{lab(r.topCustomer)} <span className="num muted">({fmtPct(r.topShare)})</span></span>) },
    { key: "last", label: t("table.lastSale"), value: (r) => r.lastDay, render: (r) => <span className="num">{r.lastDay}</span> },
  ];

  const priceCols: Col<QPriceRow>[] = [
    { key: "product", label: t("table.product"), value: (r) => lab(r.product), render: (r) => <span className="strong clip">{lab(r.product)}</span> },
    { key: "price", label: t("table.price"), value: (r) => r.price, align: "end", render: (r) => fmtPrice(r.price) },
    { key: "qty", label: t("table.qty"), value: (r) => r.qty, align: "end", bar: true, render: (r) => fmtQty(r.qty) },
    { key: "net", label: t("table.netShort"), value: (r) => r.net, align: "end", render: (r) => fmtMoney(r.net) },
    { key: "customers", label: t("table.customers"), value: (r) => r.customers, align: "end" },
    { key: "channels", label: t("table.channel"), value: (r) => r.channels.join(" "), render: (r) => r.channels.map(lab).join(" · ") },
  ];

  // Matrix cells → the heatmap's lookup.
  const hm = useMemo(() => {
    const cells = d?.matrix?.cells ?? [];
    const map = new Map(cells.map((c) => [`${c.r}\u0000${c.c}`, toAgg(c.agg)]));
    const sum = (keyOf: (c: (typeof cells)[number]) => string) => {
      const m = new Map<string, number>();
      cells.forEach((c) => m.set(keyOf(c), (m.get(keyOf(c)) ?? 0) + c.agg.net));
      return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    };
    let max = 0;
    map.forEach((a) => (max = Math.max(max, a[metric])));
    return { rows: sum((c) => c.r).slice(0, 40), cols: sum((c) => c.c).slice(0, 15), get: (r: string, c: string) => map.get(`${r}\u0000${c}`), max };
  }, [d, metric]);

  const range = d?.range;
  const span = (a: string, b: string) => (a === b ? fmtDate(localDate(a), intl) : `${fmtDate(localDate(a), intl)} – ${fmtDate(localDate(b), intl)}`);
  const period: ReactNode = range ? span(range.min, range.max) : "—";
  // The header shows the dates being looked at; the side menu always shows what the database holds.
  const viewPeriod: ReactNode = range ? span(filters.from || range.min, filters.to || range.max) : "—";
  const dimOptions: QDim[] = ["route", "partner", "city", "channel", "category", "brand", "product"];
  const other = locale === "ar" ? "en" : "ar";
  const empty = !!d && !d.totalsAll?.lines;

  return (
    <div className="shell">
      <input type="checkbox" id="nav-toggle" className="nav-toggle" ref={navToggle} aria-hidden="true" tabIndex={-1} />
      <aside className="sidenav" aria-label={t("nav.menu")}>
        <div className="sidenav-brand">
          <BrandLogo width={150} alt={t("brand.logoAlt")} />
          <div className="sidenav-product">{t("brand.product")}</div>
        </div>
        <nav className="sidenav-links">
          {NAV.map((n) => (
            <a key={n.id} href={`#${n.id}`} onClick={closeNav}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path d={n.icon} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t(n.key)}
            </a>
          ))}
        </nav>
        <div className="sidenav-foot">
          <dl>
            <dt>{t("nav.period")}</dt>
            <dd>{period}</dd>
            <dt>{t("data.stored")}</dt>
            <dd className="num">{t("data.storedValue", { lines: fmtInt(d?.totalsAll?.lines ?? 0), invoices: fmtInt(d?.totalsAll?.invoices ?? 0) })}</dd>
            {d?.lastUpload && (
              <>
                <dt>{t("data.lastUpload")}</dt>
                <dd className="src">{t("data.lastUploadValue", { file: d.lastUpload.fileName, when: fmtDateTime(new Date(d.lastUpload.uploadedAt), intl) })}</dd>
              </>
            )}
          </dl>
          <a className="lang-toggle" href={`/${other}`} hrefLang={other} lang={other}>
            {t("nav.language")}
          </a>
        </div>
      </aside>
      <label htmlFor="nav-toggle" className="nav-backdrop" aria-label={t("nav.closeMenu")} />

      <div className="main">
        <header className="topbar">
          <label htmlFor="nav-toggle" className="icon-btn burger" aria-label={t("nav.menu")}>
            <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </label>
          <div className="title-block">
            <div className="kicker">{t("header.kicker")}</div>
            <h1>{t("header.title")}</h1>
            <p className="period">
              {viewPeriod} · {t("header.invoicesCount", { n: fmtInt(d?.totals?.invoices ?? 0) })}
              {loading && <span className="loading-pill">{t("state.updating")}</span>}
            </p>
          </div>
          <div className="top-actions">
            <div className="seg" role="radiogroup" aria-label={t("header.measure")}>
              {METRICS.map((m) => (
                <button key={m} role="radio" aria-checked={metric === m} className={metric === m ? "is-on" : ""} onClick={() => setMetric(m)}>
                  {metricLabel(m)}
                </button>
              ))}
            </div>
            {hasDatabase && (
              <button className="btn" onClick={() => setUploadOpen(true)}>
                <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 16V4M7 9l5-5 5 5M4 20h16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {t("data.uploadButton")}
              </button>
            )}
            <a className="btn btn-secondary" href={exportUrl(filters)}>
              {t("header.exportCsv")}
            </a>
          </div>
        </header>

        <div className={`content${loading ? " is-loading" : ""}`}>
          {!hasDatabase && <div className="notice notice-warn">{t("state.noDatabase")}</div>}
          {empty && (
            <div className="notice notice-info empty-state">
              <b>{t("state.emptyTitle")}</b> {t("state.emptyBody")}
              <button className="btn btn-small" onClick={() => setUploadOpen(true)}>
                {t("data.uploadButton")}
              </button>
            </div>
          )}
          {error && (
            <div className="notice notice-bad" role="alert">
              {t("state.error")}
            </div>
          )}

          <FilterBar data={d} filters={filters} setFilters={setFilters} />

          {agg && aggAll && d?.totals && (
            <div id="overview" className="anchor">
              <KpiCards
                t={agg}
                all={aggAll}
                filtered={nFilters > 0}
                invoices={d.totals.invoices}
                invoicesAll={d.totalsAll?.invoices ?? 0}
                customers={d.totals.customers}
                routes={d.totals.routes}
                products={d.totals.products}
                b2b={b2b}
                onB2B={() => openEntity("channel")("B2B")}
              />
            </div>
          )}

          <Card id="insights" title={t("sections.insights")} sub={t(nFilters ? "sections.insightsSubFiltered" : "sections.insightsSubAll")}>
            <Insights items={insightList} onDrill={(dm, v) => openEntity(dm)(v)} />
          </Card>

          <div id="trend">
            <Card title={t("sections.overTime", { metric: metricLabel(metric) })} sub={t(zoomTo ? "sections.overTimeSub" : "sections.overTimeSubNoZoom", { grain: t(`grain.${grain}`) })}>
              <TimeChart points={points} grain={grain} metric={metric} onPick={zoomTo} />
            </Card>
          </div>

          <div id="customers" className="grid g-1-1">
            <Card title={t("sections.customers")} sub={t("sections.customersSub")}>
              <BarList rows={dimRows("partner")} metric={metric} selected={sel("partner")} onToggle={toggle("partner")} onDrill={openEntity("partner")} limit={10} />
            </Card>
            <Card title={t("sections.products")} sub={t("sections.productsSub")}>
              <BarList rows={dimRows("product")} metric={metric} selected={sel("product")} onToggle={toggle("product")} onDrill={openEntity("product")} limit={10} />
            </Card>
          </div>

          <div id="mix" className="grid g-1-1-1">
            <Card title={t("sections.channel")} sub={t("sections.channelSub")}>
              <Donut rows={dimRows("channel")} metric={metric} colorOf={colorFor("channel")} selected={sel("channel")} onToggle={toggle("channel")} centerLabel={t("sections.channel")} />
              <div className="sub-split">
                <h3 className="mini-h">{t("sections.routes")}</h3>
                <BarList rows={dimRows("route")} metric={metric} selected={sel("route")} onToggle={toggle("route")} onDrill={openEntity("route")} limit={6} />
              </div>
            </Card>
            <Card title={t("sections.category")} sub={t("sections.categorySub")}>
              <Donut rows={dimRows("category")} metric={metric} colorOf={colorFor("category")} selected={sel("category")} onToggle={toggle("category")} centerLabel={t("sections.category")} />
              <div className="sub-split">
                <h3 className="mini-h">{t("sections.brand")}</h3>
                <BarList rows={dimRows("brand")} metric={metric} selected={sel("brand")} onToggle={toggle("brand")} onDrill={openEntity("brand")} />
              </div>
            </Card>
            <Card title={t("sections.cities")} sub={t("sections.citiesSub")}>
              <BarList rows={dimRows("city")} metric={metric} selected={sel("city")} onToggle={toggle("city")} onDrill={openEntity("city")} />
            </Card>
          </div>

          <Card
            id="matrix"
            title={t("sections.matrix")}
            sub={t("sections.matrixSub")}
            actions={
              <div className="hm-controls">
                <label htmlFor="hm-row">
                  {t("sections.rows")}
                  <select id="hm-row" value={hmRow} onChange={(e) => setHmRow(e.target.value as QDim)}>
                    {dimOptions.filter((x) => x !== hmCol).map((x) => (
                      <option key={x} value={x}>
                        {dimLabel(x)}
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="hm-col">
                  {t("sections.columns")}
                  <select id="hm-col" value={hmCol} onChange={(e) => setHmCol(e.target.value as QDim)}>
                    {dimOptions.filter((x) => x !== hmRow).map((x) => (
                      <option key={x} value={x}>
                        {dimLabel(x)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            }
          >
            <Heatmap {...hm} metric={metric} onPick={(r, c) => setOnly([{ dim: hmRow, value: r }, { dim: hmCol, value: c }])} onRow={(r) => toggle(hmRow)(r)} onCol={(c) => toggle(hmCol)(c)} />
          </Card>

          <Card id="drill" title={t("sections.drill")} sub={t("sections.drillSub")}>
            <DrillExplorer filters={filters} metric={metric} refreshKey={refreshKey} onApply={setOnly} onInvoice={openInvoice} />
          </Card>

          <Card id="prices" title={t("sections.prices")} sub={t("sections.pricesSub")}>
            <SortTable rows={d?.prices ?? []} cols={priceCols} rowKey={(r) => `${r.product}|${r.price}`} initialSort="qty" onRow={(r) => openEntity("product")(r.product)} pageSize={12} />
          </Card>

          <Card id="scorecard" title={t("sections.scorecard")} sub={t("sections.scorecardSub")}>
            <SortTable rows={d?.customers ?? []} cols={customerCols} rowKey={(r) => r.key} initialSort="net" onRow={(r) => openEntity("partner")(r.key)} pageSize={15} />
          </Card>

          <Card id="routes" title={t("sections.routePerf")} sub={t("sections.routePerfSub")}>
            <SortTable rows={d?.routes ?? []} cols={routeCols} rowKey={(r) => r.key} initialSort="net" onRow={(r) => openEntity("route")(r.key)} pageSize={15} />
          </Card>

          <Card id="invoices" title={t("sections.invoices")} sub={t("sections.invoicesSub")}>
            <InvoiceTable
              filters={filters}
              cols={["date", "invoice", "partner", "city", "route", "channel", "lines", "qty", "net", "gross"]}
              pageSize={15}
              findBox
              refreshKey={refreshKey}
              onRow={(v) => openInvoice(v.journal_entry)}
            />
          </Card>

          <Card
            id="lines"
            title={t("sections.lines")}
            sub={t("sections.linesSub")}
            actions={
              <a className="btn btn-small" href={exportUrl(filters)}>
                {t("sections.exportRows", { n: fmtInt(agg?.lines ?? 0) })}
              </a>
            }
          >
            <LineTable
              filters={filters}
              cols={["date", "invoice", "partner", "product", "qty", "price", "net", "gross"]}
              pageSize={15}
              findBox
              refreshKey={refreshKey}
              onRow={(l) => setPanel({ kind: "line", line: l })}
              footer={(n) => t("sections.linesFooter", { n: fmtInt(n), net: fmtMoney(agg?.net ?? 0), gross: fmtMoney(agg?.gross ?? 0) })}
            />
          </Card>

          <footer className="foot">
            {t("sections.footnote", { last: range ? fmtDate(localDate(range.max), intl) : "—" })}
            <div className="foot-company">{t("brand.company")}</div>
          </footer>
        </div>
      </div>

      {panel?.kind === "entity" && (
        <EntityDrawer
          dim={panel.dim}
          value={panel.value}
          filters={filters}
          rankList={d?.dims?.[panel.dim] ?? []}
          scopeNet={agg?.net ?? 0}
          scopeQty={agg?.qty ?? 0}
          metric={metric}
          refreshKey={refreshKey}
          onClose={() => setPanel(null)}
          onFilter={(dm, v) => setOnly([{ dim: dm, value: v }])}
          onDrill={(dm, v) => setPanel({ kind: "entity", dim: dm, value: v })}
          onInvoice={openInvoice}
        />
      )}
      {panel?.kind === "invoice" && (
        <InvoiceDrawer entry={panel.entry} onClose={() => setPanel(null)} onDrill={(dm, v) => setPanel({ kind: "entity", dim: dm, value: v })} onLine={(l) => setPanel({ kind: "line", line: l })} />
      )}
      {panel?.kind === "line" && (
        <LineDrawer l={panel.line} onClose={() => setPanel(null)} onDrill={(dm, v) => setPanel({ kind: "entity", dim: dm, value: v })} onInvoice={openInvoice} />
      )}
      {uploadOpen && <UploadDialog onClose={() => setUploadOpen(false)} />}
    </div>
  );
}
