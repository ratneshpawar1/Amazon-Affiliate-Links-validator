import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStorageMock } from "./helpers/chromeStorageMock";
import { channelStore, type ChannelStore } from "../src/lib/storage";
import { suggestReplacements } from "../src/jobs/replace";
import type { ApiKeys } from "../src/lib/types";

const KEYS: ApiKeys = {
  paapiAccessKey: "AK", paapiSecretKey: "SK", paapiPartnerTag: "chan-20",
  paapiRegion: "us-east-1", llmApiKey: "sk", llmModel: "claude-haiku-4-5",
};

// LLM fetcher: keywords call returns a keyword line that maliciously embeds a
// fake ASIN/URL; copy call returns copy that also embeds a fake link.
const llmFetcher = async (_url: string, init?: RequestInit) => {
  const body = JSON.parse(String(init?.body ?? "{}"));
  const system: string = body.system ?? "";
  const text = system.includes("search query")
    ? "usb mic buy at amazon.com/dp/B0FAKEEVIL1"
    : "Great pick — see amazon.com/dp/B0FAKEEVIL1";
  return { ok: true, json: async () => ({ content: [{ text }] }) } as unknown as Response;
};

// PA-API fetcher: the ONLY legitimate source of ASINs/URLs.
const paapiFetcher = async () =>
  ({
    ok: true,
    json: async () => ({
      SearchResult: {
        Items: [
          { ASIN: "B0REALPROD1", ItemInfo: { Title: { DisplayValue: "Real USB Mic" } } },
        ],
      },
    }),
  }) as unknown as Response;

describe("suggestReplacements — guardrail (plan §9)", () => {
  let store: ChannelStore;
  beforeEach(() => {
    installChromeStorageMock();
    store = channelStore("UC");
  });

  it("candidates come ONLY from PA-API; the LLM's fake ASIN/URL is ignored", async () => {
    const s = await suggestReplacements(
      store,
      "B0DEADLINK0",
      { keys: KEYS, marketplace: "amazon.com", oldTitle: "Old Broken Mic" },
      { paapiFetcher, llmFetcher, amzDate: "20260101T000000Z", now: () => 0 }
    );
    expect(s.candidates).toHaveLength(1);
    expect(s.candidates[0].asin).toBe("B0REALPROD1");
    expect(s.candidates[0].url).toContain("dp/B0REALPROD1");
    expect(s.candidates[0].url).toContain("tag=chan-20");
    // The fake ASIN the LLM tried to sneak in never becomes a candidate.
    expect(JSON.stringify(s.candidates)).not.toContain("B0FAKEEVIL1");
    // Cached for later reads.
    expect((await store.getReplacement("B0DEADLINK0"))!.candidates[0].asin).toBe("B0REALPROD1");
  });

  it("returns a friendly note when there's no product name to search with", async () => {
    const s = await suggestReplacements(
      store,
      "B0NOTITLE00",
      { keys: KEYS, marketplace: "amazon.com" }, // no oldTitle, no cached title, no context
      { paapiFetcher, llmFetcher, now: () => 0 }
    );
    expect(s.candidates).toHaveLength(0);
    expect(s.note).toMatch(/no saved product name/i);
  });

  it("uses a cached title captured while the product was alive", async () => {
    await store.putTitle("B0DEADLINK0", "Cached Live Title");
    const s = await suggestReplacements(
      store,
      "B0DEADLINK0",
      { keys: KEYS, marketplace: "amazon.com" },
      { paapiFetcher, llmFetcher, now: () => 0 }
    );
    expect(s.candidates[0].asin).toBe("B0REALPROD1");
  });
});
