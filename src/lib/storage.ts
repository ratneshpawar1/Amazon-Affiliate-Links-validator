// Storage layer (plan §5, §M4 "crash-only" design) — now multi-channel.
//
// Per-channel data is scoped through channelStore(channelId): every key is
// prefixed `ch:<channelId>:` so channels never collide. A small global registry
// tracks the known channels, the active one, per-channel OAuth tokens, and the
// (account-wide) API keys for Phase 2.
//
// Everything is written per-item so a single check persists ~1 small key and a
// killed service worker loses at most the item in flight.

import {
  type Video,
  type Link,
  type NonProductLink,
  type CheckResult,
  type JobState,
  type Settings,
  type ChannelEntry,
  type ChannelToken,
  type ReplacementSuggestion,
  type ApiKeys,
  emptyByStatus,
  emptyApiKeys,
} from "./types";

const local = () => chrome.storage.local;

async function get<T>(key: string): Promise<T | undefined> {
  const out = await local().get(key);
  return out[key] as T | undefined;
}
async function set(key: string, value: unknown): Promise<void> {
  await local().set({ [key]: value });
}

export const DEFAULT_SETTINGS: Settings = {
  ownerTags: [],
  fetchComments: true,
  paceMinMs: 8000,
  paceMaxMs: 20000,
  marketplaces: ["amazon.com"],
  tabsOnly: false,
  videoLimitPerBatch: 500,
  checkLimitPerBatch: 500,
};

export function newJobState(settings: Partial<Settings> = {}): JobState {
  return {
    phase: "idle",
    checkQueue: [],
    consecutiveBlocks: 0,
    videosThisBatch: 0,
    checksThisBatch: 0,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    stats: { videos: 0, links: 0, checked: 0, byStatus: emptyByStatus() },
    updatedAt: new Date().toISOString(),
  };
}

export interface StoredComment {
  commentId: string;
  text: string;
  authorChannelId?: string;
}

// ── Per-channel store ───────────────────────────────────────────────────────
export interface ChannelStore {
  channelId: string;
  getJob(): Promise<JobState | undefined>;
  getOrInitJob(): Promise<JobState>;
  saveJob(job: JobState): Promise<void>;
  mutateJob(fn: (job: JobState) => void | Promise<void>): Promise<JobState>;
  putVideo(v: Video): Promise<void>;
  getVideo(id: string): Promise<Video | undefined>;
  allVideos(): Promise<Video[]>;
  getLink(asin: string): Promise<Link | undefined>;
  putLink(link: Link): Promise<void>;
  allLinks(): Promise<Link[]>;
  putNonProduct(hash: string, np: NonProductLink): Promise<void>;
  allNonProduct(): Promise<NonProductLink[]>;
  putResult(r: CheckResult): Promise<void>;
  getResult(asin: string): Promise<CheckResult | undefined>;
  allResults(): Promise<CheckResult[]>;
  getShort(url: string): Promise<string | undefined>;
  putShort(url: string, resolved: string): Promise<void>;
  putComments(videoId: string, comments: StoredComment[]): Promise<void>;
  getComments(videoId: string): Promise<StoredComment[]>;
  getTitle(asin: string): Promise<string | undefined>;
  putTitle(asin: string, title: string): Promise<void>;
  getReplacement(asin: string): Promise<ReplacementSuggestion | undefined>;
  putReplacement(r: ReplacementSuggestion): Promise<void>;
  reset(preserveSettings: Settings): Promise<void>;
}

export function channelStore(channelId: string): ChannelStore {
  const p = `ch:${channelId}:`;
  const K = {
    job: `${p}job`,
    video: (id: string) => `${p}video:${id}`,
    link: (a: string) => `${p}link:${a}`,
    nplink: (h: string) => `${p}nplink:${h}`,
    result: (a: string) => `${p}result:${a}`,
    short: (u: string) => `${p}short:${u}`,
    comments: (v: string) => `${p}comments:${v}`,
    title: (a: string) => `${p}titlecache:${a}`,
    replace: (a: string) => `${p}replace:${a}`,
  };

  async function allByPrefix<T>(prefix: string): Promise<T[]> {
    const all = await local().get(null);
    const out: T[] = [];
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(prefix)) out.push(value as T);
    }
    return out;
  }

  const getOrInitJob = async (): Promise<JobState> => {
    const existing = await get<JobState>(K.job);
    if (existing) return existing;
    const fresh = newJobState();
    fresh.channelId = channelId;
    await set(K.job, fresh);
    return fresh;
  };

  const saveJob = async (job: JobState): Promise<void> => {
    job.updatedAt = new Date().toISOString();
    await set(K.job, job);
  };

  return {
    channelId,
    getJob: () => get<JobState>(K.job),
    getOrInitJob,
    saveJob,
    async mutateJob(fn) {
      const job = await getOrInitJob();
      await fn(job);
      await saveJob(job);
      return job;
    },
    putVideo: (v) => set(K.video(v.videoId), v),
    getVideo: (id) => get<Video>(K.video(id)),
    allVideos: () => allByPrefix<Video>(`${p}video:`),
    getLink: (a) => get<Link>(K.link(a)),
    putLink: (l) => set(K.link(l.asin), l),
    allLinks: () => allByPrefix<Link>(`${p}link:`),
    putNonProduct: (h, np) => set(K.nplink(h), np),
    allNonProduct: () => allByPrefix<NonProductLink>(`${p}nplink:`),
    putResult: (r) => set(K.result(r.asin), r),
    getResult: (a) => get<CheckResult>(K.result(a)),
    allResults: () => allByPrefix<CheckResult>(`${p}result:`),
    getShort: (u) => get<string>(K.short(u)),
    putShort: (u, r) => set(K.short(u), r),
    putComments: (v, c) => set(K.comments(v), c),
    getComments: async (v) => (await get<StoredComment[]>(K.comments(v))) ?? [],
    getTitle: (a) => get<string>(K.title(a)),
    putTitle: (a, t) => set(K.title(a), t),
    getReplacement: (a) => get<ReplacementSuggestion>(K.replace(a)),
    putReplacement: (r) => set(K.replace(r.forAsin), r),
    async reset(preserveSettings) {
      const all = await local().get(null);
      const toRemove = Object.keys(all).filter((k) => k.startsWith(p));
      await local().remove(toRemove);
      const fresh = newJobState(preserveSettings);
      fresh.channelId = channelId;
      await set(K.job, fresh);
    },
  };
}

// ── Global registry ─────────────────────────────────────────────────────────
const K_CHANNELS = "channels";
const K_ACTIVE = "activeChannel";
const K_TOKEN = (id: string) => `token:${id}`;
const K_APIKEYS = "apiKeys";

export async function listChannels(): Promise<ChannelEntry[]> {
  return (await get<ChannelEntry[]>(K_CHANNELS)) ?? [];
}

export async function upsertChannel(entry: ChannelEntry): Promise<void> {
  const list = await listChannels();
  const i = list.findIndex((c) => c.channelId === entry.channelId);
  if (i >= 0) list[i] = { ...list[i], ...entry };
  else list.push(entry);
  await set(K_CHANNELS, list);
}

export async function patchChannel(
  channelId: string,
  patch: Partial<ChannelEntry>
): Promise<void> {
  const list = await listChannels();
  const i = list.findIndex((c) => c.channelId === channelId);
  if (i >= 0) {
    list[i] = { ...list[i], ...patch };
    await set(K_CHANNELS, list);
  }
}

export async function removeChannel(channelId: string): Promise<void> {
  const list = (await listChannels()).filter((c) => c.channelId !== channelId);
  await set(K_CHANNELS, list);
  await local().remove(K_TOKEN(channelId));
  // Wipe that channel's namespaced data.
  const all = await local().get(null);
  const pfx = `ch:${channelId}:`;
  await local().remove(Object.keys(all).filter((k) => k.startsWith(pfx)));
  const active = await getActiveChannelId();
  if (active === channelId) await setActiveChannelId(list[0]?.channelId);
}

export async function getActiveChannelId(): Promise<string | undefined> {
  return get<string>(K_ACTIVE);
}
export async function setActiveChannelId(id: string | undefined): Promise<void> {
  if (id) await set(K_ACTIVE, id);
  else await local().remove(K_ACTIVE);
}

export async function getChannelToken(channelId: string): Promise<ChannelToken | undefined> {
  return get<ChannelToken>(K_TOKEN(channelId));
}
export async function setChannelToken(channelId: string, tok: ChannelToken): Promise<void> {
  await set(K_TOKEN(channelId), tok);
}

// ── API keys (account-wide, Phase 2) ────────────────────────────────────────
export async function getApiKeys(): Promise<ApiKeys> {
  return (await get<ApiKeys>(K_APIKEYS)) ?? emptyApiKeys();
}
export async function setApiKeys(patch: Partial<ApiKeys>): Promise<void> {
  const current = await getApiKeys();
  await set(K_APIKEYS, { ...current, ...patch });
}
