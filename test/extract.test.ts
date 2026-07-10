import { describe, it, expect } from "vitest";
import { extractLinks, buildIndex, type ProductRef } from "../src/lib/extract";

const A = "B08N5WRWNW"; // a real-shaped ASIN

function only(text: string) {
  const refs = extractLinks(text);
  expect(refs.length).toBe(1);
  return refs[0];
}

describe("extractLinks — URL forms (plan §M3, ≥12 forms)", () => {
  it("1. /dp/<ASIN>", () => {
    const r = only(`https://www.amazon.com/dp/${A}`) as ProductRef;
    expect(r.kind).toBe("product");
    expect(r.asin).toBe(A);
    expect(r.marketplace).toBe("amazon.com");
  });

  it("2. /dp/<ASIN> with tag", () => {
    const r = only(`https://www.amazon.com/dp/${A}?tag=chan-20`) as ProductRef;
    expect(r.tag).toBe("chan-20");
  });

  it("3. /gp/product/<ASIN>", () => {
    const r = only(`https://www.amazon.com/gp/product/${A}`) as ProductRef;
    expect(r.asin).toBe(A);
  });

  it("4. /gp/aw/d/<ASIN>", () => {
    const r = only(`https://www.amazon.com/gp/aw/d/${A}`) as ProductRef;
    expect(r.asin).toBe(A);
  });

  it("5. /exec/obidos/ASIN/<ASIN>", () => {
    const r = only(`https://www.amazon.com/exec/obidos/ASIN/${A}`) as ProductRef;
    expect(r.asin).toBe(A);
  });

  it("6. SEO slug /<slug>/dp/<ASIN>", () => {
    const r = only(`https://www.amazon.com/Widget-Pro-3000/dp/${A}/ref=sr_1_1`) as ProductRef;
    expect(r.asin).toBe(A);
  });

  it("7. uppercase host", () => {
    const r = only(`https://WWW.AMAZON.COM/dp/${A}`) as ProductRef;
    expect(r.marketplace).toBe("amazon.com");
  });

  it("8. smile subdomain host", () => {
    const r = only(`https://smile.amazon.com/dp/${A}`) as ProductRef;
    expect(r.marketplace).toBe("amazon.com");
  });

  it("9a. short link amzn.to", () => {
    expect(only(`https://amzn.to/3abcDEF`).kind).toBe("short");
  });

  it("9b. short link a.co without scheme", () => {
    expect(only(`a.co/d/abc123`).kind).toBe("short");
  });

  it("10. storefront /shop/<handle>", () => {
    expect(only(`https://www.amazon.com/shop/mychannel`).kind).toBe("storefront");
  });

  it("11. idea list /ideas/", () => {
    expect(only(`https://www.amazon.com/ideas/amzn1.account.ABC`).kind).toBe("idealist");
  });

  it("12. .co.uk marketplace", () => {
    const r = only(`https://www.amazon.co.uk/dp/${A}`) as ProductRef;
    expect(r.marketplace).toBe("amazon.co.uk");
  });

  it("13. non-Amazon URL is ignored", () => {
    expect(extractLinks(`https://example.com/dp/${A}`).length).toBe(0);
  });

  it("14. ASIN-like word not in a URL is ignored", () => {
    expect(extractLinks(`Grab the ${A} model today!`).length).toBe(0);
  });

  it("14b. 'a.co' inside a word is NOT matched", () => {
    expect(extractLinks(`visit data.com for info`).length).toBe(0);
  });
});

describe("extractLinks — offsets & noise", () => {
  it("trims trailing punctuation and keeps exact offsets", () => {
    const text = `Buy here: https://www.amazon.com/dp/${A}. Thanks!`;
    const r = only(text);
    expect(r.rawUrl.endsWith(A)).toBe(true);
    expect(text.slice(r.charStart, r.charEnd)).toBe(r.rawUrl);
  });

  it("property: every ref's offsets slice back to its rawUrl", () => {
    const text = [
      `Intro 00:00 setup`,
      `Main: https://www.amazon.com/Widget/dp/${A}?tag=chan-20&th=1`,
      `Mobile: https://www.amazon.co.uk/gp/aw/d/${A}`,
      `Store: https://www.amazon.com/shop/me`,
      `Short: https://amzn.to/3xYz (grab it)`,
      `Not amazon: https://youtube.com/watch?v=x`,
    ].join("\n");
    for (const r of extractLinks(text)) {
      expect(text.slice(r.charStart, r.charEnd)).toBe(r.rawUrl);
    }
  });
});

describe("buildIndex — dedupe by ASIN with reverse index", () => {
  it("a product in N videos → 1 link row with N occurrences", () => {
    const { links } = buildIndex([
      { videoId: "v1", source: "description", text: `https://www.amazon.com/dp/${A}?tag=chan-20` },
      { videoId: "v2", source: "description", text: `https://www.amazon.com/gp/product/${A}` },
      { videoId: "v3", source: "comment", commentId: "c1", text: `see amzn link https://www.amazon.com/dp/${A}` },
    ]);
    expect(links.length).toBe(1);
    expect(links[0].asin).toBe(A);
    expect(links[0].occurrences.length).toBe(3);
    expect(links[0].tagsSeen).toContain("chan-20");
  });

  it("description occurrences carry offsets; comments do not", () => {
    const { links } = buildIndex([
      { videoId: "v1", source: "description", text: `x https://www.amazon.com/dp/${A}` },
      { videoId: "v1", source: "comment", commentId: "c1", text: `https://www.amazon.com/dp/${A}` },
    ]);
    const occs = links[0].occurrences;
    const desc = occs.find((o) => o.source === "description")!;
    const cmt = occs.find((o) => o.source === "comment")!;
    expect(desc.charStart).toBeGreaterThanOrEqual(0);
    expect(cmt.charStart).toBeUndefined();
    expect(cmt.commentId).toBe("c1");
  });

  it("storefront / idea list / short → non-product list", () => {
    const { links, nonProduct } = buildIndex([
      { videoId: "v1", source: "description", text: "https://www.amazon.com/shop/me https://amzn.to/3x" },
    ]);
    expect(links.length).toBe(0);
    const kinds = nonProduct.map((n) => n.kind).sort();
    expect(kinds).toContain("storefront");
    expect(kinds).toContain("unresolved-short");
  });
});
