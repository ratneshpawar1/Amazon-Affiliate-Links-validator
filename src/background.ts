// Background service worker = job runner (plan §3, §M4), now multi-channel.
// Owns all state transitions. Nothing in SW memory is authoritative — per-channel
// queues/cursors live in storage and a 1-min alarm re-drives work after any kill.

import { signInInteractive, getSilent, revokeToken, isConfigured } from "./lib/auth";
import { getMyChannel } from "./lib/youtube";
import {
  channelStore,
  listChannels,
  upsertChannel,
  patchChannel,
  removeChannel,
  getActiveChannelId,
  setActiveChannelId,
  getChannelToken,
  setChannelToken,
  getApiKeys,
  setApiKeys,
  type ChannelStore,
} from "./lib/storage";
import { runIngest } from "./jobs/ingest";
import { runExtract } from "./jobs/extract";
import { processNextCheck, nextPaceMs } from "./jobs/check";
import { suggestReplacements } from "./jobs/replace";
import { broadcastState } from "./lib/messages";
import { sleep } from "./lib/time";
import { config } from "./config";
import type {
  UiRequest,
  AppState,
  AddChannelResult,
  AckResult,
  ReportPayload,
  SuggestResult,
} from "./lib/messages";
import type { YoutubeDeps } from "./lib/youtube";

const HEARTBEAT_ALARM = "audit-heartbeat";

function registerAlarms(): void {
  chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 1 });
}
chrome.runtime.onInstalled.addListener(registerAlarms);
chrome.runtime.onStartup.addListener(registerAlarms);
registerAlarms();

// ── Per-channel OAuth token provider (silent refresh + verify) ──────────────
function tokenDeps(channelId: string): YoutubeDeps {
  return {
    getToken: async () => {
      const tok = await getChannelToken(channelId);
      if (tok && tok.accessToken && tok.expiresAt > Date.now() + 60_000) {
        return tok.accessToken;
      }
      const entry = (await listChannels()).find((c) => c.channelId === channelId);
      const fresh = await getSilent(entry?.loginHint);
      await setChannelToken(channelId, {
        accessToken: fresh.accessToken,
        expiresAt: fresh.expiresAt,
      });
      // Verify the refreshed token still maps to this channel (brand accounts
      // can drift on silent refresh); flag for reconnect if not.
      try {
        const who = await getMyChannel({ getToken: async () => fresh.accessToken });
        if (who.channelId !== channelId) {
          await patchChannel(channelId, { needsReauth: true });
        }
      } catch {
        /* verification is best-effort */
      }
      return fresh.accessToken;
    },
    invalidate: async () => {
      await setChannelToken(channelId, { accessToken: "", expiresAt: 0 });
    },
  };
}

// ── App state broadcast ─────────────────────────────────────────────────────
async function buildAppState(): Promise<AppState> {
  const channels = await listChannels();
  const activeChannelId = await getActiveChannelId();
  const job = activeChannelId ? ((await channelStore(activeChannelId).getJob()) ?? null) : null;
  return { channels, activeChannelId, job };
}
async function broadcast(): Promise<void> {
  broadcastState(await buildAppState());
}

// ── Pipeline driver (one channel at a time) ─────────────────────────────────
let busy = false;

async function driveChannel(channelId: string): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const store = channelStore(channelId);
    const deps = tokenDeps(channelId);

    let job = await store.getJob();
    if (job?.phase === "ingest") {
      await runIngest(store, deps);
      await broadcast();
    }
    job = await store.getJob();
    if (job?.phase === "extract") {
      await runExtract(store);
      await broadcast();
    }
    // Check loop (paced, single-flight).
    for (;;) {
      job = await store.getJob();
      if (!job || job.phase !== "check") break;
      const r = await processNextCheck(store);
      await broadcast();
      if (r.parked || r.done) break;
      await sleep(nextPaceMs(job.settings));
    }
  } catch (e) {
    const id = channelId;
    await channelStore(id).mutateJob((j) => {
      j.lastError = e instanceof Error ? e.message : String(e);
    });
    await broadcast();
  } finally {
    busy = false;
  }
}

/** Find a channel with outstanding work and drive it (used by the heartbeat). */
async function driveAnyPending(): Promise<void> {
  if (busy) return;
  const channels = await listChannels();
  for (const c of channels) {
    const job = await channelStore(c.channelId).getJob();
    if (!job) continue;
    if (job.phase === "ingest" || job.phase === "extract" || job.phase === "check") {
      driveChannel(c.channelId);
      return;
    }
    if (
      job.phase === "parked" &&
      job.parkedUntil &&
      new Date(job.parkedUntil).getTime() <= Date.now()
    ) {
      await channelStore(c.channelId).mutateJob((j) => {
        j.phase = j.checkQueue.length > 0 ? "check" : "ingest";
        j.parkedUntil = undefined;
        j.parkedReason = undefined;
      });
      driveChannel(c.channelId);
      return;
    }
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEARTBEAT_ALARM) driveAnyPending();
});

// ── Helpers ─────────────────────────────────────────────────────────────────
async function activeStore(): Promise<ChannelStore | null> {
  const id = await getActiveChannelId();
  return id ? channelStore(id) : null;
}

async function report(channelId: string): Promise<ReportPayload> {
  const store = channelStore(channelId);
  const [videos, links, nonProduct, results] = await Promise.all([
    store.allVideos(),
    store.allLinks(),
    store.allNonProduct(),
    store.allResults(),
  ]);
  // Cached replacement suggestions (one per broken ASIN we've searched).
  const replacements = [];
  for (const l of links) {
    const s = await store.getReplacement(l.asin);
    if (s) replacements.push(s);
  }
  return { videos, links, nonProduct, results, replacements };
}

function aiConfigured(k: {
  paapiAccessKey: string;
  paapiSecretKey: string;
  paapiPartnerTag: string;
  llmApiKey: string;
}): boolean {
  return Boolean(k.paapiAccessKey && k.paapiSecretKey && k.paapiPartnerTag && k.llmApiKey);
}

// ── Message protocol ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  const req = msg as UiRequest;
  if (!req || typeof req.type !== "string") return false;
  if (req.type === ("PARSE_HTML" as never) || req.type === ("PROBE_RESULT" as never)) {
    return false; // handled elsewhere
  }

  (async (): Promise<unknown> => {
    switch (req.type) {
      case "GET_STATE":
        return buildAppState();

      case "ADD_CHANNEL": {
        if (!isConfigured()) {
          return {
            ok: false,
            error: "Your Google Client ID isn't set — see SETUP.md step 3.",
          } as AddChannelResult;
        }
        try {
          const tr = await signInInteractive();
          const channel = await getMyChannel({ getToken: async () => tr.accessToken });
          await setChannelToken(channel.channelId, {
            accessToken: tr.accessToken,
            expiresAt: tr.expiresAt,
          });
          await upsertChannel({
            channelId: channel.channelId,
            title: channel.title,
            addedAt: new Date().toISOString(),
            loginHint: tr.email,
            needsReauth: false,
          });
          const store = channelStore(channel.channelId);
          await store.mutateJob((j) => {
            j.channelId = channel.channelId;
            j.channelTitle = channel.title;
            j.uploadsPlaylistId = channel.uploadsPlaylistId;
            if (!j.settings.ownerTags.length && config.defaultOwnerTags?.length) {
              j.settings.ownerTags = [...config.defaultOwnerTags];
            }
          });
          await setActiveChannelId(channel.channelId);
          await broadcast();
          return {
            ok: true,
            channel: { channelId: channel.channelId, title: channel.title, addedAt: "" },
          } as AddChannelResult;
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          } as AddChannelResult;
        }
      }

      case "SWITCH_CHANNEL":
        await setActiveChannelId(req.channelId);
        await broadcast();
        return { ok: true } as AckResult;

      case "REMOVE_CHANNEL": {
        const tok = await getChannelToken(req.channelId);
        if (tok?.accessToken) await revokeToken(tok.accessToken);
        await removeChannel(req.channelId);
        await broadcast();
        return { ok: true } as AckResult;
      }

      case "START_AUDIT": {
        const store = await activeStore();
        if (!store) return { ok: false, error: "Add a channel first." } as AckResult;
        await store.mutateJob((j) => {
          j.phase = "ingest";
          j.parkedUntil = undefined;
          j.parkedReason = undefined;
          j.consecutiveBlocks = 0;
          j.lastError = undefined;
        });
        await broadcast();
        driveChannel(store.channelId);
        return { ok: true } as AckResult;
      }

      case "PAUSE_AUDIT": {
        const store = await activeStore();
        if (store) {
          await store.mutateJob((j) => {
            if (j.phase === "check" || j.phase === "ingest" || j.phase === "extract") {
              j.phase = "parked";
              j.parkedReason = "Paused by you.";
              j.parkedUntil = undefined;
            }
          });
          await broadcast();
        }
        return { ok: true } as AckResult;
      }

      case "RESUME_AUDIT": {
        const store = await activeStore();
        if (store) {
          await store.mutateJob((j) => {
            if (j.phase !== "parked") return;
            j.phase = j.checkQueue.length > 0 ? "check" : "ingest";
            j.parkedUntil = undefined;
            j.parkedReason = undefined;
          });
          await broadcast();
          driveChannel(store.channelId);
        }
        return { ok: true } as AckResult;
      }

      case "RESET_AUDIT": {
        const store = await activeStore();
        if (store) {
          const job = await store.getJob();
          await store.reset(job?.settings ?? (await store.getOrInitJob()).settings);
          await broadcast();
        }
        return { ok: true } as AckResult;
      }

      case "UPDATE_SETTINGS": {
        const store = await activeStore();
        if (store) {
          await store.mutateJob((j) => {
            j.settings = { ...j.settings, ...req.settings };
          });
          await broadcast();
        }
        return { ok: true } as AckResult;
      }

      case "OPEN_DASHBOARD":
        await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
        return { ok: true } as AckResult;

      case "GET_REPORT": {
        const id = req.channelId ?? (await getActiveChannelId());
        if (!id) {
          return { videos: [], links: [], nonProduct: [], results: [], replacements: [] } as ReportPayload;
        }
        return report(id);
      }

      case "GET_API_KEYS":
        return getApiKeys();

      case "SET_API_KEYS":
        await setApiKeys(req.keys);
        return { ok: true } as AckResult;

      case "SUGGEST_REPLACEMENTS": {
        const store = await activeStore();
        if (!store) return { ok: false, error: "Add a channel first." } as SuggestResult;
        const keys = await getApiKeys();
        if (!aiConfigured(keys)) {
          return {
            ok: false,
            error: "Add your Amazon PA-API and LLM keys in Advanced settings first.",
          } as SuggestResult;
        }
        const link = await store.getLink(req.asin);
        const marketplace = link?.marketplace ?? "amazon.com";
        // Context: the title of a video this product appears in (extra signal).
        let context = "";
        const firstOcc = link?.occurrences[0];
        if (firstOcc) {
          const v = await store.getVideo(firstOcc.videoId);
          context = v?.title ?? "";
        }
        try {
          const suggestion = await suggestReplacements(store, req.asin, {
            keys,
            marketplace,
            context,
          });
          return { ok: true, suggestion } as SuggestResult;
        } catch (e) {
          return {
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          } as SuggestResult;
        }
      }

      default:
        return { ok: false, error: `Unknown message: ${(req as { type: string }).type}` };
    }
  })().then(sendResponse);

  return true; // async sendResponse
});
