// Dev-only: write dist/preview.html — renders the real dashboard bundle with a
// mocked chrome API + seeded data (multi-channel + AI). Run AFTER `npm run build`.
import { writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../dist");

const mic = "https://www.amazon.com/dp/B0MIC000AA";
const stand = "https://www.amazon.com/dp/B0STAND0BB?tag=mychannel-20";
const dead = "https://www.amazon.com/dp/B0DEAD00CC";
const oos = "https://www.amazon.com/dp/B0OOS000DD";

const job = {
  phase: "done", checkQueue: [], consecutiveBlocks: 0,
  channelId: "UC_main", channelTitle: "ratnesh pawar", uploadsPlaylistId: "UU",
  settings: { ownerTags: ["mychannel-20"], fetchComments: true, paceMinMs: 8000, paceMaxMs: 20000, marketplaces: ["amazon.com"], tabsOnly: false },
  stats: { videos: 22, links: 4, checked: 4, byStatus: { ok: 1, tag_missing_or_wrong: 1, redirected_asin: 0, unavailable: 1, delisted: 1, blocked: 0 } },
  commentAccessNote: "Comment scanning isn't available with read-only access on this account — your video descriptions were still scanned in full.",
  updatedAt: new Date().toISOString(),
};

const appState = {
  channels: [
    { channelId: "UC_main", title: "ratnesh pawar", addedAt: "" },
    { channelId: "UC_second", title: "Tech Reviews 2", addedAt: "" },
  ],
  activeChannelId: "UC_main",
  job,
};

const payload = {
  videos: [
    { videoId: "v1", title: "Best Budget Mic for YouTube (2024)", url: "https://www.youtube.com/watch?v=v1", description: `Gear I use:\nMic: ${mic}\nStand: ${stand}\n`, publishedAt: "", commentsFetched: true },
    { videoId: "v2", title: "My Home Studio Tour", url: "https://www.youtube.com/watch?v=v2", description: `Discontinued light: ${dead}\nOut of stock panel: ${oos}\n`, publishedAt: "", commentsFetched: true },
  ],
  links: [
    { asin: "B0MIC000AA", resolvedUrl: mic, marketplace: "amazon.com", tagsSeen: [], occurrences: [{ videoId: "v1", source: "description", rawUrl: mic }] },
    { asin: "B0STAND0BB", resolvedUrl: stand, marketplace: "amazon.com", tagsSeen: ["mychannel-20"], occurrences: [{ videoId: "v1", source: "description", rawUrl: stand }] },
    { asin: "B0DEAD00CC", resolvedUrl: dead, marketplace: "amazon.com", tagsSeen: [], occurrences: [{ videoId: "v2", source: "description", rawUrl: dead }] },
    { asin: "B0OOS000DD", resolvedUrl: oos, marketplace: "amazon.com", tagsSeen: [], occurrences: [{ videoId: "v2", source: "description", rawUrl: oos }] },
  ],
  nonProduct: [],
  results: [
    { asin: "B0MIC000AA", status: "ok", requestedAsin: "B0MIC000AA", evidence: "live product page (#add-to-cart-button + price)", signals: {}, method: "fetch", checkedAt: new Date().toISOString(), attempt: 1 },
    { asin: "B0STAND0BB", status: "ok", requestedAsin: "B0STAND0BB", evidence: "live product page (#add-to-cart-button)", signals: {}, method: "fetch", checkedAt: new Date().toISOString(), attempt: 1 },
    { asin: "B0DEAD00CC", status: "delisted", requestedAsin: "B0DEAD00CC", evidence: `"couldn't find that page" error page`, signals: {}, method: "tab", checkedAt: new Date().toISOString(), attempt: 1 },
    { asin: "B0OOS000DD", status: "unavailable", requestedAsin: "B0OOS000DD", evidence: "#availability='Currently unavailable.'", signals: {}, method: "fetch", checkedAt: new Date().toISOString(), attempt: 1 },
  ],
  replacements: [],
};

const apiKeys = {
  paapiAccessKey: "AKIADEMO", paapiSecretKey: "secret", paapiPartnerTag: "mychannel-20",
  paapiRegion: "us-east-1", llmApiKey: "sk-demo", llmModel: "claude-haiku-4-5",
};

const cannedSuggestion = {
  forAsin: "B0DEAD00CC",
  candidates: [
    { asin: "B0NEWLIGHT1", title: "Neewer 18\" Ring Light Kit (current model)", url: "https://www.amazon.com/dp/B0NEWLIGHT1?tag=mychannel-20", price: "$79.99" },
    { asin: "B0NEWLIGHT2", title: "Elgato Key Light Air", url: "https://www.amazon.com/dp/B0NEWLIGHT2?tag=mychannel-20", price: "$129.99" },
  ],
  note: "A well-reviewed current equivalent with similar brightness and price.",
  generatedAt: new Date().toISOString(),
};

const html = `<!doctype html><html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Dashboard preview</title>
<link rel="stylesheet" href="dashboard.css"/></head>
<body><div id="app"></div>
<script>
const STATE = ${JSON.stringify(appState)};
const PAYLOAD = ${JSON.stringify(payload)};
const KEYS = ${JSON.stringify(apiKeys)};
const SUGGESTION = ${JSON.stringify(cannedSuggestion)};
window.chrome = {
  runtime: {
    sendMessage: async (m) => {
      switch (m.type) {
        case "GET_STATE": return STATE;
        case "GET_REPORT": return PAYLOAD;
        case "GET_API_KEYS": return KEYS;
        case "SET_API_KEYS": Object.assign(KEYS, m.keys); return { ok: true };
        case "UPDATE_SETTINGS": Object.assign(STATE.job.settings, m.settings); return { ok: true };
        case "SUGGEST_REPLACEMENTS": return { ok: true, suggestion: SUGGESTION };
        case "SWITCH_CHANNEL": STATE.activeChannelId = m.channelId; return { ok: true };
        default: return { ok: true };
      }
    },
    onMessage: { addListener() {}, removeListener() {} },
  },
};
</script>
<script type="module">import "./dashboard.js";</script>
</body></html>`;

await writeFile(resolve(dist, "preview.html"), html);
console.log("wrote dist/preview.html");
