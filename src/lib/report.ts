// Report model (plan §5, §M5). Derived at render time — never persisted. Joins
// result:<asin> × link:<asin> × video:<id> into one row per OCCURRENCE, because
// tag correctness is decided per-occurrence (the same ASIN can appear once with
// the right tag and once untagged) while page-liveness is per-ASIN.

import type { ReportPayload } from "./messages";
import type { CheckStatus, CheckResult, Video } from "./types";
import { tagOf } from "./extract";

export type DisplayStatus = CheckStatus | "pending";

export interface OccurrenceRow {
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  source: "description" | "comment";
  commentId?: string;
  rawUrl: string;
  asin: string;
  resolvedUrl: string;
  marketplace: string;
  tag: string; // this occurrence's tag ("" if none)
  tagOk: boolean;
  status: DisplayStatus; // ASIN-level status, downgraded to tag_missing_or_wrong per-occurrence
  evidence: string;
  checkedAt: string;
}

/** A tag is "ok" only if it's present AND one of the owner's configured tags. */
export function tagIsOk(tag: string | undefined, ownerTags: string[]): boolean {
  return !!tag && ownerTags.includes(tag);
}

/**
 * Per-occurrence status: a live ASIN (`ok`) is downgraded to
 * `tag_missing_or_wrong` for any occurrence whose own tag is wrong/missing.
 */
export function occurrenceStatus(
  asinStatus: DisplayStatus,
  tagOk: boolean
): DisplayStatus {
  if (asinStatus === "ok" && !tagOk) return "tag_missing_or_wrong";
  return asinStatus;
}

export function buildOccurrenceRows(
  payload: ReportPayload,
  ownerTags: string[]
): OccurrenceRow[] {
  const videoById = new Map<string, Video>(payload.videos.map((v) => [v.videoId, v]));
  const resultByAsin = new Map<string, CheckResult>(
    payload.results.map((r) => [r.asin, r])
  );

  const rows: OccurrenceRow[] = [];
  for (const link of payload.links) {
    const result = resultByAsin.get(link.asin);
    const asinStatus: DisplayStatus = result ? result.status : "pending";
    for (const occ of link.occurrences) {
      const video = videoById.get(occ.videoId);
      const tag = tagOf(occ.rawUrl) ?? "";
      const tagOk = tagIsOk(tag, ownerTags);
      rows.push({
        videoId: occ.videoId,
        videoTitle: video?.title ?? "(unknown video)",
        videoUrl: video?.url ?? `https://www.youtube.com/watch?v=${occ.videoId}`,
        source: occ.source,
        commentId: occ.commentId,
        rawUrl: occ.rawUrl,
        asin: link.asin,
        resolvedUrl: link.resolvedUrl,
        marketplace: link.marketplace,
        tag,
        tagOk,
        status: occurrenceStatus(asinStatus, tagOk),
        evidence: result?.evidence ?? "",
        checkedAt: result?.checkedAt ?? "",
      });
    }
  }
  return rows;
}

/** Occurrences that are actively losing commission on a live page. */
export function isLosingCommission(row: OccurrenceRow): boolean {
  return row.status === "tag_missing_or_wrong";
}
