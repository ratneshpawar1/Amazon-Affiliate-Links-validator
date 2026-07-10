// Extraction pipeline (plan §M3), scoped to one channel's store. Reads ingested
// videos + comments, resolves short links, folds every occurrence into the ASIN
// reverse index, and enqueues unchecked ASINs for the checker.

import { extractLinks, buildIndex, hashString, type SourceDoc } from "../lib/extract";
import { resolveShortLink, type Fetcher } from "../lib/shortlinks";
import type { ChannelStore } from "../lib/storage";

export interface ExtractDeps {
  fetcher?: Fetcher;
}

async function resolveShortLinksInDocs(
  store: ChannelStore,
  docs: SourceDoc[],
  deps: ExtractDeps
): Promise<SourceDoc[]> {
  const out: SourceDoc[] = [];
  for (const doc of docs) {
    let text = doc.text;
    for (const ref of extractLinks(doc.text)) {
      if (ref.kind !== "short") continue;
      let resolved = await store.getShort(ref.rawUrl);
      if (resolved === undefined) {
        const r = deps.fetcher
          ? await resolveShortLink(ref.rawUrl, deps.fetcher)
          : await resolveShortLink(ref.rawUrl);
        resolved = r.resolvedUrl ?? "";
        await store.putShort(ref.rawUrl, resolved);
      }
      if (resolved) text = text.split(ref.rawUrl).join(resolved);
    }
    out.push({ ...doc, text });
  }
  return out;
}

export async function runExtract(store: ChannelStore, deps: ExtractDeps = {}): Promise<void> {
  await store.mutateJob((job) => {
    job.phase = "extract";
  });

  const videos = await store.allVideos();
  const docs: SourceDoc[] = [];
  for (const v of videos) {
    docs.push({ videoId: v.videoId, source: "description", text: v.description });
    for (const c of await store.getComments(v.videoId)) {
      docs.push({ videoId: v.videoId, source: "comment", commentId: c.commentId, text: c.text });
    }
  }

  const resolvedDocs = await resolveShortLinksInDocs(store, docs, deps);
  const { links, nonProduct } = buildIndex(resolvedDocs);

  for (const link of links) await store.putLink(link);
  for (const np of nonProduct) await store.putNonProduct(hashString(np.rawUrl), np);

  const queue: string[] = [];
  for (const link of links) {
    if (!(await store.getResult(link.asin))) queue.push(link.asin);
  }

  await store.mutateJob((job) => {
    job.stats.links = links.length;
    job.checkQueue = queue;
    job.phase = "check";
  });
}
