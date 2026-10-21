"use client";
import { useState } from "react";
import type { Agg } from "@/lib/analytics";
import { metricOf } from "@/lib/analytics";
import type { Metric } from "@/lib/dash-types";
import { fmtInt, fmtMoney, fmtPct, fmtPrice, fmtQty } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { TipRows, useTooltip } from "./useTooltip";

interface Props {
  rows: Agg[];
  metric: Metric;
  selected?: string[];
  onToggle?: (key: string) => void;
  onDrill?: (key: string) => void;
  limit?: number;
  sublabel?: (key: string) => string | undefined;
  /** Show raw keys (e.g. agent names) instead of translated display values. */
  raw?: boolean;
}

export const fmtMetric = (v: number, m: Metric) => (m === "qty" ? fmtQty(v) : fmtMoney(v));

/** Ranked horizontal bars. Click a row to cross-filter; the arrow opens the drill-down. */
export function BarList({ rows, metric, selected = [], onToggle, onDrill, limit = 8, sublabel, raw }: Props) {
  const { t, v: lab } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const tip = useTooltip();
  const total = rows.reduce((s, r) => s + metricOf(r, metric), 0);
  const max = Math.max(1e-9, ...rows.map((r) => metricOf(r, metric)));
  const shown = expanded ? rows : rows.slice(0, limit);
  const anySel = selected.length > 0;
  const name = (k: string) => (raw ? k : lab(k));

  if (!rows.length) return <div className="empty">{t("chart.empty")}</div>;

  return (
    <div className="barlist">
      {shown.map((r) => {
        const val = metricOf(r, metric);
        const isSel = selected.includes(r.key);
        const sub = sublabel?.(r.key);
        return (
          <div
            key={r.key}
            className={`barlist-row${isSel ? " is-selected" : ""}${anySel && !isSel ? " is-dimmed" : ""}`}
            onMouseMove={(e) =>
              tip.show(
                e,
                <TipRows
                  title={name(r.key)}
                  rows={[
                    [t("chart.net"), fmtMoney(r.net)],
                    [t("chart.gross"), fmtMoney(r.gross)],
                    [t("chart.qty"), fmtQty(r.qty)],
                    [t("chart.avgPrice"), r.qty ? fmtPrice(Math.round((r.net / r.qty) * 100) / 100) : "—"],
                    [t("chart.lines"), fmtInt(r.lines)],
                    [t(metric === "qty" ? "chart.shareQty" : "chart.shareRevenue"), fmtPct(val / (total || 1))],
                  ]}
                />,
              )
            }
            onMouseLeave={tip.hide}
          >
            <button
              className="barlist-main"
              onClick={() => onToggle?.(r.key)}
              aria-pressed={isSel}
              title={onToggle ? (isSel ? t("chart.removeFilter") : t("chart.filterTo", { v: name(r.key) })) : undefined}
            >
              <span className="barlist-label">
                <span className="barlist-name">{name(r.key)}</span>
                {sub && <span className="barlist-sub">{sub}</span>}
              </span>
              <span className="barlist-track">
                <span className="barlist-fill" style={{ width: `${(val / max) * 100}%` }} />
              </span>
              <span className="barlist-value num">{fmtMetric(val, metric)}</span>
              <span className="barlist-share num">{fmtPct(val / (total || 1))}</span>
            </button>
            {onDrill && (
              <button className="icon-btn drill-btn" onClick={() => onDrill(r.key)} aria-label={t("chart.drillInto", { v: name(r.key) })} title={t("chart.drillInto", { v: name(r.key) })}>
                <svg className="flip-rtl" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        );
      })}
      {rows.length > limit && (
        <button className="link-btn" onClick={() => setExpanded(!expanded)}>
          {expanded ? t("chart.showFewer") : t("chart.showAll", { n: rows.length })}
        </button>
      )}
      {tip.node}
    </div>
  );
}
