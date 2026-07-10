# Design — Multi-channel support + Phase 2 AI replacement suggestions

Date: 2026-07-10. Status: approved, in implementation.

## Feature A — Multi-channel

**Auth (chosen: A1).** Unify on `chrome.identity.launchWebAuthFlow` (implicit
`token id_token` flow, redirect `https://<ext-id>.chromiumapp.org/`). Shows
Google's account + brand-channel picker, so it handles brand accounts and
separate Google accounts alike. No client secret (implicit). Access token ~1h;
refreshed silently with `interactive:false`. After every token acquisition we
verify `channels.list?mine=true` matches the intended channelId; a mismatch
marks the channel "needs reconnect" (unavoidable for brand accounts on silent
refresh — surfaced honestly in the UI, resolved with one interactive click).

**Storage.** `channelStore(channelId)` factory scopes every key with
`ch:<channelId>:` (job, video, link, nplink, result, short, comments, plus new
`titlecache` and `replace`). A global registry holds `channels`
(`{channelId,title,addedAt,loginHint?,needsReauth?}[]`), `activeChannel`, and
`token:<channelId>` (`{accessToken,expiresAt}`).

**Jobs.** `ingest`/`extract`/`check` take a `ChannelStore` (not the module-level
storage fns) plus deps. The YouTube token provider is threaded via `YoutubeDeps`
bound to the channel. Only one audit runs at a time; viewing another channel is
a read against that channel's store.

**UI.** Top-bar channel dropdown + "Add channel" (interactive auth →
channels.list → register + activate). Switching swaps the viewed channel; each
has independent audit/progress/results.

## Feature B — Phase 2 AI replacement suggestions

**On-demand per broken link** (`delisted`/`unavailable`/`redirected`), never
auto (cost control). Flow: LLM(keywords from cached old title/context) →
PA-API `SearchItems` in the same marketplace → we build the tagged URL from the
returned ASIN + partner tag → optional LLM one-line copy → cards with copy.

**Hard guardrail.** LLM output is used ONLY for keywords + copy. Every ASIN and
URL is constructed in our code from the PA-API response. Enforced + tested.

**Pieces.**
- `lib/paapi.ts` — PA-API 5.0 client, in-browser AWS SigV4 (`crypto.subtle`
  HMAC-SHA256), marketplace→host/region map. Extension host-permissions bypass
  CORS. Injectable fetch/clock for tests.
- `lib/llm.ts` — Anthropic Messages API (default `claude-haiku-4-5`), two bounded
  calls (`keywordsFor`, `draftCopy`). Injectable fetch.
- Title gap: cache `titlecache:<asin>` whenever a product is seen alive, so a
  later-dead product still has a searchable name; else fall back to description
  context; else skip with a note.
- Graceful degrade: unconfigured / not PA-API-eligible / throttled → hide with a
  friendly hint; never breaks the audit.

**Config (friendly, no rebuild).** Keys entered in dashboard → Advanced → "AI &
Amazon API", persisted in `chrome.storage.local` (device-local): PA-API
accessKey/secretKey/partnerTag/region; LLM apiKey (+ model prefilled). `config.ts`
may still hold defaults.

## Testing
- SigV4 signature vs a known vector; PA-API + LLM clients with mocked fetch;
  guardrail test (ASIN/URL from PA-API only, LLM text ignored for links).
- Multi-channel store isolation (channel A vs B); per-channel exactly-once.
- Existing 66 tests stay green.

## Setup impact
- Google: switch from "Chrome Extension" OAuth client to a "Web application"
  client with redirect `https://<ext-id>.chromiumapp.org/`. SETUP rewritten.
- New optional SETUP section: PA-API keys (Associates → Tools → Product
  Advertising API; eligibility caveat) + Anthropic key.
