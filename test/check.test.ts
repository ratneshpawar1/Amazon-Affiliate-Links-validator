import { describe, it, expect, beforeEach } from "vitest";
import { installChromeStorageMock } from "./helpers/chromeStorageMock";
import { channelStore, newJobState, type ChannelStore } from "../src/lib/storage";
import { processNextCheck, type CheckOutcome } from "../src/jobs/check";
import type { Link } from "../src/lib/types";

const CH = "UC_test";

function link(asin: string): Link {
  return { asin, resolvedUrl: `https://www.amazon.com/dp/${asin}`, marketplace: "amazon.com", tagsSeen: [], occurrences: [] };
}
function outcome(status: CheckOutcome["classification"]["status"], asin: string): CheckOutcome {
  return { classification: { status, requestedAsin: asin, evidence: "e", signals: {} }, method: "fetch" };
}

async function seed(store: ChannelStore, asins: string[]) {
  const job = newJobState();
  job.phase = "check";
  job.checkQueue = [...asins];
  job.stats.links = asins.length;
  await store.saveJob(job);
  for (const a of asins) await store.putLink(link(a));
}

describe("checker queue runner (plan §M4 resumability)", () => {
  let store: ChannelStore;
  beforeEach(() => {
    installChromeStorageMock();
    store = channelStore(CH);
  });

  it("checks each ASIN exactly once and finishes, even across 'kills'", async () => {
    await seed(store, ["A1", "A2", "A3"]);
    const seen: Record<string, number> = {};
    const runCheck = async (asin: string) => {
      seen[asin] = (seen[asin] ?? 0) + 1;
      return outcome("ok", asin);
    };
    let guard = 0;
    for (;;) {
      const r = await processNextCheck(store, { runCheck, now: () => 0 });
      if (r.done || guard++ > 20) break;
    }
    expect(seen).toEqual({ A1: 1, A2: 1, A3: 1 });
    expect((await store.allResults()).length).toBe(3);
    const job = await store.getJob();
    expect(job!.phase).toBe("done");
    expect(job!.checkQueue.length).toBe(0);
  });

  it("does not re-check an ASIN that already has a result", async () => {
    await seed(store, ["A1"]);
    let calls = 0;
    const runCheck = async (asin: string) => { calls++; return outcome("ok", asin); };
    await processNextCheck(store, { runCheck, now: () => 0 });
    const job = await store.getJob();
    job!.phase = "check";
    job!.checkQueue = ["A1"];
    await store.saveJob(job!);
    await processNextCheck(store, { runCheck, now: () => 0 });
    expect(calls).toBe(1);
  });

  it("parks the whole job after 3 consecutive blocks", async () => {
    await seed(store, ["B1", "B2", "B3", "B4"]);
    const runCheck = async (asin: string) => outcome("blocked", asin);
    let parked = false;
    for (let i = 0; i < 4; i++) {
      const r = await processNextCheck(store, { runCheck, now: () => 1_000_000 });
      if (r.parked) parked = true;
    }
    expect(parked).toBe(true);
    const job = await store.getJob();
    expect(job!.phase).toBe("parked");
    expect(job!.consecutiveBlocks).toBe(3);
    expect(job!.parkedUntil).toBeTruthy();
    expect(job!.checkQueue).toContain("B4");
  });

  it("resets the consecutive-block counter on a non-block result", async () => {
    await seed(store, ["C1", "C2"]);
    const runCheck = async (asin: string) => (asin === "C1" ? outcome("blocked", asin) : outcome("ok", asin));
    await processNextCheck(store, { runCheck, now: () => 0 });
    await processNextCheck(store, { runCheck, now: () => 0 });
    expect((await store.getJob())!.consecutiveBlocks).toBe(0);
  });

  it("isolates channels: A's audit does not touch B's data", async () => {
    const a = channelStore("UC_a");
    const b = channelStore("UC_b");
    await seed(a, ["X1"]);
    await seed(b, ["Y1"]);
    const runCheck = async (asin: string) => outcome("ok", asin);
    await processNextCheck(a, { runCheck, now: () => 0 });
    expect((await a.allResults()).map((r) => r.asin)).toEqual(["X1"]);
    expect((await b.allResults()).length).toBe(0);
    expect((await b.getJob())!.checkQueue).toEqual(["Y1"]);
  });
});
