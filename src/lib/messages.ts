// Typed chrome.runtime message protocol (SW ↔ offscreen ↔ probe ↔ UI).

import type {
  JobState,
  Settings,
  Video,
  Link,
  NonProductLink,
  CheckResult,
  ChannelEntry,
  ReplacementSuggestion,
  ApiKeys,
} from "./types";
import type { PageSignals } from "./classify";

// ── App state (what the UI renders from) ────────────────────────────────────
export interface AppState {
  channels: ChannelEntry[];
  activeChannelId?: string;
  job: JobState | null; // active channel's job (null if no channel yet)
}

// ── UI → background (request/response) ──────────────────────────────────────
export type UiRequest =
  | { type: "GET_STATE" }
  // Interactive auth runs in the UI (a real user gesture, persistent page);
  // the resulting token is handed to the background to finish registration.
  | { type: "REGISTER_CHANNEL"; accessToken: string; expiresAt: number; email?: string }
  | { type: "SWITCH_CHANNEL"; channelId: string }
  | { type: "REMOVE_CHANNEL"; channelId: string }
  | { type: "START_AUDIT" }
  | { type: "PAUSE_AUDIT" }
  | { type: "RESUME_AUDIT" }
  | { type: "APPROVE_NEXT_BATCH" } // continue the gated batch (ingest or check)
  | { type: "BEGIN_CHECKS" } // from an ingest gate: start checking links now
  | { type: "STOP_AUDIT" } // stop for good, keep whatever results we have
  | { type: "RESET_AUDIT" }
  | { type: "UPDATE_SETTINGS"; settings: Partial<Settings> }
  | { type: "OPEN_DASHBOARD" }
  | { type: "GET_REPORT"; channelId?: string }
  | { type: "GET_API_KEYS" }
  | { type: "SET_API_KEYS"; keys: Partial<ApiKeys> }
  | { type: "SUGGEST_REPLACEMENTS"; asin: string };

export interface AddChannelResult {
  ok: boolean;
  channel?: ChannelEntry;
  error?: string;
}

export interface AckResult {
  ok: boolean;
  error?: string;
}

export interface ReportPayload {
  videos: Video[];
  links: Link[];
  nonProduct: NonProductLink[];
  results: CheckResult[];
  replacements: ReplacementSuggestion[];
}

export interface SuggestResult {
  ok: boolean;
  suggestion?: ReplacementSuggestion;
  error?: string;
}

// ── background → offscreen ──────────────────────────────────────────────────
export interface ParseHtmlRequest {
  type: "PARSE_HTML";
  target: "offscreen";
  html: string;
  finalUrl: string;
  httpStatus?: number;
  requestedAsin: string;
}

// ── probe content script → background ───────────────────────────────────────
export interface ProbeResultMessage {
  type: "PROBE_RESULT";
  signals: PageSignals;
}

// ── background → UI (broadcast) ─────────────────────────────────────────────
export interface StateChangedMessage {
  type: "STATE_CHANGED";
  state: AppState;
}

export type AnyMessage =
  | UiRequest
  | ParseHtmlRequest
  | ProbeResultMessage
  | StateChangedMessage;

export function sendMessage<T = unknown>(msg: AnyMessage): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

export function broadcastState(state: AppState): void {
  const msg: StateChangedMessage = { type: "STATE_CHANGED", state };
  chrome.runtime.sendMessage(msg).catch(() => {});
}
