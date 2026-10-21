"use client";
import type { Agg } from "@/lib/analytics";
import { metricOf } from "@/lib/analytics";
import type { Metric } from "@/lib/dash-types";
import { fmtCompact, fmtMoney, fmtPct, fmtQty } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { TipRows, useTooltip } from "./useTooltip";

// Sequential plum ramp (brand tints over white → plum), light → dark: one hue = magnitude.
const RAMP = [10, 18, 25, 37, 50, 62, 75, 88, 100].map((p) => `color-mix(in srgb, var(--plum) ${p}%, var(--white))`);

interface Props {
  rows: string[];
  cols: string[];
  get: (r: string, c: string) => Agg | undefined;
  max: number;
  metric: Metric;
  onPick?: (row: string, col: string) => void;
  onRow?: (row: string) => void;
  onCol?: (col: string) => void;
}

export function Heatmap({ rows, cols, get, max, metric, onPick, onRow, onCol }: Props) {
  const { t, v: lab } = useI18n();
  const tip = useTooltip();
  if (!rows.length) return <div className="empty">{t("chart.empty")}</div>;
  const fmt = (v: number) => fmtCompact(v);
  return (
    <div className="heatmap-wrap">
      <table className="heatmap">
        <thead>
          <tr>
            <th />
            {cols.map((c) => (
              <th key={c} scope="col">
                <button className="hm-head" onClick={() => onCol?.(c)} title={t("chart.filterTo", { v: lab(c) })}>
                  {lab(c)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const rowSum = cols.reduce((s, c) => s + (get(r, c) ? metricOf(get(r, c)!, metric) : 0), 0);
            return (
              <tr key={r}>
                <th scope="row">
                  <button className="hm-head hm-row" onClick={() => onRow?.(r)} title={t("chart.filterTo", { v: lab(r) })}>
                    {lab(r)}
                  </button>
                </th>
                {cols.map((c) => {
                  const a = get(r, c);
                  const v = a ? metricOf(a, metric) : 0;
                  if (!a) return <td key={c} className="hm-empty" />;
                  const idx = Math.min(RAMP.length - 1, Math.floor((v / (max || 1)) * (RAMP.length - 1)));
                  return (
                    <td key={c}>
                      <button
                        className="hm-cell num"
                        style={{ background: RAMP[idx], color: idx >= 5 ? "var(--white)" : "var(--ink)" }}
                        onClick={() => onPick?.(r, c)}
                        onMouseMove={(e) =>
                          tip.show(
                            e,
                            <TipRows
                              title={`${lab(r)} × ${lab(c)}`}
                              rows={[
                                [t("chart.net"), fmtMoney(a.net)],
                                [t("chart.gross"), fmtMoney(a.gross)],
                                [t("chart.qty"), fmtQty(a.qty)],
                                [t("chart.shareRow"), fmtPct(v / (rowSum || 1))],
                                [t("chart.click"), t("chart.filterBoth")],
                              ]}
                            />,
                          )
                        }
                        onMouseLeave={tip.hide}
                      >
                        {fmt(v)}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="hm-scale" aria-hidden="true">
        <span>{t("chart.low")}</span>
        <span className="hm-ramp" />
        <span>{t("chart.high")}</span>
      </div>
      {tip.node}
    </div>
  );
}
