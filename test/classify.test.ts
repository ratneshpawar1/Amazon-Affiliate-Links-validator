import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractSignals, classify } from "../src/lib/classify";

const REQ = "B000000001";
const dir = resolve(__dirname, "fixtures/amazon");

function load(name: string): Document {
  const html = readFileSync(resolve(dir, name), "utf8");
  return new DOMParser().parseFromString(html, "text/html");
}

function run(name: string, finalUrl: string, status?: number) {
  const doc = load(name);
  const signals = extractSignals(doc, finalUrl, status);
  return classify(signals, REQ);
}

describe("classify — all 6 statuses (plan §M4)", () => {
  it("ok: live product page with buy box", () => {
    const c = run("ok.html", `https://www.amazon.com/dp/${REQ}`, 200);
    expect(c.status).toBe("ok");
    expect(c.title).toBe("Widget Pro 3000 — Stainless Steel");
  });

  it("unavailable: confirmed page, no buy box / OOS", () => {
    const c = run("unavailable.html", `https://www.amazon.com/dp/${REQ}`, 200);
    expect(c.status).toBe("unavailable");
  });

  it("delisted: dog error page", () => {
    const c = run("delisted.html", `https://www.amazon.com/dp/${REQ}`, 200);
    expect(c.status).toBe("delisted");
  });

  it("delisted: HTTP 404 alone", () => {
    const c = run("blocked-unknown.html", `https://www.amazon.com/dp/${REQ}`, 404);
    expect(c.status).toBe("delisted");
  });

  it("redirected_asin: canonical ASIN differs", () => {
    const c = run("redirected.html", `https://www.amazon.com/dp/B000000009`, 200);
    expect(c.status).toBe("redirected_asin");
    expect(c.canonicalAsin).toBe("B000000009");
  });

  it("blocked: captcha / robot check", () => {
    const c = run(
      "blocked-captcha.html",
      `https://www.amazon.com/errors/validateCaptcha`,
      200
    );
    expect(c.status).toBe("blocked");
  });

  it("blocked: unrecognised page shape never guesses", () => {
    const c = run("blocked-unknown.html", `https://www.amazon.com/dp/${REQ}`, 200);
    expect(c.status).toBe("blocked");
    expect(c.evidence).toMatch(/no known markers/);
  });

  it("tag correctness is NOT decided here (ok stays ok at ASIN level)", () => {
    const c = run("ok.html", `https://www.amazon.com/dp/${REQ}`, 200);
    // report layer downgrades per-occurrence; classify never emits this.
    expect(c.status).not.toBe("tag_missing_or_wrong");
  });
});
