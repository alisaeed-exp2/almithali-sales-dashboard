import { NextResponse } from "next/server";
import { finishUpload, UploadError } from "@/lib/db";
import { uploadPasswordOk } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { password, uploadId, rowsInFile? } → totals for the whole upload. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!uploadPasswordOk(body.password)) return NextResponse.json({ error: "wrong_password" }, { status: 401 });
  const uploadId = typeof body.uploadId === "number" ? Math.floor(body.uploadId) : NaN;
  if (!Number.isFinite(uploadId)) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  try {
    return NextResponse.json(await finishUpload(uploadId, typeof body.rowsInFile === "number" ? body.rowsInFile : undefined));
  } catch (e) {
    if (e instanceof UploadError) return NextResponse.json({ error: e.message }, { status: 404 });
    console.error("upload finish failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
