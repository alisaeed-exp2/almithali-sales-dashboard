"use client";
import type { Agg } from "@/lib/analytics";
import { fmtInt, fmtMoneyExact, fmtMoneyShort, fmtPct, fmtQty, fmtIntShort } from "@/lib/format";
import { useI18n } from "@/lib/i18n";

interface Props {
  t: Agg; // filtered
  all: Agg; // unfiltered
  filtered: boolean;
  invoices: number;
  invoicesAll: number;
  customers: number;
  routes: number;
  products: number;
  b2b: number; // net of B2B sales in the selection
  onB2B: () => void;
}

/** Stat tiles. The headline (net sales) sits on plum; the B2B tile opens the B2B drill-down. */
export function KpiCards({ t: agg, all, filtered, invoices, invoicesAll, customers, routes, products, b2b, onB2B }: Props) {
  const { t } = useI18n();
  const of = (v: number, base: number) => (filtered && base ? t("kpi.ofTotal", { p: fmtPct(v / base) }) : undefined);
  const avg = invoices ? agg.net / invoices : 0;
  const cards: { id: string; label: string; value: string; exact?: string; sub?: string; note?: string; hero?: boolean; onClick?: () => void }[] = [
    { id: "net", label: t("kpi.net"), value: fmtMoneyShort(agg.net), exact: fmtMoneyExact(agg.net), sub: of(agg.net, all.net), note: t("kpi.netNote"), hero: true },
    { id: "gross", label: t("kpi.gross"), value: fmtMoneyShort(agg.gross), exact: fmtMoneyExact(agg.gross), sub: of(agg.gross, all.gross), note: t("kpi.grossNote", { vat: fmtMoneyShort(agg.vat) }) },
    { id: "invoices", label: t("kpi.invoices"), value: fmtInt(invoices), sub: of(invoices, invoicesAll), note: t("kpi.invoicesNote", { customers: fmtInt(customers), routes: fmtInt(routes) }) },
    {
      id: "avg",
      label: t("kpi.avgInvoice"),
      value: fmtMoneyShort(avg),
      exact: fmtMoneyExact(avg),
      note: invoicesAll ? t("kpi.avgInvoiceNote", { v: fmtMoneyShort(all.net / invoicesAll) }) : undefined,
    },
    { id: "qty", label: t("kpi.qty"), value: fmtIntShort(agg.qty), exact: fmtQty(agg.qty), sub: of(agg.qty, all.qty), note: t("kpi.qtyNote", { lines: fmtInt(agg.lines), products: fmtInt(products) }) },
    {
      id: "b2b",
      label: t("kpi.b2b"),
      value: fmtPct(agg.net ? b2b / agg.net : 0),
      sub: t("kpi.b2bSub", { v: fmtMoneyShort(b2b) }),
      note: t("kpi.b2bNote"),
      onClick: onB2B,
    },
  ];
  return (
    <section className="kpis" aria-label={t("kpi.aria")}>
      {cards.map((c) => {
        const Tag = c.onClick ? "button" : "div";
        return (
          <Tag key={c.id} className={`kpi${c.hero ? " kpi-hero" : ""}${c.onClick ? " kpi-click" : ""}`} onClick={c.onClick}>
            <span className="kpi-label">{c.label}</span>
            <span className="kpi-value num" title={c.exact}>
              {c.value}
            </span>
            {c.sub && <span className="kpi-sub">{c.sub}</span>}
            {c.note && <span className="kpi-note">{c.note}</span>}
          </Tag>
        );
      })}
    </section>
  );
}
