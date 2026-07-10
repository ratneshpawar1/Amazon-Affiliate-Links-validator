// CSV export (plan §M5). One row per occurrence, RFC-4180 quoted so it opens
// cleanly in Excel/Sheets even when descriptions contain commas, quotes, or
// newlines. Hand-rolled — no dependency.

import type { OccurrenceRow } from "../lib/report";

export const CSV_COLUMNS = [
  "videoId",
  "videoTitle",
  "videoUrl",
  "source",
  "rawUrl",
  "asin",
  "resolvedUrl",
  "tag",
  "tagOk",
  "status",
  "evidence",
  "checkedAt",
] as const;

/** RFC-4180 field escaping: quote if the field contains ", comma, CR or LF. */
export function csvEscape(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

export function rowToCells(r: OccurrenceRow): string[] {
  return [
    r.videoId,
    r.videoTitle,
    r.videoUrl,
    r.source,
    r.rawUrl,
    r.asin,
    r.resolvedUrl,
    r.tag,
    r.tagOk ? "true" : "false",
    r.status,
    r.evidence,
    r.checkedAt,
  ];
}

export function toCsv(rows: OccurrenceRow[]): string {
  const lines: string[] = [];
  lines.push(CSV_COLUMNS.map(csvEscape).join(","));
  for (const r of rows) {
    lines.push(rowToCells(r).map(csvEscape).join(","));
  }
  // RFC-4180 uses CRLF line breaks.
  return lines.join("\r\n") + "\r\n";
}

/** Trigger a download of the CSV from the dashboard page. */
export function downloadCsv(rows: OccurrenceRow[], filename = "affiliate-audit.csv"): void {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
