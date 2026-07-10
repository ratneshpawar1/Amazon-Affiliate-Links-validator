// Amazon link extraction (plan §M3). Pure functions — no chrome APIs — so the
// whole recognizer suite is unit-testable over text fixtures.
//
// ASIN = exactly 10 chars [A-Z0-9] (uppercase; usually starts "B0" but ISBN-10s
// of books are valid ASINs too, so we do NOT require the "B0" prefix).

export const ASIN_RE = /[A-Z0-9]{10}/;

export const SHORT_HOSTS = ["amzn.to", "amzn.eu", "amzn.asia", "a.co"] as const;

// Amazon marketplace TLDs we recognise. Longest alternatives first so
// "amazon.com.au" wins over "amazon.com".
const TLD_ALT = "com\\.au|co\\.uk|co\\.jp|com|de|ca|in|fr|it|es";

// Candidate-URL finder. Optional scheme, optional subdomains, an Amazon or
// short host, optional path. The lookbehind stops us matching "a.co" inside
// words like "data.co".
const URL_RE = new RegExp(
  "(?<![A-Za-z0-9.@-])" +
    "(?:https?://)?" +
    "(?:[a-z0-9-]+\\.)*" +
    `(?:amazon\\.(?:${TLD_ALT})|amzn\\.to|amzn\\.eu|amzn\\.asia|a\\.co)` +
    "(?:/[^\\s<>\"'\\)\\]]*)?",
  "gi"
);

const MARKETPLACE_RE = new RegExp(`amazon\\.(?:${TLD_ALT})`, "i");

// Product-path recognizers, in priority order (plan §M3).
const PRODUCT_PATH_RES: RegExp[] = [
  /\/dp\/([A-Z0-9]{10})(?:[/?#]|$)/,
  /\/gp\/product\/([A-Z0-9]{10})(?:[/?#]|$)/,
  /\/gp\/aw\/d\/([A-Z0-9]{10})(?:[/?#]|$)/,
  /\/exec\/obidos\/ASIN\/([A-Z0-9]{10})(?:[/?#]|$)/,
];

export interface BaseRef {
  rawUrl: string;
  charStart: number;
  charEnd: number;
}

export interface ProductRef extends BaseRef {
  kind: "product";
  asin: string;
  marketplace: string; // e.g. "amazon.com"
  tag?: string;
  ascsubtag?: string;
}

export interface ShortRef extends BaseRef {
  kind: "short";
}

export interface NonProductRef extends BaseRef {
  kind: "storefront" | "idealist" | "other-amazon";
}

export type LinkRef = ProductRef | ShortRef | NonProductRef;

function isShortHost(host: string): boolean {
  return SHORT_HOSTS.some((h) => host === h || host.endsWith("." + h));
}

function marketplaceFromHost(host: string): string {
  const m = host.match(MARKETPLACE_RE);
  return m ? m[0].toLowerCase() : host.toLowerCase();
}

function asinFromPath(pathname: string): string | undefined {
  for (const re of PRODUCT_PATH_RES) {
    const m = pathname.match(re);
    if (m) return m[1];
  }
  return undefined;
}

/** Trim trailing sentence/markdown punctuation the URL regex may have eaten. */
function trimTrailingPunct(url: string): string {
  return url.replace(/[.,;:!?)\]}'"»]+$/u, "");
}

function classify(rawUrl: string): Omit<LinkRef, "charStart" | "charEnd"> {
  const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  let u: URL;
  try {
    u = new URL(withScheme);
  } catch {
    return { kind: "other-amazon", rawUrl };
  }
  const host = u.hostname.toLowerCase();

  if (isShortHost(host)) {
    return { kind: "short", rawUrl };
  }

  const path = decodeURIComponent(u.pathname);

  // Storefront / idea-list pages have no single ASIN to validate.
  if (/^\/(shop|stores)(\/|$)/i.test(path)) {
    return { kind: "storefront", rawUrl };
  }
  if (/^\/(list|ideas)(\/|$)/i.test(path) || /\/ideas\//i.test(path)) {
    return { kind: "idealist", rawUrl };
  }

  const asin = asinFromPath(path);
  if (asin) {
    const ref: Omit<ProductRef, "charStart" | "charEnd"> = {
      kind: "product",
      rawUrl,
      asin,
      marketplace: marketplaceFromHost(host),
    };
    const tag = u.searchParams.get("tag");
    if (tag) ref.tag = tag;
    const asc = u.searchParams.get("ascsubtag");
    if (asc) ref.ascsubtag = asc;
    return ref;
  }

  return { kind: "other-amazon", rawUrl };
}

/**
 * Find every Amazon link in `text`, with exact char offsets. The slice
 * text.slice(ref.charStart, ref.charEnd) always equals ref.rawUrl.
 */
export function extractLinks(text: string): LinkRef[] {
  const out: LinkRef[] = [];
  URL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = URL_RE.exec(text)) !== null) {
    const start = m.index;
    const raw = trimTrailingPunct(m[0]);
    if (!raw) continue;
    const end = start + raw.length;
    const parsed = classify(raw);
    out.push({ ...parsed, charStart: start, charEnd: end } as LinkRef);
  }
  return out;
}

/** Pull the `tag=` value out of any Amazon URL (raw or resolved). */
export function tagOf(rawUrl: string): string | undefined {
  const withScheme = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
  try {
    return new URL(withScheme).searchParams.get("tag") ?? undefined;
  } catch {
    return undefined;
  }
}

/** Canonical-ish product URL used as Link.resolvedUrl. */
export function canonicalProductUrl(marketplace: string, asin: string): string {
  return `https://www.${marketplace}/dp/${asin}`;
}

/** Stable small hash for NonProductLink storage keys. */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

// ── Pure reverse-index builder (plan §M3 dedupe) ────────────────────────────
import type { Link, NonProductLink, Occurrence, NonProductKind } from "./types";

export interface SourceDoc {
  videoId: string;
  source: "description" | "comment";
  commentId?: string;
  text: string;
}

/**
 * Fold every occurrence across many documents into the ASIN reverse index and
 * the non-product list. Pure and synchronous — short links are reported as
 * `unresolved-short` here; the job resolves them first and re-feeds the
 * resolved product URL as description/comment text (see jobs/extract.ts).
 */
export function buildIndex(docs: SourceDoc[]): {
  links: Link[];
  nonProduct: NonProductLink[];
} {
  const links = new Map<string, Link>();
  const nonProduct = new Map<string, NonProductLink>();

  for (const doc of docs) {
    for (const ref of extractLinks(doc.text)) {
      const occ: Occurrence = {
        videoId: doc.videoId,
        source: doc.source,
        rawUrl: ref.rawUrl,
      };
      if (doc.commentId) occ.commentId = doc.commentId;
      if (doc.source === "description") {
        occ.charStart = ref.charStart;
        occ.charEnd = ref.charEnd;
      }

      if (ref.kind === "product") {
        let link = links.get(ref.asin);
        if (!link) {
          link = {
            asin: ref.asin,
            resolvedUrl: canonicalProductUrl(ref.marketplace, ref.asin),
            marketplace: ref.marketplace,
            tagsSeen: [],
            occurrences: [],
          };
          links.set(ref.asin, link);
        }
        link.occurrences.push(occ);
        if (ref.tag && !link.tagsSeen.includes(ref.tag)) link.tagsSeen.push(ref.tag);
      } else {
        const kind: NonProductKind =
          ref.kind === "short" ? "unresolved-short" : ref.kind;
        const key = hashString(ref.rawUrl);
        let np = nonProduct.get(key);
        if (!np) {
          np = { rawUrl: ref.rawUrl, kind, occurrences: [] };
          nonProduct.set(key, np);
        }
        np.occurrences.push(occ);
      }
    }
  }

  return { links: [...links.values()], nonProduct: [...nonProduct.values()] };
}
