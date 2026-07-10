// Amazon page classification (plan §M4). PURE and shared: it takes a normalised
// `PageSignals` object, so the SAME logic covers both check paths —
//   • fetch fast path:  SW fetch → offscreen DOMParser → extractSignals → classify
//   • tab fallback:     probe reads live DOM → extractSignals → classify
//
// All the Amazon-controlled selectors/strings live in ONE table here, each with
// a fixture test, so DOM drift is a one-file change (plan §M4).

import type { CheckStatus } from "./types";

export interface PageSignals {
  finalUrl: string;
  httpStatus?: number;
  title: string;
  productTitle: string; // #productTitle text, if any (captured for Phase 2)
  canonicalAsin?: string; // from link[rel=canonical] or the final URL path
  canonicalFromDom: boolean; // true only when the ASIN came from a DOM canonical link
  captchaUrl: boolean; // final URL is a validateCaptcha/robot URL
  captchaTitle: boolean; // "Robot Check" / "Sorry! Something went wrong"
  captchaBodyText: boolean; // "enter the characters you see below" / "not a robot"
  captchaForm: boolean; // a <form> posts to /errors/validateCaptcha
  dogPage: boolean; // the "we couldn't find that page" dog error page
  pageNotFoundTitle: boolean;
  availabilityText: string; // #availability text
  hasOutOfStock: boolean; // #outOfStock present
  hasAddToCart: boolean; // #add-to-cart-button present
  hasBuyNow: boolean; // #buy-now-button present
  hasPrice: boolean; // .a-price .a-offscreen or #corePrice* present
  bodySample: string; // first 500 chars of body text (debug)
}

export interface Classification {
  status: CheckStatus;
  requestedAsin: string;
  canonicalAsin?: string;
  title?: string;
  evidence: string;
  signals: Record<string, string | boolean>;
}

const CANONICAL_ASIN_RE =
  /\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/ASIN)\/([A-Z0-9]{10})/;

const OOS_RE = /currently unavailable|out of stock|available from these sellers/i;

function textOf(el: Element | null): string {
  return (el?.textContent ?? "").replace(/\s+/g, " ").trim();
}

function canonicalAsinFrom(
  doc: Document,
  finalUrl: string
): { asin?: string; fromDom: boolean } {
  const link = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  const href = link?.getAttribute("href") ?? "";
  const fromCanonical = href.match(CANONICAL_ASIN_RE);
  if (fromCanonical) return { asin: fromCanonical[1], fromDom: true };
  // A /dp/<ASIN> in the final URL is just the URL we requested echoed back — it
  // tells us the landing ASIN (for redirect detection) but is NOT evidence the
  // page actually rendered as a product page.
  const fromUrl = finalUrl.match(CANONICAL_ASIN_RE);
  return { asin: fromUrl ? fromUrl[1] : undefined, fromDom: false };
}

/**
 * Read raw signals from a parsed/rendered Amazon page. Runs identically over a
 * DOMParser Document (fetch path) and a live document (tab path).
 */
export function extractSignals(
  doc: Document,
  finalUrl: string,
  httpStatus?: number
): PageSignals {
  const title = textOf(doc.querySelector("title")) || (doc as Document).title || "";
  const titleLc = title.toLowerCase();
  const bodyText = (doc.body?.textContent ?? "").replace(/\s+/g, " ").trim();

  const captchaForm = Array.from(doc.querySelectorAll("form")).some((f) =>
    /\/errors\/validateCaptcha/i.test(f.getAttribute("action") ?? "")
  );
  const dogPage =
    /we couldn'?t find that page|sorry!? we couldn'?t find that page/i.test(bodyText) ||
    !!doc.querySelector('img[src*="dogsofamazon"], a[href*="dogsofamazon"]');

  const canonical = canonicalAsinFrom(doc, finalUrl);

  return {
    finalUrl,
    httpStatus,
    title,
    productTitle: textOf(doc.querySelector("#productTitle")),
    canonicalAsin: canonical.asin,
    canonicalFromDom: canonical.fromDom,
    captchaUrl: /\/errors\/(?:validateCaptcha|robot)/i.test(finalUrl),
    captchaTitle:
      titleLc === "robot check" || /sorry!? something went wrong/i.test(title),
    captchaBodyText:
      /enter the characters you see below/i.test(bodyText) ||
      /type the characters you see|not a robot/i.test(bodyText),
    captchaForm,
    dogPage,
    pageNotFoundTitle: /page not found/i.test(titleLc),
    availabilityText: textOf(doc.querySelector("#availability")),
    hasOutOfStock: !!doc.querySelector("#outOfStock"),
    hasAddToCart: !!doc.querySelector("#add-to-cart-button"),
    hasBuyNow: !!doc.querySelector("#buy-now-button"),
    hasPrice: !!doc.querySelector(
      '.a-price .a-offscreen, [id^="corePrice"], #priceblock_ourprice, #priceblock_dealprice'
    ),
    bodySample: bodyText.slice(0, 500),
  };
}

/**
 * Turn signals into one of the 6 statuses. NEVER guesses — an unrecognised page
 * shape falls through to `blocked`, not to a wrong verdict.
 *
 * Note `tag_missing_or_wrong` is NOT produced here: liveness is per-ASIN, but
 * tag correctness is per-occurrence and computed at report time. A live page is
 * `ok` at the ASIN level; the report layer downgrades individual occurrences.
 */
export function classify(s: PageSignals, requestedAsin: string): Classification {
  const signals: Record<string, string | boolean> = {
    finalUrl: s.finalUrl,
    hasAddToCart: s.hasAddToCart,
    hasBuyNow: s.hasBuyNow,
    hasPrice: s.hasPrice,
    hasOutOfStock: s.hasOutOfStock,
    availabilityText: s.availabilityText,
    canonicalAsin: s.canonicalAsin ?? "",
    title: s.title,
  };
  if (s.httpStatus != null) signals.httpStatus = String(s.httpStatus);

  const base = (status: CheckStatus, evidence: string): Classification => ({
    status,
    requestedAsin,
    canonicalAsin: s.canonicalAsin,
    title: s.productTitle || undefined,
    evidence,
    signals,
  });

  // 1. blocked — robot check / CAPTCHA.
  if (s.captchaUrl || s.captchaTitle || s.captchaBodyText || s.captchaForm) {
    const why = [
      s.captchaUrl && "captcha URL",
      s.captchaTitle && "robot-check title",
      s.captchaBodyText && "captcha body text",
      s.captchaForm && "captcha form",
    ]
      .filter(Boolean)
      .join(", ");
    return base("blocked", `robot check detected (${why})`);
  }

  // 2. delisted — 404 / dog error page.
  if (s.httpStatus === 404) {
    return base("delisted", "HTTP 404");
  }
  if (s.dogPage || s.pageNotFoundTitle) {
    return base("delisted", `"couldn't find that page" error page`);
  }

  // 3. redirected_asin — canonical/landing ASIN differs from what we asked for.
  if (s.canonicalAsin && s.canonicalAsin !== requestedAsin) {
    return base(
      "redirected_asin",
      `canonical ASIN ${s.canonicalAsin} ≠ requested ${requestedAsin} (possible hijack/merge or a variant — confirm)`
    );
  }

  // Is this recognisably a product page at all? If none of these markers exist
  // (and it isn't a captcha/dog page), we don't understand the shape.
  const productMarkers =
    s.canonicalFromDom ||
    s.hasAddToCart ||
    s.hasBuyNow ||
    s.hasPrice ||
    s.availabilityText !== "" ||
    s.hasOutOfStock;

  if (!productMarkers) {
    signals.sample = s.bodySample;
    return base("blocked", "no known markers matched (unrecognised page shape)");
  }

  // 4. unavailable — product page confirmed but not buyable.
  const noBuyBox = !s.hasAddToCart && !s.hasBuyNow;
  const oosText = OOS_RE.test(s.availabilityText);
  if (s.hasOutOfStock || oosText || noBuyBox) {
    const why = s.hasOutOfStock
      ? "#outOfStock present"
      : oosText
        ? `#availability='${s.availabilityText}'`
        : "no #add-to-cart-button and no #buy-now-button";
    return base("unavailable", why);
  }

  // 5. ok — live with a buy box (tag correctness handled at report time).
  const priceNote = s.hasPrice ? " + price" : "";
  const boxNote = s.hasAddToCart ? "#add-to-cart-button" : "#buy-now-button";
  return base("ok", `live product page (${boxNote}${priceNote})`);
}
