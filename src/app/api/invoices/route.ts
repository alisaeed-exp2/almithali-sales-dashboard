import { NextResponse } from "next/server";
import { cleanFilters, runInvoices } from "@/lib/query";
import type { QInvoiceSort } from "@/lib/dash-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { filters, q?, sort, dir, page, pageSize } → one page of invoices plus the total count. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  try {
    const res = await runInvoices({
      filters: cleanFilters(body.filters),
      q: typeof body.q === "string" ? body.q : undefined,
      sort: typeof body.sort === "string" ? (body.sort as QInvoiceSort) : "date",
      dir: body.dir === "asc" ? "asc" : "desc",
      page: typeof body.page === "number" ? body.page : 0,
      pageSize: typeof body.pageSize === "number" ? body.pageSize : 25,
    });
    return NextResponse.json(res);
  } catch (e) {
    console.error("invoices failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
