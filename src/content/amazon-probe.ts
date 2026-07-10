// Amazon probe content script (plan §M4 tab path). Injected via
// chrome.scripting.executeScript ONLY into background tabs the extension itself
// opened. Reads the rendered DOM in the user's real session, reduces it to
// PageSignals with the shared extractSignals, and reports back to the SW. The
// SW then closes the tab.
//
// Bundled as an IIFE (no runtime imports) so it can run as an injected file.

import { extractSignals } from "../lib/classify";
import type { ProbeResultMessage } from "../lib/messages";

const signals = extractSignals(document, location.href, undefined);
const msg: ProbeResultMessage = { type: "PROBE_RESULT", signals };
chrome.runtime.sendMessage(msg);
