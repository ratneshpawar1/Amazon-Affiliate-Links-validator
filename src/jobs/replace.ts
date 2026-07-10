// Replacement suggestions (Feature B). On demand, for ONE broken ASIN:
//   old product name → LLM keywords → PA-API SearchItems → candidates.
//
// GUARDRAIL: candidates (ASIN + URL) come only from the PA-API response; the
// LLM contributes keywords and one line of copy, nothing else.

import type { ApiKeys, ReplacementSuggestion } from "../lib/types";
import type { ChannelStore } from "../lib/storage";
import { keywordsFor, draftCopy, type Fetcher as LlmFetcher } from "../lib/llm";
import { searchItems, type Fetcher as PaapiFetcher } from "../lib/paapi";

export interface ReplaceDeps {
  paapiFetcher?: PaapiFetcher;
  llmFetcher?: LlmFetcher;
  amzDate?: string;
  now?: () => number;
}

export interface SuggestArgs {
  keys: ApiKeys;
  marketplace: string;
  oldTitle?: string;
  context?: string;
}

export async function suggestReplacements(
  store: ChannelStore,
  asin: string,
  args: SuggestArgs,
  deps: ReplaceDeps = {}
): Promise<ReplacementSuggestion> {
  const now = deps.now ?? Date.now;
  const generatedAt = new Date(now()).toISOString();
  const title = (args.oldTitle || (await store.getTitle(asin)) || "").trim();

  if (!title && !args.context) {
    const suggestion: ReplacementSuggestion = {
      forAsin: asin,
      candidates: [],
      note: "No saved product name for this link, so there's nothing to search with. Re-run the audit while the page is still live to capture its name.",
      generatedAt,
    };
    await store.putReplacement(suggestion);
    return suggestion;
  }

  const query = await keywordsFor(title || args.context!, args.context ?? "", args.keys, {
    fetcher: deps.llmFetcher,
  });

  const candidates = await searchItems(
    { keywords: query, marketplace: args.marketplace, itemCount: 5 },
    args.keys,
    { fetcher: deps.paapiFetcher, amzDate: deps.amzDate }
  );

  let note: string | undefined;
  if (candidates.length) {
    note = await draftCopy(title || query, candidates[0].title, args.keys, {
      fetcher: deps.llmFetcher,
    }).catch(() => undefined);
  } else {
    note = "No matching products found for this search.";
  }

  const suggestion: ReplacementSuggestion = { forAsin: asin, candidates, note, generatedAt };
  await store.putReplacement(suggestion);
  return suggestion;
}
