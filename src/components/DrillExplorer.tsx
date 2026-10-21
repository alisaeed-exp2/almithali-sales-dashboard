"use client";
import { useMemo, useState } from "react";
import type { Metric, QDim, QFilters } from "@/lib/dash-types";
import { fetchQuery, toAgg, useQuery } from "@/lib/client-data";
import { fmtInt, fmtMoney, fmtQty } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { BarList } from "./charts/BarList";
import { InvoiceTable } from "./InvoiceTable";

const HIERARCHIES: { key: string; levels: QDim[] }[] = [
  { key: "channel", levels: ["channel", "route", "partner", "product"] },
  { key: "geography", levels: ["city", "partner", "category", "product"] },
  { key: "customer", levels: ["partner", "category", "product"] },
  { key: "product", levels: ["category", "brand", "product", "partner"] },
  { key: "route", levels: ["route", "partner", "product"] },
];

interface Props {
  filters: QFilters;
  metric: Metric;
  refreshKey: string;
  onApply: (path: { dim: QDim; value: string }[]) => void;
  onInvoice: (entry: string) => void;
}

/** Click down a hierarchy level by level, ending at the invoices (and from there, their lines). */
export function DrillExplorer({ filters, metric, refreshKey, onApply, onInvoice }: Props) {
  const { t, v: lab, dimLabel, dir } = useI18n();
  const [h, setH] = useState(0);
  const [path, setPath] = useState<{ dim: QDim; value: string }[]>([]);
  const levels = HIERARCHIES[h].levels;
  const atLeaf = path.length >= levels.length;
  const dim = levels[Math.min(path.length, levels.length - 1)];
  const arrow = dir === "rtl" ? " ← " : " → ";

  // The dashboard filters narrowed by the drill path.
  const scoped = useMemo<QFilters>(() => {
    const dims = { ...filters.dims };
    path.forEach((p) => (dims[p.dim] = [p.value]));
    return { ...filters, dims };
  }, [filters, path]);

  const key = `${JSON.stringify(scoped)}|${dim}|${refreshKey}`;
  const { data, loading } = useQuery((signal) => fetchQuery({ filters: scoped, parts: ["totals", "dims"], dims: [dim] }, signal), key);
  const tot = data?.totals;
  // The level's own dimension may already be filtered on the dashboard; keep only the allowed values.
  const allowed = scoped.dims[dim];
  const rows = (data?.dims?.[dim] ?? []).filter((r) => !allowed?.length || allowed.includes(r.key)).map(toAgg);

  return (
    <div className="drill">
      <div className="drill-top">
        <div className="seg" role="tablist" aria-label={t("drill.path")}>
          {HIERARCHIES.map((x, i) => (
            <button
              key={x.key}
              role="tab"
              aria-selected={i === h}
              className={i === h ? "is-on" : ""}
              onClick={() => {
                setH(i);
                setPath([]);
              }}
              title={x.levels.map(dimLabel).join(arrow)}
            >
              {t(`drill.${x.key}`)}
            </button>
          ))}
        </div>
        <span className="drill-levels">
          {levels.map(dimLabel).join(arrow)}
          {arrow}
          {t("drill.invoicesLevel")}
        </span>
      </div>

      <nav className="crumbs" aria-label={t("drill.breadcrumb")}>
        <button onClick={() => setPath([])} className={path.length === 0 ? "is-current" : ""}>
          {t("drill.allSales")}
        </button>
        {path.map((p, i) => (
          <span key={i}>
            <span className="crumb-sep">/</span>
            <button onClick={() => setPath(path.slice(0, i + 1))} className={i === path.length - 1 ? "is-current" : ""}>
              {lab(p.value)}
            </button>
          </span>
        ))}
      </nav>

      <div className={`drill-summary${loading ? " is-loading" : ""}`}>
        <span>
          <b className="num">{fmtMoney(tot?.net ?? 0)}</b> {t("drill.net")}
        </span>
        <span>
          <b className="num">{fmtQty(tot?.qty ?? 0)}</b> {t("drill.units")}
        </span>
        <span>
          <b className="num">{fmtInt(tot?.invoices ?? 0)}</b> {t("drill.invoices")}
        </span>
        {path.length > 0 && (
          <button className="btn btn-small" onClick={() => onApply(path)}>
            {t("drill.apply")}
          </button>
        )}
      </div>

      {!atLeaf ? (
        <>
          <div className="drill-level-label">
            {t("drill.level", { n: path.length + 1, total: levels.length })} <b>{dimLabel(dim)}</b> · {t("drill.clickToDrill")}
          </div>
          {/* Until this level's own list arrives, show loading rather than the previous level's bars (or "no sales"). */}
          {data?.dims?.[dim] && !loading ? (
            <BarList rows={rows} metric={metric} limit={12} onToggle={(k) => setPath([...path, { dim, value: k }])} />
          ) : (
            <div className="empty">{t("state.loading")}</div>
          )}
        </>
      ) : (
        <div className="drill-visits">
          <div className="drill-level-label">{t("drill.individual")}</div>
          <InvoiceTable filters={scoped} cols={["date", "invoice", "partner", "net"]} pageSize={10} compact onRow={(v) => onInvoice(v.journal_entry)} refreshKey={refreshKey} />
        </div>
      )}
    </div>
  );
}
