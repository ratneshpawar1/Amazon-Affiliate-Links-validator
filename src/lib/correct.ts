// "Copy corrected description" generator (plan §M6). Pure and idempotent.
//
// Rules:
//  • live page, tag missing/wrong  → rewrite the URL in place, setting the
//    owner's tag while preserving every other query param and the URL FORM the
//    owner used (we never canonicalize /gp/product/ → /dp/). Short links are
//    replaced with their resolved full URL + correct tag, since a short link
//    itself can't be retagged.
//  • delisted / unavailable / redirected_asin → keep the link, append a visible
//    ⚠️ annotation (never silently remove).
//  • blocked → annotate [UNVERIFIED …].
//  • live page with a correct tag → left byte-identical.

import type { CheckStatus } from "./types";

export const YOUTUBE_DESC_LIMIT = 5000;

export interface CorrectionOccurrence {
  rawUrl: string;
  charStart?: number;
  charEnd?: number;
  status: CheckStatus; // ASIN-level status
  tagOk: boolean; // is THIS occurrence's tag correct? (per-occurrence)
  marketplace?: string;
  resolvedUrl?: string; // short links: the full URL to substitute
}

export interface CorrectionOptions {
  /** Choose the owner tag to apply for a given marketplace. */
  ownerTagFor: (marketplace: string | undefined) => string | undefined;
}

export interface DiffSpan {
  start: number; // offset into the CORRECTED string
  end: number;
  kind: "retag" | "annotate";
}

export interface CorrectionResult {
  corrected: string;
  changed: boolean;
  descriptionChanged: boolean; // a rawUrl could not be located → re-run ingest
  notFound: string[];
  exceedsLimit: boolean;
  spans: DiffSpan[];
}

const REPLACE_ANNOTATION = (status: CheckStatus) =>
  ` ⚠️ [LINK NEEDS REPLACEMENT — ${status}]`;
const BLOCKED_ANNOTATION = " [UNVERIFIED — Amazon blocked the check]";

/** Simple per-marketplace chooser; v1 uses the first configured tag. */
export function chooseOwnerTag(
  ownerTags: string[],
  _marketplace?: string
): string | undefined {
  return ownerTags[0];
}

/** Set/replace `tag=` while preserving everything else and the URL form. */
export function retagUrl(url: string, tag: string): string {
  // Split off any #fragment so an appended param lands before it.
  const hashIdx = url.indexOf("#");
  const frag = hashIdx >= 0 ? url.slice(hashIdx) : "";
  let base = hashIdx >= 0 ? url.slice(0, hashIdx) : url;

  if (/([?&])tag=[^&]*/i.test(base)) {
    base = base.replace(/([?&])tag=[^&]*/i, `$1tag=${tag}`);
  } else if (base.includes("?")) {
    base = `${base}&tag=${tag}`;
  } else {
    base = `${base}?tag=${tag}`;
  }
  return base + frag;
}

interface Edit {
  start: number;
  end: number;
  original: string;
  replacement: string;
  kind: "retag" | "annotate";
}

function locate(
  description: string,
  occ: CorrectionOccurrence
): { start: number; end: number } | null {
  if (
    occ.charStart != null &&
    occ.charEnd != null &&
    description.slice(occ.charStart, occ.charEnd) === occ.rawUrl
  ) {
    return { start: occ.charStart, end: occ.charEnd };
  }
  const idx = description.indexOf(occ.rawUrl);
  if (idx < 0) return null;
  return { start: idx, end: idx + occ.rawUrl.length };
}

export function correctDescription(
  description: string,
  occurrences: CorrectionOccurrence[],
  opts: CorrectionOptions
): CorrectionResult {
  const notFound: string[] = [];
  const edits: Edit[] = [];

  for (const occ of occurrences) {
    const span = locate(description, occ);
    if (!span) {
      notFound.push(occ.rawUrl);
      continue;
    }
    const original = description.slice(span.start, span.end);

    // Live page, wrong/missing tag → retag in place.
    if (occ.status === "ok" && !occ.tagOk) {
      const tag = opts.ownerTagFor(occ.marketplace);
      if (!tag) continue; // no owner tag configured — nothing to apply
      const target = occ.resolvedUrl && occ.resolvedUrl.length ? occ.resolvedUrl : original;
      const retagged = retagUrl(target, tag);
      if (retagged !== original) {
        edits.push({ ...span, original, replacement: retagged, kind: "retag" });
      }
      continue;
    }

    // Dead / suspicious → append a visible annotation (idempotently).
    let annotation: string | null = null;
    if (
      occ.status === "delisted" ||
      occ.status === "unavailable" ||
      occ.status === "redirected_asin"
    ) {
      annotation = REPLACE_ANNOTATION(occ.status);
    } else if (occ.status === "blocked") {
      annotation = BLOCKED_ANNOTATION;
    }
    if (annotation) {
      // Idempotent: skip if the annotation is already right after the URL.
      if (description.startsWith(annotation, span.end)) continue;
      edits.push({
        ...span,
        original,
        replacement: original + annotation,
        kind: "annotate",
      });
    }
    // status === 'ok' && tagOk → no edit (byte-identical).
  }

  // Apply left-to-right, tracking corrected-string coordinates for the diff.
  edits.sort((a, b) => a.start - b.start);
  let out = "";
  let cursor = 0;
  const spans: DiffSpan[] = [];
  for (const e of edits) {
    out += description.slice(cursor, e.start);
    const spanStart = out.length;
    out += e.replacement;
    spans.push({ start: spanStart, end: out.length, kind: e.kind });
    cursor = e.end;
  }
  out += description.slice(cursor);

  return {
    corrected: out,
    changed: edits.length > 0,
    descriptionChanged: notFound.length > 0,
    notFound,
    exceedsLimit: out.length > YOUTUBE_DESC_LIMIT,
    spans,
  };
}
