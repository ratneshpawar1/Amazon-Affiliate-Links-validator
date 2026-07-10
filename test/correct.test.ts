import { describe, it, expect } from "vitest";
import {
  correctDescription,
  retagUrl,
  type CorrectionOccurrence,
} from "../src/lib/correct";

const opts = { ownerTagFor: () => "chan-20" };

function occ(
  description: string,
  rawUrl: string,
  status: CorrectionOccurrence["status"],
  tagOk: boolean
): CorrectionOccurrence {
  const charStart = description.indexOf(rawUrl);
  return {
    rawUrl,
    charStart,
    charEnd: charStart + rawUrl.length,
    status,
    tagOk,
    marketplace: "amazon.com",
  };
}

describe("retagUrl", () => {
  it("adds tag preserving other params", () => {
    expect(retagUrl("https://www.amazon.com/dp/X?th=1", "t-20")).toBe(
      "https://www.amazon.com/dp/X?th=1&tag=t-20"
    );
  });
  it("adds tag when no query string", () => {
    expect(retagUrl("https://www.amazon.com/gp/product/X", "t-20")).toBe(
      "https://www.amazon.com/gp/product/X?tag=t-20"
    );
  });
  it("replaces a wrong tag, keeping other params", () => {
    expect(retagUrl("https://www.amazon.com/dp/X?tag=old-99&x=1", "t-20")).toBe(
      "https://www.amazon.com/dp/X?tag=t-20&x=1"
    );
  });
  it("keeps the URL form (does not canonicalize /gp/product/ → /dp/)", () => {
    expect(retagUrl("https://www.amazon.com/gp/product/X?tag=old", "t-20")).toContain(
      "/gp/product/X"
    );
  });
  it("preserves a #fragment", () => {
    expect(retagUrl("https://www.amazon.com/dp/X?x=1#frag", "t-20")).toBe(
      "https://www.amazon.com/dp/X?x=1&tag=t-20#frag"
    );
  });
});

describe("correctDescription (plan §M6)", () => {
  const mic = "https://www.amazon.com/dp/B0MIC000AA?th=1";
  const cam = "https://www.amazon.com/dp/B0CAM000BB?tag=chan-20";
  const cable = "https://www.amazon.com/dp/B0CBL000CC?tag=chan-20";
  const desc =
    `🎧 Gear below!\n` +
    `Mic: ${mic} (live, untagged)\n` +
    `Cam: ${cam} (dead)\n` +
    `Cable: ${cable} (fine)\n`;

  const occs = [
    occ(desc, mic, "ok", false), // live, wrong/missing tag → retag
    occ(desc, cam, "delisted", true), // dead → annotate
    occ(desc, cable, "ok", true), // fine → untouched
  ];

  it("retags #1 (preserving params), annotates #2, leaves #3 identical", () => {
    const r = correctDescription(desc, occs, opts);
    expect(r.corrected).toContain("B0MIC000AA?th=1&tag=chan-20");
    expect(r.corrected).toContain(
      "B0CAM000BB?tag=chan-20 ⚠️ [LINK NEEDS REPLACEMENT — delisted]"
    );
    expect(r.corrected).toContain(cable + " (fine)");
    expect(r.changed).toBe(true);
    expect(r.descriptionChanged).toBe(false);
  });

  it("is idempotent: re-annotating already-annotated text is a no-op", () => {
    const first = correctDescription(desc, occs, opts).corrected;
    // Re-run the annotation for the dead link against the already-corrected text.
    const camOcc = occ(first, cam, "delisted", true);
    const second = correctDescription(first, [camOcc], opts);
    expect(second.changed).toBe(false);
    expect(second.corrected).toBe(first);
  });

  it("astral char before a link does not shift offsets", () => {
    const d = `𝟘𝟙 intro https://www.amazon.com/dp/B0AST00000?th=1 end`;
    const o = occ(d, "https://www.amazon.com/dp/B0AST00000?th=1", "ok", false);
    const r = correctDescription(d, [o], opts);
    expect(r.corrected).toContain("B0AST00000?th=1&tag=chan-20");
  });

  it("flags description-changed when a raw URL can't be found", () => {
    const o: CorrectionOccurrence = {
      rawUrl: "https://www.amazon.com/dp/B0MISSING0",
      status: "ok",
      tagOk: false,
      marketplace: "amazon.com",
    };
    const r = correctDescription("no links here", [o], opts);
    expect(r.descriptionChanged).toBe(true);
    expect(r.notFound).toContain("https://www.amazon.com/dp/B0MISSING0");
  });

  it("warns when corrected text exceeds the 5,000-char limit", () => {
    const long = "x".repeat(5000) + " https://www.amazon.com/dp/B0LONG0000?th=1";
    const o = occ(long, "https://www.amazon.com/dp/B0LONG0000?th=1", "ok", false);
    const r = correctDescription(long, [o], opts);
    expect(r.exceedsLimit).toBe(true);
  });

  it("annotates blocked ASINs as unverified", () => {
    const url = "https://www.amazon.com/dp/B0BLOCK000";
    const d = `Item: ${url}`;
    const o = occ(d, url, "blocked", false);
    const r = correctDescription(d, [o], opts);
    expect(r.corrected).toContain("[UNVERIFIED — Amazon blocked the check]");
  });
});
