// Data model — mirrors plan.md §5. Stored in chrome.storage.local, keyed as
// noted in comments. All timestamps are ISO-8601 strings.

export interface Video {
  videoId: string;
  title: string;
  url: string; // https://www.youtube.com/watch?v=<id>
  description: string;
  publishedAt: string;
  commentsFetched: boolean;
  commentsDisabled?: boolean;
} // key: `video:<videoId>`

export type OccurrenceSource = "description" | "comment";

export interface Occurrence {
  videoId: string;
  source: OccurrenceSource;
  commentId?: string;
  rawUrl: string; // exactly as found, for corrected-description rewrite
  charStart?: number; // offsets into description (description source only)
  charEnd?: number;
}

export interface Link {
  asin: string; // dedupe key
  resolvedUrl: string; // post-short-link-resolution canonical-ish URL
  marketplace: string; // e.g. "amazon.com"
  tagsSeen: string[]; // every tag= value observed across occurrences
  occurrences: Occurrence[]; // REVERSE INDEX: asin -> everywhere it appears
} // key: `link:<asin>`

export type NonProductKind =
  | "storefront"
  | "idealist"
  | "unresolved-short"
  | "other-amazon";

export interface NonProductLink {
  rawUrl: string;
  resolvedUrl?: string;
  kind: NonProductKind;
  occurrences: Occurrence[];
} // key: `nplink:<hash(rawUrl)>` — reported informationally, not ASIN-checked

export type CheckStatus =
  | "ok" // live, owner's correct tag present (ASIN-level liveness)
  | "tag_missing_or_wrong" // live, but tag absent or not one of the owner's tags
  | "redirected_asin" // canonical/landing ASIN ≠ requested ASIN (possible hijack/merge)
  | "unavailable" // listed but currently unavailable / OOS
  | "delisted" // 404 / "couldn't find that page"
  | "blocked"; // robot check / CAPTCHA — status undetermined, NEVER guessed

export const CHECK_STATUSES: CheckStatus[] = [
  "ok",
  "tag_missing_or_wrong",
  "redirected_asin",
  "unavailable",
  "delisted",
  "blocked",
];

export interface CheckResult {
  asin: string;
  status: CheckStatus;
  requestedAsin: string;
  canonicalAsin?: string;
  title?: string; // captured when page is live (useful for Phase 2 replacement search)
  evidence: string; // human-readable
  signals: Record<string, string | boolean>; // machine-readable raw signals
  method: "fetch" | "tab";
  checkedAt: string;
  attempt: number;
} // key: `result:<asin>`

export type JobPhase =
  | "idle"
  | "ingest"
  | "extract"
  | "check"
  | "done"
  | "parked";

export interface IngestCursor {
  pageToken?: string;
  playlistDone?: boolean; // all playlist pages fetched
  pendingVideoIdBatches: string[][]; // batches of ≤50 ids awaiting videos.list
  commentQueue: string[]; // videoIds awaiting commentThreads.list
}

export interface Settings {
  ownerTags: string[]; // e.g. ["mychannel-20"]
  fetchComments: boolean; // default true
  paceMinMs: number; // default 8000
  paceMaxMs: number; // default 20000
  marketplaces: string[]; // e.g. ["amazon.com"]
  tabsOnly: boolean; // "stealthiest" mode — skip fetch fast path (open question #2)
}

export interface JobStats {
  videos: number;
  links: number;
  checked: number;
  byStatus: Record<CheckStatus, number>;
}

export interface JobState {
  phase: JobPhase;
  ingestCursor?: IngestCursor;
  checkQueue: string[]; // ASINs pending
  parkedUntil?: string; // quota / manual pause / block-cooloff (ISO)
  parkedReason?: string; // human-readable reason for the current park
  channelTitle?: string;
  channelId?: string;
  uploadsPlaylistId?: string;
  lastError?: string;
  commentAccessNote?: string; // set when comment scanning was skipped (read-only limit)
  consecutiveBlocks: number; // for the 3-in-a-row global stop condition
  settings: Settings;
  stats: JobStats;
  updatedAt: string;
} // key: `job` (single object, small, written often)

export function emptyByStatus(): Record<CheckStatus, number> {
  return {
    ok: 0,
    tag_missing_or_wrong: 0,
    redirected_asin: 0,
    unavailable: 0,
    delisted: 0,
    blocked: 0,
  };
}

/** A report row is derived at render time — never persisted (plan §5). */
export interface ReportRow {
  link: Link;
  result?: CheckResult;
}

// ── Multi-channel (Feature A) ───────────────────────────────────────────────
export interface ChannelEntry {
  channelId: string;
  title: string;
  addedAt: string;
  loginHint?: string; // email, used to steer silent re-auth to the same account
  needsReauth?: boolean; // silent refresh landed on a different channel
}

export interface ChannelToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}

// ── Phase 2: AI replacement suggestions (Feature B) ─────────────────────────
export interface ReplacementCandidate {
  asin: string;
  title: string;
  url: string; // tagged link WE build from the PA-API ASIN + partner tag
  image?: string;
  price?: string;
}

export interface ReplacementSuggestion {
  forAsin: string;
  candidates: ReplacementCandidate[];
  note?: string; // e.g. "no product name available to search"
  generatedAt: string;
} // key: `replace:<asin>`

export interface ApiKeys {
  paapiAccessKey: string;
  paapiSecretKey: string;
  paapiPartnerTag: string;
  paapiRegion: string; // e.g. "us-east-1"
  llmApiKey: string;
  llmModel: string;
} // global key: `apiKeys`

export function emptyApiKeys(): ApiKeys {
  return {
    paapiAccessKey: "",
    paapiSecretKey: "",
    paapiPartnerTag: "",
    paapiRegion: "us-east-1",
    llmApiKey: "",
    llmModel: "claude-haiku-4-5",
  };
}
