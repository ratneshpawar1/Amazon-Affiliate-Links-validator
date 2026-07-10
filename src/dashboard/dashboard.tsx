// Dashboard — multi-channel + Phase 2 AI. One obvious action, plain-language
// summary, filterable results, per-video corrected descriptions, AI replacement
// suggestions, channel switcher, and API keys tucked into Advanced.

import "./dashboard.css";
import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { sendMessage } from "../lib/messages";
import type { AppState, ReportPayload, AddChannelResult, SuggestResult, AckResult } from "../lib/messages";
import type { JobState, Settings, CheckResult, ReplacementSuggestion, ApiKeys } from "../lib/types";
import {
  buildOccurrenceRows, tagIsOk, type OccurrenceRow, type DisplayStatus,
} from "../lib/report";
import { tagOf, SHORT_HOSTS } from "../lib/extract";
import { signInInteractive, getRedirectUrl } from "../lib/auth";
import {
  correctDescription, chooseOwnerTag, type CorrectionOccurrence, type CorrectionResult,
} from "../lib/correct";
import { downloadCsv } from "./csv";
import { StatusChips, SearchBox } from "./filters";
import { ReportTable } from "./report";

function isShortUrl(url: string): boolean {
  try {
    const h = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname;
    return SHORT_HOSTS.some((s) => h === s || h.endsWith("." + s));
  } catch { return false; }
}

const emptyCounts = (): Record<DisplayStatus, number> => ({
  ok: 0, tag_missing_or_wrong: 0, redirected_asin: 0,
  unavailable: 0, delisted: 0, blocked: 0, pending: 0,
});

// ── Top bar with channel switcher ───────────────────────────────────────────
function TopBar({ state, onChange, onAdd, adding }: {
  state: AppState; onChange: () => void; onAdd: () => void; adding: boolean;
}) {
  const active = state.channels.find((c) => c.channelId === state.activeChannelId);
  async function switchTo(id: string) {
    await sendMessage({ type: "SWITCH_CHANNEL", channelId: id }); onChange();
  }
  async function remove() {
    if (!active) return;
    if (!confirm(`Remove "${active.title}" and its audit data?`)) return;
    await sendMessage({ type: "REMOVE_CHANNEL", channelId: active.channelId }); onChange();
  }
  return (
    <div class="topbar">
      <div class="logo">🔗 Affiliate Link Auditor</div>
      <div class="spacer" />
      {state.channels.length > 0 && (
        <div class="chan">
          <span class="dot on" />
          <select value={state.activeChannelId}
            onChange={(e) => switchTo((e.target as HTMLSelectElement).value)}>
            {state.channels.map((c) => <option value={c.channelId}>{c.title}</option>)}
          </select>
          <button class="btn ghost" disabled={adding} onClick={onAdd}>{adding ? "Connecting…" : "+ Channel"}</button>
          <button class="btn ghost" onClick={remove}>Remove</button>
        </div>
      )}
    </div>
  );
}

// ── Associates-tag explainer + setup ────────────────────────────────────────
function TagSetup({ settings, prominent }: { settings: Settings; prominent: boolean }) {
  const [tag, setTag] = useState(settings.ownerTags.join(", "));
  const [saved, setSaved] = useState(false);
  async function save() {
    const ownerTags = tag.split(",").map((s) => s.trim()).filter(Boolean);
    await sendMessage({ type: "UPDATE_SETTINGS", settings: { ownerTags } });
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }
  return (
    <div class="card">
      <h2>Your Amazon Associates tag</h2>
      <p class="sub">
        Your Amazon tracking ID — how Amazon knows to pay <b>you</b>. Looks like
        <code> yourname-20</code> and appears as <code>tag=yourname-20</code> in your
        links. Find it in your{" "}
        <a href="https://affiliate-program.amazon.com" target="_blank" rel="noreferrer">Amazon Associates dashboard</a>.
      </p>
      <div class="rowflex">
        <input type="text" value={tag} placeholder="yourname-20"
          onInput={(e) => setTag((e.target as HTMLInputElement).value)} />
        <button class="btn primary" onClick={save}>Save</button>
        {saved && <span class="muted">Saved ✓</span>}
      </div>
      {prominent && !settings.ownerTags.length && (
        <p class="small muted" style="margin-top:10px">
          You can still run the audit, but we can't flag lost-commission links until this is set.
        </p>
      )}
    </div>
  );
}

// ── Run card ─────────────────────────────────────────────────────────────────
function RunCard({ job, onChange }: { job: JobState; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function act(type: "START_AUDIT" | "PAUSE_AUDIT" | "RESUME_AUDIT") {
    setBusy(true); setErr("");
    const res = await sendMessage<AckResult>({ type });
    setBusy(false);
    if (!res.ok) setErr(res.error ?? "Something went wrong.");
    onChange();
  }
  const { phase, stats } = job;
  const pct = stats.links > 0 ? Math.round((stats.checked / stats.links) * 100) : 0;
  const estMin = stats.links ? Math.max(1, Math.round((stats.links * 14) / 60)) : 0;
  return (
    <div class="card hero">
      {phase === "idle" && (<>
        <h2>Ready to audit this channel</h2>
        <p class="sub">We'll read every video, find your Amazon links, and check each one. Checks run gently (~8–20s apart) to avoid Amazon's robot checks.</p>
        <button class="btn primary lg" disabled={busy} onClick={() => act("START_AUDIT")}>Run audit</button>
      </>)}
      {phase === "ingest" && (<>
        <h2>Reading your channel…</h2><p class="sub">{stats.videos} videos so far.</p>
        <div class="progress indet"><i /></div>
        <button class="btn" disabled={busy} onClick={() => act("PAUSE_AUDIT")}>Pause</button>
      </>)}
      {phase === "extract" && (<><h2>Finding Amazon links…</h2><div class="progress indet"><i /></div></>)}
      {phase === "check" && (<>
        <h2>Checking links… {stats.checked} / {stats.links}</h2>
        <p class="sub">About {estMin} min total — you can close this tab, it keeps going.</p>
        <div class="progress"><i style={`width:${pct}%`} /></div>
        <button class="btn" disabled={busy} onClick={() => act("PAUSE_AUDIT")}>Pause</button>
      </>)}
      {phase === "parked" && (<>
        <h2>Paused</h2><p class="sub">{job.parkedReason ?? "The audit is paused."}</p>
        <button class="btn primary" disabled={busy} onClick={() => act("RESUME_AUDIT")}>Resume</button>
      </>)}
      {phase === "done" && (<>
        <h2>Audit complete ✓</h2><p class="sub">Checked {stats.checked} links across {stats.videos} videos.</p>
        <button class="btn" disabled={busy} onClick={() => act("START_AUDIT")}>Run again</button>
      </>)}
      {err && <div class="banner error" style="margin-top:14px"><span class="ic">⚠</span><span>{err}</span></div>}
    </div>
  );
}

function Summary({ rows }: { rows: OccurrenceRow[] }) {
  const c = useMemo(() => {
    const acc = emptyCounts();
    for (const r of rows) acc[r.status] += 1;
    return acc;
  }, [rows]);
  const uncertain = c.blocked + c.pending;
  return (
    <div class="tiles">
      <div class="tile bad"><div class="n">{c.tag_missing_or_wrong}</div><div class="l">Losing commission (wrong/no tag)</div></div>
      <div class="tile warn"><div class="n">{c.delisted + c.unavailable + c.redirected_asin}</div><div class="l">Broken (dead, gone, or redirected)</div></div>
      <div class="tile ok"><div class="n">{c.ok}</div><div class="l">Healthy</div></div>
      {uncertain > 0 && <div class="tile neutral"><div class="n">{uncertain}</div><div class="l">Couldn't check / pending</div></div>}
    </div>
  );
}

// ── Corrected-description modal ─────────────────────────────────────────────
function DiffView({ result }: { result: CorrectionResult }) {
  const parts: preact.JSX.Element[] = [];
  let cursor = 0;
  const text = result.corrected;
  result.spans.forEach((sp, i) => {
    if (sp.start > cursor) parts.push(<span key={`p${i}`}>{text.slice(cursor, sp.start)}</span>);
    parts.push(<span key={`h${i}`} class="hl">{text.slice(sp.start, sp.end)}</span>);
    cursor = sp.end;
  });
  if (cursor < text.length) parts.push(<span key="end">{text.slice(cursor)}</span>);
  return <div class="diff">{parts}</div>;
}

function Corrections({ payload, ownerTags, rows }: { payload: ReportPayload; ownerTags: string[]; rows: OccurrenceRow[] }) {
  const [openVideo, setOpenVideo] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const resultByAsin = useMemo(() => new Map<string, CheckResult>(payload.results.map((r) => [r.asin, r])), [payload.results]);

  const videos = useMemo(() => {
    const ids = new Set<string>();
    for (const r of rows) if (r.status !== "ok" && r.status !== "pending") ids.add(r.videoId);
    return payload.videos.filter((v) => ids.has(v.videoId));
  }, [rows, payload.videos]);

  function buildFor(videoId: string): CorrectionResult | null {
    const video = payload.videos.find((v) => v.videoId === videoId);
    if (!video) return null;
    const occs: CorrectionOccurrence[] = [];
    for (const link of payload.links) {
      const result = resultByAsin.get(link.asin);
      if (!result) continue;
      for (const occ of link.occurrences) {
        if (occ.videoId !== videoId || occ.source !== "description") continue;
        occs.push({
          rawUrl: occ.rawUrl, charStart: occ.charStart, charEnd: occ.charEnd,
          status: result.status, tagOk: tagIsOk(tagOf(occ.rawUrl), ownerTags),
          marketplace: link.marketplace, resolvedUrl: isShortUrl(occ.rawUrl) ? link.resolvedUrl : undefined,
        });
      }
    }
    return correctDescription(video.description, occs, { ownerTagFor: (m) => chooseOwnerTag(ownerTags, m) });
  }

  const current = openVideo ? buildFor(openVideo) : null;
  const currentVideo = payload.videos.find((v) => v.videoId === openVideo);
  async function copy() {
    if (!current) return;
    await navigator.clipboard.writeText(current.corrected);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  if (!videos.length) return null;
  return (
    <div class="card">
      <h2>Fix descriptions</h2>
      <p class="sub">Review the suggested edits per video, then copy &amp; paste into YouTube Studio yourself. We never touch YouTube directly.</p>
      {videos.map((v) => (
        <div class="rowflex" key={v.videoId} style="margin:6px 0; justify-content:space-between">
          <a href={v.url} target="_blank" rel="noreferrer" style="flex:1; min-width:0">{v.title}</a>
          <button class="btn" onClick={() => setOpenVideo(v.videoId)}>Review &amp; copy</button>
        </div>
      ))}
      {openVideo && current && currentVideo && (
        <div class="modal-back" onClick={(e) => { if (e.target === e.currentTarget) setOpenVideo(null); }}>
          <div class="modal">
            <div class="rowflex" style="justify-content:space-between">
              <h2 style="flex:1; min-width:0">{currentVideo.title}</h2>
              <button class="btn ghost" onClick={() => setOpenVideo(null)}>Close</button>
            </div>
            {!current.changed && <div class="banner info"><span class="ic">✓</span><span>No changes needed — already correct.</span></div>}
            {current.descriptionChanged && <div class="banner warn"><span class="ic">⚠</span><span>Some links couldn't be located (description changed since the audit). Re-run before trusting this.</span></div>}
            {current.exceedsLimit && <div class="banner warn"><span class="ic">⚠</span><span>Exceeds YouTube's 5,000-character limit.</span></div>}
            <h3 style="margin:14px 0 6px">Corrected (changes highlighted)</h3>
            <DiffView result={current} />
            <div class="rowflex" style="margin-top:12px">
              <button class="btn primary" onClick={copy} disabled={!current.changed}>Copy corrected description</button>
              {copied && <span class="muted">Copied ✓</span>}
            </div>
            <h3 style="margin:16px 0 6px">Original</h3>
            <div class="diff">{currentVideo.description}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Advanced settings (audit knobs + API keys) ──────────────────────────────
function Advanced({ settings, onReset }: { settings: Settings; onReset: () => void }) {
  const [markets, setMarkets] = useState(settings.marketplaces.join(", "));
  const [comments, setComments] = useState(settings.fetchComments);
  const [tabsOnly, setTabsOnly] = useState(settings.tabsOnly);
  const [pMin, setPMin] = useState(settings.paceMinMs);
  const [pMax, setPMax] = useState(settings.paceMaxMs);
  const [saved, setSaved] = useState(false);

  const [keys, setKeys] = useState<ApiKeys | null>(null);
  const [keysSaved, setKeysSaved] = useState(false);
  useEffect(() => { sendMessage<ApiKeys>({ type: "GET_API_KEYS" }).then(setKeys); }, []);

  async function saveAudit() {
    await sendMessage({
      type: "UPDATE_SETTINGS",
      settings: {
        marketplaces: markets.split(",").map((s) => s.trim()).filter(Boolean),
        fetchComments: comments, tabsOnly,
        paceMinMs: Math.max(1000, Number(pMin) || 8000),
        paceMaxMs: Math.max(Number(pMin) || 8000, Number(pMax) || 20000),
      },
    });
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }
  async function saveKeys() {
    if (!keys) return;
    await sendMessage({ type: "SET_API_KEYS", keys });
    setKeysSaved(true); setTimeout(() => setKeysSaved(false), 1500);
  }
  const setK = (patch: Partial<ApiKeys>) => setKeys((k) => (k ? { ...k, ...patch } : k));

  return (
    <details class="adv">
      <summary>Advanced settings</summary>
      <div class="card">
        <div class="field" style="margin-bottom:12px">
          <label>Amazon marketplaces (comma-separated)</label>
          <input type="text" value={markets} placeholder="amazon.com, amazon.co.uk"
            onInput={(e) => setMarkets((e.target as HTMLInputElement).value)} />
        </div>
        <div class="rowflex" style="margin-bottom:12px">
          <label class="check"><input type="checkbox" checked={comments} onChange={(e) => setComments((e.target as HTMLInputElement).checked)} /> Scan pinned / top comments</label>
          <label class="check"><input type="checkbox" checked={tabsOnly} onChange={(e) => setTabsOnly((e.target as HTMLInputElement).checked)} /> Tabs only (stealthiest, slower)</label>
        </div>
        <div class="rowflex">
          <div class="field"><label>Pace min (ms)</label><input type="number" value={pMin} style="min-width:120px" onInput={(e) => setPMin(Number((e.target as HTMLInputElement).value))} /></div>
          <div class="field"><label>Pace max (ms)</label><input type="number" value={pMax} style="min-width:120px" onInput={(e) => setPMax(Number((e.target as HTMLInputElement).value))} /></div>
        </div>
        <div class="rowflex" style="margin-top:14px">
          <button class="btn primary" onClick={saveAudit}>Save audit settings</button>
          {saved && <span class="muted">Saved ✓</span>}
          <div style="flex:1" />
          <button class="btn danger ghost" onClick={onReset}>Reset all audit data</button>
        </div>
      </div>

      <div class="card">
        <h2>AI &amp; Amazon API (optional)</h2>
        <p class="sub">Add these to enable AI replacement suggestions for broken links. Keys stay on your computer. See SETUP.md.</p>
        {keys && (
          <>
            <div class="rowflex" style="margin-bottom:10px">
              <div class="field"><label>PA-API Access Key</label><input type="text" value={keys.paapiAccessKey} onInput={(e) => setK({ paapiAccessKey: (e.target as HTMLInputElement).value })} /></div>
              <div class="field"><label>PA-API Secret Key</label><input type="password" value={keys.paapiSecretKey} onInput={(e) => setK({ paapiSecretKey: (e.target as HTMLInputElement).value })} /></div>
            </div>
            <div class="rowflex" style="margin-bottom:10px">
              <div class="field"><label>Partner (Associates) tag</label><input type="text" value={keys.paapiPartnerTag} placeholder="yourname-20" onInput={(e) => setK({ paapiPartnerTag: (e.target as HTMLInputElement).value })} /></div>
              <div class="field"><label>PA-API region</label><input type="text" value={keys.paapiRegion} placeholder="us-east-1" onInput={(e) => setK({ paapiRegion: (e.target as HTMLInputElement).value })} /></div>
            </div>
            <div class="rowflex" style="margin-bottom:10px">
              <div class="field"><label>LLM API key (Anthropic)</label><input type="password" value={keys.llmApiKey} onInput={(e) => setK({ llmApiKey: (e.target as HTMLInputElement).value })} /></div>
              <div class="field"><label>LLM model</label><input type="text" value={keys.llmModel} onInput={(e) => setK({ llmModel: (e.target as HTMLInputElement).value })} /></div>
            </div>
            <div class="rowflex"><button class="btn primary" onClick={saveKeys}>Save keys</button>{keysSaved && <span class="muted">Saved ✓</span>}</div>
          </>
        )}
      </div>
    </details>
  );
}

// ── Root ────────────────────────────────────────────────────────────────────
function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [payload, setPayload] = useState<ReportPayload | null>(null);
  const [active, setActive] = useState<Set<DisplayStatus>>(new Set());
  const [search, setSearch] = useState("");
  const [apiKeys, setApiKeys] = useState<ApiKeys | null>(null);
  const [suggestions, setSuggestions] = useState<Record<string, ReplacementSuggestion>>({});
  const [suggesting, setSuggesting] = useState<Set<string>>(new Set());
  const [aiError, setAiError] = useState("");
  const [addError, setAddError] = useState("");
  const [adding, setAdding] = useState(false);

  const refreshState = async () => setState(await sendMessage<AppState>({ type: "GET_STATE" }));
  const refreshReport = async () => setPayload(await sendMessage<ReportPayload>({ type: "GET_REPORT" }));

  useEffect(() => {
    refreshState(); refreshReport();
    sendMessage<ApiKeys>({ type: "GET_API_KEYS" }).then(setApiKeys);
    const onMsg = (m: unknown) => {
      const msg = m as { type?: string; state?: AppState };
      if (msg?.type === "STATE_CHANGED" && msg.state) { setState(msg.state); refreshReport(); }
    };
    chrome.runtime.onMessage.addListener(onMsg);
    const poll = setInterval(refreshReport, 5000);
    return () => { chrome.runtime.onMessage.removeListener(onMsg); clearInterval(poll); };
  }, []);

  // Seed suggestions from cached replacements.
  useEffect(() => {
    if (!payload) return;
    const m: Record<string, ReplacementSuggestion> = {};
    for (const s of payload.replacements) m[s.forAsin] = s;
    setSuggestions((prev) => ({ ...m, ...prev }));
  }, [payload]);

  const job = state?.job ?? null;
  const ownerTags = job?.settings.ownerTags ?? [];
  const rows = useMemo(() => (payload ? buildOccurrenceRows(payload, ownerTags) : []), [payload, ownerTags]);
  const counts = useMemo(() => {
    const c = emptyCounts();
    for (const r of rows) c[r.status] += 1;
    return c;
  }, [rows]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (active.size && !active.has(r.status)) return false;
      if (!q) return true;
      return r.asin.toLowerCase().includes(q) || r.rawUrl.toLowerCase().includes(q) || r.videoTitle.toLowerCase().includes(q);
    });
  }, [rows, active, search]);

  const aiEnabled = Boolean(apiKeys?.paapiAccessKey && apiKeys?.paapiSecretKey && apiKeys?.paapiPartnerTag && apiKeys?.llmApiKey);

  function toggle(s: DisplayStatus) {
    setActive((prev) => { const n = new Set(prev); n.has(s) ? n.delete(s) : n.add(s); return n; });
  }
  async function reset() {
    if (!confirm("Clear this channel's audit results? Settings are kept.")) return;
    await sendMessage({ type: "RESET_AUDIT" }); refreshState(); refreshReport();
  }
  // Interactive auth MUST run here (real user gesture, persistent page) — not in
  // the popup (which closes) or the service worker (which loses the gesture).
  async function addChannel() {
    setAddError(""); setAdding(true);
    try {
      const tr = await signInInteractive();
      const res = await sendMessage<AddChannelResult>({
        type: "REGISTER_CHANNEL", accessToken: tr.accessToken, expiresAt: tr.expiresAt, email: tr.email,
      });
      if (!res.ok) setAddError(res.error ?? "Couldn't add channel.");
      else await refreshState();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }
  async function onSuggest(asin: string) {
    setAiError("");
    setSuggesting((s) => new Set(s).add(asin));
    const res = await sendMessage<SuggestResult>({ type: "SUGGEST_REPLACEMENTS", asin });
    setSuggesting((s) => { const n = new Set(s); n.delete(asin); return n; });
    if (res.ok && res.suggestion) setSuggestions((prev) => ({ ...prev, [asin]: res.suggestion! }));
    else if (!res.ok) setAiError(res.error ?? "Couldn't get suggestions.");
  }

  if (!state) return <div class="container"><p class="muted">Loading…</p></div>;

  // No channels yet.
  if (state.channels.length === 0) {
    return (<>
      <TopBar state={state} onChange={refreshState} onAdd={addChannel} adding={adding} />
      <div class="container">
        <div class="card hero">
          <h2>Add your YouTube channel</h2>
          <p class="sub">Sign in with Google (read-only) to get started. Pick the channel you want in Google's picker. You can add more channels later.</p>
          <button class="btn primary lg" disabled={adding} onClick={addChannel}>{adding ? "Connecting…" : "Add channel"}</button>
        </div>
        {addError && (
          <div class="banner error"><span class="ic">⚠</span><span>{addError}</span></div>
        )}
        <p class="small muted" style="text-align:center;margin-top:8px">
          Google redirect URL (must be registered in your OAuth client):<br />
          <code>{getRedirectUrl()}</code>
        </p>
      </div>
    </>);
  }

  const activeChannel = state.channels.find((c) => c.channelId === state.activeChannelId);
  const hasData = rows.length > 0 || (job?.stats.checked ?? 0) > 0;
  const needsTag = ownerTags.length === 0;

  return (
    <>
      <TopBar state={state} onChange={refreshState} onAdd={addChannel} adding={adding} />
      <div class="container">
        {activeChannel?.needsReauth && (
          <div class="banner warn"><span class="ic">⚠</span><span>This channel needs reconnecting — click <b>+ Channel</b> and pick it again.</span></div>
        )}
        {addError && <div class="banner error"><span class="ic">⚠</span><span>{addError}</span></div>}
        {job?.commentAccessNote && <div class="banner info"><span class="ic">ℹ</span><span>{job.commentAccessNote}</span></div>}
        {job?.lastError && <div class="banner error"><span class="ic">⚠</span><span>{job.lastError}</span></div>}
        {aiError && <div class="banner error"><span class="ic">⚠</span><span>{aiError}</span></div>}

        {needsTag && <TagSetup settings={job!.settings} prominent />}
        {job && <RunCard job={job} onChange={refreshState} />}

        {hasData && (
          <>
            <h2 style="margin:22px 0 4px">Summary</h2>
            <Summary rows={rows} />
            <div class="card" style="margin-top:16px">
              <div class="rowflex" style="justify-content:space-between; margin-bottom:12px">
                <StatusChips active={active} counts={counts} onToggle={toggle} />
                <div class="rowflex">
                  <SearchBox value={search} onInput={setSearch} />
                  <button class="btn" onClick={() => downloadCsv(rows)}>Export CSV</button>
                </div>
              </div>
              {!aiEnabled && (
                <p class="small muted" style="margin-bottom:8px">💡 Add Amazon &amp; AI keys in Advanced to get replacement suggestions for broken links.</p>
              )}
              <ReportTable rows={filtered} aiEnabled={aiEnabled} suggestions={suggestions} suggesting={suggesting} onSuggest={onSuggest} />
            </div>
            {payload && <Corrections payload={payload} ownerTags={ownerTags} rows={rows} />}
          </>
        )}

        {!needsTag && job && <TagSetup settings={job.settings} prominent={false} />}
        {job && <Advanced settings={job.settings} onReset={reset} />}
      </div>
    </>
  );
}

render(<App />, document.getElementById("app")!);
