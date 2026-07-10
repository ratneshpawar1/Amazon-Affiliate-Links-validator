# YT Amazon Affiliate Link Auditor

A Chrome MV3 extension that audits the Amazon affiliate links across **your own**
YouTube channel and reports which are **dead, hijacked, or losing commission** —
so you can fix descriptions before they cost you money.

It signs you into the YouTube Data API (read-only), enumerates every video,
extracts every Amazon link from descriptions and pinned/top comments, dedupes by
ASIN, then checks each product **through your own logged-in Chrome session** with
gentle human-like pacing. Results land in a filterable dashboard with CSV export
and one-click "copy corrected description".

> **New here / not a developer?** Follow **[SETUP.md](SETUP.md)** instead — it's
> a click-by-click guide. This README is the technical overview.

---

## The six statuses

Every checked ASIN gets exactly one honest status:

| Status | Meaning |
|---|---|
| `ok` | Live product page, and (per occurrence) your correct tag is present. |
| `tag_missing_or_wrong` | **Live but losing commission** — the link has no tag, or a tag that isn't yours. Decided **per occurrence**. |
| `redirected_asin` | The page's canonical ASIN differs from the one you linked (possible hijack/merge, or a variant to confirm). |
| `unavailable` | Product page exists but has no buy box / is out of stock. |
| `delisted` | 404 / "we couldn't find that page". |
| `blocked` | Amazon showed a robot check — **status undetermined, never guessed.** |

`tag_missing_or_wrong` and `redirected_asin` are the money-losers and are sorted
to the top and coloured loudest in the dashboard.

---

## Capabilities

- **Multi-channel.** Sign in via `launchWebAuthFlow` (Google's account + brand-
  channel picker), so it handles brand accounts and separate Google accounts.
  Each channel keeps its own audit data; switch with the top-bar dropdown.
- **AI replacement suggestions (optional).** For broken links, an on-demand
  action finds real current products via the Amazon PA-API and builds fresh
  tagged links. The LLM (Anthropic) only picks search keywords and writes a
  one-line note — **every ASIN/URL is built from the PA-API response, never the
  model.** Keys are entered in the dashboard and stay on your machine; the
  feature hides itself when unconfigured or when the account isn't PA-API-eligible.

## What it does NOT do

- No writes to YouTube (read-only scope only).
- No servers — PA-API is signed in-browser (SigV4); keys never leave your device.
- The AI never invents product links (enforced in code + tested).

---

## How it works

```
Popup (launcher)  ──▶  Background service worker (job runner)  ──▶  chrome.storage.local
Dashboard (tab UI)      ├─ OAuth via launchWebAuthFlow (per-channel tokens)
                        ├─ YouTube API client (read-only, paged, quota-aware)
                        ├─ Extraction pipeline (ASIN dedupe + reverse index)
                        ├─ Checker queue (crash-only, resumable)
                        │     ├─ fast path: SW fetch → offscreen DOMParser → classify
                        │     └─ fallback:  background tab → probe content script → classify
                        └─ Replacements (optional): LLM keywords → PA-API SearchItems

Storage is namespaced per channel: channelStore(channelId) → `ch:<id>:…` keys.
```

- The **queue and every result live in storage before the next item starts**, so
  a killed service worker resumes exactly-once. A 1-minute `chrome.alarms`
  heartbeat re-drives the job after any SW kill or browser restart.
- Checks hit `/dp/<ASIN>` **without** your affiliate tag, so audit traffic never
  registers as an affiliate click and can't inflate your metrics (plan §8).
- All Amazon-controlled selectors live in one table in
  [`src/lib/classify.ts`](src/lib/classify.ts) with a fixture test per status, so
  when Amazon changes its DOM it's a one-file update.

---

## Project layout

```
manifest.json                 MV3 manifest template (build injects your Client ID)
src/
  config.example.ts           copy to config.ts — the ONLY file you edit
  background.ts               service worker = job runner
  popup/                      launcher popup
  dashboard/                  full dashboard UI (report, filters, csv)
  offscreen/                  DOMParser for fetched Amazon HTML
  content/amazon-probe.ts     probe injected into background checker tabs
  lib/                        auth, storage, youtube, extract, classify, correct…
  jobs/                       ingest, extract, check pipelines
test/                         Vitest unit tests + HTML/description fixtures
scripts/build.mjs             esbuild build → dist/
```

---

## Developing

```bash
npm install        # once
npm run build      # produce dist/ (load unpacked at chrome://extensions)
npm run dev        # rebuild on change
npm run typecheck  # tsc --noEmit
npm test           # vitest
```

The build reads `src/config.ts` (git-ignored) and injects your OAuth Client ID
into `dist/manifest.json`. With no Client ID set it still builds — the extension
just shows a friendly "finish SETUP.md step 3" message.

Manual end-to-end steps live in **[TESTING.md](TESTING.md)**.

---

## Setup summary (details in SETUP.md)

1. Create a free Google Cloud project; enable **YouTube Data API v3**.
2. OAuth consent screen in **Testing** mode; add your own account as a test user.
3. Create a **Web application** OAuth client with redirect
   `https://<ext-id>.chromiumapp.org/`; paste the client ID into `src/config.ts`.
4. `npm install && npm run build`, load `dist/` unpacked, add your channel, enter your tag.
5. *(Optional)* paste Amazon PA-API + Anthropic keys in Advanced to enable AI suggestions.

---

## Privacy

Read-only YouTube access. No data leaves your browser except (a) read-only calls
to the YouTube API and (b) the same Amazon product pages you'd visit yourself.
Your OAuth Client ID lives only in your local, git-ignored `config.ts`.
