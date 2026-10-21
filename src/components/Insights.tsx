"use client";
import type { Insight } from "@/lib/insights";
import type { QDim } from "@/lib/dash-types";
import { useI18n } from "@/lib/i18n";

const ICON: Record<Insight["tone"], string> = {
  info: "M8 7v4M8 5h.01",
  good: "M5 8.2l2 2 4-4.2",
  warn: "M8 4.5v4M8 11h.01",
  risk: "M8 4.5v4M8 11h.01",
};

export function Insights({ items, onDrill }: { items: Insight[]; onDrill: (dim: QDim, value: string) => void }) {
  const { t, v: lab } = useI18n();
  if (!items.length) return <div className="empty">{t("insight.none")}</div>;
  return (
    <div className="insights">
      {items.map((it, i) => (
        <article key={i} className={`insight tone-${it.tone}`}>
          <span className="insight-badge">
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
              <path d={ICON[it.tone]} stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" fill="none" />
            </svg>
            {t(`insight.tone.${it.tone}`)}
          </span>
          <h3>{it.title}</h3>
          <p>{it.body}</p>
          {it.drill && (
            <button className="link-btn" onClick={() => onDrill(it.drill!.dim, it.drill!.value)}>
              {t("insight.drill", { v: lab(it.drill.value) })}
            </button>
          )}
        </article>
      ))}
    </div>
  );
}
