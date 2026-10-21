import { notFound } from "next/navigation";
import Dashboard from "@/components/Dashboard";
import { I18nProvider } from "@/lib/i18n";
import { isLocale } from "@/lib/i18n-core";
import { getPool } from "@/lib/db";
import { runQuery } from "@/lib/query";
import { emptyQFilters, type QResult } from "@/lib/dash-types";

// Always read the latest data from the database.
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  // First screen is computed on the server so it appears with data; later filters call /api/query.
  const hasDatabase = !!getPool();
  let initial: QResult | null = null;
  if (hasDatabase) initial = await runQuery({ filters: emptyQFilters(), matrix: { rowDim: "route", colDim: "category" } });

  return (
    <I18nProvider locale={locale}>
      <Dashboard initial={initial} hasDatabase={hasDatabase} />
    </I18nProvider>
  );
}
