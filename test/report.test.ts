import { describe, it, expect } from "vitest";
import { buildOccurrenceRows, occurrenceStatus, tagIsOk } from "../src/lib/report";
import type { ReportPayload } from "../src/lib/messages";
import type { Link, Video, CheckResult } from "../src/lib/types";

const A = "B08N5WRWNW";

function payload(): ReportPayload {
  const video: Video = {
    videoId: "v1",
    title: "Gear",
    url: "https://www.youtube.com/watch?v=v1",
    description: "",
    publishedAt: "",
    commentsFetched: true,
  };
  const link: Link = {
    asin: A,
    resolvedUrl: `https://www.amazon.com/dp/${A}`,
    marketplace: "amazon.com",
    tagsSeen: ["chan-20"],
    occurrences: [
      { videoId: "v1", source: "description", rawUrl: `https://www.amazon.com/dp/${A}?tag=chan-20` },
      { videoId: "v1", source: "description", rawUrl: `https://www.amazon.com/dp/${A}` }, // untagged
      { videoId: "v1", source: "comment", rawUrl: `https://www.amazon.com/dp/${A}?tag=someone-else-20` },
    ],
  };
  const result: CheckResult = {
    asin: A,
    status: "ok",
    requestedAsin: A,
    evidence: "live",
    signals: {},
    method: "fetch",
    checkedAt: "2026-07-10T00:00:00Z",
    attempt: 1,
  };
  return { videos: [video], links: [link], nonProduct: [], results: [result], replacements: [] };
}

describe("occurrenceStatus", () => {
  it("downgrades a live ASIN to tag_missing_or_wrong when the tag is wrong", () => {
    expect(occurrenceStatus("ok", false)).toBe("tag_missing_or_wrong");
    expect(occurrenceStatus("ok", true)).toBe("ok");
    expect(occurrenceStatus("delisted", true)).toBe("delisted");
  });
});

describe("tagIsOk", () => {
  it("requires the tag to be present and one of the owner's", () => {
    expect(tagIsOk("chan-20", ["chan-20"])).toBe(true);
    expect(tagIsOk("other-20", ["chan-20"])).toBe(false);
    expect(tagIsOk(undefined, ["chan-20"])).toBe(false);
  });
});

describe("buildOccurrenceRows — per-occurrence tag correctness", () => {
  it("same live ASIN: correct tag → ok; missing/wrong tag → tag_missing_or_wrong", () => {
    const rows = buildOccurrenceRows(payload(), ["chan-20"]);
    expect(rows.length).toBe(3);
    const byTag = Object.fromEntries(rows.map((r) => [r.tag || "(none)", r.status]));
    expect(byTag["chan-20"]).toBe("ok");
    expect(byTag["(none)"]).toBe("tag_missing_or_wrong");
    expect(byTag["someone-else-20"]).toBe("tag_missing_or_wrong");
  });

  it("flags a bad tag instantly even with NO Amazon check (pending)", () => {
    const p = payload();
    p.results = []; // nothing checked yet — no Amazon contact
    const rows = buildOccurrenceRows(p, ["chan-20"]);
    const byTag = Object.fromEntries(rows.map((r) => [r.tag || "(none)", r.status]));
    expect(byTag["chan-20"]).toBe("pending"); // good tag, liveness unknown
    expect(byTag["(none)"]).toBe("tag_missing_or_wrong");
    expect(byTag["someone-else-20"]).toBe("tag_missing_or_wrong");
  });
});
