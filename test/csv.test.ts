import { describe, it, expect } from "vitest";
import { csvEscape, toCsv, CSV_COLUMNS } from "../src/dashboard/csv";
import type { OccurrenceRow } from "../src/lib/report";

function row(over: Partial<OccurrenceRow>): OccurrenceRow {
  return {
    videoId: "v1",
    videoTitle: "My Video",
    videoUrl: "https://youtu.be/v1",
    source: "description",
    rawUrl: "https://www.amazon.com/dp/B08N5WRWNW",
    asin: "B08N5WRWNW",
    resolvedUrl: "https://www.amazon.com/dp/B08N5WRWNW",
    marketplace: "amazon.com",
    tag: "chan-20",
    tagOk: true,
    status: "ok",
    evidence: "live product page",
    checkedAt: "2026-07-10T00:00:00.000Z",
    ...over,
  };
}

describe("csvEscape (RFC-4180)", () => {
  it("quotes commas", () => expect(csvEscape("a,b")).toBe('"a,b"'));
  it("quotes and doubles quotes", () => expect(csvEscape('a"b')).toBe('"a""b"'));
  it("quotes newlines", () => expect(csvEscape("a\nb")).toBe('"a\nb"'));
  it("leaves plain text alone", () => expect(csvEscape("plain")).toBe("plain"));
});

describe("toCsv", () => {
  it("emits a header plus one row per occurrence", () => {
    const csv = toCsv([row({}), row({ asin: "B000000002" })]);
    const lines = csv.trimEnd().split("\r\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toBe(CSV_COLUMNS.join(","));
  });

  it("survives titles with commas, quotes and newlines", () => {
    const csv = toCsv([
      row({ videoTitle: 'Top 10, "best" gear\nreview', evidence: "a,b,c" }),
    ]);
    // Header + exactly one data record; the embedded newline is INSIDE a quoted
    // field, so a compliant parser still sees 2 logical rows.
    expect(csv).toContain('"Top 10, ""best"" gear\nreview"');
    expect(csv).toContain('"a,b,c"');
  });
});
