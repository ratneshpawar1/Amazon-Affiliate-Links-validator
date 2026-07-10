import { describe, it, expect } from "vitest";
import { sha256Hex, sigv4Headers, taggedUrl, searchItems } from "../src/lib/paapi";
import type { ApiKeys } from "../src/lib/types";

describe("SigV4 primitives", () => {
  it("sha256Hex of empty string is the known constant", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });

  // AWS SigV4 published reference test "get-vanilla": verifies the full chain
  // (canonical request → string-to-sign → signing key → signature).
  it("matches the AWS get-vanilla reference signature", async () => {
    const { authorization } = await sigv4Headers({
      method: "GET",
      host: "example.amazonaws.com",
      path: "/",
      region: "us-east-1",
      service: "service",
      headers: { host: "example.amazonaws.com", "x-amz-date": "20150830T123600Z" },
      payload: "",
      accessKey: "AKIDEXAMPLE",
      secretKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      amzDate: "20150830T123600Z",
      dateStamp: "20150830",
    });
    expect(authorization).toContain(
      "Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
    );
    expect(authorization).toContain("SignedHeaders=host;x-amz-date");
  });
});

const KEYS: ApiKeys = {
  paapiAccessKey: "AK", paapiSecretKey: "SK", paapiPartnerTag: "chan-20",
  paapiRegion: "us-east-1", llmApiKey: "", llmModel: "claude-haiku-4-5",
};

describe("searchItems", () => {
  it("builds the tagged URL from the PA-API ASIN (not from the response URL)", async () => {
    const fetcher = async () =>
      ({
        ok: true,
        json: async () => ({
          SearchResult: {
            Items: [
              {
                ASIN: "B0NEWPROD1",
                ItemInfo: { Title: { DisplayValue: "New Mic" } },
                Images: { Primary: { Medium: { URL: "https://img/x.jpg" } } },
                Offers: { Listings: [{ Price: { DisplayAmount: "$25.00" } }] },
              },
            ],
          },
        }),
      }) as unknown as Response;

    const out = await searchItems(
      { keywords: "budget mic", marketplace: "amazon.com" },
      KEYS,
      { fetcher, amzDate: "20260101T000000Z" }
    );
    expect(out).toHaveLength(1);
    expect(out[0].asin).toBe("B0NEWPROD1");
    expect(out[0].url).toBe(taggedUrl("www.amazon.com", "B0NEWPROD1", "chan-20"));
    expect(out[0].url).toContain("tag=chan-20");
    expect(out[0].price).toBe("$25.00");
  });

  it("throws PaapiError with the API message on failure (e.g. not eligible)", async () => {
    const fetcher = async () =>
      ({ ok: false, status: 401, json: async () => ({ Errors: [{ Message: "not eligible" }] }) }) as unknown as Response;
    await expect(
      searchItems({ keywords: "x", marketplace: "amazon.com" }, KEYS, { fetcher })
    ).rejects.toThrow(/not eligible/);
  });
});
