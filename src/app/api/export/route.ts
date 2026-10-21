import { cleanFilters, exportCsv } from "@/lib/query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/export?f=<filters JSON> → CSV download of every invoice line matching the filters (streamed). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  let filters: unknown = {};
  try {
    filters = JSON.parse(url.searchParams.get("f") ?? "{}");
  } catch {}
  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(exportCsv(cleanFilters(filters)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="almithali-sales-lines-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
