// LLM client (Feature B) — Anthropic Messages API. Two BOUNDED jobs only:
//   1. keywordsFor(): turn an old product's name into a search query.
//   2. draftCopy(): write a one-line "why this replacement" note.
// The model NEVER sees or produces ASINs/URLs — those are built in code from
// the PA-API response. Keep it that way.

import type { ApiKeys } from "./types";

const ENDPOINT = "https://api.anthropic.com/v1/messages";

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface LlmDeps {
  fetcher?: Fetcher;
}

export class LlmError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmError";
  }
}

async function complete(
  system: string,
  user: string,
  keys: ApiKeys,
  maxTokens: number,
  deps: LlmDeps
): Promise<string> {
  const fetcher = deps.fetcher ?? fetch;
  const res = await fetcher(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": keys.llmApiKey,
      "anthropic-version": "2023-06-01",
      // Required for calling the API directly from a browser context.
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: keys.llmModel || "claude-haiku-4-5",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = (data as { error?: { message?: string } })?.error?.message ||
      `LLM request failed (${res.status})`;
    throw new LlmError(msg);
  }
  const text = (data as { content?: { text?: string }[] })?.content?.[0]?.text ?? "";
  return text.trim();
}

/** Old product name (+ optional context) → a short Amazon search query. */
export async function keywordsFor(
  oldTitle: string,
  context: string,
  keys: ApiKeys,
  deps: LlmDeps = {}
): Promise<string> {
  const system =
    "You turn a product name into a concise Amazon search query. Reply with ONLY " +
    "the search query (2-6 words), no quotes, no explanation, no product links or IDs.";
  const user =
    `Old product name: ${oldTitle}\n` +
    (context ? `Extra context: ${context}\n` : "") +
    `Give the best short search query to find a current equivalent.`;
  const out = await complete(system, user, keys, 40, deps);
  // Defensive: keep only the first line, strip stray quotes.
  return out.split("\n")[0].replace(/^["']|["']$/g, "").trim();
}

/** One-line recommendation copy for a candidate. Never references links/IDs. */
export async function draftCopy(
  oldTitle: string,
  candidateTitle: string,
  keys: ApiKeys,
  deps: LlmDeps = {}
): Promise<string> {
  const system =
    "Write one short, plain sentence (max 20 words) telling a viewer why this is a " +
    "good replacement. No links, no product IDs, no markdown.";
  const user = `Old (now unavailable): ${oldTitle}\nSuggested replacement: ${candidateTitle}`;
  return complete(system, user, keys, 60, deps);
}
