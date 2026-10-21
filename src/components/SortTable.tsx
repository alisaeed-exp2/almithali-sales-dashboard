"use client";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useI18n } from "@/lib/i18n";

export interface Col<T> {
  key: string;
  label: string;
  value: (row: T) => number | string;
  render?: (row: T) => ReactNode;
  align?: "start" | "end";
  bar?: boolean; // inline magnitude bar behind the number
}

interface Props<T> {
  rows: T[];
  cols: Col<T>[];
  rowKey: (row: T) => string;
  initialSort?: string;
  onRow?: (row: T) => void;
  pageSize?: number;
  footer?: ReactNode;
}

/** Sortable table. Scrolls sideways on tablets; on phones every row becomes a labelled card (CSS .rtable). */
export function SortTable<T>({ rows, cols, rowKey, initialSort, onRow, pageSize, footer }: Props<T>) {
  const { t } = useI18n();
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 }>({ key: initialSort ?? cols[0].key, dir: -1 });
  const [page, setPage] = useState(0);
  const sorted = useMemo(() => {
    const col = cols.find((c) => c.key === sort.key) ?? cols[0];
    return [...rows].sort((a, b) => {
      const x = col.value(a),
        y = col.value(b);
      return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y))) * sort.dir;
    });
  }, [rows, cols, sort]);
  const maxes = useMemo(() => {
    const m: Record<string, number> = {};
    cols.filter((c) => c.bar).forEach((c) => (m[c.key] = Math.max(1e-9, ...rows.map((r) => Number(c.value(r)) || 0))));
    return m;
  }, [rows, cols]);

  const pages = pageSize ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const p = Math.min(page, pages - 1);
  const shown = pageSize ? sorted.slice(p * pageSize, (p + 1) * pageSize) : sorted;

  return (
    <div className="table-wrap">
      <table className="table rtable">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.key} className={c.align === "end" ? "r" : ""} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
                <button
                  className="th-btn"
                  onClick={() => {
                    setSort({ key: c.key, dir: sort.key === c.key ? (sort.dir === 1 ? -1 : 1) : -1 });
                    setPage(0);
                  }}
                >
                  {c.label}
                  <span className="sort-ind">{sort.key === c.key ? (sort.dir === 1 ? "▲" : "▼") : ""}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={rowKey(r)} className={onRow ? "clickable" : ""} onClick={() => onRow?.(r)}>
              {cols.map((c) => (
                <td key={c.key} data-label={c.label} className={`${c.align === "end" ? "r num" : ""}${c.bar ? " has-bar" : ""}`}>
                  {c.bar && <span className="cell-bar" style={{ width: `${((Number(c.value(r)) || 0) / maxes[c.key]) * 100}%` }} />}
                  <span className="cell-text">{c.render ? c.render(r) : c.value(r)}</span>
                </td>
              ))}
            </tr>
          ))}
          {!shown.length && (
            <tr>
              <td colSpan={cols.length} className="empty">
                {t("table.noRows")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {(pages > 1 || footer) && (
        <div className="table-foot">
          <span>{footer}</span>
          {pages > 1 && (
            <span className="pager">
              <button disabled={p === 0} onClick={() => setPage(p - 1)}>
                {t("table.prev")}
              </button>
              <span className="num">
                {p + 1} / {pages}
              </span>
              <button disabled={p >= pages - 1} onClick={() => setPage(p + 1)}>
                {t("table.next")}
              </button>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** Plain table that copies header text into each cell's data-label, so phones can show rows as cards. */
export function ResponsiveTable({ children, compact }: { children: ReactNode; compact?: boolean }) {
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    const heads = Array.from(table.querySelectorAll("thead th")).map((th) => (th.textContent ?? "").trim());
    table.querySelectorAll("tbody tr").forEach((tr) => Array.from(tr.children).forEach((cell, i) => cell.setAttribute("data-label", heads[i] ?? "")));
  });
  return (
    <div className="table-wrap">
      <table ref={ref} className={`table rtable${compact ? " compact" : ""}`}>
        {children}
      </table>
    </div>
  );
}
