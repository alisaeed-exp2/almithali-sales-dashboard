"use client";
import { useState, type ReactNode } from "react";
import type { QFilters, QInvoice, QInvoiceSort } from "@/lib/dash-types";
import { fetchInvoices, useQuery } from "@/lib/client-data";
import { fmtInt, fmtMoneyExact, fmtQty } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type ColKey = "date" | "invoice" | "partner" | "city" | "route" | "channel" | "lines" | "qty" | "net" | "gross";

interface Props {
  filters: QFilters;
  cols: ColKey[];
  pageSize?: number;
  onRow?: (v: QInvoice) => void;
  refreshKey?: string;
  compact?: boolean;
  /** Show a box that finds an invoice by number or reference (this table only). */
  findBox?: boolean;
  footer?: (total: number) => ReactNode;
}

const SORTABLE: Partial<Record<ColKey, QInvoiceSort>> = {
  date: "date",
  invoice: "invoice",
  partner: "partner",
  route: "route",
  lines: "lines",
  qty: "qty",
  net: "net",
  gross: "net",
};

/** Invoices built from their lines, one page at a time from the server (the database may hold millions of lines). */
export function InvoiceTable({ filters, cols, pageSize = 12, onRow, refreshKey = "", compact, findBox, footer }: Props) {
  const { t, v: lab } = useI18n();
  const [sort, setSort] = useState<{ key: QInvoiceSort; dir: "asc" | "desc" }>({ key: "date", dir: "desc" });
  const [page, setPage] = useState(0);
  const [find, setFind] = useState("");
  const fkey = JSON.stringify(filters) + "|" + find;
  const [lastF, setLastF] = useState(fkey);
  if (fkey !== lastF) {
    // New filters start again at the first page.
    setLastF(fkey);
    setPage(0);
  }
  const key = `${fkey}|${sort.key}|${sort.dir}|${page}|${pageSize}|${refreshKey}`;
  const { data, loading, error } = useQuery((signal) => fetchInvoices({ filters, q: find, sort: sort.key, dir: sort.dir, page, pageSize }, signal), key, null, 120);

  const label: Record<ColKey, string> = {
    date: t("table.date"),
    invoice: t("table.invoice"),
    partner: t("table.customer"),
    city: t("table.city"),
    route: t("table.route"),
    channel: t("table.channel"),
    lines: t("table.lines"),
    qty: t("table.qty"),
    net: t("table.netShort"),
    gross: t("table.gross"),
  };
  const cell = (v: QInvoice, c: ColKey) => {
    switch (c) {
      case "date":
        return <span className="num">{v.invoice_date}</span>;
      case "invoice":
        return (
          <span className="inv-ref">
            <span className="num strong">{v.journal_entry.replace(/\s*\(.*\)\s*$/, "")}</span>
            <span className="num muted">{v.reference}</span>
          </span>
        );
      case "partner":
        return <span className="clip">{lab(v.partner)}</span>;
      case "city":
        return lab(v.city);
      case "route":
        return <span className="num">{lab(v.route)}</span>;
      case "channel":
        return <span className={`tag tag-${v.channel.toLowerCase()}`}>{lab(v.channel)}</span>;
      case "lines":
        return fmtInt(v.lines);
      case "qty":
        return fmtQty(v.qty);
      case "net":
        return fmtMoneyExact(v.net);
      case "gross":
        return fmtMoneyExact(v.gross);
    }
  };
  const end = (c: ColKey) => c === "net" || c === "gross" || c === "lines" || c === "qty";
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={`table-wrap${loading ? " is-loading" : ""}`}>
      {findBox && (
        <input className="search table-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t("table.findInvoice")} aria-label={t("table.findInvoice")} />
      )}
      <table className={`table rtable${compact ? " compact" : ""}`}>
        <thead>
          <tr>
            {cols.map((c) => {
              const sk = SORTABLE[c];
              const on = sk && sort.key === sk;
              return (
                <th key={c} className={end(c) ? "r" : ""} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                  <button
                    className="th-btn"
                    disabled={!sk}
                    onClick={() => {
                      if (!sk) return;
                      setSort({ key: sk, dir: on && sort.dir === "desc" ? "asc" : "desc" });
                      setPage(0);
                    }}
                  >
                    {label[c]}
                    <span className="sort-ind">{on ? (sort.dir === "asc" ? "▲" : "▼") : ""}</span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {(data?.rows ?? []).map((v) => (
            <tr key={v.journal_entry} className={onRow ? "clickable" : ""} onClick={() => onRow?.(v)}>
              {cols.map((c) => (
                <td key={c} data-label={label[c]} className={end(c) ? "r num" : ""}>
                  {cell(v, c)}
                </td>
              ))}
            </tr>
          ))}
          {data && !data.rows.length && (
            <tr>
              <td colSpan={cols.length} className="empty">
                {t("table.noRows")}
              </td>
            </tr>
          )}
          {!data && (
            <tr>
              <td colSpan={cols.length} className="empty">
                {error ? t("state.error") : t("state.loading")}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="table-foot">
        <span>{footer ? footer(total) : t("table.invoicesTotal", { n: fmtInt(total) })}</span>
        {pages > 1 && (
          <span className="pager">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              {t("table.prev")}
            </button>
            <span className="num">
              {fmtInt(page + 1)} / {fmtInt(pages)}
            </span>
            <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
              {t("table.next")}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
