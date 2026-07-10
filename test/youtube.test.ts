import { describe, it, expect } from "vitest";
import {
  getMyChannel,
  listPlaylistPage,
  listTopComments,
  QuotaExceededError,
  type YoutubeDeps,
} from "../src/lib/youtube";

function res(status: number, body: unknown, url = "https://api"): Response {
  return {
    status,
    url,
    json: async () => body,
  } as unknown as Response;
}

function deps(
  responses: Response[],
  extra: Partial<YoutubeDeps> = {}
): YoutubeDeps & { calls: () => number; invalidations: () => number } {
  let i = 0;
  let inval = 0;
  return {
    fetcher: async () => responses[Math.min(i++, responses.length - 1)],
    getToken: async () => "tok",
    invalidate: async () => {
      inval++;
    },
    sleep: async () => {},
    ...extra,
    calls: () => i,
    invalidations: () => inval,
  };
}

const CHANNEL_OK = {
  items: [
    {
      id: "UC123",
      snippet: { title: "My Channel" },
      contentDetails: { relatedPlaylists: { uploads: "UU123" } },
    },
  ],
};

describe("YouTube client backoff & errors (plan §M2, §7)", () => {
  it("[500,500,200] succeeds after exponential backoff", async () => {
    const d = deps([res(500, {}), res(500, {}), res(200, CHANNEL_OK)]);
    const ch = await getMyChannel(d);
    expect(ch.uploadsPlaylistId).toBe("UU123");
    expect(d.calls()).toBe(3);
  });

  it("403 quotaExceeded throws QuotaExceededError", async () => {
    const d = deps([res(403, { error: { errors: [{ reason: "quotaExceeded" }] } })]);
    await expect(getMyChannel(d)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("429 throws QuotaExceededError", async () => {
    const d = deps([res(429, {})]);
    await expect(getMyChannel(d)).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it("401 drops the cached token and retries once", async () => {
    const d = deps([res(401, {}), res(200, CHANNEL_OK)]);
    const ch = await getMyChannel(d);
    expect(ch.channelId).toBe("UC123");
    expect(d.invalidations()).toBe(1);
    expect(d.calls()).toBe(2);
  });

  it("gives up after maxServerRetries on persistent 5xx", async () => {
    const d = deps([res(500, {}), res(500, {})], { maxServerRetries: 2 });
    await expect(getMyChannel(d)).rejects.toThrow(/500/);
    expect(d.calls()).toBe(2);
  });
});

describe("listPlaylistPage", () => {
  it("returns video ids and the next page token", async () => {
    const d = deps([
      res(200, {
        items: [
          { contentDetails: { videoId: "a" } },
          { contentDetails: { videoId: "b" } },
        ],
        nextPageToken: "PAGE2",
      }),
    ]);
    const page = await listPlaylistPage("UU123", undefined, d);
    expect(page.videoIds).toEqual(["a", "b"]);
    expect(page.nextPageToken).toBe("PAGE2");
  });
});

describe("listTopComments", () => {
  it("tolerates commentsDisabled (403) by returning disabled:true", async () => {
    const d = deps([res(403, { error: { errors: [{ reason: "commentsDisabled" }] } })]);
    const out = await listTopComments("vid1", d);
    expect(out.disabled).toBe(true);
    expect(out.comments).toEqual([]);
  });

  it("returns top-level comment text", async () => {
    const d = deps([
      res(200, {
        items: [
          {
            snippet: {
              topLevelComment: {
                id: "c1",
                snippet: { textOriginal: "grab it https://amzn.to/x", authorChannelId: { value: "UC123" } },
              },
            },
          },
        ],
      }),
    ]);
    const out = await listTopComments("vid1", d);
    expect(out.disabled).toBe(false);
    expect(out.comments[0].text).toContain("amzn.to");
    expect(out.comments[0].authorChannelId).toBe("UC123");
  });
});
