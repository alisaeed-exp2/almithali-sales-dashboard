"use client";
import type { Agg } from "@/lib/analytics";
import { metricOf } from "@/lib/analytics";
import type { Metric } from "@/lib/dash-types";
import { fmtIntShort, fmtMoney, fmtPct, fmtQty } from "@/lib/format";
import { fmtMetric } from "./BarList";
import { useI18n } from "@/lib/i18n";
import { TipRows, useTooltip } from "./useTooltip";

interface Props {
  rows: Agg[];
  metric: Metric;
  colorOf: (key: string) => string;
  selected?: string[];
  onToggle?: (key: string) => void;
  centerLabel: string;
}

/** Part-to-whole for a handful (≤5) of categories. Legend carries labels and values so identity is never colour-only. */
export function Donut({ rows, metric, colorOf, selected = [], onToggle, centerLabel }: Props) {
  const { t, v: lab } = useI18n();
  const tip = useTooltip();
  const total = rows.reduce((s, r) => s + metricOf(r, metric), 0);
  const R = 70,
    r = 46,
    C = 80;
  let a0 = -Math.PI / 2;
  const anySel = selected.length > 0;

  if (!rows.length || total <= 0) return <div className="empty">{t("chart.empty")}</div>;

  const arcs = rows.map((row) => {
    const v = metricOf(row, metric);
    const frac = v / total;
    const a1 = a0 + frac * Math.PI * 2;
    const pad = rows.length > 1 ? 0.012 : 0;
    const s = a0 + pad,
      e = Math.max(s, a1 - pad);
    a0 = a1;
    const large = e - s > Math.PI ? 1 : 0;
    const p = (rad: number, ang: number) => `${C + rad * Math.cos(ang)},${C + rad * Math.sin(ang)}`;
    const d =
      frac >= 0.999
        ? `M${C - R},${C} a${R},${R} 0 1,0 ${2 * R},0 a${R},${R} 0 1,0 ${-2 * R},0 M${C - r},${C} a${r},${r} 0 1,1 ${2 * r},0 a${r},${r} 0 1,1 ${-2 * r},0`
        : `M${p(R, s)} A${R},${R} 0 ${large} 1 ${p(R, e)} L${p(r, e)} A${r},${r} 0 ${large} 0 ${p(r, s)} Z`;
    return { row, v, frac, d };
  });

  const tipFor = (row: Agg, frac: number) => (
    <TipRows
      title={lab(row.key)}
      rows={[
        [t("chart.net"), fmtMoney(row.net)],
        [t("chart.gross"), fmtMoney(row.gross)],
        [t("chart.qty"), fmtQty(row.qty)],
        [t("chart.share"), fmtPct(frac)],
      ]}
    />
  );

  return (
    <div className="donut">
      <svg viewBox="0 0 160 160" width="160" height="160" role="img" aria-label={centerLabel}>
        {arcs.map(({ row, d, frac }) => (
          <path
            key={row.key}
            d={d}
            fill={colorOf(row.key)}
            fillRule="evenodd"
            className={`donut-arc${anySel && !selected.includes(row.key) ? " is-dimmed" : ""}`}
            onClick={() => onToggle?.(row.key)}
            onMouseMove={(e) => tip.show(e, tipFor(row, frac))}
            onMouseLeave={tip.hide}
          />
        ))}
        <text x={C} y={C - 4} textAnchor="middle" className="donut-total num">
          {fmtIntShort(Math.round(total))}
        </text>
        <text x={C} y={C + 14} textAnchor="middle" className="donut-caption">
          {metric === "qty" ? t("chart.units") : t("chart.sar")}
        </text>
      </svg>
      <ul className="legend">
        {arcs.map(({ row, v, frac }) => (
          <li key={row.key}>
            <button
              className={`legend-item${selected.includes(row.key) ? " is-selected" : ""}${anySel && !selected.includes(row.key) ? " is-dimmed" : ""}`}
              onClick={() => onToggle?.(row.key)}
              aria-pressed={selected.includes(row.key)}
            >
              <span className="swatch" style={{ background: colorOf(row.key) }} />
              <span className="legend-name">{lab(row.key)}</span>
              <span className="legend-val num">{fmtMetric(v, metric)}</span>
              <span className="legend-pct num">{fmtPct(frac)}</span>
            </button>
          </li>
        ))}
      </ul>
      {tip.node}
    </div>
  );
}
