// YouTube Data API v3 client (plan §4, §M2). READ ONLY. All list methods cost
// 1 unit/page against the 10,000/day default. Handles 401 (drop token + retry
// once), quota/429 (throw → job parks until midnight PT), and 5xx (exponential
// backoff up to 5 tries).
//
// Dependencies (fetch, token) are injectable so the client is unit-testable
// with a mocked fetch (plan §7 quota/backoff tests).

const BASE = "https://www.googleapis.com/youtube/v3";

export class QuotaExceededError extends Error {
  constructor(message = "YouTube API quota exceeded") {
    super(message);
    this.name = "QuotaExceededError";
  }
}

export class YoutubeError extends Error {
  status: number;
  reason?: string;
  constructor(status: number, message: string, reason?: string) {
    super(message);
    this.name = "YoutubeError";
    this.status = status;
    this.reason = reason;
  }
}

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface YoutubeDeps {
  fetcher?: Fetcher;
  getToken?: (interactive?: boolean) => Promise<string>;
  invalidate?: (token: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  maxServerRetries?: number;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function firstReason(body: unknown): string | undefined {
  const errors = (body as { error?: { errors?: { reason?: string }[] } })?.error?.errors;
  return errors?.[0]?.reason;
}

async function apiGet<T>(
  endpoint: string,
  params: Record<string, string>,
  deps: YoutubeDeps = {}
): Promise<T> {
  const fetcher = deps.fetcher ?? fetch;
  const getToken =
    deps.getToken ??
    (() => Promise.reject(new Error("no token provider supplied to YouTube client")));
  const invalidate = deps.invalidate ?? (async () => {});
  const sleep = deps.sleep ?? defaultSleep;
  const maxServerRetries = deps.maxServerRetries ?? 5;

  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}/${endpoint}?${qs}`;

  let token = await getToken();
  let auth401Retried = false;

  for (let attempt = 1; ; attempt++) {
    const res = await fetcher(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (res.status === 200) {
      return (await res.json()) as T;
    }

    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      /* non-JSON error body */
    }
    const reason = firstReason(body);

    if (res.status === 401 && !auth401Retried) {
      auth401Retried = true;
      await invalidate(token);
      token = await getToken();
      continue;
    }

    if (res.status === 403 && (reason === "quotaExceeded" || reason === "rateLimitExceeded")) {
      throw new QuotaExceededError(`${reason}`);
    }
    if (res.status === 429) {
      throw new QuotaExceededError("rateLimitExceeded (429)");
    }

    if (res.status >= 500 && attempt < maxServerRetries) {
      await sleep(Math.min(2 ** (attempt - 1) * 1000, 16000));
      continue;
    }

    throw new YoutubeError(
      res.status,
      `YouTube API ${endpoint} failed: ${res.status} ${reason ?? ""}`.trim(),
      reason
    );
  }
}

// ── Typed slices of the responses we use ────────────────────────────────────
export interface MyChannel {
  channelId: string;
  title: string;
  uploadsPlaylistId: string;
}

export interface PlaylistPage {
  videoIds: string[];
  nextPageToken?: string;
}

export interface VideoSnippet {
  videoId: string;
  title: string;
  description: string;
  publishedAt: string;
}

export interface TopComment {
  commentId: string;
  text: string;
  authorChannelId?: string;
}

export async function getMyChannel(deps?: YoutubeDeps): Promise<MyChannel> {
  const data = await apiGet<{
    items?: {
      id: string;
      snippet?: { title?: string };
      contentDetails?: { relatedPlaylists?: { uploads?: string } };
    }[];
  }>("channels", { part: "snippet,contentDetails", mine: "true" }, deps);

  const item = data.items?.[0];
  const uploads = item?.contentDetails?.relatedPlaylists?.uploads;
  if (!item || !uploads) {
    throw new YoutubeError(200, "No channel found for the signed-in account.");
  }
  return { channelId: item.id, title: item.snippet?.title ?? "(untitled)", uploadsPlaylistId: uploads };
}

export async function listPlaylistPage(
  playlistId: string,
  pageToken: string | undefined,
  deps?: YoutubeDeps
): Promise<PlaylistPage> {
  const params: Record<string, string> = {
    part: "contentDetails",
    playlistId,
    maxResults: "50",
  };
  if (pageToken) params.pageToken = pageToken;

  const data = await apiGet<{
    items?: { contentDetails?: { videoId?: string } }[];
    nextPageToken?: string;
  }>("playlistItems", params, deps);

  const videoIds = (data.items ?? [])
    .map((i) => i.contentDetails?.videoId)
    .filter((v): v is string => Boolean(v));
  return { videoIds, nextPageToken: data.nextPageToken };
}

export async function listVideos(
  ids: string[],
  deps?: YoutubeDeps
): Promise<VideoSnippet[]> {
  if (ids.length === 0) return [];
  if (ids.length > 50) throw new Error("listVideos accepts at most 50 ids per call");

  const data = await apiGet<{
    items?: {
      id: string;
      snippet?: { title?: string; description?: string; publishedAt?: string };
    }[];
  }>("videos", { part: "snippet", id: ids.join(",") }, deps);

  return (data.items ?? []).map((i) => ({
    videoId: i.id,
    title: i.snippet?.title ?? "",
    description: i.snippet?.description ?? "",
    publishedAt: i.snippet?.publishedAt ?? "",
  }));
}

/** One relevance-ordered page of top-level comments; captures pinned/top ones. */
export async function listTopComments(
  videoId: string,
  deps?: YoutubeDeps
): Promise<{ comments: TopComment[]; disabled: boolean; skipped: boolean; reason?: string }> {
  try {
    const data = await apiGet<{
      items?: {
        snippet?: {
          topLevelComment?: {
            id?: string;
            snippet?: {
              textOriginal?: string;
              textDisplay?: string;
              authorChannelId?: { value?: string };
            };
          };
        };
      }[];
    }>(
      "commentThreads",
      {
        part: "snippet",
        videoId,
        order: "relevance",
        maxResults: "20",
        textFormat: "plainText",
      },
      deps
    );

    const comments: TopComment[] = (data.items ?? []).map((it) => {
      const c = it.snippet?.topLevelComment;
      return {
        commentId: c?.id ?? "",
        text: c?.snippet?.textOriginal ?? c?.snippet?.textDisplay ?? "",
        authorChannelId: c?.snippet?.authorChannelId?.value,
      };
    });
    return { comments, disabled: false, skipped: false };
  } catch (e) {
    if (e instanceof YoutubeError) {
      if (e.reason === "commentsDisabled") {
        return { comments: [], disabled: true, skipped: false };
      }
      // Any other API error — most commonly a 403 insufficientPermissions where
      // this account's comment endpoint demands the youtube.force-ssl (write)
      // scope. We deliberately stay read-only, so skip comment scanning and let
      // the audit continue on descriptions.
      return { comments: [], disabled: false, skipped: true, reason: e.reason ?? String(e.status) };
    }
    throw e; // QuotaExceededError etc. still propagate so the job can park
  }
}
