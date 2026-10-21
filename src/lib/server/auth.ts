import { timingSafeEqual } from "node:crypto";

/** Constant-time check of the upload password (UPLOAD_PASSWORD on the server). */
export function uploadPasswordOk(given: unknown): boolean {
  const expected = process.env.UPLOAD_PASSWORD;
  if (!expected || typeof given !== "string") return false;
  const a = Buffer.from(given),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
