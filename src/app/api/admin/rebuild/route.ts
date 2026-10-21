import { NextResponse } from "next/server";
import { rebuildSummary } from "@/lib/db";
import { uploadPasswordOk } from "@/lib/server/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

/** POST { password } → rebuilds the daily summary from sales_lines. Never changes the lines themselves. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  if (!process.env.UPLOAD_PASSWORD) return NextResponse.json({ error: "not_configured" }, { status: 503 });
  if (!uploadPasswordOk(body.password)) return NextResponse.json({ error: "wrong_password" }, { status: 401 });
  try {
    return NextResponse.json(await rebuildSummary());
  } catch (e) {
    console.error("rebuild failed", e);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }
}
