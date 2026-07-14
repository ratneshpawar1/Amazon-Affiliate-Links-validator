// Ingestion pipeline (plan §M2), scoped to one channel's store.
//
// Crash-only: exactly one API call per step, cursor persisted after every step,
// so a service-worker kill mid-run loses at most one page.

import {
  getMyChannel,
  listPlaylistPage,
  listVideos,
  listTopComments,
  QuotaExceededError,
  type YoutubeDeps,
} from "../lib/youtube";
import type { ChannelStore } from "../lib/storage";
import type { JobState } from "../lib/types";
import { nextMidnightPacificISO } from "../lib/time";

export interface StepResult {
  more: boolean;
  parked: boolean;
  batch?: boolean; // hit the per-batch video cap; awaiting approval
}

export type IngestStatus = "complete" | "batch" | "parked";

/** Ensure the uploads playlist is known and the cursor is initialised. */
export async function beginIngest(store: ChannelStore, deps?: YoutubeDeps): Promise<void> {
  const channel = await getMyChannel(deps);
  await store.mutateJob((job) => {
    job.channelId = channel.channelId;
    job.channelTitle = channel.title;
    job.uploadsPlaylistId = channel.uploadsPlaylistId;
    job.phase = "ingest";
    job.lastError = undefined;
    if (!job.ingestCursor) {
      job.ingestCursor = {
        pageToken: undefined,
        playlistDone: false,
        pendingVideoIdBatches: [],
        commentQueue: [],
      };
    }
  });
}

function parkOnQuota(job: JobState): void {
  job.phase = "parked";
  job.parkedUntil = nextMidnightPacificISO();
  job.parkedReason = "YouTube API quota reached — resuming after midnight Pacific.";
}

/** One unit of ingest work, persisted. Parks (not throws) on quota. */
export async function stepIngest(store: ChannelStore, deps?: YoutubeDeps): Promise<StepResult> {
  let result: StepResult = { more: true, parked: false };

  await store.mutateJob(async (job) => {
    if (!job.uploadsPlaylistId || !job.ingestCursor) {
      result = { more: false, parked: false };
      return;
    }
    const cur = job.ingestCursor;

    // Per-batch video cap: if we've read the batch limit and there's still more
    // to read, stop and wait for the user's approval.
    const limit = job.settings.videoLimitPerBatch;
    const ingestComplete =
      cur.playlistDone && cur.pendingVideoIdBatches.length === 0 && cur.commentQueue.length === 0;
    if (limit > 0 && job.videosThisBatch >= limit && !ingestComplete) {
      result = { more: false, parked: false, batch: true };
      return;
    }

    try {
      // Phase A: page the uploads playlist.
      if (!cur.playlistDone) {
        const page = await listPlaylistPage(job.uploadsPlaylistId, cur.pageToken, deps);
        if (page.videoIds.length) cur.pendingVideoIdBatches.push(page.videoIds);
        cur.pageToken = page.nextPageToken;
        if (!page.nextPageToken) cur.playlistDone = true;
        return;
      }

      // Phase B: full video snippets, 1 batch (≤50) per step.
      if (cur.pendingVideoIdBatches.length) {
        const batch = cur.pendingVideoIdBatches.shift()!;
        const vids = await listVideos(batch, deps);
        for (const v of vids) {
          await store.putVideo({
            videoId: v.videoId,
            title: v.title,
            url: `https://www.youtube.com/watch?v=${v.videoId}`,
            description: v.description,
            publishedAt: v.publishedAt,
            commentsFetched: false,
          });
          job.stats.videos += 1;
          job.videosThisBatch += 1;
          if (job.settings.fetchComments) cur.commentQueue.push(v.videoId);
        }
        return;
      }

      // Phase C: one relevance page of comments per video (if enabled).
      if (cur.commentQueue.length) {
        const videoId = cur.commentQueue.shift()!;
        const { comments, disabled, skipped } = await listTopComments(videoId, deps);
        if (skipped) {
          job.commentAccessNote =
            "Comment scanning isn't available with read-only access on this account — your video descriptions were still scanned in full.";
          cur.commentQueue = [];
        } else if (!disabled && comments.length) {
          await store.putComments(videoId, comments);
        }
        const v = await store.getVideo(videoId);
        if (v) {
          v.commentsFetched = true;
          v.commentsDisabled = disabled;
          await store.putVideo(v);
        }
        return;
      }

      job.phase = "extract";
      result = { more: false, parked: false };
    } catch (e) {
      if (e instanceof QuotaExceededError) {
        parkOnQuota(job);
        result = { more: false, parked: true };
        return;
      }
      throw e;
    }
  });

  return result;
}

export async function runIngest(store: ChannelStore, deps?: YoutubeDeps): Promise<IngestStatus> {
  await beginIngest(store, deps);
  for (;;) {
    const { more, parked, batch } = await stepIngest(store, deps);
    if (parked) return "parked";
    if (batch) return "batch";
    if (!more) return "complete";
  }
}
