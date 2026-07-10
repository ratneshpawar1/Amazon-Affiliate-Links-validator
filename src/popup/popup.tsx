// Popup = launcher only. Add a channel, see status, open the dashboard.

import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { sendMessage } from "../lib/messages";
import type { AppState, AddChannelResult } from "../lib/messages";
import type { JobState } from "../lib/types";
import { isConfigured } from "../lib/auth";

function phaseLabel(job: JobState): string {
  switch (job.phase) {
    case "idle": return "Idle";
    case "ingest": return `Reading videos… (${job.stats.videos})`;
    case "extract": return "Extracting links…";
    case "check": return `Checking… (${job.stats.checked}/${job.stats.links})`;
    case "parked": return `Paused — ${job.parkedReason ?? "parked"}`;
    case "done": return "Audit complete";
  }
}

function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const configured = isConfigured();

  async function refresh() {
    setState(await sendMessage<AppState>({ type: "GET_STATE" }));
  }
  useEffect(() => {
    refresh();
    const onMsg = (m: unknown) => {
      const msg = m as { type?: string; state?: AppState };
      if (msg?.type === "STATE_CHANGED" && msg.state) setState(msg.state);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, []);

  async function addChannel() {
    setBusy(true); setError("");
    const res = await sendMessage<AddChannelResult>({ type: "ADD_CHANNEL" });
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Couldn't add channel.");
    else refresh();
  }
  async function start() {
    setBusy(true); setError("");
    const res = await sendMessage<{ ok: boolean; error?: string }>({ type: "START_AUDIT" });
    setBusy(false);
    if (!res.ok) setError(res.error ?? "Could not start.");
    else refresh();
  }
  const openDashboard = () => sendMessage({ type: "OPEN_DASHBOARD" });

  if (!configured) {
    return (
      <div class="stack">
        <h1>Affiliate Link Auditor</h1>
        <p class="err">Your Google Client ID isn't set yet.</p>
        <p class="muted">Open <b>SETUP.md</b> step 3, then <code>npm run build</code> and reload.</p>
      </div>
    );
  }

  const channels = state?.channels ?? [];
  const active = channels.find((c) => c.channelId === state?.activeChannelId);
  const job = state?.job ?? null;

  return (
    <div class="stack">
      <h1>Affiliate Link Auditor</h1>

      {channels.length === 0 ? (
        <div class="row">
          <button disabled={busy} onClick={addChannel}>
            {busy ? "Connecting…" : "Add your channel"}
          </button>
          <div class="muted" style="margin-top:6px">Read-only YouTube access.</div>
        </div>
      ) : (
        <>
          <div class="row">Channel: <b>{active?.title ?? "—"}</b></div>
          {job && <div class="row"><span class="pill">{phaseLabel(job)}</span></div>}
          <div class="row stack">
            {(!job || job.phase === "idle" || job.phase === "done") && (
              <button disabled={busy} onClick={start}>Run audit</button>
            )}
            <button class="secondary" onClick={openDashboard}>Open dashboard</button>
            <button class="secondary" disabled={busy} onClick={addChannel}>+ Add another channel</button>
          </div>
        </>
      )}

      {error && <div class="row err">{error}</div>}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
