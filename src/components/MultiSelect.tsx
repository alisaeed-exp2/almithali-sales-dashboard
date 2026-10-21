"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n";

interface Props {
  label: string;
  options: { value: string; count: number }[];
  selected: string[];
  onChange: (next: string[]) => void;
}

/** Compact multi-select dropdown with search, counts and select-all / clear. */
export function MultiSelect({ label, options, selected, onChange }: Props) {
  const { t, v: lab } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = options.filter((o) => `${o.value} ${lab(o.value)}`.toLowerCase().includes(q.toLowerCase()));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  const summary = selected.length === 0 ? t("filters.all") : selected.length === 1 ? lab(selected[0]) : t("filters.selected", { n: selected.length });

  return (
    <div className="ms" ref={ref}>
      <button className={`ms-trigger${selected.length ? " is-active" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="ms-label">{label}</span>
        <span className="ms-value">{summary}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div className="ms-pop" role="listbox" aria-multiselectable="true">
          {options.length > 6 && <input className="ms-search" id={`ms-search-${label}`} placeholder={t("filters.search", { label })} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />}
          <div className="ms-actions">
            <button onClick={() => onChange(options.map((o) => o.value))}>{t("filters.selectAll")}</button>
            <button onClick={() => onChange([])}>{t("filters.clear")}</button>
          </div>
          <div className="ms-list">
            {filtered.map((o) => (
              <label key={o.value} className="ms-opt">
                <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
                <span className="ms-opt-name">{lab(o.value)}</span>
                <span className="ms-opt-count num">{o.count}</span>
              </label>
            ))}
            {!filtered.length && <div className="empty small">{t("filters.noMatches")}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
