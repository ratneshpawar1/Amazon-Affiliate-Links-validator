# Testing

## Automated (Vitest)

```bash
npm run typecheck   # tsc --noEmit — must be clean
npm test            # 66 unit tests
```

Coverage maps to the plan's milestone acceptance criteria:

| Area | File | Covers |
|---|---|---|
| Extraction (M3) | `test/extract.test.ts` | ≥12 URL forms, offsets slice back to the raw URL, dedupe/reverse-index, non-product classification |
| Classification (M4) | `test/classify.test.ts` | all 6 statuses over HTML fixtures; unknown shape → `blocked` (never guesses) |
| Checker resumability (M4) | `test/check.test.ts` | exactly-once across simulated SW kills; park after 3 consecutive blocks; block-counter reset |
| Short links (M3) | `test/shortlinks.test.ts` | redirect resolution, captcha-landing → blocked, network error |
| Quota/backoff (M2) | `test/youtube.test.ts` | `[500,500,200]` succeeds after backoff; 403 quota / 429 → park; 401 retry-once; `commentsDisabled` tolerated |
| Report model (M5) | `test/report.test.ts` | per-occurrence `tag_missing_or_wrong` downgrade |
| CSV (M5) | `test/csv.test.ts` | RFC-4180 escaping of commas / quotes / newlines |
| Corrected descriptions (M6) | `test/correct.test.ts` | retag preserving params & form, annotate dead links, idempotency, astral-char offsets, 5,000-char warning |

Classification fixtures live in `test/fixtures/amazon/*.html`. To refresh them
after Amazon DOM drift, save a real page's HTML into that folder (strip your
account name from the navbar) and re-run the tests — because `classify.ts` is
pure and shared, the same tests cover both the fetch and tab paths.

## Manual end-to-end checklist (real channel + real Amazon session)

Run after loading `dist/` unpacked and signing in.

### M1 — auth
- [ ] Popup **Sign in** → Google consent shows **only** "See your YouTube account" (read-only).
- [ ] Popup shows the correct channel title.
- [ ] Revoke at myaccount.google.com → re-auth works.
- [ ] With `oauthClientId` blank, popup shows the friendly SETUP pointer (no console error).

### M2 — ingest
- [ ] Dashboard video count matches YouTube Studio exactly.
- [ ] Kill the SW mid-ingest (`chrome://serviceworker-internals`, or wait ~30s idle) → reopening resumes with no duplicate or missing videos.
- [ ] A video with comments disabled is skipped without stopping the run.

### M4 — checker live smoke list
Make a test video/description containing:
- [ ] a known-good **tagged** link → `ok`
- [ ] the **same product untagged** → that occurrence flags `tag_missing_or_wrong`
- [ ] a discontinued product → `unavailable` or `delisted`
- [ ] garbage ASIN `B000000000` → `delisted`
- [ ] Kill the SW mid-queue → resumes within ~1 min, no completed ASIN re-checked.
- [ ] In DevTools Network, confirm no two Amazon hits closer than `paceMinMs`.
- [ ] Trigger a real robot check → `blocked`; after 3 in a row the job parks with a banner.

### M5 — dashboard
- [ ] Status filter chips return correct subsets.
- [ ] `tag_missing_or_wrong` and `redirected_asin` are visually loud and sorted to top.
- [ ] Export CSV opens cleanly in Excel/Sheets even with commas/quotes in titles.

### M6 — corrected descriptions
- [ ] "Review & copy" shows a diff with changed spans highlighted.
- [ ] Untagged live link gets your tag added (other params preserved); dead link gets a ⚠️ annotation; correct link is unchanged.
- [ ] Running it twice produces identical output (idempotent).
- [ ] A description edited since ingest shows the "re-run ingest" warning instead of guessing.

### Logged-out Amazon run
- [ ] Repeat a small M4 run while **logged out** of Amazon. Tag checking is
      URL-based so it still works; note any buy-box differences that shift
      `ok`↔`unavailable` (expected — that's what the logged-in session is for).
