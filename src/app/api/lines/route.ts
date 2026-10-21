import { NextResponse } from "next/server";
import { cleanFilters, runLines } from "@/lib/query";
import type { QLineSort } from "@/lib/dash-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { filters, invoice?, q?, sort, dir, page, pageSize } → one page of invoice lines plus the total count. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  try {
    const res = await runLines({
      filters: cleanFilters(body.filters),
      invoice: typeof body.invoice === "string" && body.invoice ? body.invoice.slice(0, 120) : undefined,
      q: typeof body.q === "string" ? body.q : undefined,
      sort: typeof body.sort === "string" ? (body.sort as QLineSort) : "date",
      dir: body.dir === "asc" ? "asc" : "desc",
      page: typeof body.page === "number" ? body.page : 0,
      pageSize: typeof body.pageSize === "number" ? body.pageSize : 25,
    });
    return NextResponse.json(res);
  } catch (e) {
    console.error("lines failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
