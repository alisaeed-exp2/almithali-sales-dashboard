"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Grain, TimePoint } from "@/lib/analytics";
import { metricOf } from "@/lib/analytics";
import type { Metric } from "@/lib/dash-types";
import { fmtCompact, fmtInt, fmtMoney, fmtQty } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { TipRows, useTooltip } from "./useTooltip";

/** Tracks an element's width. A callback ref re-attaches whenever the element appears (e.g. after data loads). */
function useWidth<T extends HTMLElement>() {
  const [w, setW] = useState(0);
  const ro = useRef<ResizeObserver | null>(null);
  const ref = useCallback((el: T | null) => {
    ro.current?.disconnect();
    ro.current = null;
    if (!el) return;
    setW(el.getBoundingClientRect().width);
    ro.current = new ResizeObserver(([e]) => setW(e.contentRect.width));
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);
  return [ref, Math.max(240, w || 0)] as const;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const label = (d: Date, g: Grain, intl = "en-GB") =>
  g === "month" ? d.toLocaleDateString(intl, { month: "short", year: "2-digit" }) : d.toLocaleDateString(intl, { day: "2-digit", month: "short" });

/** Tooltip title: one day, or the first and last day of a week or month (end is exclusive). */
const span = (p: TimePoint, g: Grain, intl: string) => {
  if (g === "day") return p.start.toLocaleDateString(intl, { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  if (g === "month") return p.start.toLocaleDateString(intl, { month: "long", year: "numeric" });
  const last = new Date(p.end);
  last.setDate(last.getDate() - 1);
  return `${label(p.start, g, intl)} – ${label(last, g, intl)}`;
};

interface Props {
  points: TimePoint[];
  grain: Grain;
  metric: Metric;
  onPick?: (p: TimePoint) => void;
}

/** Column chart over time with a hover tooltip; clicking a column zooms the dashboard to that period. */
export function TimeChart({ points, grain, metric, onPick }: Props) {
  const { t, intl } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const tip = useTooltip();
  const [hover, setHover] = useState<number | null>(null);
  const H = 240,
    m = { t: 12, r: 8, b: 28, l: 52 };
  const iw = width - m.l - m.r,
    ih = H - m.t - m.b;
  const vals = points.map((p) => metricOf(p, metric));
  const ymax = niceMax(Math.max(0, ...vals));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * ymax);
  const step = iw / Math.max(1, points.length);
  const gap = Math.min(2, step * 0.2);
  // Few periods (a single day, a couple of weeks) keep columns slim instead of filling the width.
  const bw = Math.max(1, Math.min(step - gap, 56));
  const inset = (step - bw) / 2;
  const every = Math.max(1, Math.ceil(points.length / Math.floor(iw / 64)));

  if (!points.length) return <div className="empty">{t("chart.empty")}</div>;

  return (
    <div ref={ref} className="timechart" dir="ltr">
      <svg width={width} height={H} role="img" aria-label={t("chart.overTimeAria", { metric: t(`metric.${metric}`) })}>
        <g transform={`translate(${m.l},${m.t})`}>
          {ticks.map((t) => (
            <g key={t} transform={`translate(0,${ih - (t / ymax) * ih})`}>
              <line x2={iw} className={t === 0 ? "axis-base" : "gridline"} />
              <text x={-8} dy="0.32em" textAnchor="end" className="axis-text num">
                {fmtCompact(t)}
              </text>
            </g>
          ))}
          {points.map((p, i) => {
            const v = vals[i];
            const h = (v / ymax) * ih;
            const x = i * step + inset;
            const r = Math.min(4, bw / 2, h);
            return (
              <g
                key={i}
                className="col"
                onMouseMove={(e) => {
                  setHover(i);
                  tip.show(
                    e,
                    <TipRows
                      title={span(p, grain, intl)}
                      rows={[
                        [t("chart.net"), fmtMoney(p.net)],
                        [t("chart.gross"), fmtMoney(p.gross)],
                        [t("chart.qty"), fmtQty(p.qty)],
                        [t("chart.invoices"), fmtInt(p.invoices)],
                        ...(onPick ? ([[t("chart.click"), t("chart.zoom")]] as [string, string][]) : []),
                      ]}
                    />,
                  );
                }}
                onMouseLeave={() => {
                  setHover(null);
                  tip.hide();
                }}
                onClick={() => onPick?.(p)}
                style={{ cursor: onPick ? "pointer" : undefined }}
              >
                <rect x={i * step} y={0} width={step} height={ih} fill="transparent" />
                {hover === i && <rect x={i * step} y={0} width={step} height={ih} className="col-hover" />}
                {h > 0 && (
                  <path
                    className="col-bar"
                    d={`M${x},${ih} V${ih - h + r} Q${x},${ih - h} ${x + r},${ih - h} H${x + bw - r} Q${x + bw},${ih - h} ${x + bw},${ih - h + r} V${ih} Z`}
                  />
                )}
              </g>
            );
          })}
          {points.map((p, i) =>
            i % every === 0 ? (
              <text key={"l" + i} x={i * step + step / 2} y={ih + 18} textAnchor="middle" className="axis-text num">
                {label(p.start, grain, intl)}
              </text>
            ) : null,
          )}
        </g>
      </svg>
      {tip.node}
    </div>
  );
}
