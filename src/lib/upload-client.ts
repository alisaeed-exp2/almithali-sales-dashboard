// Browser side of a chunked upload: reads the file in pieces and sends batches of up to 5,000 lines per request.
// Each batch is its own transaction on the server, so a failed batch can simply be sent again.
import type { RawRow } from "./normalize";
import { readCsv } from "./csv-stream";
import { missingColumns, optionalColumnsFound, REQUIRED_COLUMNS, toSaleRows } from "./sale-rows";

export const BATCH = 5000;

export interface Progress {
  rows: number; // lines sent so far
  inserted: number;
  updated: number;
  unchanged: number;
  skipped: number;
  ignored: number; // zero-value tax/receivable lines without a product
  fraction: number; // 0..1 of the file read
  batches: number;
}

export interface Preview {
  kind: "csv" | "excel";
  header: string[];
  missing: string[];
  missingRequired: string[];
  /** Optional columns present in the file (Invoice Type, Product Category). */
  optional: { invoiceType: boolean; productCategory: boolean };
  /** Excel files are read whole up front; CSV files are streamed during the upload. */
  excelRows?: RawRow[];
}

export class UploadFailure extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const isCsv = (f: File) => /\.(csv|txt)$/i.test(f.name) || f.type === "text/csv";

/** Read just enough of the file to check its columns. */
export async function previewFile(file: File): Promise<Preview> {
  let header: string[] = [];
  let excelRows: RawRow[] | undefined;
  let kind: Preview["kind"] = "csv";
  if (isCsv(file)) {
    for await (const b of readCsv(file.slice(0, 64 * 1024), 1)) {
      header = b.header;
      break;
    }
  } else {
    kind = "excel";
    const XLSX = await import("xlsx");
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    header = (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 0 })[0] ?? []).map((h) => String(h ?? ""));
    excelRows = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null });
  }
  const missing = missingColumns(header);
  const missingRequired = missing.filter((m) => (REQUIRED_COLUMNS as readonly string[]).includes(m));
  return { kind, header, missing, missingRequired, optional: optionalColumnsFound(header), excelRows };
}

async function post<T>(url: string, body: unknown, attempts = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json().catch(() => ({}));
      if (res.ok) return json as T;
      const code = (json as { error?: string }).error ?? "db_error";
      // Wrong password or a bad request will not fix itself; server/database errors are retried.
      if (res.status < 500) throw new UploadFailure(code);
      last = new UploadFailure(code);
    } catch (e) {
      if (e instanceof UploadFailure && !["db_error"].includes(e.code)) throw e;
      last = e instanceof UploadFailure ? e : new UploadFailure("network");
    }
    await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
  }
  throw last instanceof UploadFailure ? last : new UploadFailure("network");
}

async function* batches(file: File, preview: Preview): AsyncGenerator<{ rows: RawRow[]; fraction: number }> {
  if (preview.excelRows) {
    const all = preview.excelRows;
    for (let i = 0; i < all.length; i += BATCH) yield { rows: all.slice(i, i + BATCH), fraction: Math.min(1, (i + BATCH) / all.length) };
    return;
  }
  for await (const b of readCsv(file, BATCH)) yield { rows: b.rows as RawRow[], fraction: b.totalBytes ? b.bytesRead / b.totalBytes : 1 };
}

export interface UploadOutcome extends Progress {
  stopped: boolean;
  totalLines: number;
}

/**
 * Send the file in batches. `shouldStop` is checked between batches; batches already saved stay saved.
 */
export async function uploadFile(
  file: File,
  preview: Preview,
  password: string,
  onProgress: (p: Progress) => void,
  shouldStop: () => boolean,
): Promise<UploadOutcome> {
  const { uploadId } = await post<{ uploadId: number }>("/api/upload/start", { password, fileName: file.name, rowsInFile: preview.excelRows?.length ?? 0 }, 2);
  const p: Progress = { rows: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0, ignored: 0, fraction: 0, batches: 0 };
  let stopped = false;
  let rowsInFile = 0;
  for await (const b of batches(file, preview)) {
    if (shouldStop()) {
      stopped = true;
      break;
    }
    const { rows, skipped, ignored } = toSaleRows(b.rows);
    rowsInFile += b.rows.length;
    if (rows.length || skipped) {
      const r = await post<{ inserted: number; updated: number; unchanged: number }>("/api/upload/chunk", { password, uploadId, rows, skipped });
      p.inserted += r.inserted;
      p.updated += r.updated;
      p.unchanged += r.unchanged;
    }
    p.rows += rows.length;
    p.skipped += skipped;
    p.ignored += ignored;
    p.batches++;
    p.fraction = b.fraction;
    onProgress({ ...p });
  }
  const done = await post<{ totalLines: number }>("/api/upload/finish", { password, uploadId, rowsInFile }, 3);
  return { ...p, stopped, totalLines: done.totalLines };
}
