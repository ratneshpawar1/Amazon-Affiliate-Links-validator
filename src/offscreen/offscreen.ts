// Offscreen document (reason: DOM_PARSER). The service worker has no DOMParser,
// so it hands fetched Amazon HTML here to be parsed into a Document and reduced
// to PageSignals with the SAME shared extractSignals used by the tab probe.
//
// NB: Amazon serves X-Frame-Options: SAMEORIGIN, so we can't iframe product
// pages — this doc only parses HTML STRINGS the SW fetched (plan §3).

import { extractSignals } from "../lib/classify";
import type { ParseHtmlRequest } from "../lib/messages";

chrome.runtime.onMessage.addListener((msg: unknown, _sender, sendResponse) => {
  const req = msg as ParseHtmlRequest;
  if (req?.type !== "PARSE_HTML" || req.target !== "offscreen") return false;

  try {
    const doc = new DOMParser().parseFromString(req.html, "text/html");
    const signals = extractSignals(doc, req.finalUrl, req.httpStatus);
    sendResponse(signals);
  } catch (e) {
    // Return minimal signals; classify() will treat an unknown shape as blocked.
    sendResponse({
      finalUrl: req.finalUrl,
      httpStatus: req.httpStatus,
      title: "",
      productTitle: "",
      canonicalFromDom: false,
      captchaUrl: false,
      captchaTitle: false,
      captchaBodyText: false,
      captchaForm: false,
      dogPage: false,
      pageNotFoundTitle: false,
      availabilityText: "",
      hasOutOfStock: false,
      hasAddToCart: false,
      hasBuyNow: false,
      hasPrice: false,
      bodySample: String(e),
    });
  }
  return true; // async sendResponse
});
