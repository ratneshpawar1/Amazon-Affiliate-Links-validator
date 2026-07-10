import { describe, it, expect } from "vitest";
import { resolveShortLink, looksBlocked } from "../src/lib/shortlinks";

function mockFetch(finalUrl: string, throwErr = false) {
  return async (_url: string) => {
    if (throwErr) throw new Error("network");
    return { url: finalUrl } as Response;
  };
}

describe("resolveShortLink", () => {
  it("returns the final URL after redirects", async () => {
    const r = await resolveShortLink(
      "https://amzn.to/3xYz",
      mockFetch("https://www.amazon.com/dp/B08N5WRWNW?tag=chan-20")
    );
    expect(r.resolvedUrl).toBe("https://www.amazon.com/dp/B08N5WRWNW?tag=chan-20");
    expect(r.blocked).toBe(false);
  });

  it("marks a captcha landing as blocked (needs tab retry)", async () => {
    const r = await resolveShortLink(
      "https://amzn.to/3xYz",
      mockFetch("https://www.amazon.com/errors/validateCaptcha?foo=1")
    );
    expect(r.resolvedUrl).toBeNull();
    expect(r.blocked).toBe(true);
  });

  it("returns null (not blocked) on a network error", async () => {
    const r = await resolveShortLink("https://amzn.to/3xYz", mockFetch("", true));
    expect(r.resolvedUrl).toBeNull();
    expect(r.blocked).toBe(false);
  });

  it("adds a scheme to a bare short link", async () => {
    const r = await resolveShortLink(
      "a.co/d/abc",
      mockFetch("https://www.amazon.com/dp/B08N5WRWNW")
    );
    expect(r.resolvedUrl).toContain("amazon.com");
  });
});

describe("looksBlocked", () => {
  it("detects captcha URLs", () => {
    expect(looksBlocked("https://www.amazon.com/errors/validateCaptcha")).toBe(true);
    expect(looksBlocked("https://www.amazon.com/dp/B08N5WRWNW")).toBe(false);
  });
});
