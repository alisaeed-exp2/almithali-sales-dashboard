// Streaming CSV reader for very large exports (hundreds of thousands of rows).
// Reads the file piece by piece, so memory stays small and the page stays responsive.
// Handles quoted fields, escaped quotes, line breaks inside quotes, CRLF, a UTF-8 BOM,
// and comma, semicolon or tab separators (detected from the header line).

export interface CsvBatch {
  header: string[];
  rows: Record<string, string>[];
  bytesRead: number;
  totalBytes: number;
}

export async function* readCsv(file: Blob, batchSize = 5000): AsyncGenerator<CsvBatch> {
  const reader = file.stream().getReader();
  const decoder = new TextDecoder("utf-8");
  const total = file.size;
  let bytes = 0;
  let header: string[] | null = null;
  let sep = ",";
  let field = "";
  let record: string[] = [];
  let inQuotes = false;
  let quotePending = false; // saw a quote inside a quoted field; next char decides
  let batch: Record<string, string>[] = [];
  let first = true;
  let pendingCR = false;

  const endRecord = () => {
    record.push(field);
    field = "";
    if (!header) {
      header = record.map((h, i) => (i === 0 ? h.replace(/^﻿/, "") : h).trim());
    } else if (!(record.length === 1 && record[0] === "")) {
      const o: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) o[header[i]] = record[i] ?? "";
      batch.push(o);
    }
    record = [];
  };

  const feed = (text: string) => {
    if (first) {
      first = false;
      text = text.replace(/^﻿/, "");
      const line = text.split(/\r?\n/, 1)[0];
      const counts = [",", ";", "\t"].map((s) => [s, line.split(s).length] as const).sort((a, b) => b[1] - a[1]);
      sep = counts[0][1] > 1 ? counts[0][0] : ",";
    }
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (pendingCR) {
        pendingCR = false;
        if (c === "\n") continue;
      }
      if (inQuotes) {
        if (quotePending) {
          quotePending = false;
          if (c === '"') {
            field += '"';
            continue;
          }
          inQuotes = false; // closing quote; fall through to handle c normally
        } else if (c === '"') {
          quotePending = true;
          continue;
        } else {
          field += c;
          continue;
        }
      }
      if (c === '"' && field === "") inQuotes = true;
      else if (c === sep) {
        record.push(field);
        field = "";
      } else if (c === "\n") endRecord();
      else if (c === "\r") {
        endRecord();
        pendingCR = true;
      } else field += c;
    }
  };

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    feed(decoder.decode(value, { stream: true }));
    while (batch.length >= batchSize) {
      const out = batch.slice(0, batchSize);
      batch = batch.slice(batchSize);
      yield { header: header ?? [], rows: out, bytesRead: bytes, totalBytes: total };
    }
  }
  feed(decoder.decode());
  if (quotePending) inQuotes = false;
  if (field !== "" || record.length) endRecord();
  if (batch.length || !header) yield { header: header ?? [], rows: batch, bytesRead: bytes, totalBytes: total };
  else yield { header, rows: [], bytesRead: bytes, totalBytes: total };
}
