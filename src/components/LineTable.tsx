"use client";
import { useState, type ReactNode } from "react";
import type { QFilters, QLine, QLineSort } from "@/lib/dash-types";
import { fetchLines, useQuery } from "@/lib/client-data";
import { fmtInt, fmtMoneyExact, fmtPrice, fmtQty } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

type ColKey = "date" | "invoice" | "partner" | "product" | "qty" | "price" | "net" | "gross";

interface Props {
  filters: QFilters;
  /** Lines of one invoice (ignores the filters). */
  invoice?: string;
  cols: ColKey[];
  pageSize?: number;
  onRow?: (v: QLine) => void;
  refreshKey?: string;
  compact?: boolean;
  findBox?: boolean;
  footer?: (total: number) => ReactNode;
}

const SORTABLE: Partial<Record<ColKey, QLineSort>> = {
  date: "date",
  invoice: "invoice",
  partner: "partner",
  product: "product",
  qty: "qty",
  price: "price",
  net: "net",
  gross: "net",
};

/** Individual invoice lines, one page at a time from the server. */
export function LineTable({ filters, invoice, cols, pageSize = 12, onRow, refreshKey = "", compact, findBox, footer }: Props) {
  const { t, v: lab } = useI18n();
  const [sort, setSort] = useState<{ key: QLineSort; dir: "asc" | "desc" }>(invoice ? { key: "net", dir: "desc" } : { key: "date", dir: "desc" });
  const [page, setPage] = useState(0);
  const [find, setFind] = useState("");
  const fkey = JSON.stringify(filters) + "|" + (invoice ?? "") + "|" + find;
  const [lastF, setLastF] = useState(fkey);
  if (fkey !== lastF) {
    setLastF(fkey);
    setPage(0);
  }
  const key = `${fkey}|${sort.key}|${sort.dir}|${page}|${pageSize}|${refreshKey}`;
  const { data, loading, error } = useQuery((signal) => fetchLines({ filters, invoice, q: find, sort: sort.key, dir: sort.dir, page, pageSize }, signal), key, null, 100);

  const label: Record<ColKey, string> = {
    date: t("table.date"),
    invoice: t("table.invoice"),
    partner: t("table.customer"),
    product: t("table.product"),
    qty: t("table.qty"),
    price: t("table.price"),
    net: t("table.netShort"),
    gross: t("table.gross"),
  };
  const cell = (v: QLine, c: ColKey) => {
    switch (c) {
      case "date":
        return <span className="num">{v.invoice_date}</span>;
      case "invoice":
        return <span className="num">{v.journal_entry.replace(/\s*\(.*\)\s*$/, "")}</span>;
      case "partner":
        return <span className="clip">{lab(v.partner)}</span>;
      case "product":
        return <span className="clip">{lab(v.product)}</span>;
      case "qty":
        return fmtQty(v.quantity);
      case "price":
        return fmtPrice(v.unit_price);
      case "net":
        return fmtMoneyExact(v.subtotal);
      case "gross":
        return fmtMoneyExact(v.total);
    }
  };
  const end = (c: ColKey) => c === "net" || c === "gross" || c === "qty" || c === "price";
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className={`table-wrap${loading ? " is-loading" : ""}`}>
      {findBox && <input className="search table-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t("table.findInvoice")} aria-label={t("table.findInvoice")} />}
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
            <tr key={v.line_key} className={onRow ? "clickable" : ""} onClick={() => onRow?.(v)}>
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
        <span>{footer ? footer(total) : t("table.linesTotal", { n: fmtInt(total) })}</span>
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
