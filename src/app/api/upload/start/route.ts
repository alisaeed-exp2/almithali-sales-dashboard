import { NextResponse } from "next/server";
import { startUpload } from "@/lib/db";
import { uploadPasswordOk } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** POST { password, fileName, rowsInFile } → { uploadId }. Opens an upload that batches are added to. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!process.env.UPLOAD_PASSWORD) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!uploadPasswordOk(body.password)) return NextResponse.json({ error: "wrong_password" }, { status: 401 });
  const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "upload.csv";
  const rowsInFile = typeof body.rowsInFile === "number" ? body.rowsInFile : 0;
  try {
    return NextResponse.json({ uploadId: await startUpload(fileName, rowsInFile) });
  } catch (e) {
    console.error("upload start failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
