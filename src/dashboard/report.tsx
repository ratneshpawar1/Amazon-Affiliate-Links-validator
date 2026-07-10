// Report table (plan §M5): one row per ASIN with status badge, resolved link,
// evidence, tags seen, expandable video occurrences, and — for broken links,
// when AI is configured — on-demand replacement suggestions (Feature B).

import { useState } from "preact/hooks";
import type { OccurrenceRow, DisplayStatus } from "../lib/report";
import type { ReplacementSuggestion } from "../lib/types";
import { STATUS_LABEL, STATUS_ORDER } from "./filters";

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span class={`badge b-${status}`}>{STATUS_LABEL[status]}</span>;
}

const BROKEN: DisplayStatus[] = ["delisted", "unavailable", "redirected_asin"];

interface Group {
  asin: string;
  resolvedUrl: string;
  marketplace: string;
  asinStatus: DisplayStatus;
  losing: boolean;
  tagsSeen: string[];
  evidence: string;
  rows: OccurrenceRow[];
}

function severityRank(s: DisplayStatus): number {
  const i = STATUS_ORDER.indexOf(s);
  return i < 0 ? 999 : i;
}

function groupByAsin(rows: OccurrenceRow[]): Group[] {
  const map = new Map<string, Group>();
  for (const r of rows) {
    let g = map.get(r.asin);
    if (!g) {
      g = {
        asin: r.asin, resolvedUrl: r.resolvedUrl, marketplace: r.marketplace,
        asinStatus: r.status, losing: false, tagsSeen: [], evidence: r.evidence, rows: [],
      };
      map.set(r.asin, g);
    }
    g.rows.push(r);
    if (r.evidence && !g.evidence) g.evidence = r.evidence;
    if (severityRank(r.status) < severityRank(g.asinStatus)) g.asinStatus = r.status;
    if (r.status === "tag_missing_or_wrong") g.losing = true;
    if (r.tag && !g.tagsSeen.includes(r.tag)) g.tagsSeen.push(r.tag);
  }
  return [...map.values()].sort(
    (a, b) => severityRank(a.asinStatus) - severityRank(b.asinStatus)
  );
}

export interface ReportTableProps {
  rows: OccurrenceRow[];
  aiEnabled?: boolean;
  suggestions?: Record<string, ReplacementSuggestion>;
  suggesting?: Set<string>;
  onSuggest?: (asin: string) => void;
}

function Suggestions({ s }: { s: ReplacementSuggestion }) {
  if (!s.candidates.length) {
    return <div class="occ muted">{s.note ?? "No suggestions."}</div>;
  }
  return (
    <div style="margin-top:6px">
      {s.note && <div class="occ muted">{s.note}</div>}
      {s.candidates.map((c) => (
        <div class="occ" key={c.asin} style="display:flex; gap:8px; align-items:center">
          {c.image && <img src={c.image} alt="" width="34" height="34" style="border-radius:6px" />}
          <div style="flex:1; min-width:0">
            <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a>
            {c.price && <span class="muted"> — {c.price}</span>}
          </div>
          <button class="btn ghost" onClick={() => navigator.clipboard.writeText(c.url)}>
            Copy link
          </button>
        </div>
      ))}
    </div>
  );
}

function OccurrenceList({ rows }: { rows: OccurrenceRow[] }) {
  return (
    <div>
      {rows.map((r, i) => (
        <div class="occ" key={i}>
          <a href={r.videoUrl} target="_blank" rel="noreferrer">{r.videoTitle}</a>{" "}
          <span class="muted">({r.source})</span>{" — "}
          <StatusBadge status={r.status} />{" "}
          {r.tag ? (
            <span class="muted">tag=<code>{r.tag}</code> {r.tagOk ? "✓" : "✗"}</span>
          ) : (
            <span class="muted">no tag</span>
          )}
        </div>
      ))}
    </div>
  );
}

function Row({ g, p }: { g: Group; p: ReportTableProps }) {
  const [open, setOpen] = useState(false);
  const broken = BROKEN.includes(g.asinStatus);
  const suggestion = p.suggestions?.[g.asin];
  const isSuggesting = p.suggesting?.has(g.asin);

  return (
    <tr class={g.losing || g.asinStatus === "redirected_asin" ? "loud" : ""}>
      <td>
        <StatusBadge status={g.asinStatus} />
        {g.losing && g.asinStatus !== "tag_missing_or_wrong" && (
          <div class="muted" style="font-size:11px">+ losing commission</div>
        )}
      </td>
      <td>
        <code>{g.asin}</code>
        <div><a href={g.resolvedUrl} target="_blank" rel="noreferrer">{g.marketplace}</a></div>
      </td>
      <td>{g.evidence}</td>
      <td>{g.tagsSeen.length ? g.tagsSeen.map((t) => <code>{t} </code>) : <span class="muted">—</span>}</td>
      <td>
        <button class="btn ghost" onClick={() => setOpen((v) => !v)}>
          {g.rows.length} video{g.rows.length === 1 ? "" : "s"} {open ? "▾" : "▸"}
        </button>
        {open && <OccurrenceList rows={g.rows} />}
        {broken && p.aiEnabled && (
          <div style="margin-top:8px">
            {!suggestion && (
              <button class="btn" disabled={isSuggesting} onClick={() => p.onSuggest?.(g.asin)}>
                {isSuggesting ? "Finding replacements…" : "✨ Suggest replacements"}
              </button>
            )}
            {suggestion && <Suggestions s={suggestion} />}
          </div>
        )}
      </td>
    </tr>
  );
}

export function ReportTable(props: ReportTableProps) {
  const groups = groupByAsin(props.rows);
  if (!groups.length) return <div class="empty">No links match this filter yet.</div>;
  return (
    <div class="tablewrap">
      <table>
        <thead>
          <tr>
            <th>Status</th>
            <th>ASIN / Marketplace</th>
            <th>Evidence</th>
            <th>Tags seen</th>
            <th>Occurrences</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => (
            <Row key={g.asin} g={g} p={props} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
