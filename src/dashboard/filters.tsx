// Status filter chips + free-text search (plan §M5).

import type { DisplayStatus } from "../lib/report";

export const STATUS_ORDER: DisplayStatus[] = [
  "tag_missing_or_wrong",
  "redirected_asin",
  "unavailable",
  "delisted",
  "blocked",
  "ok",
  "pending",
];

export const STATUS_LABEL: Record<DisplayStatus, string> = {
  tag_missing_or_wrong: "Tag missing/wrong",
  redirected_asin: "Redirected ASIN",
  unavailable: "Unavailable",
  delisted: "Delisted",
  blocked: "Blocked",
  ok: "OK",
  pending: "Pending",
};

export function StatusChips(props: {
  active: Set<DisplayStatus>;
  counts: Record<DisplayStatus, number>;
  onToggle: (s: DisplayStatus) => void;
}) {
  return (
    <div class="chips">
      {STATUS_ORDER.map((s) => (
        <span
          key={s}
          class={`pill chip b-${s}`}
          role="button"
          aria-pressed={props.active.has(s)}
          onClick={() => props.onToggle(s)}
        >
          {STATUS_LABEL[s]} ({props.counts[s] ?? 0})
        </span>
      ))}
    </div>
  );
}

export function SearchBox(props: { value: string; onInput: (v: string) => void }) {
  return (
    <input
      type="text"
      placeholder="Search ASIN, URL, video title…"
      value={props.value}
      style="min-width:240px"
      onInput={(e) => props.onInput((e.target as HTMLInputElement).value)}
    />
  );
}
