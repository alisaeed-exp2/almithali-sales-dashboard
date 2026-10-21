"use client";
import type { QDim, QFilters, QResult } from "@/lib/dash-types";
import { QDIMS } from "@/lib/dash-types";
import { useI18n } from "@/lib/i18n";
import { MultiSelect } from "./MultiSelect";

interface Props {
  data: QResult | null;
  filters: QFilters;
  setFilters: (f: QFilters) => void;
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export function FilterBar({ data, filters, setFilters }: Props) {
  const { t, v: lab, dimLabel, locale } = useI18n();
  const setDim = (k: QDim, vals: string[]) => setFilters({ ...filters, dims: { ...filters.dims, [k]: vals } });

  // Every value in the database, with its count under the other active filters (cross-filtering).
  const optionsFor = (k: QDim) => {
    const counts = new Map<string, number>();
    (data?.values?.[k] ?? []).forEach((v) => counts.set(v, 0));
    (data?.dims?.[k] ?? []).forEach((a) => counts.set(a.key, a.lines));
    (filters.dims[k] ?? []).forEach((v) => !counts.has(v) && counts.set(v, 0));
    return [...counts.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  };

  // Presets count back from the latest day in the database.
  const min = data?.range?.min ?? "";
  const max = data?.range?.max ?? "";
  const presets: { key: string; from: string; to: string }[] = [];
  if (max) {
    const end = parse(max);
    const back = (days: number) => {
      const d = new Date(end);
      d.setDate(d.getDate() - days + 1);
      return ymd(d);
    };
    const monthStart = ymd(new Date(end.getFullYear(), end.getMonth(), 1));
    const prevStart = ymd(new Date(end.getFullYear(), end.getMonth() - 1, 1));
    const prevEnd = ymd(new Date(end.getFullYear(), end.getMonth(), 0));
    presets.push(
      { key: "filters.lastDay", from: max, to: max },
      { key: "filters.last7", from: back(7), to: max },
      { key: "filters.last30", from: back(30), to: max },
      { key: "filters.thisMonth", from: monthStart, to: max },
      { key: "filters.prevMonth", from: prevStart, to: prevEnd },
      { key: "filters.last90", from: back(90), to: max },
      { key: "filters.ytd", from: `${end.getFullYear()}-01-01`, to: max },
    );
  }
  // Only presets that fall inside the data and differ from "all time".
  const shown = presets.filter((p) => (!min || p.to >= min) && !(p.from <= min && p.to >= max));
  const isOn = (p: { from: string; to: string }) => filters.from === p.from && filters.to === p.to;

  const chips: { label: string; clear: () => void }[] = [];
  const sep = locale === "ar" ? "، " : ", ";
  for (const k of QDIMS) {
    const vals = filters.dims[k];
    if (vals?.length) chips.push({ label: `${dimLabel(k)}: ${vals.length > 2 ? t("filters.selected", { n: vals.length }) : vals.map(lab).join(sep)}`, clear: () => setDim(k, []) });
  }
  if (filters.from || filters.to)
    chips.push({
      label: t("filters.chipTime", { from: filters.from || t("filters.start"), to: filters.to || t("filters.end") }),
      clear: () => setFilters({ ...filters, from: "", to: "" }),
    });
  if (filters.search) chips.push({ label: t("filters.chipSearch", { q: filters.search }), clear: () => setFilters({ ...filters, search: "" }) });

  return (
    <section className="filterbar" aria-label={t("filters.aria")}>
      <div className="filter-row">
        {QDIMS.map((k) => (
          <MultiSelect key={k} label={dimLabel(k)} options={optionsFor(k)} selected={filters.dims[k] ?? []} onChange={(v) => setDim(k, v)} />
        ))}
      </div>
      <div className="filter-row">
        <div className="time-range">
          <label htmlFor="f-from">
            <span>{t("filters.from")}</span>
            <input id="f-from" className="num" type="date" value={filters.from} min={min} max={filters.to || max} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
          </label>
          <label htmlFor="f-to">
            <span>{t("filters.to")}</span>
            <input id="f-to" className="num" type="date" value={filters.to} min={filters.from || min} max={max} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
          </label>
          <div className="seg">
            <button className={!filters.from && !filters.to ? "is-on" : ""} onClick={() => setFilters({ ...filters, from: "", to: "" })}>
              {t("filters.allTime")}
            </button>
            {shown.map((p) => (
              <button key={p.key} className={isOn(p) ? "is-on" : ""} onClick={() => setFilters({ ...filters, from: p.from, to: p.to })}>
                {t(p.key)}
              </button>
            ))}
          </div>
        </div>
        <input
          id="f-search"
          className="search"
          type="search"
          placeholder={t("filters.searchAll")}
          value={filters.search}
          onChange={(e) => setFilters({ ...filters, search: e.target.value })}
        />
      </div>
      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <span className="chip" key={c.label}>
              {c.label}
              <button onClick={c.clear} aria-label={t("filters.remove", { label: c.label })}>
                ×
              </button>
            </span>
          ))}
          <button className="link-btn" onClick={() => setFilters({ dims: {}, from: "", to: "", search: "" })}>
            {t("filters.resetAll")}
          </button>
        </div>
      )}
    </section>
  );
}
