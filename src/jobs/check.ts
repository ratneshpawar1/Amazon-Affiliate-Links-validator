// Session-based checker (plan §M4). Crash-only queue: the queue and every
// result live in storage BEFORE the next item starts, so the runner is a pure
// function of stored state and a SW kill re-resumes exactly-once.
//
// Per ASIN: try the fetch fast path (SW fetch → offscreen DOMParser → classify);
// if that says `blocked`/ambiguous, retry once via a background tab rendered in
// the user's real session. We NEVER record `blocked` from the fast path alone.
//
// Compliance note (plan §8): check URLs hit /dp/<ASIN> WITHOUT the affiliate
// tag, so audit traffic never registers as an affiliate click and cannot
// inflate the owner's metrics.

import { classify, type PageSignals, type Classification } from "../lib/classify";
import type { CheckResult, Settings } from "../lib/types";
import type { ChannelStore } from "../lib/storage";
import { randomInt } from "../lib/time";
import type { ParseHtmlRequest, ProbeResultMessage } from "../lib/messages";

const TAB_TIMEOUT_MS = 30_000;
const BLOCK_PARK_MS = 6 * 60 * 60 * 1000; // 6h cool-off after 3 blocks
const MAX_CONSECUTIVE_BLOCKS = 3;

export interface CheckOutcome {
  classification: Classification;
  method: "fetch" | "tab";
}

export interface CheckerDeps {
  // Injectable for tests: perform the actual network check for one ASIN.
  runCheck?: (asin: string, marketplace: string, settings: Settings) => Promise<CheckOutcome>;
  now?: () => number;
}

export interface ProcessResult {
  done: boolean; // whole queue finished
  parked: boolean; // parked on consecutive blocks
  processedAsin?: string;
}

/** Random human-like delay between checks (plan §M4 pacing). */
export function nextPaceMs(settings: Settings): number {
  return randomInt(settings.paceMinMs, settings.paceMaxMs);
}

function checkUrl(marketplace: string, asin: string): string {
  return `https://www.${marketplace}/dp/${asin}`; // NB: no tag= (see file header)
}

function blockedClassification(asin: string, evidence: string): Classification {
  return {
    status: "blocked",
    requestedAsin: asin,
    evidence,
    signals: { evidence },
  };
}

// ── Offscreen (fetch fast path) ─────────────────────────────────────────────
async function ensureOffscreen(): Promise<void> {
  const has: boolean = (await chrome.offscreen.hasDocument?.()) ?? false;
  if (has) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: "Parse fetched Amazon product HTML with DOMParser.",
    });
  } catch {
    /* already exists (race) */
  }
}

async function parseInOffscreen(
  html: string,
  finalUrl: string,
  httpStatus: number,
  requestedAsin: string
): Promise<PageSignals> {
  await ensureOffscreen();
  const req: ParseHtmlRequest = {
    type: "PARSE_HTML",
    target: "offscreen",
    html,
    finalUrl,
    httpStatus,
    requestedAsin,
  };
  return (await chrome.runtime.sendMessage(req)) as PageSignals;
}

// ── Tab fallback (authoritative, bot-resistant) ─────────────────────────────
function probeViaTab(url: string): Promise<{ signals?: PageSignals; timedOut: boolean }> {
  return new Promise((resolve) => {
    let tabId: number | undefined;
    let settled = false;

    const cleanup = () => {
      chrome.runtime.onMessage.removeListener(onMsg);
      chrome.tabs.onUpdated.removeListener(onUpd);
      if (tabId != null) chrome.tabs.remove(tabId).catch(() => {});
    };
    const finish = (r: { signals?: PageSignals; timedOut: boolean }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(r);
    };

    const timer = setTimeout(() => finish({ timedOut: true }), TAB_TIMEOUT_MS);

    const onMsg = (msg: unknown, sender: chrome.runtime.MessageSender) => {
      const m = msg as ProbeResultMessage;
      if (m?.type === "PROBE_RESULT" && sender.tab?.id === tabId) {
        finish({ signals: m.signals, timedOut: false });
      }
    };
    const onUpd = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") {
        chrome.scripting
          .executeScript({ target: { tabId: id }, files: ["amazon-probe.js"] })
          .catch(() => {});
      }
    };

    chrome.runtime.onMessage.addListener(onMsg);
    chrome.tabs.onUpdated.addListener(onUpd);
    chrome.tabs
      .create({ url, active: false })
      .then((tab) => {
        tabId = tab.id;
      })
      .catch(() => finish({ timedOut: true }));
  });
}

/** Real network check: fetch fast path, then tab fallback if ambiguous. */
export async function realCheck(
  asin: string,
  marketplace: string,
  settings: Settings
): Promise<CheckOutcome> {
  const url = checkUrl(marketplace, asin);

  if (!settings.tabsOnly) {
    try {
      const res = await fetch(url, { credentials: "include", redirect: "follow" });
      const html = await res.text();
      const signals = await parseInOffscreen(html, res.url || url, res.status, asin);
      const c = classify(signals, asin);
      // Only accept a non-blocked verdict from the fast path; escalate blocks.
      if (c.status !== "blocked") return { classification: c, method: "fetch" };
    } catch {
      /* network/parse hiccup — fall through to the tab path */
    }
  }

  const { signals, timedOut } = await probeViaTab(url);
  if (timedOut || !signals) {
    return { classification: blockedClassification(asin, "tab timeout"), method: "tab" };
  }
  return { classification: classify(signals, asin), method: "tab" };
}

/**
 * Process ONE queued ASIN and persist. Pure function of stored state — safe to
 * call from the heartbeat alarm or the in-flight chain.
 */
export async function processNextCheck(
  store: ChannelStore,
  deps: CheckerDeps = {}
): Promise<ProcessResult> {
  const now = deps.now ?? Date.now;
  const runCheck = deps.runCheck ?? realCheck;

  const job = await store.getJob();
  if (!job || job.phase !== "check") return { done: true, parked: false };
  if (job.checkQueue.length === 0) {
    await store.mutateJob((j) => {
      if (j.phase === "check") j.phase = "done";
    });
    return { done: true, parked: false };
  }

  const asin = job.checkQueue[0];

  // Defensive: if somehow already checked, just dequeue.
  const existing = await store.getResult(asin);
  if (existing) {
    await store.mutateJob((j) => {
      j.checkQueue = j.checkQueue.filter((a) => a !== asin);
    });
    return { done: false, parked: false, processedAsin: asin };
  }

  const link = await store.getLink(asin);
  const marketplace = link?.marketplace ?? job.settings.marketplaces[0] ?? "amazon.com";

  const { classification, method } = await runCheck(asin, marketplace, job.settings);

  // Cache the product title whenever we see it alive, so a later-dead product
  // still has a searchable name for Phase 2 replacement suggestions.
  if (classification.title) await store.putTitle(asin, classification.title);

  const result: CheckResult = {
    asin,
    status: classification.status,
    requestedAsin: asin,
    canonicalAsin: classification.canonicalAsin,
    title: classification.title,
    evidence: classification.evidence,
    signals: classification.signals,
    method,
    checkedAt: new Date(now()).toISOString(),
    attempt: 1,
  };
  await store.putResult(result);

  let out: ProcessResult = { done: false, parked: false, processedAsin: asin };
  await store.mutateJob((j) => {
    j.checkQueue = j.checkQueue.filter((a) => a !== asin);
    j.stats.checked += 1;
    j.stats.byStatus[result.status] += 1;
    if (result.status === "blocked") j.consecutiveBlocks += 1;
    else j.consecutiveBlocks = 0;

    if (j.consecutiveBlocks >= MAX_CONSECUTIVE_BLOCKS) {
      j.phase = "parked";
      j.parkedUntil = new Date(now() + BLOCK_PARK_MS).toISOString();
      j.parkedReason =
        "3 blocked checks in a row — open Amazon in a normal tab, solve any CAPTCHA, then resume the audit.";
      out = { ...out, parked: true };
    } else if (j.checkQueue.length === 0) {
      j.phase = "done";
      out = { ...out, done: true };
    }
  });

  return out;
}
