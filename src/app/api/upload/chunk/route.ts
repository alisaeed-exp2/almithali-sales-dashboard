import { NextResponse } from "next/server";
import { saveChunk, UploadError } from "@/lib/db";
import { uploadPasswordOk } from "@/lib/server/auth";
import { checkRow, type SaleRow } from "@/lib/sale-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_ROWS = 10_000;

/**
 * POST { password, uploadId, rows: SaleRow[], skipped } → { inserted, updated, unchanged }.
 * Each batch is saved in its own transaction; sending the same batch twice is harmless.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!uploadPasswordOk(body.password)) return NextResponse.json({ error: "wrong_password" }, { status: 401 });
  const uploadId = typeof body.uploadId === "number" ? Math.floor(body.uploadId) : NaN;
  if (!Number.isFinite(uploadId)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!Array.isArray(body.rows)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (body.rows.length > MAX_ROWS) return NextResponse.json({ error: "too_many_rows" }, { status: 413 });

  const byKey = new Map<string, SaleRow>();
  let rejected = 0;
  for (const r of body.rows) {
    const ok = checkRow(r);
    if (ok) byKey.set(ok.line_key, ok);
    else rejected++;
  }
  const skipped = (typeof body.skipped === "number" && body.skipped >= 0 ? Math.floor(body.skipped) : 0) + rejected;
  try {
    return NextResponse.json(await saveChunk(uploadId, [...byKey.values()], skipped));
  } catch (e) {
    if (e instanceof UploadError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("upload chunk failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
