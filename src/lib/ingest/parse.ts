import Papa from "papaparse";
import * as XLSX from "xlsx";
import { createHash } from "node:crypto";

export type ParsedFile = {
  filename: string;
  sha256: string;
  headers: string[];
  rows: Record<string, string>[];
  /** rows the parser could not turn into a record at all */
  badRows: { rowNumber: number; raw: string; error: string }[];
};

const stripBom = (s: string) => s.replace(/^﻿/, "");

export function parseBuffer(filename: string, buf: Buffer): ParsedFile {
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const isExcel = /\.(xlsx|xlsm|xls)$/i.test(filename);
  return isExcel ? parseExcel(filename, buf, sha256) : parseCsv(filename, buf, sha256);
}

function parseCsv(filename: string, buf: Buffer, sha256: string): ParsedFile {
  const text = stripBom(buf.toString("utf8"));
  const res = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (h) => stripBom(h),
    dynamicTyping: false,
  });

  const headers = (res.meta.fields ?? []).map(stripBom);
  const badRows: ParsedFile["badRows"] = [];
  for (const err of res.errors) {
    if (err.row === undefined) continue;
    badRows.push({ rowNumber: err.row + 2, raw: "", error: `${err.code}: ${err.message}` });
  }

  const rows = (res.data as Record<string, string>[])
    .filter((r) => Object.values(r).some((v) => v != null && String(v).trim() !== ""))
    .map((r) => {
      const out: Record<string, string> = {};
      for (const h of headers) out[h] = r[h] == null ? "" : String(r[h]);
      return out;
    });

  return { filename, sha256, headers, rows, badRows };
}

function parseExcel(filename: string, buf: Buffer, sha256: string): ParsedFile {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false, raw: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  const headers = (matrix[0] ?? []).map((h) => stripBom(String(h ?? "")).trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const line = matrix[i] ?? [];
    if (line.every((c) => String(c ?? "").trim() === "")) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, j) => (row[h] = String(line[j] ?? "")));
    rows.push(row);
  }
  return { filename, sha256, headers, rows, badRows: [] };
}
