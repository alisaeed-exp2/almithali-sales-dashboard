import { NextResponse } from "next/server";
import { cleanFilters, runQuery } from "@/lib/query";
import { QDIMS, QPARTS, type QDim, type QPart, type QRequest } from "@/lib/dash-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { filters, parts?, dims?, matrix? } → aggregated dashboard data. */
export async function POST(req: Request) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request" }, { status: 400 });
  }
  const isDim = (d: unknown): d is QDim => typeof d === "string" && (QDIMS as string[]).includes(d);
  const m = body.matrix as { rowDim?: unknown; colDim?: unknown } | undefined;
  const q: QRequest = {
    filters: cleanFilters(body.filters),
    parts: Array.isArray(body.parts) ? (body.parts.filter((p) => QPARTS.includes(p as QPart)) as QPart[]) : undefined,
    dims: Array.isArray(body.dims) ? body.dims.filter(isDim) : undefined,
    matrix: m && isDim(m.rowDim) && isDim(m.colDim) ? { rowDim: m.rowDim, colDim: m.colDim } : undefined,
  };
  try {
    return NextResponse.json(await runQuery(q));
  } catch (e) {
    console.error("query failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
